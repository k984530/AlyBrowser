export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const tabIdProp = {
  tabId: { type: 'number', description: 'Target tab ID (default: active tab). Use for multi-tab parallel work.' },
};

const frameIdProp = {
  frameId: { type: 'number', description: 'Target frame ID (default: 0 = main frame). Use browser_frame_list to discover iframe frameIds.' },
};

const sessionIdProp = {
  sessionId: { type: 'string', description: 'Browser session ID (default: "default"). Use different sessionIds for isolated browser instances with separate cookies/profiles — required for multi-account scenarios (e.g., multiple Instagram logins).' },
};

export const tools: ToolDefinition[] = [
  // ── Browser Control ───────────────────────────────────────
  {
    name: 'browser_launch',
    description:
      'Launch Chrome browser via extension bridge. Each sessionId gets its own isolated Chrome instance with separate cookies/profile. ' +
      'Use different sessionIds for multi-account scenarios (e.g., sessionId "insta-a" and "insta-b" for two Instagram accounts). ' +
      'If url is provided, auto-attaches recorded site knowledge. Use browser_get_knowledge for existing insights before complex site interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to navigate to after launch',
        },
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_navigate',
    description: 'Navigate the current page to a URL. Auto-attaches recorded site knowledge on first visit to each path.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_back',
    description: 'Navigate back in browser history.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_forward',
    description: 'Navigate forward in browser history.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_close',
    description: 'Close a browser session. If sessionId is omitted, closes the default session.',
    inputSchema: { type: 'object', properties: { ...sessionIdProp } },
  },

  // ── Site Knowledge (Core Feature) ────────────────────────
  {
    name: 'browser_learn',
    description:
      'IMPORTANT: Record success/fail experiences for sites to build persistent knowledge. ' +
      'This is a core feature — the more you record, the fewer mistakes you repeat across sessions. ' +
      'Record after: discovering working approaches, recovering from failures, finding site-specific patterns. ' +
      'Example: After finding that a Slate.js editor needs click-before-type, record it as a success note.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL where the experience occurred' },
        action: { type: 'string', description: 'Action attempted (e.g., "type", "click")' },
        result: {
          type: 'string',
          enum: ['success', 'fail'],
          description: 'Whether the action succeeded or failed',
        },
        note: { type: 'string', description: 'Brief description of what happened' },
      },
      required: ['url', 'action', 'result', 'note'],
    },
  },
  {
    name: 'browser_get_knowledge',
    description:
      'Retrieve recorded site knowledge for a URL. If url is omitted, returns knowledge for the current page. ' +
      'Use before attempting complex interactions on a site you have visited before.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to query (omit for current page)' },
        ...sessionIdProp,
      },
    },
  },

  // ── Page Reading ──────────────────────────────────────────
  {
    name: 'browser_snapshot',
    description:
      'Capture accessibility tree snapshot. Returns text with @eN ref IDs for interactive elements. ' +
      'On page transition, compact site knowledge hints are auto-attached. Use frameId to snapshot a specific iframe.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...frameIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_snapshot_diff',
    description:
      'Compare current page snapshot with the previous one and return only what changed. ' +
      'Dramatically reduces token usage (60-90% less) for incremental page updates. ' +
      'Shows added/removed elements. Call after actions to see their effect without full snapshot overhead.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...frameIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_html',
    description: 'Get the current page HTML content. Use frameId to get HTML from a specific iframe.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...frameIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_eval',
    description:
      'Execute JavaScript in the page context and return the result.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate',
        },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['expression'],
    },
  },

  // ── Page Interaction ──────────────────────────────────────
  {
    name: 'browser_click',
    description: 'Click an element by its @eN ref ID. Returns updated snapshot automatically — no need to call browser_snapshot afterward.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref ID (e.g., "@e3")' },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
      required: ['ref'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input element. Supports special keys: {Enter}, {Tab}, {Escape}, {Backspace}, {Space}, {ArrowDown}, {ArrowUp}. Returns updated snapshot.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref ID' },
        text: { type: 'string', description: 'Text to type' },
        clear: {
          type: 'boolean',
          description: 'Clear existing content first (default: false)',
        },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> element.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref ID' },
        value: { type: 'string', description: 'Option value to select' },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
      required: ['ref', 'value'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref ID' },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
      required: ['ref'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page by pixel amounts.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal scroll pixels' },
        y: { type: 'number', description: 'Vertical scroll pixels' },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a CSS selector to appear (or disappear with hidden:true) in the DOM. Uses MutationObserver.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        timeout: {
          type: 'number',
          description: 'Max wait ms (default: 30000)',
        },
        hidden: {
          type: 'boolean',
          description: 'Wait for selector to disappear instead of appear (default: false)',
        },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_wait_for_stable',
    description:
      'Wait until DOM stops changing (no mutations for 500ms). Detects SPA render completion via MutationObserver. Use instead of browser_sleep for page loading.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Max wait ms (default: 30000)',
        },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Tab Management ────────────────────────────────────────
  {
    name: 'browser_tab_list',
    description: 'List all open browser tabs.',
    inputSchema: { type: 'object', properties: { ...sessionIdProp } },
  },
  {
    name: 'browser_tab_new',
    description: 'Create a new browser tab. Returns tabId. When opening multiple tabs, each tab MUST be operated by a separate agent with its dedicated tabId.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open (default: about:blank)' },
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_tab_close',
    description: 'Close a browser tab. In multi-tab agent work, each agent should close its tab after completing the task.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to close (default: active tab)' },
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_tab_switch',
    description: 'Switch active tab focus. Avoid in multi-tab parallel work — use tabId parameter on each tool instead.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Tab ID to activate' },
        ...sessionIdProp,
      },
      required: ['tabId'],
    },
  },

  // ── File Upload ─────────────────────────────────────────────
  {
    name: 'browser_upload',
    description: 'Upload a file to an input[type=file] element. Reads the file from local filesystem, encodes as base64, and injects via DataTransfer API.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path to the file to upload' },
        ref: { type: 'string', description: 'Element ref ID of the file input (optional — auto-detects if omitted)' },
        ...tabIdProp,
        ...frameIdProp,
        ...sessionIdProp,
      },
      required: ['filePath'],
    },
  },

  // ── Frame Management ────────────────────────────────────────
  {
    name: 'browser_frame_list',
    description: 'List all frames (main + iframes) in the current tab. Returns frameId, parentFrameId, URL, and depth for each frame. Supports nested iframes up to configurable depth. Use frameId to target specific iframes with snapshot/click/type/etc.',
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'Max nesting depth to return (default: 10). Use to limit results for deeply nested iframes.' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Cookie Management ─────────────────────────────────────
  {
    name: 'browser_cookie_get',
    description: 'Get cookies for a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to get cookies for' },
        name: { type: 'string', description: 'Filter by cookie name' },
        ...sessionIdProp,
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_cookie_set',
    description: 'Set a cookie.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL for the cookie' },
        name: { type: 'string', description: 'Cookie name' },
        value: { type: 'string', description: 'Cookie value' },
        domain: { type: 'string', description: 'Cookie domain' },
        path: { type: 'string', description: 'Cookie path' },
        secure: { type: 'boolean', description: 'Secure flag' },
        httpOnly: { type: 'boolean', description: 'HttpOnly flag' },
        expirationDate: { type: 'number', description: 'Expiration (unix timestamp)' },
        ...sessionIdProp,
      },
      required: ['url', 'name', 'value'],
    },
  },
  {
    name: 'browser_cookie_delete',
    description: 'Delete a cookie.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL of the cookie' },
        name: { type: 'string', description: 'Cookie name' },
        ...sessionIdProp,
      },
      required: ['url', 'name'],
    },
  },

  // ── Downloads ─────────────────────────────────────────────
  {
    name: 'browser_download',
    description: 'Download a file from a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to download' },
        filename: { type: 'string', description: 'Save filename' },
        ...sessionIdProp,
      },
      required: ['url'],
    },
  },

  // ── History ───────────────────────────────────────────────
  {
    name: 'browser_history_search',
    description: 'Search browser history.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text' },
        maxResults: { type: 'number', description: 'Max results (default: 20)' },
        ...sessionIdProp,
      },
    },
  },

  // ── Alarms ────────────────────────────────────────────────
  {
    name: 'browser_alarm_create',
    description:
      'Create a scheduled alarm. Fires onAlarm event after delay or periodically.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Alarm name' },
        delayInMinutes: {
          type: 'number',
          description: 'Minutes until first fire (min 0.5)',
        },
        periodInMinutes: {
          type: 'number',
          description: 'Repeat interval in minutes',
        },
        ...sessionIdProp,
      },
      required: ['name'],
    },
  },
  {
    name: 'browser_alarm_list',
    description: 'List all active alarms.',
    inputSchema: { type: 'object', properties: { ...sessionIdProp } },
  },
  {
    name: 'browser_alarm_clear',
    description: 'Clear an alarm by name, or all alarms if no name given.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Alarm name (omit for all)' },
        ...sessionIdProp,
      },
    },
  },

  {
    name: 'browser_alarm_events',
    description: 'Get fired alarm events since last poll. Returns an array of events with name, scheduledTime, and firedAt timestamps, then clears the buffer.',
    inputSchema: { type: 'object', properties: { ...sessionIdProp } },
  },

  // ── Storage ───────────────────────────────────────────────
  {
    name: 'browser_storage_get',
    description: 'Get data from extension local storage.',
    inputSchema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keys to retrieve (null for all)',
        },
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_storage_set',
    description: 'Set data in extension local storage.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Key-value pairs to store',
        },
        ...sessionIdProp,
      },
      required: ['data'],
    },
  },

  // ── Notifications ─────────────────────────────────────────
  {
    name: 'browser_notify',
    description: 'Show a desktop notification.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notification title' },
        message: { type: 'string', description: 'Notification message' },
        ...sessionIdProp,
      },
      required: ['title', 'message'],
    },
  },

  // ── Bookmarks ──────────────────────────────────────────────
  {
    name: 'browser_bookmark_list',
    description: 'List or search bookmarks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (omit for full tree)' },
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_bookmark_create',
    description: 'Create a new bookmark.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Bookmark title' },
        url: { type: 'string', description: 'Bookmark URL' },
        parentId: { type: 'string', description: 'Parent folder ID' },
        ...sessionIdProp,
      },
      required: ['title', 'url'],
    },
  },
  {
    name: 'browser_bookmark_delete',
    description: 'Delete a bookmark by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Bookmark ID to delete' },
        ...sessionIdProp,
      },
      required: ['id'],
    },
  },

  // ── Sleep ────────────────────────────────────────────────
  {
    name: 'browser_sleep',
    description:
      'Wait exactly 1 second. Use between actions to allow page updates. Fixed 1s — no configurable duration.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Performance ──────────────────────────────────────────
  {
    name: 'browser_perf_metrics',
    description:
      'Collect page performance metrics: load timing, DOM size, resource count, memory usage. ' +
      'Useful for performance audits, identifying slow pages, and monitoring page complexity.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Console ────────────────────────────────────────────────
  {
    name: 'browser_console_log',
    description:
      'Read recent console messages (log, warn, error, info) from the page. ' +
      'Captures messages since last call or page load. Useful for debugging JavaScript errors, ' +
      'monitoring API responses logged to console, and detecting runtime issues.',
    inputSchema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['all', 'error', 'warn', 'info', 'log'], description: 'Filter by log level (default: all)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Network ────────────────────────────────────────────────
  {
    name: 'browser_network_log',
    description:
      'Capture recent network requests using Performance API. Returns URL, transfer size, duration, ' +
      'and initiator type for each resource. Useful for API debugging, finding failed requests, and analyzing page load.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Filter URLs containing this string (optional)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Form Automation ────────────────────────────────────────
  {
    name: 'browser_form_fill',
    description:
      'Auto-fill form fields on the current page. Detects field types by name/id/autocomplete/label ' +
      'and fills matching values. Pass a data object with keys like "email", "name", "phone", "address", etc. ' +
      'Unmatched fields are skipped. Returns a report of filled/skipped fields.',
    inputSchema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Key-value pairs to fill. Keys: email, name, firstName, lastName, phone, address, city, zip, country, company, password, username, or any field name/id.',
        },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['data'],
    },
  },
  {
    name: 'browser_form_detect',
    description:
      'Detect all form fields on the current page. Returns field type, name, id, autocomplete attribute, ' +
      'current value, and detected semantic type (email, name, phone, etc.). Use before browser_form_fill.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Accessibility ──────────────────────────────────────────
  {
    name: 'browser_a11y_audit',
    description:
      'Run a lightweight WCAG accessibility audit on the current page. ' +
      'Checks: missing alt text, empty links, missing form labels, heading hierarchy, ' +
      'missing lang attribute, low contrast indicators, missing ARIA roles. ' +
      'Returns issues grouped by severity (critical/warning/info).',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Top Sites ──────────────────────────────────────────────
  {
    name: 'browser_top_sites',
    description: 'Get the most visited sites.',
    inputSchema: { type: 'object', properties: { ...sessionIdProp } },
  },

  // ── Clipboard ──────────────────────────────────────────────
  {
    name: 'browser_clipboard_read',
    description: 'Read text from the clipboard.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_clipboard_write',
    description: 'Write text to the clipboard.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to write to clipboard' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['text'],
    },
  },

  // ── Session Management ─────────────────────────────────────
  {
    name: 'browser_session_list',
    description: 'List all active browser sessions with their sessionId, port, and connection status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_session_close_all',
    description: 'Close all active browser sessions and clean up resources.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Screen Tools (standalone, no extension needed) ─────
  {
    name: 'screen_capture',
    description: 'Capture a screenshot of the entire screen or a specific window. Returns the image file path. Use this to see what is on screen when Extension Bridge cannot.',
    inputSchema: {
      type: 'object',
      properties: {
        windowTitle: { type: 'string', description: 'Window title to capture (omit for full screen)' },
      },
    },
  },
  {
    name: 'screen_click',
    description: 'Click at exact screen coordinates (x, y) using real mouse events. Works on any UI element including React buttons that synthetic events cannot trigger.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (pixels from left)' },
        y: { type: 'number', description: 'Y coordinate (pixels from top)' },
        double: { type: 'boolean', description: 'Double-click (default: false)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'screen_type',
    description: 'Type text at the current cursor position using real keyboard events. Works on any focused input.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'screen_key',
    description: 'Press a special key (enter, tab, escape, backspace, space, up, down, left, right, f1-f5). Supports modifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (enter, tab, escape, backspace, space, up, down, left, right)' },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['command', 'shift', 'option', 'control'] },
          description: 'Modifier keys to hold',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'screen_scroll',
    description: 'Scroll at current mouse position. Negative = scroll up, positive = scroll down.',
    inputSchema: {
      type: 'object',
      properties: {
        deltaY: { type: 'number', description: 'Scroll amount (negative=up, positive=down)' },
      },
      required: ['deltaY'],
    },
  },
];
