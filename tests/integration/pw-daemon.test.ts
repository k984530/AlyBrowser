import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

const PORT = 19876;
const BASE = `http://localhost:${PORT}`;

// ── Helper ─────────────────────────────────────────────────
async function req(
  method: string,
  path: string,
  body?: string
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}${path}`, { method, body });
  const data = await res.json();
  return { status: res.status, data };
}

function ok(path: string, body?: string) {
  return req("POST", path, body).then((r) => r.data);
}

function get(path: string) {
  return req("GET", path).then((r) => r.data);
}

// ── Lifecycle ──────────────────────────────────────────────
describe("pw-daemon", () => {
  let daemon: ChildProcess;

  beforeAll(async () => {
    daemon = spawn(
      "node",
      [join(__dirname, "../../scripts/pw-daemon.mjs")],
      {
        env: {
          ...process.env,
          PW_PORT: String(PORT),
          PW_HEADLESS: "1",
          PW_SESSIONS_DIR: "/tmp/pw-test-sessions",
        },
        stdio: "pipe",
      }
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("daemon startup timeout")),
        20000
      );

      let stderr = "";
      daemon.stderr?.on("data", (d) => (stderr += d.toString()));

      daemon.stdout?.on("data", (data) => {
        if (data.toString().includes("pw-daemon on")) {
          clearTimeout(timeout);
          resolve();
        }
      });

      daemon.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      daemon.on("exit", (code) => {
        if (code) {
          clearTimeout(timeout);
          reject(new Error(`daemon exited ${code}: ${stderr}`));
        }
      });
    });
  }, 30000);

  afterAll(async () => {
    try {
      await ok("/close");
    } catch {
      daemon?.kill("SIGTERM");
    }
    await new Promise<void>((resolve) => {
      if (daemon.exitCode !== null) return resolve();
      daemon.on("exit", () => resolve());
      setTimeout(resolve, 5000);
    });
  }, 10000);

  // ── Sessions ───────────────────────────────────────────
  describe("session management", () => {
    it("auto-creates default session on first request", async () => {
      const data = await get("/status");
      expect(data.name).toBe("default");
      expect(data.browser).toBe(true);
      expect(data.persistent).toBe(true);
      expect(data.page).toBe(true);
      expect(data.url).toBe("about:blank");
    });

    it("GET /sessions lists active sessions", async () => {
      const data = await get("/sessions");
      expect(data.sessions).toHaveLength(1);
      expect(data.sessions[0].name).toBe("default");
    });

    it("?s=name creates named session on demand", async () => {
      const data = await get("/status?s=test1");
      expect(data.name).toBe("test1");
      expect(data.browser).toBe(true);
      expect(data.url).toBe("about:blank");

      const list = await get("/sessions");
      expect(list.sessions).toHaveLength(2);
      const names = list.sessions.map((s: any) => s.name).sort();
      expect(names).toEqual(["default", "test1"]);
    });

    it("DELETE /session closes specific session", async () => {
      await req("DELETE", "/session?s=test1");
      const list = await get("/sessions");
      expect(list.sessions).toHaveLength(1);
      expect(list.sessions[0].name).toBe("default");
    });
  });

  // ── Navigation (default session) ───────────────────────
  describe("POST /goto", () => {
    it("navigates with plain URL string", async () => {
      const data = await ok("/goto", "https://example.com");
      expect(data.ok).toBe(true);
      expect(data.url).toContain("example.com");
      expect(data.status).toBe(200);
    });

    it("accepts JSON body with options", async () => {
      const data = await ok(
        "/goto",
        JSON.stringify({ url: "https://example.com", waitUntil: "load" })
      );
      expect(data.ok).toBe(true);
      expect(data.url).toContain("example.com");
    });
  });

  describe("POST /reload", () => {
    it("reloads current page", async () => {
      const data = await ok("/reload");
      expect(data.ok).toBe(true);
      expect(data.url).toContain("example.com");
    });
  });

  // ── Eval ───────────────────────────────────────────────
  describe("POST /eval", () => {
    it("executes Playwright API and returns result", async () => {
      const data = await ok("/eval", "return await page.title()");
      expect(data.result).toBe("Example Domain");
    });

    it("supports page.evaluate for browser-side JS", async () => {
      const data = await ok(
        "/eval",
        "return await page.evaluate(() => document.title)"
      );
      expect(data.result).toBe("Example Domain");
    });

    it("returns null for void expressions", async () => {
      const data = await ok("/eval", "await page.title()");
      expect(data.result).toBeNull();
    });

    it("exposes session object", async () => {
      const data = await ok("/eval", "return session.name");
      expect(data.result).toBe("default");
    });

    it("returns 500 for thrown errors", async () => {
      const { status, data } = await req(
        "POST",
        "/eval",
        'throw new Error("intentional")'
      );
      expect(status).toBe(500);
      expect(data.error).toBe("intentional");
    });
  });

  // ── DOM Extraction ─────────────────────────────────────
  describe("POST /text", () => {
    it("extracts inner text by selector", async () => {
      const data = await ok("/text", "h1");
      expect(data.text).toBe("Example Domain");
    });
  });

  describe("POST /html", () => {
    it("extracts inner HTML by selector", async () => {
      const data = await ok("/html", "h1");
      expect(data.html).toBe("Example Domain");
    });
  });

  // ── Interaction ────────────────────────────────────────
  describe("interaction endpoints", () => {
    beforeAll(async () => {
      await ok(
        "/eval",
        `
        await page.setContent(\`
          <input id="name" type="text" />
          <button id="btn" onclick="document.getElementById('result').textContent='clicked'">Go</button>
          <div id="result"></div>
        \`);
        `
      );
    });

    it("POST /fill fills an input field", async () => {
      const data = await ok(
        "/fill",
        JSON.stringify({ selector: "#name", value: "Alice" })
      );
      expect(data.ok).toBe(true);
      const val = await ok("/eval", 'return await page.inputValue("#name")');
      expect(val.result).toBe("Alice");
    });

    it("POST /click clicks an element", async () => {
      const data = await ok("/click", "#btn");
      expect(data.ok).toBe(true);
      const result = await ok("/text", "#result");
      expect(result.text).toBe("clicked");
    });

    it("POST /wait waits for existing selector", async () => {
      const data = await ok("/wait", "#btn");
      expect(data.ok).toBe(true);
    });
  });

  // ── Screenshot ─────────────────────────────────────────
  describe("POST /screenshot", () => {
    const tmpPath = "/tmp/pw-daemon-test-screenshot.png";
    afterAll(() => { if (existsSync(tmpPath)) unlinkSync(tmpPath); });

    it("saves screenshot to specified path", async () => {
      const data = await ok("/screenshot", JSON.stringify({ path: tmpPath }));
      expect(data.ok).toBe(true);
      expect(existsSync(tmpPath)).toBe(true);
    });
  });

  // ── Console ────────────────────────────────────────────
  describe("console endpoints", () => {
    it("GET /console returns buffer", async () => {
      const data = await get("/console");
      expect(Array.isArray(data.console)).toBe(true);
    });

    it("DELETE /console clears buffer", async () => {
      await req("DELETE", "/console");
      const data = await get("/console");
      expect(data.console).toEqual([]);
    });
  });

  // ── Multi-page (within session) ────────────────────────
  describe("multi-page", () => {
    it("POST /new-page creates named page", async () => {
      const data = await ok(
        "/new-page",
        JSON.stringify({ name: "tab2", url: "https://example.com" })
      );
      expect(data.ok).toBe(true);
      expect(data.name).toBe("tab2");
    });

    it("POST /switch changes active page", async () => {
      const data = await ok("/switch", "tab2");
      expect(data.ok).toBe(true);
    });

    it("POST /switch returns 404 for unknown page", async () => {
      const { status } = await req("POST", "/switch", "nonexistent");
      expect(status).toBe(404);
    });
  });

  // ── Batch ──────────────────────────────────────────────
  describe("POST /batch", () => {
    it("executes multiple operations in one call", async () => {
      const data = await ok(
        "/batch",
        JSON.stringify([
          { goto: "https://example.com" },
          { eval: "return await page.title()" },
          { text: "h1" },
        ])
      );
      expect(data.results).toHaveLength(3);
      expect(data.results[0].ok).toBe(true);
      expect(data.results[1].result).toBe("Example Domain");
      expect(data.results[2].text).toBe("Example Domain");
    });

    it("handles errors per-operation without stopping", async () => {
      const data = await ok(
        "/batch",
        JSON.stringify([
          { eval: "return 1" },
          { text: "#nonexistent-xyz" },
          { eval: "return 2" },
        ])
      );
      expect(data.results).toHaveLength(3);
      expect(data.results[0].result).toBe(1);
      expect(data.results[1].error).toBeDefined();
      expect(data.results[2].result).toBe(2);
    });

    it("stops on error when stopOnError is set", async () => {
      const data = await ok(
        "/batch",
        JSON.stringify([
          { eval: "return 1" },
          { text: "#nonexistent-xyz", stopOnError: true },
          { eval: "return 3" },
        ])
      );
      expect(data.results).toHaveLength(2);
    });
  });

  // ── Multi-session ──────────────────────────────────────
  describe("multi-session isolation", () => {
    it("sessions are isolated from each other", async () => {
      // Navigate default to example.com
      await ok("/goto", "https://example.com");

      // Create session "other" and navigate to a different page
      await ok("/goto?s=other", "https://example.com");
      await ok("/eval?s=other", 'await page.setContent("<h1>Other</h1>")');

      // Verify isolation
      const defaultTitle = await ok("/eval", "return await page.title()");
      expect(defaultTitle.result).toBe("Example Domain");

      const otherText = await ok("/text?s=other", "h1");
      expect(otherText.text).toBe("Other");

      // List sessions
      const list = await get("/sessions");
      const names = list.sessions.map((s: any) => s.name).sort();
      expect(names).toContain("default");
      expect(names).toContain("other");
    });

    it("batch works in specific session", async () => {
      const data = await ok(
        "/batch?s=other",
        JSON.stringify([
          { eval: "return session.name" },
          { text: "h1" },
        ])
      );
      expect(data.results[0].result).toBe("other");
      expect(data.results[1].text).toBe("Other");
    });

    it("DELETE /session closes only that session", async () => {
      await req("DELETE", "/session?s=other");
      const list = await get("/sessions");
      const names = list.sessions.map((s: any) => s.name);
      expect(names).not.toContain("other");
      expect(names).toContain("default");
    });
  });

  // ── POST /init with options ────────────────────────────
  describe("POST /init", () => {
    it("reinitializes a session", async () => {
      await ok("/init?s=reinit", "{}");
      const data = await get("/status?s=reinit");
      expect(data.browser).toBe(true);
      expect(data.url).toBe("about:blank");

      // Cleanup
      await req("DELETE", "/session?s=reinit");
    });

    it("supports ephemeral (non-persistent) sessions", async () => {
      await ok("/init?s=ephemeral", '{"persistent":false}');
      const data = await get("/status?s=ephemeral");
      expect(data.persistent).toBe(false);
      expect(data.browser).toBe(true);

      // Cleanup
      await req("DELETE", "/session?s=ephemeral");
    });
  });

  // ── Error Handling ─────────────────────────────────────
  describe("error handling", () => {
    it("returns 404 for unknown routes", async () => {
      const { status, data } = await req("GET", "/unknown");
      expect(status).toBe(404);
      expect(data.error).toBe("not found");
    });

    it("returns 500 for handler errors", async () => {
      const { status, data } = await req("POST", "/text", "#nonexistent-element-xyz");
      expect(status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });
});
