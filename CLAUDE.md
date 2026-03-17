# AlyBrowser

AI 에이전트용 경량 브라우저 자동화 SDK. Chrome Extension Bridge 방식으로 봇 감지를 우회.

## Architecture

- **Extension Bridge**: `src/extension/bridge.ts` — WS 서버 ↔ Chrome Extension
- **Content Script**: `extension/content.js` — DOM 스냅샷 + 인터랙션
- **MCP Server**: `src/mcp/server.ts`, `src/mcp/tools.ts`
- **Site Knowledge**: `src/mcp/site-knowledge.ts`

## Build & Test

```bash
npm run build      # tsup (CJS + ESM dual)
npm test           # vitest (229 tests)
npm run coverage   # vitest --coverage
```

## Test Coverage

| Module | Tests | Coverage |
|--------|-------|----------|
| bridge.ts | 108 | 96% (Stmts/Branch/Funcs/Lines) |
| screen.ts | 28 | 100% |
| content-snapshot | 22 | — (happy-dom, incl. upload) |
| other modules | 71 | — |
| **Total** | **229** | — |

## Tools

44 MCP tools total: browser control (5), page reading (3), interaction (8), upload (1), tabs (4), frames (1), cookies (3), downloads (1), history (1), alarms (4), storage (2), notifications (1), bookmarks (3), clipboard (2), sessions (2), screen (5), sleep (1).

## Recent Changes

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
