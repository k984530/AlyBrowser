# AlyBrowser

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

## MCP Tools (49)

### Browser Control (5)

| Tool | Description |
|------|-------------|
| `browser_launch` | Launch Chrome with optional URL. Each `sessionId` gets an isolated instance. |
| `browser_navigate` | Navigate to a URL. Auto-attaches site knowledge on first visit. |
| `browser_back` | Navigate back in browser history. |
| `browser_forward` | Navigate forward in browser history. |
| `browser_close` | Close a browser session. |

### Page Reading (3)

| Tool | Description |
|------|-------------|
| `browser_snapshot` | Capture accessibility tree with `@eN` ref IDs. Supports `frameId` for iframes. |
| `browser_html` | Get full page HTML. Supports `frameId`. |
| `browser_eval` | Execute JavaScript in page context. Tries MAIN world first, falls back to ISOLATED. |

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

### File Upload (1)

| Tool | Description |
|------|-------------|
| `browser_upload` | Upload local file to `input[type=file]` via DataTransfer injection. Auto-detects MIME type. |

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

### Cookies (3)

| Tool | Description |
|------|-------------|
| `browser_cookie_get` | Get cookies for a URL. |
| `browser_cookie_set` | Set a cookie with full options (domain, path, secure, httpOnly, expiration). |
| `browser_cookie_delete` | Delete a cookie by URL and name. |

### Downloads (1)

| Tool | Description |
|------|-------------|
| `browser_download` | Download a file from a URL. |

### History (1)

| Tool | Description |
|------|-------------|
| `browser_history_search` | Search browser history. |

### Alarms (4)

| Tool | Description |
|------|-------------|
| `browser_alarm_create` | Create scheduled alarm with delay or period. |
| `browser_alarm_list` | List active alarms. |
| `browser_alarm_clear` | Clear alarm(s) by name. |
| `browser_alarm_events` | Get fired alarm events since last poll. |

### Storage (2)

| Tool | Description |
|------|-------------|
| `browser_storage_get` | Get data from extension local storage. |
| `browser_storage_set` | Set key-value data in extension local storage. |

### Notifications (1)

| Tool | Description |
|------|-------------|
| `browser_notify` | Show a Chrome notification. |

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

### Sessions (2)

| Tool | Description |
|------|-------------|
| `browser_session_list` | List active browser sessions with port and connection status. |
| `browser_session_close_all` | Close all browser sessions. |

### Site Knowledge (2)

| Tool | Description |
|------|-------------|
| `browser_learn` | Record success/fail experience for a site. Auto-shown on future visits. |
| `browser_get_knowledge` | Retrieve recorded knowledge for a URL. |

### Screen Tools (5)

| Tool | Description |
|------|-------------|
| `screen_capture` | Capture screenshot (macOS). Supports window title targeting. |
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

## Requirements

- Node.js >= 18
- Chrome or Chromium installed
- macOS, Linux (screen tools are macOS-only)

## License

MIT
