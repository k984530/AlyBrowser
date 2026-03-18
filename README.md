# AlyBrowser

[![npm version](https://img.shields.io/npm/v/aly-browser)](https://www.npmjs.com/package/aly-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Lightweight browser SDK for AI agents. Connects via a Chrome Extension bridge that bypasses bot detection.

## How it works

```
AI Agent  →  MCP Server  →  WebSocket  →  Chrome Extension  →  Content Script  →  Web Page
```

- **No CDP** — Uses Chrome Extension bridge instead of DevTools Protocol, avoiding bot detection
- **Accessibility tree snapshots** — Pages are read through `@eN` ref IDs for interactive elements
- **Multi-session** — Isolated Chrome instances with separate profiles for multi-account scenarios
- **Site Knowledge** — Records success/fail experiences per site, auto-attached on revisit
- **Crash Recovery** — Auto-restarts Chrome on crash, preserves session state (cookies, localStorage)
- **Security** — JWT HS256 WS auth, AES-256-GCM encrypted site knowledge, password field masking
- **Minimal deps** — Only 2 runtime dependencies (`@modelcontextprotocol/sdk`, `ws`)

## Install

```bash
npm install aly-browser
```

## Quick Start

### As MCP Server (Claude Code / Cursor / etc.)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "aly-browser": {
      "command": "npx",
      "args": ["aly-browser-mcp"]
    }
  }
}
```

### As Library

```typescript
import { ExtensionBridge } from 'aly-browser';

const bridge = new ExtensionBridge('my-session');
await bridge.launch({ url: 'https://example.com' });

const snapshot = await bridge.snapshot();
console.log(snapshot); // Accessibility tree with @eN refs

await bridge.click('@e1');
await bridge.type('@e2', 'Hello world');
await bridge.close();
```

## Multi-Session Support

Each session gets an isolated Chrome instance with separate cookies/profile:

```typescript
// Two Instagram accounts simultaneously
const sessionA = new ExtensionBridge('insta-a');
const sessionB = new ExtensionBridge('insta-b');

