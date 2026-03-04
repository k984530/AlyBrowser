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

export const tools: ToolDefinition[] = [
  // ── Browser Control ───────────────────────────────────────
  {
    name: 'browser_launch',
    description:
      'Launch Chrome browser via extension bridge. Uses persistent profile (~/.aly-browser/profile) so login sessions survive restarts. ' +
      'If url is provided, auto-attaches recorded site knowledge. Use browser_get_knowledge for existing insights before complex site interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to navigate to after launch',
        },
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
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_back',
    description: 'Navigate back in browser history.',
    inputSchema: { type: 'object', properties: { ...tabIdProp } },
  },
  {
    name: 'browser_forward',
    description: 'Navigate forward in browser history.',
    inputSchema: { type: 'object', properties: { ...tabIdProp } },
  },
  {
    name: 'browser_close',
    description: 'Close the browser and clean up resources.',
    inputSchema: { type: 'object', properties: {} },
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
      },
    },
  },

  // ── Page Reading ──────────────────────────────────────────
  {
    name: 'browser_snapshot',
    description:
      'Capture accessibility tree snapshot. Returns text with @eN ref IDs for interactive elements. ' +
      'On page transition, compact site knowledge hints are auto-attached.',
    inputSchema: { type: 'object', properties: { ...tabIdProp } },
  },
  {
    name: 'browser_html',
    description: 'Get the current page HTML content.',
    inputSchema: { type: 'object', properties: { ...tabIdProp } },
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
      },
      required: ['expression'],
    },
  },

  // ── Page Interaction ──────────────────────────────────────
  {
    name: 'browser_click',
    description: 'Click an element by its @eN ref ID.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Element ref ID (e.g., "@e3")' },
        ...tabIdProp,
      },
      required: ['ref'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input element.',
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
      },
    },
  },

  // ── Tab Management ────────────────────────────────────────
  {
    name: 'browser_tab_list',
    description: 'List all open browser tabs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_tab_new',
    description: 'Create a new browser tab. Returns tabId. When opening multiple tabs, each tab MUST be operated by a separate agent with its dedicated tabId.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open (default: about:blank)' },
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
      },
      required: ['tabId'],
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
      },
      required: ['name'],
    },
  },
  {
    name: 'browser_alarm_list',
    description: 'List all active alarms.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_alarm_clear',
    description: 'Clear an alarm by name, or all alarms if no name given.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Alarm name (omit for all)' },
      },
    },
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

  // ── Top Sites ──────────────────────────────────────────────
  {
    name: 'browser_top_sites',
    description: 'Get the most visited sites.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Clipboard ──────────────────────────────────────────────
  {
    name: 'browser_clipboard_read',
    description: 'Read text from the clipboard.',
    inputSchema: { type: 'object', properties: { ...tabIdProp } },
  },
  {
    name: 'browser_clipboard_write',
    description: 'Write text to the clipboard.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to write to clipboard' },
        ...tabIdProp,
      },
      required: ['text'],
    },
  },
];
