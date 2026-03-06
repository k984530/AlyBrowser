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
- **Minimal deps** — Only 2 runtime dependencies (`@modelcontextprotocol/sdk`, `ws`)

## Quick Start

### As MCP Server (Claude Code)

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

## MCP Tools (32)

| Category | Tools |
|----------|-------|
| Browser Control | `browser_launch`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_close` |
| Site Knowledge | `browser_learn`, `browser_get_knowledge` |
| Page Reading | `browser_snapshot`, `browser_html`, `browser_eval` |
| Interaction | `browser_click`, `browser_type`, `browser_select`, `browser_hover`, `browser_scroll`, `browser_wait`, `browser_wait_for_stable`, `browser_sleep` |
| Tab Management | `browser_tab_list`, `browser_tab_new`, `browser_tab_close`, `browser_tab_switch` |
| Cookies | `browser_cookie_get`, `browser_cookie_set`, `browser_cookie_delete` |
| Storage | `browser_storage_get`, `browser_storage_set` |
| Bookmarks | `browser_bookmark_list`, `browser_bookmark_create`, `browser_bookmark_delete` |
| Alarms | `browser_alarm_create`, `browser_alarm_list`, `browser_alarm_clear` |
| Other | `browser_download`, `browser_history_search`, `browser_notify`, `browser_top_sites`, `browser_clipboard_read`, `browser_clipboard_write` |
| Session | `browser_session_list`, `browser_session_close_all` |

## Requirements

- Node.js >= 18
- Chrome or Chromium installed

## License

MIT
