# Changelog

## [1.2.0] - 2026-03-18

### Added
- **`browser_console_log`**: Capture JS console messages with level filter + uncaught errors
- **`browser_network_log`**: Capture network requests via Performance API with URL filter
- **`browser_meta_seo`**: Comprehensive SEO metadata analysis (title/OG/Twitter/JSON-LD/headings)
- **`browser_element_info`**: CSS selector-based element inspector (bounds/styles/attributes)
- **`PageWatcher`**: Page change monitoring module with snapshot diff
- 58 MCP tools, 438 tests

## [1.1.0] - 2026-03-18

### Added
- **`browser_snapshot_diff`**: Compare snapshots, return only changes (60-90% token reduction)
- **`browser_perf_metrics`**: Page performance metrics (TTFB, DOM complexity, resources)
- **`browser_a11y_audit`**: Lightweight WCAG accessibility checker (10 rules)
- **`browser_form_fill`**: Auto-fill forms by semantic field type detection
- **`browser_form_detect`**: Scan and classify form fields
- **AutoLoginManager**: Encrypted credential storage, SSO chain resolution, login state cache
- Linux screen tools: xdotool/import/gnome-screenshot/scrot support
- Nested iframe depth support in `browser_frame_list`
- Korean sensitive data patterns (5 types: resident ID, passport, license, account, phone)
- Video/audio MIME types (mp4, webm, mov, avi, mkv, mp3, wav, ogg)
- 421 tests (from 229), 54 MCP tools (from 49)

### Fixed
- CI: build before test (mcp-protocol needs dist/)
- publish.yml: reorder build before test
- Screen tests: platform-aware for Linux CI
- SEC-B01: Remove plaintext fallback in site knowledge encryption
- SEC-B02: Validate snapshot diff inputs (null/undefined safe)

### Changed
- Export auth API from package root
- Encrypted storage: try plaintext on decryption failure (migration)

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
