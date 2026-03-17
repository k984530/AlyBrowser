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
npm test           # vitest (194 tests)
npm run coverage   # vitest --coverage
```

## Test Coverage

| Module | Tests | Coverage |
|--------|-------|----------|
| bridge.ts | 95 | 96% (Stmts/Branch/Funcs/Lines) |
| screen.ts | 28 | 100% |
| Total | 194 | — |

## Recent Changes

- **isVisible() optimization**: `getComputedStyle()` → `checkVisibility()` (Chrome 105+ native C++). Eliminates layout thrashing on complex pages.
- **Shadow DOM support (Wave1)**: `walkDOM` traverses `el.shadowRoot`. Click/hover events use `composed: true` to cross shadow boundaries.
- **bridge.ts tests**: Full WS mock-based testing covering send/launch/close lifecycle + all 34 public API methods.

## Key Patterns

- ref ID (`@eN`) is ephemeral — resets on every `snapshot()` call
- Multi-session: `sessionId` parameter isolates Chrome instances
- `checkVisibility()` replaces `getComputedStyle()` for visibility checks
- Shadow DOM: open shadow roots are traversed in snapshots; closed roots are inaccessible (browser limitation)
