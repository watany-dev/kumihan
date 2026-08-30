/**
 * Host ヘッダの検査です。
 *
 * プレビューは編集中の原稿をそのまま返すので、既定ではループバックだけに
 * 待ち受けます。ただし「ループバックに待ち受ける」だけでは、閲覧者を選んだ
 * ことになりません。攻撃者のページが自分のドメインを短い TTL で 127.0.0.1 に
 * 差し替えると（DNS リバインディング）、ブラウザから見た生成元は攻撃者の
 * ドメインのまま、接続先だけがこのサーバになります。生成元が同じである以上、
 * CSP も CORS も CORP も止められません。原稿と、原稿ディレクトリの画像が
 * そのまま読み出せます。
 *
 * 防ぎ方は 1 つで、Host ヘッダが自分の名前かどうかを見ることです。
 *
 * - IP リテラル（`127.0.0.1`・`[::1]`・LAN の `192.168.x.y`）は名前ではないので
 *   付け替えようがありません。そのまま通します。
 * - `localhost` と `*.localhost` はブラウザと OS がループバックに固定するので、
 *   これも付け替えられません。
 * - それ以外の名前は、待ち受けに指定された名前か、明示的に許可された名前
 *   （`KUMIHAN_ALLOWED_HOSTS`、Codespaces の転送ドメイン）だけを通します。
 */

// Host ヘッダはクライアントが自由に決められるので、素の authority（ホストと
// 任意のポート）でなければ受け付けません。`evil.com/x?` のような値をそのまま
// URL に埋めると、リクエスト URL のパスやクエリまで差し替えられます。
export const AUTHORITY =
  /^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)(?::\d{1,5})?$/

export interface HostPolicy {
  /** そのまま一致したら通す名前。 */
  readonly names: ReadonlySet<string>
  /** この接尾辞で終わる名前は通す。必ず `.` から始まる。 */
  readonly suffixes: readonly string[]
}

export interface HostPolicyOptions {
  /** `--host` / `KUMIHAN_HOST` に渡された待ち受けアドレス。 */
  host?: string | undefined
  /** `KUMIHAN_ALLOWED_HOSTS`。カンマ区切り。`.example.com` で接尾辞。 */
  allowed?: string | undefined
  /** Codespaces の `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`。 */
  portForwardingDomain?: string | undefined
}

// どれも「全部のアドレスで待つ」という意味で、名前ではありません。許可名に
// 入れても誰の名乗りとも一致しないので、入れません。
const WILDCARD_BIND = new Set(['0.0.0.0', '::', '[::]', '*'])

/**
 * Host ヘッダから、ポートを落とした小文字のホスト名を取り出します。素の
 * authority でなければ null。IPv6 は WHATWG の正規化に合わせて角括弧付きです。
 *
 * ポートは先に落とします。判断に使うのは名前だけなので、範囲外のポート
 * （`localhost:99999`）で名前まで捨てる必要はありません。URL に埋める値の
 * ほうは safeHost が別に均します。
 */
function hostnameOf(host: string): string | null {
  if (host.length > 255 || !AUTHORITY.test(host)) {
    return null
  }
  const name = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : (host.split(':')[0] ?? '')
  if (name.length === 0 || !URL.canParse(`http://${name}/`)) {
    return null
  }
  return new URL(`http://${name}/`).hostname.toLowerCase()
}

// 設定された名前も Host と同じ形に揃えます。`example.com:3000` のように
// ポート付きで書かれても、`example.com` として比べられるようにします。
function normalizeName(entry: string): string {
  return hostnameOf(entry) ?? entry
}

export function createHostPolicy(options: HostPolicyOptions = {}): HostPolicy {
  const names = new Set<string>()
  const suffixes: string[] = []

  const bind = (options.host ?? '').trim().toLowerCase()
  if (bind.length > 0 && !WILDCARD_BIND.has(bind)) {
    names.add(normalizeName(bind))
  }

  for (const raw of (options.allowed ?? '').split(',')) {
    const entry = raw.trim().toLowerCase()
    if (entry.length === 0) continue
    if (entry.startsWith('.')) suffixes.push(entry)
    else names.add(normalizeName(entry))
  }

  const domain = (options.portForwardingDomain ?? '').trim().toLowerCase()
  if (domain.length > 0) {
    suffixes.push(domain.startsWith('.') ? domain : `.${domain}`)
  }

  return { names, suffixes }
}

/** 何も設定しなかったときの方針。ループバックしか通しません。 */
export const LOOPBACK_HOST_POLICY = createHostPolicy()

// URL の正規化を通したあとの形で見ます。IPv6 は角括弧付き、IPv4 は
// 点付き 10 進（`0x7f.1` のような書き方もここへ畳まれます）。
function isIpLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

export function isAllowedHost(host: string | undefined, policy: HostPolicy): boolean {
  // Host の無いリクエストは HTTP/1.0 のクライアントです（`curl --http1.0` や
  // 素朴なヘルスチェック）。ブラウザは必ず送るので、ここを通してもリバイン
  // ディングの経路にはなりません。
  if (host === undefined || host.length === 0) {
    return true
  }

  const hostname = hostnameOf(host)
  if (hostname === null) {
    return false
  }
  if (isIpLiteral(hostname)) {
    return true
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true
  }
  if (policy.names.has(hostname)) {
    return true
  }
  return policy.suffixes.some((suffix) => hostname.endsWith(suffix))
}
