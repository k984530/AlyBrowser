# Changelog

## [3.0.1] - 2026-03-18

### Added
- **`browser_permissions_check`**: Query browser permission states (geolocation, camera, mic, clipboard, notifications)
- README.md updated: 49 → 124 tools across 29 categories
- Tool integrity tests: tools↔handler sync verification via source parsing
- MCP E2E protocol tests: unknown tool, parallel calls, schema validation, sequential lifecycle
- 124 MCP tools, 562 tests

## [3.0.0] - 2026-03-18

### Highlights
- **123 MCP tools** (major version bump from v2.x)
- IndexedDB + Service Worker + Resource Hints inspection tools
- PWA debugging capabilities

### Added
- **`browser_indexeddb_list`**: List IndexedDB databases and object stores
- **`browser_service_worker_info`**: Service Worker status (active/installing/waiting, scope, caches)
- **`browser_resource_hints`**: Analyze preload/prefetch/preconnect hints

## [2.9.0] - 2026-03-18

### Added
- **`browser_service_worker_info`**: PWA service worker status analysis
- **`browser_resource_hints`**: Resource hint analysis and recommendations
- 122 MCP tools

## [2.8.0] - 2026-03-18

### Added
- **`browser_xpath_query`**: XPath expression queries for complex element selection
- **`browser_media_list`**: Video/audio/embed element inventory with metadata
- **`browser_open_graph_preview`**: Social media card simulation (Facebook, Twitter, LinkedIn)
- **`browser_selector_generator`**: Auto-generate stable CSS/XPath selectors
- 120 MCP tools milestone

## [2.7.0] - 2026-03-18

### Added
- **`browser_broken_links`**: Detect empty, javascript:, and invalid hrefs
- **`browser_mixed_content_check`**: Detect HTTP resources on HTTPS pages
- **`browser_js_coverage`**: JS usage analysis with blocking/3P detection
- 116 MCP tools

## [2.6.0] - 2026-03-18

### Added
- **`browser_web_vitals`**: Core Web Vitals (LCP/FCP/CLS/TTFB) measurement
- **`browser_css_coverage`**: Detect unused CSS rules
- **`browser_element_remove`**: Delete elements by CSS selector
- 113 MCP tools

## [2.5.0] - 2026-03-18

### Added
- **`browser_network_throttle`**: Simulate slow network (3G/4G/slow/offline presets)
- **`browser_device_emulate`**: Full device profile emulation (iPhone/Pixel/iPad presets)
- **`browser_timezone_set`**: IANA timezone spoofing via Intl.DateTimeFormat
- **`browser_user_agent_set`**: UA spoofing with device presets
- **`browser_geolocation_mock`**: Location spoofing with city presets
- 110 MCP tools

## [2.4.0] - 2026-03-18

### Added
- **`browser_shadow_dom_pierce`**: Traverse open shadow roots with `>>>` syntax
- **`browser_infinite_scroll`**: Auto-load infinite scroll content
- **`browser_print_preview`**: Print layout analysis (page count, paper size)
- **`browser_event_listener_list`**: Interactive element event analysis
- 105 MCP tools

## [2.3.0] - 2026-03-18

### Added
- **`browser_json_extract`**: Structured data extraction (JSON-LD, OG, meta tags)
- **WorkflowRunner**: Validate, plan, and estimate recorded action workflows
- 101 MCP tools, 527 tests

## [2.2.0] - 2026-03-18

### Highlights
- **100 MCP tools milestone**
- 10 utility tools for common operations
- 515 tests

### Added
- **`browser_drag_drop`**: HTML5 drag and drop simulation
- **`browser_count_elements`**: Multi-selector element counting
- **`browser_scroll_to_element`**: Smooth scroll to CSS selector target
- **`browser_page_to_pdf_data`**: Clean article text extraction
- **`browser_highlight`**: Visual element highlighting with colored outline
- **`browser_attribute_set`**: Set/remove HTML attributes
- **`browser_double_click`**: Double-click by ref
- **`browser_right_click`**: Context menu click by CSS selector
- 10 utility tools: `scroll_to_bottom`, `scroll_to_top`, `get_url`, `get_title`, `focus`, `blur`, `press_key`, `reload`, `page_info`, `element_count`

