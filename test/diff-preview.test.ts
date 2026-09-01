import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it } from 'vite-plus/test'

import { createPreviewApp } from '../src/app.js'
import { memoryManuscript } from '../src/manuscript.js'
import { typesetCss } from '../src/typesetting/typeset.css.js'
import { webCss } from '../src/typesetting/web.css.js'

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

async function initRepo(
  prefix: string,
  body = '# 初版\n\n古い段落。\n\n残す段落。\n',
): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.name', 't'])
  git(dir, ['config', 'user.email', 't@example.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  const file = join(dir, 'index.md')
  await writeFile(file, body)
  git(dir, ['add', '--', 'index.md'])
  git(dir, ['commit', '-m', 'init'])
  return { dir, file }
}

function assertSecurityHeaders(headers: Headers): void {
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.match(headers.get('Content-Security-Policy') ?? '', /script-src 'self'/)
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string | null> {
  const decoder = new TextDecoder()
  let buffered = ''
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const race = await Promise.race([
      reader.read(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), remaining)),
    ])
    if (race === 'timeout' || race.done) return null
    buffered += decoder.decode(race.value, { stream: true })
    if (pattern.test(buffered)) return buffered
  }
}

describe('preview /diff', () => {
  it('marks added and removed segments against HEAD', async () => {
    const { dir, file } = await initRepo('kumihan-diff-edit-')
    try {
      await writeFile(file, '# 初版\n\n新しい段落。\n\n残す段落。\n')
      const app = createPreviewApp({ source: file })
      const htmlRes = await app.request('/diff.html')
      const alias = await app.request('/diff')
      assert.equal(htmlRes.status, 200)
      assert.equal(alias.status, 200)
      assertSecurityHeaders(htmlRes.headers)
      const html = await htmlRes.text()
      assert.equal(html, await alias.text())
      assert.match(html, /class="diff-removed"/)
      assert.match(html, /古い段落/)
      assert.match(html, /class="diff-added"/)
      assert.match(html, /新しい段落/)
      assert.match(html, /残す段落/)
      assert.match(html, /class="paper"/)
      assert.match(html, /assets\/typeset.css/)
      assert.match(html, /aria-current="page">組版</)
      assert.match(html, /aria-pressed="true">差分</)
      assert.match(html, /href="magazine-diff.html"/)
      assert.match(html, /href="web-diff.html"/)
      assert.match(html, /href="\.\/"[^>]*>差分</)
      assert.doesNotMatch(html, /aria-current="page">差分</)
      const web = await (await app.request('/web.html')).text()
      assert.match(web, /href="web-diff.html"/)
      assert.match(web, /aria-current="page">Web</)
      assert.match(web, /aria-pressed="false">差分</)
      assert.equal(web.includes('diff-added'), false)
      const magazine = await (await app.request('/magazine.html')).text()
      assert.match(magazine, /href="magazine-diff.html"/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('shows the whole manuscript as added when the file is only in the index', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-diff-added-'))
    try {
      git(dir, ['init', '-b', 'main'])
      git(dir, ['config', 'user.name', 't'])
      git(dir, ['config', 'user.email', 't@example.com'])
      git(dir, ['config', 'commit.gpgsign', 'false'])
      const file = join(dir, 'index.md')
      await writeFile(file, '# 新規の原稿\n')
      git(dir, ['add', '--', 'index.md'])
      const app = createPreviewApp({ source: file })
      const html = await (await app.request('/diff')).text()
      assert.match(html, /class="diff-added"/)
      assert.match(html, /新規の原稿/)
      assert.equal(html.includes('diff-removed'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not show the diff switcher for an untracked file', async () => {
    const { dir } = await initRepo('kumihan-diff-untracked-')
    try {
      const extra = join(dir, 'extra.md')
      await writeFile(extra, '# 未追跡\n')
      const app = createPreviewApp({ source: extra })
      const web = await (await app.request('/web.html')).text()
      assert.match(web, /未追跡/)
      assert.equal(web.includes('href="diff.html"'), false)
      const diff = await app.request('/diff')
      assert.equal(diff.status, 200)
      assertSecurityHeaders(diff.headers)
      const html = await diff.text()
      assert.match(html, /差分を表示できません/)
      assert.equal(html.includes('href="diff.html"'), false)
      assert.match(html, /data-kumihan-version="/)
      assert.match(html, /class="paper"/)
      const magazineGuide = await (await app.request('/magazine-diff')).text()
      assert.match(magazineGuide, /差分を表示できません/)
      assert.match(magazineGuide, /cols-2/)
      const webGuide = await (await app.request('/web-diff')).text()
      assert.match(webGuide, /差分を表示できません/)
      assert.match(webGuide, /<body class="web">/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not show the diff switcher outside a repository', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kumihan-diff-outside-'))
    try {
      const file = join(dir, 'index.md')
      await writeFile(file, '# 外\n')
      const app = createPreviewApp({ source: file })
      const html = await (await app.request('/')).text()
      assert.match(html, /外/)
      assert.equal(html.includes('href="diff.html"'), false)
      assert.match(await (await app.request('/diff')).text(), /差分を表示できません/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not show the diff switcher for a piped manuscript', async () => {
    const app = createPreviewApp({ source: memoryManuscript('# パイプ原稿\n') })
    for (const path of ['/', '/magazine.html', '/web.html']) {
      const html = await (await app.request(path)).text()
      assert.match(html, /パイプ原稿/)
      assert.equal(html.includes('href="diff.html"'), false)
    }
    const diff = await (await app.request('/diff')).text()
    assert.match(diff, /差分を表示できません/)
    assert.equal(diff.includes('パイプ原稿'), false)
    assert.match(diff, /class="paper"/)
    assert.match(await (await app.request('/magazine-diff')).text(), /cols-2/)
    assert.match(await (await app.request('/web-diff')).text(), /<body class="web">/)
  })

  it('follows a save on /diff', async () => {
    const { dir, file } = await initRepo('kumihan-diff-sse-')
    try {
      const app = createPreviewApp({ source: file })
      const first = await (await app.request('/diff')).text()
      assert.equal(first.includes('追記の区画'), false)
      const res = await app.request('/events')
      assert.equal(res.status, 200)
      assert.ok(res.body)
      const reader = res.body.getReader()
      try {
        assert.ok(await readUntil(reader, /retry: \d+/, 2000), 'retry line')
        await writeFile(file, '# 初版\n\n古い段落。\n\n残す段落。\n\n追記の区画。\n')
        assert.ok(await readUntil(reader, /data: [0-9a-f]{16}/, 2000), '保存が通知されない')
        const html = await (await app.request('/diff')).text()
        assert.match(html, /追記の区画/)
        assert.match(html, /class="diff-added"/)
      } finally {
        await reader.cancel()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serves magazine and web diffs with the same marks', async () => {
    const { dir, file } = await initRepo('kumihan-diff-layouts-')
    try {
      await writeFile(file, '# 初版\n\n新しい段落。\n\n残す段落。\n')
      const app = createPreviewApp({ source: file })
      const print = await (await app.request('/diff.html')).text()
      const magazine = await (await app.request('/magazine-diff.html')).text()
      const magazineAlias = await (await app.request('/magazine-diff')).text()
      const web = await (await app.request('/web-diff.html')).text()
      const webAlias = await (await app.request('/web-diff')).text()
      assert.equal(magazine, magazineAlias)
      assert.equal(web, webAlias)
      assert.match(print, /<p class="diff-removed">/)
      assert.match(print, /<p class="diff-added">/)
      assert.equal(print.includes('<div class="diff-'), false)
      assert.match(magazine, /cols-2/)
      assert.match(magazine, /aria-current="page">2段</)
      assert.match(magazine, /aria-pressed="true">差分</)
      assert.match(magazine, /href="diff.html">組版</)
      assert.match(magazine, /href="magazine.html"[^>]*>差分</)
      assert.match(web, /<body class="web">/)
      assert.match(web, /assets\/web.css/)
      assert.match(web, /aria-current="page">Web</)
      assert.match(web, /href="web.html"[^>]*>差分</)
      assert.match(web, /<p class="diff-added">/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reuses the assembled magazine diff while HEAD and the manuscript stay put', async () => {
    const { dir, file } = await initRepo('kumihan-diff-cache-mode-')
    try {
      await writeFile(file, '# 初版\n\n新しい段落。\n\n残す段落。\n')
      const app = createPreviewApp({ source: file })
      const first = await (await app.request('/magazine-diff')).text()
      const second = await (await app.request('/magazine-diff')).text()
      assert.equal(second, first)
      const web = await (await app.request('/web-diff')).text()
      assert.notEqual(web, first)
      assert.match(web, /class="diff-added"/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('shows an unmarked typeset page when the manuscript matches HEAD', async () => {
    const { dir, file } = await initRepo('kumihan-diff-same-')
    try {
      const app = createPreviewApp({ source: file })
      const html = await (await app.request('/diff')).text()
      assert.equal(html.includes('diff-added'), false)
      assert.equal(html.includes('diff-removed'), false)
      assert.match(html, /aria-pressed="true">差分</)
      assert.match(html, /aria-current="page">組版</)
      assert.match(html, /古い段落/)
      assert.match(html, /class="paper"/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns the guide page when cat-file cannot read HEAD', async () => {
    const { dir, file } = await initRepo('kumihan-diff-cat-')
    try {
      const oid = git(dir, ['rev-parse', 'HEAD:index.md']).trim()
      await rm(join(dir, '.git', 'objects', oid.slice(0, 2), oid.slice(2)))
      const app = createPreviewApp({ source: file })
      const res = await app.request('/diff')
      assert.equal(res.status, 200)
      const html = await res.text()
      assert.match(html, /差分を表示できません/)
      assert.match(html, /href="diff.html"/)
      assert.match(html, /class="paper"/)
      assert.match(html, /aria-pressed="true">差分</)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns 404 from /diff when the manuscript is missing', async () => {
    const app = createPreviewApp({ source: './content/does-not-exist.md' })
    const res = await app.request('/diff')
    assert.equal(res.status, 404)
    assert.match(await res.text(), /原稿が見つかりません/)
  })

  it('does not break other modes by converting HEAD', async () => {
    const { dir, file } = await initRepo('kumihan-diff-modes-')
    try {
      await writeFile(file, '# 初版\n\n新しい段落。\n\n残す段落。\n')
      const app = createPreviewApp({ source: file })
      const print = await (await app.request('/')).text()
      assert.match(print, /新しい段落/)
      assert.equal(print.includes('diff-added'), false)
      await app.request('/diff')
      assert.equal(await (await app.request('/')).text(), print)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns 500 from /diff without leaking filesystem details', async () => {
    const app = createPreviewApp({ source: './src' })
    const res = await app.request('/diff')
    assert.equal(res.status, 500)
    const html = await res.text()
    assert.match(html, /読み込みに失敗しました/)
    assert.equal(html.includes('EISDIR'), false)
  })

  it('styles added and removed blocks without changing typeset size', () => {
    assert.match(webCss, /\.article \.diff-added/)
    assert.match(webCss, /\.article \.diff-removed/)
    assert.match(webCss, /border-left:\s*4px solid/)
    assert.match(webCss, /ul\.diff-added/)
    assert.match(typesetCss, /\.typeset \.diff-added/)
    assert.match(typesetCss, /left:\s*-2\.4mm/)
    assert.match(typesetCss, /width:\s*1\.2mm/)
    assert.doesNotMatch(typesetCss, /\.typeset \.diff-added[^{]*\{[^}]*padding/)
    assert.doesNotMatch(typesetCss, /\.typeset \.diff-added[^{]*\{[^}]*border-left/)
  })
})
