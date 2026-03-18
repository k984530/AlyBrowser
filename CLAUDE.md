# AlyBrowser

AI 에이전트용 경량 브라우저 자동화 SDK. Chrome Extension Bridge 방식으로 봇 감지를 우회.

## Architecture

- **Extension Bridge**: `src/extension/bridge.ts` — WS 서버 ↔ Chrome Extension
- **Auth**: `src/auth/token.ts` — JWT HS256 sign/verify (no external deps)
- **Content Script**: `extension/content.js` — DOM 스냅샷 + 인터랙션
- **MCP Server**: `src/mcp/server.ts`, `src/mcp/tools.ts`
- **Site Knowledge**: `src/mcp/site-knowledge.ts`

## Build & Test

```bash
npm run build      # tsup (CJS + ESM dual)
npm test           # vitest (550 tests)
npm run coverage   # vitest --coverage
```

## Test Coverage

| Module | Stmts | Branch | Notes |
|--------|-------|--------|-------|
| bridge.ts | 94% | 84% | WS mock-based lifecycle tests |
| token.ts | 100% | 100% | JWT HS256 sign/verify |
| site-knowledge.ts | 92% | 78% | AES-256-GCM encryption + redaction |
| tools.ts | 100% | 100% | Schema + tools↔handler sync |
| auto-login.ts | 95% | 88% | SSO chain + credentials |
| action-recorder.ts | 98% | 91% | Recording/replay |
| page-watch.ts | 96% | 88% | Page change monitoring |
| workflow-runner.ts | 97% | 96% | Workflow validation |
| snapshot-diff.ts | 100% | 100% | Diff comparison |
| screenshot-compare.ts | 100% | 92% | Visual regression |
| server.ts | 53% | 35% | 124 handlers, many need browser |
| screen.ts | 51% | 40% | Platform-dependent (macOS/Linux) |
| **Total (562 tests)** | **66%** | **46%** | 18 test files |

## Tools

124 MCP tools across 29 categories: browser control (5), site knowledge (2), page reading (4), interaction (8), advanced interaction (9), navigation & scrolling (7), tabs (4), frames (1), page info (6), data extraction (7), DOM manipulation (5), form automation (2), cookies (5), storage (3), performance & audit (7), SEO & social (4), accessibility (1), debugging (5), testing & emulation (7), design analysis (4), print & export (2), dialog & security (3), browser APIs (5), PWA & service worker (2), downloads & history (2), bookmarks (3), clipboard (2), sessions (4), screen (5).

## Recent Changes

- **v1.0.0 Release Prep**: package.json v1.0.0, npm publish workflow (.github/workflows/publish.yml), CHANGELOG.md, README with full 49-tool API reference. JWT exp claim validation. Password field masking in DOM snapshots. Obsolete scripts removed.
- **Crash Recovery (v0.9.0)**: Auto-detects Chrome crash (non-zero exit) or unexpected WS disconnect. Exponential backoff recovery (1s→2s→4s, max 3 attempts). Reuses profile directory to preserve cookies/localStorage. Recovery resets on success. Intentional `close()` skips recovery.
- **Site Knowledge Security (v0.9.0)**: Sensitive data filtering via `redactSensitive()` — passwords, tokens, API keys, JWTs, long hex secrets, email:password combos automatically masked with `[REDACTED]`. AES-256-GCM encrypted storage with per-installation key (`~/.aly-browser/site-knowledge/.encryption-key`, 0600 permissions). Transparent migration from plaintext JSON.
- **WS Token Auth (v0.9.0)**: Per-session JWT HS256 token generated on `startServer()`. Injected into extension's `background.js` via `WS_TOKEN` marker. Validated on WS handshake via URL query param `?token=`. Invalid tokens rejected with close code 4001. Token-less connections accepted with warning (backward compat for pre-installed extensions). Token file `~/.aly-browser/sessions/<id>/token` with 0600 permissions.
- **File upload (v0.8.0)**: `browser_upload` reads local file → base64 → DataTransfer injection into `input[type=file]`. Auto-detects MIME type (20 extensions). Supports `ref` auto-detection and `frameId` for iframe uploads.
- **iframe support (Wave2)**: `all_frames: true` + `webNavigation` permission. Per-frame `contentReady` tracking, `sendToContent` routes via `frameId`, `browser_frame_list` tool for frame discovery. All content-targeted tools accept optional `frameId`.
- **isVisible() optimization**: `getComputedStyle()` → `checkVisibility()` (Chrome 105+ native C++). Eliminates layout thrashing on complex pages.
- **Shadow DOM support (Wave1)**: `walkDOM` traverses `el.shadowRoot`. Click/hover events use `composed: true` to cross shadow boundaries.
- **bridge.ts tests**: Full WS mock-based testing covering send/launch/close lifecycle + all public API methods including frameId routing.

## Key Patterns

- ref ID (`@eN`) is ephemeral — resets on every `snapshot()` call
- Multi-session: `sessionId` parameter isolates Chrome instances
- `checkVisibility()` replaces `getComputedStyle()` for visibility checks
- Shadow DOM: open shadow roots are traversed in snapshots; closed roots are inaccessible (browser limitation)
- iframe: use `browser_frame_list` to discover frames, then pass `frameId` to snapshot/click/type/etc. Default `frameId=0` targets main frame
- WS Token Auth: per-session JWT HS256 token via `?token=` query param. Invalid tokens → close 4001. `ALY_REQUIRE_AUTH=1` enforces token for all connections; default accepts token-less with warning (backward compat)
- Crash Recovery: Chrome non-zero exit or WS close → auto-restart with backoff (1s/2s/4s, max 3). `_intentionalClose` flag prevents recovery on `close()`
- Site Knowledge: `redactSensitive()` filters credentials before storage. AES-256-GCM encrypted on disk. Plaintext auto-migrated on load
- Password masking: `input[type=password]` values shown as `••••••••` in snapshots
