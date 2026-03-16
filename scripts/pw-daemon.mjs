#!/usr/bin/env node

/**
 * pw-daemon — Multi-session Playwright daemon for Claude Code
 *
 * Each session is an isolated Chromium instance with its own profile.
 * Sessions persist login state across daemon restarts.
 *
 * Usage:
 *   node scripts/pw-daemon.mjs                  # start daemon
 *   PW_PORT=9000 node scripts/pw-daemon.mjs     # custom port
 *   PW_HEADLESS=1 node scripts/pw-daemon.mjs    # headless mode
 *
 * Session routing — append ?s=<name> to any endpoint:
 *   curl localhost:9876/status?s=instagram
 *   curl -X POST localhost:9876/goto?s=dev -d 'http://localhost:3000'
 *   (omit ?s= to use "default" session)
 */

import { chromium, firefox, webkit } from "playwright";
import { createServer } from "node:http";
import { join } from "node:path";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const PORT = parseInt(process.env.PW_PORT || "9876");
const SOCK = process.env.PW_SOCK || "/tmp/pw.sock";
const HEADLESS = process.env.PW_HEADLESS === "1";
const SESSIONS_DIR = process.env.PW_SESSIONS_DIR || join(homedir(), ".pw-sessions");
const CONSOLE_MAX = 200;
const engines = { chromium, firefox, webkit };

// ── Session ────────────────────────────────────────────────
class Session {
  constructor(name) {
    this.name = name;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.refs = {};        // named pages for multi-tab
    this.consoleBuf = [];
    this.persistent = false;
    this.createdAt = new Date().toISOString();
  }

  attachConsole(p) {
    p.on("console", (msg) => {
      this.consoleBuf.push({ type: msg.type(), text: msg.text() });
      if (this.consoleBuf.length > CONSOLE_MAX) this.consoleBuf.shift();
    });
    p.on("pageerror", (err) => {
      this.consoleBuf.push({ type: "error", text: err.message });
      if (this.consoleBuf.length > CONSOLE_MAX) this.consoleBuf.shift();
    });
  }

  async init(opts = {}) {
    await this.close();

    const engine = engines[opts.engine || "chromium"];
    const profileDir = opts.profile || join(SESSIONS_DIR, this.name, "profile");
    mkdirSync(profileDir, { recursive: true });

    if (opts.persistent !== false) {
      // Default: persistent context with isolated profile
      this.context = await engine.launchPersistentContext(profileDir, {
        headless: opts.headless ?? HEADLESS,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
          ...(opts.args || []),
        ],
        ignoreDefaultArgs: ["--enable-automation"],
        viewport: opts.viewport ?? null,
        ...(opts.channel ? { channel: opts.channel } : {}),
      });
      this.browser = null;
      this.persistent = true;
    } else {
      // Ephemeral: no profile persistence
      this.browser = await engine.launch({
        headless: opts.headless ?? HEADLESS,
        args: opts.args || [],
        ...(opts.channel ? { channel: opts.channel } : {}),
      });
      this.context = await this.browser.newContext(opts.context || {});
      this.persistent = false;
    }

