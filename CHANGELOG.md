# Changelog

## [Unreleased]

### Fixed
- CI workflow: add build step before test (mcp-protocol tests require dist/)
- publish.yml: reorder build before test

### Changed
- Export auth API (`generateSecret`, `signJwt`, `verifyJwt`, `TokenPayload`) from package root
- Encrypted storage fallback: try plaintext on decryption failure
- Remove unused `_lastUrls` field from bridge

### Added
- 331 tests (from 291): server handler error paths, auto-learn utilities
- `eslint.config.js` flat config
- `plugin.yaml` Aly ecosystem plugin definition
- `.gitignore`: coverage, screenshots, pipeline artifacts

## [1.0.0] - 2026-03-18

### Security
- **WS Token Authentication**: Per-session JWT HS256 token validated on WS handshake. `ALY_REQUIRE_AUTH=1` enforces token for all connections. Invalid tokens rejected with close code 4001.
- **Site Knowledge Encryption**: AES-256-GCM encrypted storage with per-installation key. Sensitive data (passwords, tokens, API keys, JWTs) automatically redacted before storage.

### Added
- **Crash Recovery**: Auto-detects Chrome crash or unexpected WS disconnect. Exponential backoff recovery (1s-4s, max 3 attempts). Reuses profile directory to preserve cookies/localStorage.
- `src/auth/token.ts` — Minimal JWT HS256 sign/verify (no external dependencies)
- `ALY_REQUIRE_AUTH` environment variable for strict authentication mode
- `redactSensitive()` export for sensitive data pattern matching
- npm publish workflow (`.github/workflows/publish.yml`)

### Changed
- `extension/background.js` — Sends auth token via WS URL query param
- `package.json` — v1.0.0, added `prepublishOnly`, `repository`, `homepage`, `bugs` fields

## [0.9.0] - 2026-03-17

### Added
- Exponential backoff for WS reconnection (3s → 6s → 12s → 24s → 30s cap)

## [0.8.0] - 2026-03-17

### Added
- `browser_upload` tool — File input injection via base64 DataTransfer
- Auto MIME type detection (20 extensions)

## [0.7.0] - 2026-03-17

### Added
- iframe support (Wave 2) — `all_frames: true`, `frameId` routing, `browser_frame_list`
- Shadow DOM support (Wave 1) — `walkDOM` traverses `el.shadowRoot`
- `checkVisibility()` optimization (Chrome 105+ native C++)
- Screen tools: capture, click, type, key, scroll
- Multi-monitor screenshot support
- CI workflow (typecheck + test)

## [0.4.2] - 2026-03-16

### Added
- Initial release with 44 MCP tools
- Extension Bridge architecture (Node.js WS ↔ Chrome Extension)
- Accessibility tree snapshots with `@eN` ref IDs
- Multi-session support with isolated Chrome instances
- Site Knowledge system for cross-session learning