await sessionA.launch({ url: 'https://instagram.com' });
await sessionB.launch({ url: 'https://instagram.com' });
// Each has independent login state
```

## MCP Tools (124)

### Browser Control (5)

| Tool | Description |
|------|-------------|
| `browser_launch` | Launch Chrome with optional URL. Each `sessionId` gets an isolated instance. |
| `browser_navigate` | Navigate to a URL. Auto-attaches site knowledge on first visit. |
| `browser_back` | Navigate back in browser history. |
| `browser_forward` | Navigate forward in browser history. |
| `browser_close` | Close a browser session. |

### Site Knowledge (2)

| Tool | Description |
|------|-------------|
| `browser_learn` | Record success/fail experience for a site. Auto-shown on future visits. |
| `browser_get_knowledge` | Retrieve recorded knowledge for a URL. |

### Page Reading (4)

| Tool | Description |
|------|-------------|
| `browser_snapshot` | Capture accessibility tree with `@eN` ref IDs. Supports `frameId` for iframes. |
| `browser_snapshot_diff` | Compare with previous snapshot, return only changes. 60-90% less tokens. |
| `browser_html` | Get full page HTML. Supports `frameId`. |
| `browser_eval` | Execute JavaScript in page context. |

### Interaction (8)

| Tool | Description |
|------|-------------|
| `browser_click` | Click element by `@eN` ref. Returns updated snapshot. |
| `browser_type` | Type text into input. Supports `{Enter}`, `{Tab}`, `{Escape}`, etc. |
| `browser_select` | Select option in `<select>` element. |
| `browser_hover` | Hover over element. |
| `browser_scroll` | Scroll by pixel amounts (x, y). |
| `browser_wait` | Wait for CSS selector to appear/disappear (MutationObserver). |
| `browser_wait_for_stable` | Wait until DOM stops changing (500ms quiet period). |
| `browser_sleep` | Wait 1 second. Prefer `browser_wait_for_stable`. |

### Advanced Interaction (9)

| Tool | Description |
|------|-------------|
| `browser_double_click` | Double-click element by `@eN` ref. |
| `browser_right_click` | Right-click (context menu) by CSS selector. |
| `browser_drag_drop` | Drag and drop between two elements (HTML5 DnD events). |
| `browser_click_all` | Click all elements matching a CSS selector (batch). |
| `browser_focus` | Focus element by CSS selector. |
| `browser_blur` | Remove focus from current element. |
| `browser_press_key` | Dispatch keyboard event on focused element. |
| `browser_upload` | Upload local file to `input[type=file]` via DataTransfer injection. |
| `browser_shadow_dom_pierce` | Query/click/type inside Shadow DOM with piercing selector (`>>>` syntax). |

### Navigation & Scrolling (7)

| Tool | Description |
|------|-------------|
| `browser_reload` | Reload page. Optionally bypass cache. |
| `browser_scroll_to_bottom` | Scroll to page bottom (lazy content loading). |
| `browser_scroll_to_top` | Scroll to page top. |
| `browser_scroll_to_element` | Scroll to element by CSS selector (smooth). |
| `browser_infinite_scroll` | Auto-scroll to load all infinite scroll content. |
| `browser_wait_for_url` | Wait until URL matches pattern (OAuth redirects, SPA nav). |
| `browser_wait_for_text` | Wait until text appears/disappears on page. |

### Tabs (4)

| Tool | Description |
|------|-------------|
| `browser_tab_list` | List all open tabs. |
| `browser_tab_new` | Create new tab. Returns `tabId` for parallel work. |
| `browser_tab_close` | Close a tab by ID. |
| `browser_tab_switch` | Switch active tab focus. |

### Frames (1)

| Tool | Description |
|------|-------------|
| `browser_frame_list` | List all frames (main + iframes) with `frameId` and URL. |

### Page Info (6)

| Tool | Description |
|------|-------------|
| `browser_get_url` | Get current page URL. |
| `browser_get_title` | Get current page title. |
| `browser_page_info` | Get page info: URL, title, domain, viewport, scroll position. |
| `browser_element_count` | Get total DOM element count (complexity check). |
| `browser_element_info` | Detailed element info: bounding box, styles, attributes, text. |
| `browser_text_content` | Extract all visible text organized by sections. |

### Data Extraction (7)

| Tool | Description |
|------|-------------|
| `browser_table_extract` | Extract HTML table data as structured JSON. |
| `browser_link_extract` | Extract all links with href, text, internal/external flag. |
| `browser_image_list` | List all images with src, alt, dimensions, loading status. |
| `browser_json_extract` | Extract JSON-LD, microdata, meta tags as structured data. |
| `browser_find_text` | Search text on page with context and match count. |
| `browser_media_list` | List video/audio/embed elements with metadata. |
| `browser_count_elements` | Count elements matching CSS selectors. |

### DOM Manipulation (5)

| Tool | Description |
|------|-------------|
| `browser_element_remove` | Remove elements by CSS selector (ads, banners, etc). |
| `browser_attribute_set` | Set/remove HTML attributes on elements. |
| `browser_highlight` | Highlight elements with colored border/overlay. |
| `browser_style_override` | Inject/remove custom CSS styles. |
| `browser_popup_blocker` | Detect and remove popups, modals, cookie banners. |

### Form Automation (2)

| Tool | Description |
|------|-------------|
| `browser_form_fill` | Auto-fill form fields by semantic type (email, name, phone, etc). |
| `browser_form_detect` | Detect all form fields with type, name, autocomplete info. |

### Cookies (5)

| Tool | Description |
|------|-------------|
| `browser_cookie_get` | Get cookies for a URL. |
| `browser_cookie_set` | Set a cookie with full options (domain, path, secure, httpOnly, expiration). |
| `browser_cookie_delete` | Delete a cookie by URL and name. |
| `browser_cookie_export` | Export all cookies for a domain as JSON profile. |
| `browser_cookie_import` | Import cookies from exported JSON profile. |

### Storage (3)

| Tool | Description |
|------|-------------|
| `browser_storage_get` | Get data from extension local storage. |
| `browser_storage_set` | Set data in extension local storage. |
| `browser_local_storage` | Read/write/clear page localStorage (get, set, delete, clear, list). |

### Performance & Audit (7)

| Tool | Description |
|------|-------------|
| `browser_perf_metrics` | Page load timing, DOM size, resource count, memory usage. |
| `browser_web_vitals` | Core Web Vitals: LCP, CLS, FCP, TTFB with pass/fail. |
| `browser_js_coverage` | JS analysis: script count, size, render-blocking, third-party. |
| `browser_css_coverage` | CSS analysis: stylesheets, rules, unused rule estimates. |
| `browser_page_size` | Total page weight: HTML, CSS, JS, images, fonts. |
| `browser_resource_hints` | Analyze preload/prefetch/preconnect hints, suggest missing ones. |
| `browser_page_audit` | Comprehensive audit: perf + a11y + SEO + weight (score 0-100). |

### SEO & Social (4)

| Tool | Description |
|------|-------------|
| `browser_meta_seo` | SEO audit: title, description, OG tags, structured data, headings. |
| `browser_open_graph_preview` | Preview social media cards (Facebook, Twitter, LinkedIn). |
| `browser_broken_links` | Check all page links for broken URLs. |
| `browser_mixed_content_check` | Detect HTTP resources on HTTPS pages. |

### Accessibility (1)

| Tool | Description |
|------|-------------|
| `browser_a11y_audit` | WCAG audit: alt text, labels, heading hierarchy, ARIA roles, contrast. |

### Debugging (5)

| Tool | Description |
|------|-------------|
| `browser_console_log` | Read console messages (log, warn, error, info). |
| `browser_network_log` | Capture network requests via Performance API. |
| `browser_dom_observe` | Start/read/stop MutationObserver for DOM changes. |
| `browser_event_listener_list` | List event listeners on page elements. |
| `browser_xpath_query` | Query elements using XPath expressions. |

### Testing & Emulation (7)

| Tool | Description |
|------|-------------|
| `browser_device_emulate` | Emulate device: viewport, UA, touch, DPR (presets: iPhone, Pixel, iPad). |
| `browser_viewport_test` | Test responsiveness across viewports (mobile, tablet, desktop, wide). |
| `browser_dark_mode` | Detect or toggle dark/light mode preference. |
| `browser_timezone_set` | Override timezone for time-sensitive UI testing. |
| `browser_user_agent_set` | Override user agent (presets: mobile, firefox, googlebot). |
| `browser_geolocation_mock` | Mock geolocation (presets: Tokyo, NYC, London, Seoul, Paris). |
| `browser_network_throttle` | Simulate slow network (presets: 3G, 4G, slow, offline). |

### Design Analysis (4)

| Tool | Description |
|------|-------------|
| `browser_color_picker` | Extract page color palette sorted by frequency. |
| `browser_font_list` | Analyze fonts: families, sizes, weights, web vs system. |
| `browser_selector_generator` | Generate stable CSS/XPath selectors for elements. |
| `browser_scroll_map` | Content density analysis by scroll position. |

### Print & Export (2)

| Tool | Description |
|------|-------------|
| `browser_print_preview` | Print preview: page count, paper size, margins, print CSS. |
| `browser_page_to_pdf_data` | Extract clean printable text (strips nav, ads). |

### Dialog & Security (3)

| Tool | Description |
|------|-------------|
| `browser_dialog_handler` | Auto-handle JS dialogs (alert, confirm, prompt). |
| `browser_captcha_detect` | Detect CAPTCHA: reCAPTCHA, hCaptcha, Cloudflare Turnstile. |
| `browser_permissions_check` | Check browser permission states (geo, camera, mic, etc). |

### Browser APIs (5)

| Tool | Description |
|------|-------------|
| `browser_alarm_create` | Create scheduled alarm with delay or period. |
| `browser_alarm_list` | List active alarms. |
| `browser_alarm_clear` | Clear alarm(s) by name. |
| `browser_alarm_events` | Get fired alarm events since last poll. |
| `browser_notify` | Show a Chrome notification. |

### PWA & Service Worker (2)

| Tool | Description |
|------|-------------|
| `browser_indexeddb_list` | List IndexedDB databases and object stores. |
| `browser_service_worker_info` | Service Worker status: active/installing/waiting, scope, caches. |

### Downloads & History (2)

| Tool | Description |
|------|-------------|
| `browser_download` | Download a file from a URL. |
| `browser_history_search` | Search browser history. |

### Bookmarks (3)

| Tool | Description |
|------|-------------|
| `browser_bookmark_list` | List or search bookmarks. |
| `browser_bookmark_create` | Create a bookmark. |
| `browser_bookmark_delete` | Delete a bookmark. |

### Clipboard (2)

| Tool | Description |
|------|-------------|
| `browser_clipboard_read` | Read clipboard text. |
| `browser_clipboard_write` | Write text to clipboard. |

### Sessions (4)

| Tool | Description |
|------|-------------|
| `browser_session_list` | List active sessions with port and connection status. |
| `browser_session_close_all` | Close all browser sessions. |
| `browser_session_clone` | Clone session (copies cookies for parallel work). |
| `browser_top_sites` | Get most visited sites. |

### Screen Tools (5)

| Tool | Description |
|------|-------------|
| `screen_capture` | Capture screenshot. Supports window title targeting. |
| `screen_click` | Click at screen coordinates. Supports double-click. |
| `screen_type` | Type text at current cursor position. |
| `screen_key` | Press key with optional modifiers. |
| `screen_scroll` | Scroll at current cursor position. |

## Security

### WS Token Authentication

Per-session JWT HS256 token is generated on launch and validated on every WS connection.

- **Chrome for Testing** — Token is auto-injected into the extension. Fully authenticated.
- **Pre-installed extension** — Token-less connections accepted with warning by default. Set `ALY_REQUIRE_AUTH=1` to enforce token auth for all connections.
- **Token storage** — Written to `~/.aly-browser/sessions/<id>/token` with `0600` permissions. Cleaned up on `close()`.

### Site Knowledge Security

- **Sensitive data filtering** — Passwords, tokens, API keys, JWTs, and other secrets are automatically redacted before storage via pattern matching.
- **Encrypted storage** — AES-256-GCM encryption with per-installation key (`0600` permissions). Transparent migration from plaintext.

### Password Protection

Password input field values are masked with `••••••••` in accessibility tree snapshots. Actual passwords are never exposed to AI agents.

### Extension Bridge Security Model

- **Content Script isolation** — Runs in Chrome's isolated world, invisible to page JavaScript.
- **No CDP exposure** — No DevTools port (9222) is opened. No `chrome.debugger` API is used.
- **Sideloading only** — Requires `--load-extension` flag. Not publishable to Chrome Web Store due to broad permissions.

### Site Knowledge & Prompt Injection

- **Risk** — A malicious site could craft text designed to be stored as site knowledge.
- **Mitigations** — 200 entries/domain cap, 1000 chars/field, entries are advisory only (not executable), sensitive data auto-redacted.

## Crash Recovery

Chrome crashes are auto-detected and recovered:

- Non-zero exit code or unexpected WS disconnect triggers recovery
- Exponential backoff: 1s → 2s → 4s (max 3 attempts)
- Profile directory is reused — cookies, localStorage, IndexedDB are preserved
- `close()` sets an intentional flag to skip recovery

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ALY_REQUIRE_AUTH` | (unset) | Set to `1` to reject WS connections without a valid JWT token |

## AI Framework Integration

AlyBrowser is MCP-native and works with any MCP-compatible AI framework.

### LangChain

```python
# pip install langchain-mcp-adapters
from langchain_mcp_adapters import MCPToolkit

toolkit = MCPToolkit(server_command="npx", server_args=["aly-browser-mcp"])
tools = toolkit.get_tools()
# Use tools in your LangChain agent
```

### CrewAI

```yaml
# crewai.yaml
tools:
  - type: mcp
    command: npx
    args: ["aly-browser-mcp"]
```

### Claude Code

```json
{
  "mcpServers": {
    "aly-browser": {
      "command": "npx",
      "args": ["aly-browser-mcp"]
    }
  }
}
```

### Direct SDK Usage

```typescript
import { ExtensionBridge } from 'aly-browser';

const browser = new ExtensionBridge('session-1');
await browser.launch({ url: 'https://example.com' });

// Full API: snapshot, click, type, evaluate, upload, cookies...
const tree = await browser.snapshot();
await browser.click('@e1');
await browser.close();
```

## Requirements

- Node.js >= 18
- Chrome or Chromium installed
- macOS, Linux (screen tools are macOS-only)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT
