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

  // ── Media List ───────────────────────────────────────────
  {
    name: 'browser_media_list',
    description:
      'List all media elements (video, audio, embed, object) on the page with src, type, ' +
      'dimensions, autoplay status, and duration.',
    inputSchema: {
      type: 'object',
      properties: { ...tabIdProp, ...sessionIdProp },
    },
  },
  // ── XPath Query ─────────────────────────────────────────
  {
    name: 'browser_xpath_query',
    description:
      'Query elements using XPath expressions. More powerful than CSS selectors for complex ' +
      'queries like "find text containing X" or "find nth sibling". Returns matching elements.',
    inputSchema: {
      type: 'object',
      properties: {
        xpath: { type: 'string', description: 'XPath expression (e.g., "//h2[contains(text(),\\"Price\\")]")' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['xpath'],
    },
  },

  // ── Social Preview ───────────────────────────────────────
  {
    name: 'browser_open_graph_preview',
    description:
      'Simulate how the page will appear when shared on social media. Shows Facebook, Twitter, ' +
      'and LinkedIn card previews based on OG/meta tags. Reports missing tags for each platform.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Selector Generator ───────────────────────────────────
  {
    name: 'browser_selector_generator',
    description:
      'Generate stable CSS/XPath selectors for elements. Given a description or partial selector, ' +
      'finds the best unique selector. Useful for test automation and scraping script generation.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Visible text to find the element by' },
        selector: { type: 'string', description: 'Partial CSS selector to refine' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Broken Links ─────────────────────────────────────────
  {
    name: 'browser_broken_links',
    description:
      'Check all links on the page for broken URLs. Tests href validity, identifies empty/javascript/# links, ' +
      'and flags potentially broken external links. Quick link health check.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Mixed Content ────────────────────────────────────────
  {
    name: 'browser_mixed_content_check',
    description:
      'Detect mixed content (HTTP resources on HTTPS pages). Scans images, scripts, stylesheets, ' +
      'iframes, and media for insecure URLs. Reports security risk level.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── JS Coverage ──────────────────────────────────────────
  {
    name: 'browser_js_coverage',
    description:
      'Analyze JavaScript usage: count inline/external scripts, estimate total JS size, ' +
      'detect render-blocking scripts, and list third-party scripts. Useful for JS diet.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Core Web Vitals ──────────────────────────────────────
  {
    name: 'browser_web_vitals',
    description:
      'Measure Core Web Vitals: LCP (Largest Contentful Paint), CLS (Cumulative Layout Shift), ' +
      'FCP (First Contentful Paint), and TTFB. Reports pass/fail against Google thresholds.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Element Remove ───────────────────────────────────────
  {
    name: 'browser_element_remove',
    description:
      'Remove elements from the page by CSS selector. Useful for cleaning up ads, banners, ' +
      'sidebars, or any distracting elements before screenshots or scraping.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of elements to remove' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },

  // ── CSS Coverage ─────────────────────────────────────────
  {
    name: 'browser_css_coverage',
    description:
      'Analyze CSS usage on the current page. Reports total stylesheets, rules, and estimates ' +
      'unused rules by testing selectors against live DOM. Useful for identifying CSS bloat.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Network Throttle ─────────────────────────────────────
  {
    name: 'browser_network_throttle',
    description:
      'Simulate slow network by intercepting fetch/XHR with artificial delay. ' +
      'Presets: 3g (2000ms), 4g (500ms), slow (5000ms), offline (reject all). Action: "enable" or "disable".',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['3g', '4g', 'slow', 'offline'], description: 'Network speed preset' },
        delayMs: { type: 'number', description: 'Custom delay in ms (overrides preset)' },
        action: { type: 'string', enum: ['enable', 'disable'], description: 'enable (default) or disable' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Device Emulate ───────────────────────────────────────
  {
    name: 'browser_device_emulate',
    description:
      'Emulate a complete device profile: viewport, user agent, touch support, and DPR in one call. ' +
      'Presets: iphone-14, pixel-7, ipad, desktop-1080p, or custom.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['iphone-14', 'pixel-7', 'ipad', 'desktop-1080p'], description: 'Device preset' },
        width: { type: 'number', description: 'Custom viewport width' },
        height: { type: 'number', description: 'Custom viewport height' },
        userAgent: { type: 'string', description: 'Custom user agent' },
        touch: { type: 'boolean', description: 'Enable touch events (default: auto based on preset)' },
        dpr: { type: 'number', description: 'Device pixel ratio (default: auto based on preset)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Timezone ─────────────────────────────────────────────
  {
    name: 'browser_timezone_set',
    description:
      'Override Intl.DateTimeFormat timezone to emulate different time zones. ' +
      'Useful for testing time-sensitive UI without changing system clock.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: 'IANA timezone (e.g., "Asia/Tokyo", "America/New_York", "Europe/London")' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['timezone'],
    },
  },

  // ── User Agent ───────────────────────────────────────────
  {
    name: 'browser_user_agent_set',
    description:
      'Override navigator.userAgent to emulate different browsers/devices. ' +
      'Presets: mobile-chrome, mobile-safari, desktop-firefox, googlebot, or custom string.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['mobile-chrome', 'mobile-safari', 'desktop-firefox', 'googlebot'], description: 'Preset UA string' },
        custom: { type: 'string', description: 'Custom UA string (overrides preset)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Geolocation Mock ─────────────────────────────────────
  {
    name: 'browser_geolocation_mock',
    description:
      'Mock the browser geolocation API to return a specific lat/lng. ' +
      'Useful for testing location-based features without physical movement. ' +
      'Presets: tokyo, nyc, london, seoul, paris, or custom coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: { type: 'string', enum: ['tokyo', 'nyc', 'london', 'seoul', 'paris'], description: 'City preset (overridden by lat/lng)' },
        lat: { type: 'number', description: 'Custom latitude' },
        lng: { type: 'number', description: 'Custom longitude' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Event Listeners ──────────────────────────────────────
  {
    name: 'browser_event_listener_list',
    description:
      'List event listeners attached to elements on the page. Reports click, submit, input, change, ' +
      'and other common event types with target elements. Useful for debugging interactivity issues.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to inspect (default: scan common interactive elements)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Print to PDF ─────────────────────────────────────────
  {
    name: 'browser_print_preview',
    description:
      'Get print preview info: how many pages the current page would produce when printed, ' +
      'paper size, margins, and print-specific CSS media query status. Useful for verifying print layouts.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Infinite Scroll ──────────────────────────────────────
  {
    name: 'browser_infinite_scroll',
    description:
      'Auto-scroll to load all content on infinite scroll pages. Scrolls to bottom repeatedly ' +
      'until no new content loads or max iterations reached. Reports items loaded per scroll.',
    inputSchema: {
      type: 'object',
      properties: {
        maxScrolls: { type: 'number', description: 'Max scroll iterations (default: 10)' },
        waitMs: { type: 'number', description: 'Wait between scrolls in ms (default: 1500)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Shadow DOM Pierce ────────────────────────────────────
  {
    name: 'browser_shadow_dom_pierce',
    description:
      'Query elements inside Shadow DOM using a piercing selector path. ' +
      'Syntax: "host-selector >>> shadow-selector". Traverses open shadow roots. ' +
      'Returns matching element info or clicks/types into shadow elements.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Piercing path (e.g., "my-component >>> .inner-btn")' },
        action: { type: 'string', enum: ['query', 'click', 'text'], description: 'query (default), click, or get text' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['path'],
    },
  },

  // ── JSON Extract ─────────────────────────────────────────
  {
    name: 'browser_json_extract',
    description:
      'Extract structured data from the page: JSON-LD, microdata, meta tags as JSON. ' +
      'Useful for scraping product info, article metadata, breadcrumbs, and rich snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Utility Tools ────────────────────────────────────────
  {
    name: 'browser_scroll_to_bottom',
    description: 'Scroll to the very bottom of the page. Useful for loading lazy content or infinite scroll.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_scroll_to_top',
    description: 'Scroll to the top of the page.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_get_url',
    description: 'Get the current page URL. Simpler than browser_eval for just getting the URL.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_get_title',
    description: 'Get the current page title.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_focus',
    description: 'Focus an element by CSS selector. Useful before typing into non-ref elements.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_blur',
    description: 'Remove focus from the currently focused element. Triggers blur events.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_press_key',
    description: 'Dispatch a keyboard event (keydown + keyup) on the focused element or document. Supports Enter, Escape, Tab, ArrowDown, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key name (e.g., "Enter", "Escape", "Tab", "ArrowDown")' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page. Optionally bypass cache.',
    inputSchema: {
      type: 'object',
      properties: {
        hard: { type: 'boolean', description: 'Force reload bypassing cache (default: false)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },
  {
    name: 'browser_page_info',
    description: 'Get basic page information: URL, title, domain, protocol, viewport size, scroll position.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },
  {
    name: 'browser_element_count',
    description: 'Get total number of DOM elements on the page. Quick complexity check.',
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...sessionIdProp } },
  },

  // ── Advanced Click ───────────────────────────────────────
  {
    name: 'browser_double_click',
    description: 'Double-click an element by @eN ref. Returns updated snapshot.',
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
    name: 'browser_right_click',
    description: 'Right-click (context menu) an element by CSS selector. Dispatches contextmenu event.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of target element' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },

  // ── Attribute Set ────────────────────────────────────────
  {
    name: 'browser_attribute_set',
    description:
      'Set or remove HTML attributes on elements by CSS selector. Useful for enabling disabled buttons, ' +
      'changing input values, toggling visibility, modifying data attributes.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of target element(s)' },
        attribute: { type: 'string', description: 'Attribute name (e.g., "disabled", "href", "data-id")' },
        value: { type: 'string', description: 'Value to set (omit to remove the attribute)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector', 'attribute'],
    },
  },

  // ── Highlight ────────────────────────────────────────────
  {
    name: 'browser_highlight',
    description:
      'Highlight elements on the page with a colored border/overlay. Useful for visual debugging, ' +
      'pointing out elements to users, or marking test targets. Action: "add" or "clear".',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to highlight' },
        action: { type: 'string', enum: ['add', 'clear'], description: 'add (default) or clear all highlights' },
        color: { type: 'string', description: 'Highlight color (default: "red")' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Page Print ───────────────────────────────────────────
  {
    name: 'browser_page_to_pdf_data',
    description:
      'Get page content as clean, printable text. Strips navigation, ads, and non-content elements. ' +
      'Returns title + main content text. Useful for saving articles, generating summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Scroll to Element ────────────────────────────────────
  {
    name: 'browser_scroll_to_element',
    description:
      'Scroll to a specific element by CSS selector. Uses scrollIntoView with smooth behavior. ' +
      'Reports element position after scroll. Useful for reaching elements below the fold.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of target element' },
        block: { type: 'string', enum: ['start', 'center', 'end', 'nearest'], description: 'Vertical alignment (default: center)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },

  // ── Count Elements ───────────────────────────────────────
  {
    name: 'browser_count_elements',
    description:
      'Count elements matching one or more CSS selectors. Returns count per selector. ' +
      'Useful for verifying page state: "are there 5 items in the cart?", "how many errors?", etc.',
    inputSchema: {
      type: 'object',
      properties: {
        selectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of CSS selectors to count (e.g., [".product", ".error", "input:checked"])',
        },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selectors'],
    },
  },

  // ── Drag and Drop ────────────────────────────────────────
  {
    name: 'browser_drag_drop',
    description:
      'Simulate drag and drop between two elements by CSS selector. Dispatches dragstart, drag, ' +
      'dragenter, dragover, drop, and dragend events. Works with HTML5 drag-and-drop API.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'CSS selector of drag source element' },
        target: { type: 'string', description: 'CSS selector of drop target element' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['source', 'target'],
    },
  },

  // ── Wait for URL ─────────────────────────────────────────
  {
    name: 'browser_wait_for_url',
    description:
      'Wait until the page URL matches a pattern (contains, starts with, or regex). ' +
      'Useful for waiting after form submission, OAuth redirects, or SPA navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'URL pattern to match (substring, or /regex/)' },
        timeout: { type: 'number', description: 'Max wait ms (default: 15000)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['pattern'],
    },
  },

  // ── Batch Click ──────────────────────────────────────────
  {
    name: 'browser_click_all',
    description:
      'Click all elements matching a CSS selector. Returns count of clicked elements. ' +
      'Useful for: "select all" checkboxes, dismissing multiple notifications, closing overlays, ' +
      'expanding all accordion sections.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to match elements (e.g., "input[type=checkbox]:not(:checked)")' },
        limit: { type: 'number', description: 'Max elements to click (default: 20, safety limit)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },

  // ── Popup Blocker ─────────────────────────────────────────
  {
    name: 'browser_popup_blocker',
    description:
      'Detect and remove popups, modals, overlays, and cookie banners that block page interaction. ' +
      'Identifies fixed/sticky positioned elements with high z-index covering the viewport. ' +
      'Actions: "detect" (list blocking elements), "remove" (auto-remove detected blockers).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['detect', 'remove'], description: 'detect (default) or remove' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Find Text ─────────────────────────────────────────────
  {
    name: 'browser_find_text',
    description:
      'Search for text on the page and return all occurrences with context. ' +
      'Reports match count, surrounding text, and parent element. Case-insensitive. ' +
      'More powerful than Ctrl+F — returns structured results for AI processing.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['query'],
    },
  },

  // ── Font List ─────────────────────────────────────────────
  {
    name: 'browser_font_list',
    description:
      'Analyze fonts used on the current page. Reports font families, sizes, weights, and element counts. ' +
      'Detects custom web fonts vs system fonts. Useful for design consistency audits.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Color Picker ──────────────────────────────────────────
  {
    name: 'browser_color_picker',
    description:
      'Extract the color palette from the current page. Analyzes background colors, text colors, ' +
      'and accent colors. Returns unique colors sorted by frequency. Useful for design auditing ' +
      'and brand consistency checks.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Dialog Handler ────────────────────────────────────────
  {
    name: 'browser_dialog_handler',
    description:
      'Configure automatic handling of JavaScript dialogs (alert, confirm, prompt). ' +
      'Set default responses so dialogs don\'t block automation. ' +
      'Actions: "configure" (set auto-responses), "status" (check current config), "history" (view past dialogs).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['configure', 'status', 'history'], description: 'Action (default: status)' },
        alert: { type: 'string', enum: ['accept', 'dismiss'], description: 'Auto-response for alert() (default: accept)' },
        confirm: { type: 'string', enum: ['accept', 'dismiss'], description: 'Auto-response for confirm() (default: accept)' },
        promptValue: { type: 'string', description: 'Auto-response value for prompt() (default: empty string)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Style Override ────────────────────────────────────────
  {
    name: 'browser_style_override',
    description:
      'Inject or remove custom CSS styles on the page. Useful for hiding elements, ' +
      'changing colors, testing layout changes, or removing popups/overlays.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['inject', 'remove', 'list'], description: 'inject (default), remove, or list active overrides' },
        css: { type: 'string', description: 'CSS rules to inject (for inject action)' },
        id: { type: 'string', description: 'Override ID to remove (for remove action)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Local Storage ─────────────────────────────────────────
  {
    name: 'browser_local_storage',
    description:
      'Read, write, or clear page localStorage. Actions: "get" (read key or all), "set" (write key/value), ' +
      '"delete" (remove key), "clear" (remove all), "list" (show all keys with sizes). ' +
      'Useful for debugging state, modifying app settings, and testing.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'delete', 'clear', 'list'], description: 'Action (default: list)' },
        key: { type: 'string', description: 'Key for get/set/delete' },
        value: { type: 'string', description: 'Value for set' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Wait for Text ─────────────────────────────────────────
  {
    name: 'browser_wait_for_text',
    description:
      'Wait until specific text appears (or disappears) on the page. ' +
      'Uses polling with configurable timeout. More intuitive than browser_wait (CSS selector). ' +
      'Useful for waiting on dynamic content, loading indicators, or confirmation messages.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to wait for' },
        hidden: { type: 'boolean', description: 'Wait for text to disappear instead (default: false)' },
        timeout: { type: 'number', description: 'Max wait ms (default: 10000)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['text'],
    },
  },

  // ── Page Audit (Unified) ──────────────────────────────────
  {
    name: 'browser_page_audit',
    description:
      'Run a comprehensive page audit combining performance, accessibility, SEO, and page weight analysis ' +
      'into a single report with overall score. One call instead of 4 separate tools. ' +
      'Returns score (0-100), issue count per category, and top issues.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Session Clone ─────────────────────────────────────────
  {
    name: 'browser_session_clone',
    description:
      'Clone an existing browser session to a new one. Copies cookies from the source session ' +
      'to maintain login state. Useful for parallel work with same authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceSessionId: { type: 'string', description: 'Session to clone from (default: "default")' },
        targetSessionId: { type: 'string', description: 'New session name to create' },
        url: { type: 'string', description: 'URL to navigate after cloning (optional)' },
      },
      required: ['targetSessionId'],
    },
  },

  // ── Page Weight ───────────────────────────────────────────
  {
    name: 'browser_page_size',
    description:
      'Analyze total page weight: HTML size, inline CSS/JS, external resources, images, fonts. ' +
      'Reports transfer sizes and identifies the heaviest resources. Useful for page diet/optimization.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Cookie Profile ────────────────────────────────────────
  {
    name: 'browser_cookie_export',
    description:
      'Export all cookies for a domain as a JSON profile. Useful for saving login state, ' +
      'sharing sessions between instances, and backup/restore of authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to export cookies for' },
        ...sessionIdProp,
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_cookie_import',
    description:
      'Import cookies from a previously exported JSON profile. Restores login state ' +
      'and session data. Use with browser_cookie_export for session transfer.',
    inputSchema: {
      type: 'object',
      properties: {
        cookies: {
          type: 'array',
          description: 'Array of cookie objects from browser_cookie_export',
          items: { type: 'object' },
        },
        ...sessionIdProp,
      },
      required: ['cookies'],
    },
  },

  // ── CAPTCHA Detection ─────────────────────────────────────
  {
    name: 'browser_captcha_detect',
    description:
      'Detect CAPTCHA presence on the current page. Checks for reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, ' +
      'and generic challenge patterns. Returns type, location, and whether it blocks page interaction.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── DOM Observer ──────────────────────────────────────────
  {
    name: 'browser_dom_observe',
    description:
      'Start/stop/read a MutationObserver on the page. Captures DOM changes (added/removed nodes, ' +
      'attribute changes, text changes). Use action="start" to begin observing, "read" to get changes ' +
      'since last read (drains buffer), "stop" to remove observer.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'read', 'stop'], description: 'start, read (default), or stop' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Scroll Map ────────────────────────────────────────────
  {
    name: 'browser_scroll_map',
    description:
      'Analyze page content density by scroll position. Divides the page into vertical sections ' +
      'and reports element count, interactive elements, text density, and images per section. ' +
      'Useful for understanding page layout, finding content-heavy zones, and UX analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        sections: { type: 'number', description: 'Number of vertical sections to divide page into (default: 5)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Dark Mode ─────────────────────────────────────────────
  {
    name: 'browser_dark_mode',
    description:
      'Detect or toggle dark mode preference. Reports current color scheme (light/dark), ' +
      'whether the page respects prefers-color-scheme, and can emulate dark/light mode.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['detect', 'dark', 'light'], description: 'detect (default), dark (emulate dark), light (emulate light)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Viewport ──────────────────────────────────────────────
  {
    name: 'browser_viewport_test',
    description:
      'Test page responsiveness across common device viewports. Reports viewport dimensions, ' +
      'horizontal overflow, hidden elements, and media query breakpoints. ' +
      'Presets: mobile (375x667), tablet (768x1024), desktop (1280x720), wide (1920x1080).',
    inputSchema: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: ['mobile', 'tablet', 'desktop', 'wide'],
          description: 'Device preset (default: reports current viewport)',
        },
        width: { type: 'number', description: 'Custom viewport width (overrides preset)' },
        height: { type: 'number', description: 'Custom viewport height (overrides preset)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Page Text ──────────────────────────────────────────────
  {
    name: 'browser_text_content',
    description:
      'Extract all visible text content from the current page, organized by sections. ' +
      'More structured than browser_html, less noisy than browser_snapshot. ' +
      'Returns headings, paragraphs, lists, and other text blocks in reading order.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Data Extraction ────────────────────────────────────────
  {
    name: 'browser_table_extract',
    description:
      'Extract data from HTML tables on the current page. Returns structured JSON arrays with headers and rows. ' +
      'Supports multiple tables via index parameter. Useful for scraping price lists, leaderboards, data grids.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'Table index (0-based, default: 0). Use -1 for all tables.' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  {
    name: 'browser_link_extract',
    description:
      'Extract all links from the current page. Returns href, text, and whether internal/external. ' +
      'Supports domain filter. Useful for crawling, sitemap generation, and broken link detection.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'internal', 'external'], description: 'Filter by link type (default: all)' },
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  {
    name: 'browser_image_list',
    description:
      'List all images on the current page with src, alt text, dimensions, and loading status. ' +
      'Useful for content auditing, finding broken images, and checking alt text coverage.',
    inputSchema: {
      type: 'object',
      properties: {
        ...tabIdProp,
        ...sessionIdProp,
      },
    },
  },

  // ── Element Inspector ──────────────────────────────────────
  {
    name: 'browser_element_info',
    description:
      'Get detailed information about a page element by CSS selector: bounding box (x, y, width, height), ' +
      'computed styles (color, font, display, visibility, position), all HTML attributes, inner text, and tag name. ' +
      'Useful for debugging layout issues, verifying styles, and understanding element state.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (e.g., "#login-btn", ".header h1", "input[name=email]")' },
        ...tabIdProp,
        ...sessionIdProp,
      },
      required: ['selector'],
    },
  },

  // ── SEO ────────────────────────────────────────────────────
  {
    name: 'browser_meta_seo',
    description:
      'Analyze page SEO metadata: title, description, canonical URL, Open Graph tags, ' +
      'Twitter Card tags, structured data (JSON-LD), robots meta, and heading structure. ' +
      'Returns a comprehensive SEO audit report.',
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