## [2.1.0] - 2026-03-18

### Added
- **`browser_dialog_handler`**: Auto-respond to alert/confirm/prompt dialogs
- **`browser_color_picker`**: Extract page color palette by frequency
- **`browser_font_list`**: Page font usage analysis (families/sizes/weights)
- **`browser_find_text`**: Structured text search with context
- **`browser_popup_blocker`**: Detect/remove popups, modals, cookie banners
- **`browser_click_all`**: Batch click elements by CSS selector
- **`browser_wait_for_url`**: Wait for URL pattern match (substring/regex)
- **`browser_style_override`**: Inject/remove CSS overrides
- **`browser_local_storage`**: Full localStorage CRUD
- **`browser_wait_for_text`**: Wait for text appear/disappear
- **`browser_session_clone`**: Clone session with cookie transfer
- **`browser_page_audit`**: Unified quality report (0-100 score)
- **`ActionRecorder`**: Action recording/replay module
- 82 MCP tools, 500 tests

## [2.0.0] - 2026-03-18

### Highlights
- **75 MCP tools** (from 49 in v1.0.0)
- **486 tests** (from 229 at session start)
- **26 new tools** added via autonomous planning in one day
- 7 npm releases (v1.0.0 → v2.0.0)

### Added (since v1.5.0)
- **`browser_style_override`**: Inject/remove/list CSS overrides
- **`browser_local_storage`**: Full localStorage CRUD (get/set/delete/clear/list)
- **`browser_wait_for_text`**: Wait for text to appear/disappear on page
- **`browser_session_clone`**: Clone session with cookie transfer
- **`browser_page_audit`**: Unified quality report (0-100 score, A-F grade)
- **`ActionRecorder`**: Browser action recording/replay module

### Infrastructure
- AI framework integration guide (LangChain, CrewAI, Claude Code)
- Visual regression testing foundation (PageWatcher + snapshot-diff + screenshot-compare)
- AutoLoginManager with SSO chain resolution
- Korean PII detection (5 types)
- Linux screen tools (xdotool/import/gnome-screenshot)
- Cross-platform CI fixes

## [1.5.0] - 2026-03-18

### Added
- **`browser_viewport_test`**: Responsive design testing with device presets + overflow detection
- **`browser_dark_mode`**: Dark/light mode detection and emulation
- **`browser_scroll_map`**: Page content density analysis by scroll position
- **`browser_dom_observe`**: Real-time DOM mutation monitoring (MutationObserver)
- **`browser_captcha_detect`**: CAPTCHA/bot protection detection (7 systems)
- **`browser_cookie_export/import`**: Session transfer via cookie profiles
- **`browser_page_size`**: Page weight analysis with heaviest resources
- **`browser_text_content`**: Structured page text extraction in Markdown
- **`browser_image_list`**: Image audit with broken/alt detection
- 70 MCP tools, 461 tests

## [1.4.0] - 2026-03-18

### Added
- **`screenshot-compare`**: Pixel-level screenshot comparison (hash + byte similarity %)
- **`PageWatcher`**: Page change monitoring with snapshot diff
- Visual regression testing foundation (3 modules: snapshot-diff + page-watch + screenshot-compare)
- 451 tests, 60 MCP tools

## [1.3.0] - 2026-03-18

### Added
- **`browser_table_extract`**: Structured HTML table data extraction (headers + rows as JSON)
- **`browser_link_extract`**: Page link extraction with internal/external filter
- AI framework integration guide (LangChain, CrewAI, Claude Code examples)
- 60 MCP tools, 440 tests

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
