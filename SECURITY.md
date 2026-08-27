# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x     | :white_check_mark: |

Only the latest `main` of `kumihan` is supported. Fixes ship on `main` rather than being backported.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security problem.**

Report it privately through GitHub Security Advisories:
[Report a vulnerability](https://github.com/watany-dev/kumihan/security/advisories/new)

Include, as far as you can:

- what the issue is and how it can be triggered
- the version or commit you tested
- the impact you believe it has (XSS, secret leak, supply chain, and so on)

You should receive an initial response within 72 hours. Once a fix is ready it will land on `main` with an advisory, unless you prefer not to be credited.

## Scope

In scope:

- Markdown to HTML escaping and URL sanitization
- Preview HTTP responses (security headers, error pages, cache policy)
- Static export consumed via GitHub Pages
- CI, GitHub Actions, and dependency installation

Out of scope:

- Browser or GitHub Pages platform behaviour itself
- Secrets in a fork's GitHub Actions logs that the fork owner introduced

## Automated checks

Every pull request runs:

- `vp check` (Oxfmt, Oxlint with warnings denied, type-aware type check)
- `vp test --coverage` (Vitest, 95% thresholds on `src/**`)
- Semgrep (`p/javascript`, `p/typescript`, `p/nodejs`, `p/security-audit`, `p/github-actions`, plus `.semgrep/`)
- Gitleaks
- `bun audit`
- `actionlint` and `zizmor` (pedantic) on workflows