    this.page = this.context.pages()[0] || await this.context.newPage();
    this.attachConsole(this.page);
    this.consoleBuf = [];
    for (const k of Object.keys(this.refs)) delete this.refs[k];
  }

  async close() {
    if (this.persistent && this.context) {
      await this.context.close().catch(() => {});
    } else if (this.browser) {
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.persistent = false;
    for (const k of Object.keys(this.refs)) delete this.refs[k];
  }

  async execCode(code) {
    const fn = new AsyncFunction(
      "browser", "context", "page", "refs",
      "chromium", "firefox", "webkit", "session",
      code
    );
    return await fn(
      this.browser, this.context, this.page, this.refs,
      chromium, firefox, webkit, this
    );
  }

  status() {
    const pages = this.context ? this.context.pages().map((p) => p.url()) : [];
    return {
      name: this.name,
      browser: !!(this.browser || this.persistent),
      persistent: this.persistent,
      page: !!this.page,
      url: this.page?.url() ?? null,
      pages,
      refs: Object.keys(this.refs),
      consoleCount: this.consoleBuf.length,
      createdAt: this.createdAt,
    };
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ── Session Manager ────────────────────────────────────────
const sessions = new Map();

function getSession(name = "default") {
  if (!sessions.has(name)) {
    sessions.set(name, new Session(name));
  }
  return sessions.get(name);
}

// ── HTTP Helpers ───────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

function json(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  try {
    res.end(JSON.stringify(data));
  } catch {
    res.end(JSON.stringify({ result: String(data) }));
  }
}

// ── Routes ─────────────────────────────────────────────────
// Each route receives (req, res, session)
const routes = {
  "GET /sessions": async (_req, res) => {
    const list = [];
    for (const [name, s] of sessions) {
      list.push(s.status());
    }
    json(res, { sessions: list });
  },

  "GET /status": async (_req, res, s) => {
    json(res, s.status());
  },

  "POST /init": async (req, res, s) => {
    const body = await readBody(req);
    const opts = body ? JSON.parse(body) : {};
    await s.init(opts);
    json(res, { ok: true, session: s.name, url: s.page.url() });
  },

  "POST /eval": async (req, res, s) => {
    const code = await readBody(req);
    const prevLen = s.consoleBuf.length;
    const result = await s.execCode(code);
    const newConsole = s.consoleBuf.slice(prevLen);
    json(res, { result: result ?? null, console: newConsole });
  },

  "POST /goto": async (req, res, s) => {
    const body = await readBody(req);
    let url, opts;
    try {
      const parsed = JSON.parse(body);
      url = parsed.url;
      opts = parsed;
    } catch {
      url = body.trim();
      opts = {};
    }
    const resp = await s.page.goto(url, {
      waitUntil: opts.waitUntil || "domcontentloaded",
    });
    json(res, { ok: true, url: s.page.url(), status: resp?.status() });
  },

  "POST /reload": async (_req, res, s) => {
    await s.page.reload({ waitUntil: "domcontentloaded" });
    json(res, { ok: true, url: s.page.url() });
  },

  "POST /screenshot": async (req, res, s) => {
    const body = await readBody(req);
    const opts = body ? JSON.parse(body) : {};
    const path = opts.path || join(process.cwd(), `screenshot-${Date.now()}.png`);
    await s.page.screenshot({ path, fullPage: opts.fullPage ?? false });
    json(res, { ok: true, path });
  },

  "POST /html": async (req, res, s) => {
    const body = await readBody(req);
    const selector = body?.trim() || "body";
    const html = await s.page.$eval(selector, (el) => el.innerHTML);
    json(res, { html });
  },

  "POST /text": async (req, res, s) => {
    const body = await readBody(req);
    const selector = body?.trim() || "body";
    const text = await s.page.$eval(selector, (el) => el.innerText);
    json(res, { text });
  },

  "POST /click": async (req, res, s) => {
    const selector = (await readBody(req)).trim();
    await s.page.click(selector);
    json(res, { ok: true, selector });
  },

  "POST /fill": async (req, res, s) => {
    const { selector, value } = JSON.parse(await readBody(req));
    await s.page.fill(selector, value);
    json(res, { ok: true, selector });
  },

  "POST /wait": async (req, res, s) => {
    const body = await readBody(req);
    let selector, opts;
    try {
      const parsed = JSON.parse(body);
      selector = parsed.selector;
      opts = parsed;
    } catch {
      selector = body.trim();
      opts = {};
    }
    await s.page.waitForSelector(selector, {
      timeout: opts.timeout || 10000,
      state: opts.state || "visible",
    });
    json(res, { ok: true, selector });
  },

  "POST /new-page": async (req, res, s) => {
    const body = await readBody(req);
    const opts = body ? JSON.parse(body) : {};
    const p = await s.context.newPage();
    s.attachConsole(p);
    if (opts.name) s.refs[opts.name] = p;
    if (opts.url) await p.goto(opts.url, { waitUntil: "domcontentloaded" });
    s.page = p;
    json(res, { ok: true, name: opts.name ?? null, url: p.url() });
  },

  "POST /switch": async (req, res, s) => {
    const name = (await readBody(req)).trim();
    if (!s.refs[name]) {
      json(res, { error: `no page named "${name}"` }, 404);
      return;
    }
    s.page = s.refs[name];
    json(res, { ok: true, url: s.page.url() });
  },

  "POST /new-context": async (req, res, s) => {
    if (s.persistent) {
      json(res, { error: "cannot create new context in persistent session" }, 400);
      return;
    }
    const body = await readBody(req);
    const opts = body ? JSON.parse(body) : {};
    s.context = await s.browser.newContext(opts);
    s.page = await s.context.newPage();
    s.attachConsole(s.page);
    s.consoleBuf = [];
    json(res, { ok: true });
  },

  "GET /console": async (_req, res, s) => {
    json(res, { console: s.consoleBuf });
  },

  "DELETE /console": async (_req, res, s) => {
    s.consoleBuf = [];
    json(res, { ok: true });
  },

  "POST /batch": async (req, res, s) => {
    const ops = JSON.parse(await readBody(req));
    const results = [];
    for (const op of ops) {
      try {
        if (op.eval) {
          const prevLen = s.consoleBuf.length;
          const result = await s.execCode(op.eval);
          results.push({ result: result ?? null, console: s.consoleBuf.slice(prevLen) });
        } else if (op.goto) {
          const resp = await s.page.goto(op.goto, { waitUntil: op.waitUntil || "domcontentloaded" });
          results.push({ ok: true, url: s.page.url(), status: resp?.status() });
        } else if (op.click) {
          await s.page.click(op.click);
          results.push({ ok: true });
        } else if (op.fill) {
          await s.page.fill(op.fill, op.value);
          results.push({ ok: true });
        } else if (op.text) {
          const text = await s.page.$eval(op.text, (el) => el.innerText);
          results.push({ text });
        } else if (op.html) {
          const html = await s.page.$eval(op.html, (el) => el.innerHTML);
          results.push({ html });
        } else if (op.wait) {
          await s.page.waitForSelector(op.wait, { timeout: op.timeout || 10000, state: op.state || "visible" });
          results.push({ ok: true });
        } else if (op.screenshot) {
          const path = op.screenshot === true ? join(process.cwd(), `screenshot-${Date.now()}.png`) : op.screenshot;
          await s.page.screenshot({ path, fullPage: op.fullPage ?? false });
          results.push({ ok: true, path });
        } else if (op.reload) {
          await s.page.reload({ waitUntil: "domcontentloaded" });
          results.push({ ok: true, url: s.page.url() });
        } else {
          results.push({ error: "unknown op", op });
        }
      } catch (err) {
        results.push({ error: err.message });
        if (op.stopOnError) break;
      }
    }
    json(res, { results });
  },

  "DELETE /session": async (_req, res, s) => {
    await s.close();
    sessions.delete(s.name);
    json(res, { ok: true, closed: s.name });
  },

  "POST /close": async (_req, res) => {
    // Close ALL sessions and shut down daemon
    for (const [, s] of sessions) {
      await s.close();
    }
    sessions.clear();
    json(res, { ok: true, message: "shutdown" });
    server.close();
    udsServer.close();
    if (existsSync(SOCK)) unlinkSync(SOCK);
    setTimeout(() => process.exit(0), 100);
  },
};

// ── Server ─────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  const key = `${req.method} ${pathname}`;
  const handler = routes[key];

  if (!handler) {
    json(res, { error: "not found", routes: Object.keys(routes) }, 404);
    return;
  }

  // Session routing: ?s=name (default: "default")
  const sessionName = url.searchParams.get("s") || "default";
  const session = getSession(sessionName);

  // Auto-init session if not yet initialized and route needs it
  const noInitNeeded = ["GET /sessions", "POST /init", "POST /close"];
  if (!noInitNeeded.includes(key) && !session.page) {
    try {
      await session.init();
    } catch (err) {
      json(res, { error: `session "${sessionName}" auto-init failed: ${err.message}` }, 500);
      return;
    }
  }

  try {
    await handler(req, res, session);
  } catch (err) {
    json(
      res,
      { error: err.message, stack: err.stack?.split("\n").slice(0, 5) },
      500
    );
  }
});

// ── Startup ────────────────────────────────────────────────
mkdirSync(SESSIONS_DIR, { recursive: true });

// Dual listen: TCP + Unix Domain Socket
server.listen(PORT, () => {
  console.log(`pw-daemon on http://localhost:${PORT}`);
  console.log(`  headless: ${HEADLESS} | sessions: ${SESSIONS_DIR}`);
});

const udsServer = createServer(server.listeners("request")[0]);
if (existsSync(SOCK)) unlinkSync(SOCK);
udsServer.listen(SOCK, () => {
  console.log(`pw-daemon on unix://${SOCK}`);
  console.log(`  routes: ${Object.keys(routes).join(", ")}`);
});

// ── Graceful Shutdown ──────────────────────────────────────
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    for (const [, s] of sessions) {
      await s.close();
    }
    server.close();
    udsServer.close();
    if (existsSync(SOCK)) unlinkSync(SOCK);
    process.exit(0);
  });
}
