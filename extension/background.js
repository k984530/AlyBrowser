// AlyBrowser Extension — Background Service Worker
// Bridges between Node.js WebSocket server and Chrome Extension APIs

const WS_PORT = 19222;
let ws = null;
let activeTabId = null;
let contentReady = new Map();
let alarmEvents = [];

// ── WebSocket Connection ────────────────────────────────────

let connecting = false;

function connect() {
  if (connecting) return;
  connecting = true;

  try {
    ws = new WebSocket(`ws://localhost:${WS_PORT}`);
  } catch {
    connecting = false;
    scheduleReconnect();
    return;
  }

  ws.onopen = async () => {
    connecting = false;
    console.log('[aly] Connected to bridge');
    // Cancel reconnect alarm since we're connected
    chrome.alarms.clear('aly-reconnect');
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      activeTabId = tabs[0].id;
    } else {
      const tab = await chrome.tabs.create({ url: 'about:blank' });
      activeTabId = tab.id;
    }
    ws.send(JSON.stringify({ type: 'ready', tabId: activeTabId }));
  };

  ws.onmessage = async (event) => {
    const cmd = JSON.parse(event.data);
    if (cmd.type === 'ping') return;

    let response;
    try {
      const result = await handleCommand(cmd);
      response = JSON.stringify({ id: cmd.id, result });
    } catch (err) {
      response = JSON.stringify({ id: cmd.id, error: err.message || String(err) });
    }
    try {
      ws.send(response);
    } catch {
      // WS closed during async command — response is lost, onclose will handle reconnect
    }
  };

  ws.onclose = () => {
    connecting = false;
    console.log('[aly] Disconnected, scheduling reconnect...');
    scheduleReconnect();
  };

  ws.onerror = () => {
    connecting = false;
  };
}

// Use chrome.alarms for reconnection — survives service worker suspension
function scheduleReconnect() {
  chrome.alarms.create('aly-reconnect', { periodInMinutes: 0.05 }); // every 3 seconds
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'aly-reconnect') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    } else {
      chrome.alarms.clear('aly-reconnect');
    }
    return;
  }
  // User-created alarms
  alarmEvents.push({
    name: alarm.name,
    scheduledTime: alarm.scheduledTime,
    firedAt: Date.now(),
  });
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'alarm',
      alarm: { name: alarm.name, scheduledTime: alarm.scheduledTime },
    }));
  }
});

// Keep service worker alive while connected
setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 20000);

// ── Content Script Tracking ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'contentReady' && sender.tab) {
    contentReady.set(sender.tab.id, true);
  }
});

// ── Tab Lifecycle Cleanup ───────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  contentReady.delete(tabId);
  if (tabId === activeTabId) {
    activeTabId = null;
  }
});

// ── Alarm Events (user-created alarms handled in the unified alarm listener above) ──

// ── Command Router ──────────────────────────────────────────

async function handleCommand(cmd) {
  const { action, params = {} } = cmd;
  const tabId = params.tabId;  // Optional tab targeting for parallel work

  switch (action) {
    // Navigation
    case 'navigate': return handleNavigate(params, tabId);
    case 'goBack': return handleGoBack(tabId);
    case 'goForward': return handleGoForward(tabId);

    // Page interaction (content script)
    case 'snapshot': return sendToContent({ action: 'snapshot' }, tabId);
    case 'click': return sendToContent({ action: 'click', params }, tabId);
    case 'type': return sendToContent({ action: 'type', params }, tabId);
    case 'select': return sendToContent({ action: 'select', params }, tabId);
    case 'hover': return sendToContent({ action: 'hover', params }, tabId);
    case 'scrollBy': return sendToContent({ action: 'scrollBy', params }, tabId);
    case 'waitForSelector': return sendToContent({ action: 'waitForSelector', params }, tabId);
    case 'waitForStable': return sendToContent({ action: 'waitForStable', params }, tabId);
    case 'getHTML': return sendToContent({ action: 'getHTML' }, tabId);

    // JavaScript
    case 'evaluate': return handleEvaluate(params, tabId);

    // Tabs
    case 'tabList': return handleTabList();
    case 'tabNew': return handleTabNew(params);
    case 'tabClose': return handleTabClose(params);
    case 'tabSwitch': return handleTabSwitch(params);

    // Cookies
    case 'cookieGet': return handleCookieGet(params);
    case 'cookieSet': return handleCookieSet(params);
    case 'cookieDelete': return handleCookieDelete(params);

    // Downloads
    case 'download': return handleDownload(params);

    // History
    case 'historySearch': return handleHistorySearch(params);

    // Alarms
    case 'alarmCreate': return handleAlarmCreate(params);
    case 'alarmList': return handleAlarmList();
    case 'alarmClear': return handleAlarmClear(params);
    case 'alarmEvents': return handleAlarmEvents();

    // Storage
    case 'storageGet': return handleStorageGet(params);
    case 'storageSet': return handleStorageSet(params);

    // Notifications
    case 'notify': return handleNotify(params);

    // Bookmarks
    case 'bookmarkList': return handleBookmarkList(params);
    case 'bookmarkCreate': return handleBookmarkCreate(params);
    case 'bookmarkDelete': return handleBookmarkDelete(params);

    // Top Sites
    case 'topSites': return handleTopSites();

    // Clipboard
    case 'clipboardRead': return handleClipboardRead(tabId);
    case 'clipboardWrite': return handleClipboardWrite(params, tabId);

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ── Navigation ──────────────────────────────────────────────

function isContentScriptUrl(url) {
  try {
    return /^https?:\/\//i.test(url);
  } catch { return false; }
}

async function handleNavigate(params, tabId) {
  const target = tabId || activeTabId;
  contentReady.delete(target);
  await chrome.tabs.update(target, { url: params.url });
  // Content scripts only run on http/https pages — skip wait for other schemes
  if (isContentScriptUrl(params.url)) {
    await waitForContentScript(target, 30000);
  }
  return { ok: true, url: params.url };
}

async function handleGoBack(tabId) {
  const target = tabId || activeTabId;
  contentReady.delete(target);
  await chrome.tabs.goBack(target);
  await waitForContentScript(target, 10000).catch(() => {});
  return { ok: true };
}

async function handleGoForward(tabId) {
  const target = tabId || activeTabId;
  contentReady.delete(target);
  await chrome.tabs.goForward(target);
  await waitForContentScript(target, 10000).catch(() => {});
  return { ok: true };
}

// ── JavaScript Evaluation ───────────────────────────────────

async function handleEvaluate(params, tabId) {
  const target = tabId || activeTabId;
  // Try MAIN world first (works on most sites), fall back to ISOLATED if CSP blocks eval
  for (const world of ['MAIN', 'ISOLATED']) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: target },
        world,
        func: async (expr) => {
          try {
            let r = (0, eval)(expr); // indirect eval
            // Await Promises so async expressions (fetch, etc.) return resolved values
            if (r && typeof r === 'object' && typeof r.then === 'function') {
              r = await r;
            }
            if (r === undefined || r === null) return { ok: true, value: null };
            if (typeof r === 'function') return { ok: true, value: r.toString() };
            if (typeof r === 'object') {
              try { return { ok: true, value: JSON.parse(JSON.stringify(r)) }; }
              catch { return { ok: true, value: String(r) }; }
            }
            return { ok: true, value: r };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        },
        args: [params.expression],
      });

      const r = results?.[0]?.result;
      if (!r) continue;
      if (!r.ok && r.error?.includes('Content Security Policy')) continue;
      if (!r.ok) throw new Error(r.error);
      return r.value;
    } catch (e) {
      if (world === 'ISOLATED') throw e;
    }
  }
  throw new Error('Script execution failed in both MAIN and ISOLATED worlds');
}

// ── Tab Management ──────────────────────────────────────────

async function handleTabList() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({
    id: t.id, url: t.url, title: t.title,
    active: t.active, windowId: t.windowId,
  }));
}

async function handleTabNew(params) {
  const url = params.url || 'about:blank';
  const tab = await chrome.tabs.create({ url });
  activeTabId = tab.id;
  if (isContentScriptUrl(url)) {
    await waitForContentScript(tab.id, 30000).catch(() => {});
  }
  return { tabId: tab.id, url: tab.url };
}

async function handleTabClose(params) {
  const tabId = params.tabId || activeTabId;
  contentReady.delete(tabId);
  await chrome.tabs.remove(tabId);
  if (tabId === activeTabId) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tabs[0]?.id || null;
  }
  return { ok: true };
}

async function handleTabSwitch(params) {
  await chrome.tabs.update(params.tabId, { active: true });
  activeTabId = params.tabId;
  return { ok: true };
}

// ── Cookie Management ───────────────────────────────────────

async function handleCookieGet(params) {
  const cookies = await chrome.cookies.getAll({
    url: params.url,
    ...(params.name && { name: params.name }),
  });
  return cookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain,
    path: c.path, secure: c.secure, httpOnly: c.httpOnly,
    expirationDate: c.expirationDate,
  }));
}

async function handleCookieSet(params) {
  const cookie = await chrome.cookies.set({
    url: params.url, name: params.name, value: params.value,
    ...(params.domain && { domain: params.domain }),
    ...(params.path && { path: params.path }),
    ...(params.secure !== undefined && { secure: params.secure }),
    ...(params.httpOnly !== undefined && { httpOnly: params.httpOnly }),
    ...(params.expirationDate && { expirationDate: params.expirationDate }),
  });
  return { ok: true, cookie };
}

async function handleCookieDelete(params) {
  await chrome.cookies.remove({ url: params.url, name: params.name });
  return { ok: true };
}

// ── Downloads ───────────────────────────────────────────────

async function handleDownload(params) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: params.url,
      ...(params.filename && { filename: params.filename }),
      ...(params.saveAs !== undefined && { saveAs: params.saveAs }),
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      function onChanged(delta) {
        if (delta.id !== downloadId) return;
        if (delta.state?.current === 'complete') {
          chrome.downloads.onChanged.removeListener(onChanged);
          chrome.downloads.search({ id: downloadId }, (results) => {
            resolve({
              id: downloadId, filename: results[0]?.filename,
              fileSize: results[0]?.fileSize, state: 'complete',
            });
          });
        } else if (delta.state?.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error(`Download failed: ${delta.error?.current || 'unknown'}`));
        }
      }
      chrome.downloads.onChanged.addListener(onChanged);

      // 5 min timeout
      setTimeout(() => {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve({ id: downloadId, state: 'in_progress' });
      }, 300000);
    });
  });
}

// ── History ─────────────────────────────────────────────────

async function handleHistorySearch(params) {
  const results = await chrome.history.search({
    text: params.query || '',
    maxResults: params.maxResults || 20,
    ...(params.startTime && { startTime: params.startTime }),
    ...(params.endTime && { endTime: params.endTime }),
  });
  return results.map(r => ({
    url: r.url, title: r.title,
    lastVisitTime: r.lastVisitTime, visitCount: r.visitCount,
  }));
}

// ── Alarms ──────────────────────────────────────────────────

async function handleAlarmCreate(params) {
  const info = {};
  if (params.delayInMinutes !== undefined) info.delayInMinutes = params.delayInMinutes;
  if (params.periodInMinutes !== undefined) info.periodInMinutes = params.periodInMinutes;
  if (params.when !== undefined) info.when = params.when;
  await chrome.alarms.create(params.name, info);
  return { ok: true, name: params.name };
}

async function handleAlarmList() {
  const alarms = await chrome.alarms.getAll();
  return alarms
    .filter(a => a.name !== 'aly-reconnect')
    .map(a => ({
      name: a.name, scheduledTime: a.scheduledTime,
      periodInMinutes: a.periodInMinutes,
    }));
}

async function handleAlarmClear(params) {
  if (params.name) {
    await chrome.alarms.clear(params.name);
  } else {
    // Preserve internal reconnect alarm when clearing all user alarms
    const alarms = await chrome.alarms.getAll();
    for (const alarm of alarms) {
      if (alarm.name !== 'aly-reconnect') {
        await chrome.alarms.clear(alarm.name);
      }
    }
  }
  return { ok: true };
}

function handleAlarmEvents() {
  const events = [...alarmEvents];
  alarmEvents = [];
  return events;
}

// ── Storage ─────────────────────────────────────────────────

async function handleStorageGet(params) {
  return await chrome.storage.local.get(params.keys || null);
}

async function handleStorageSet(params) {
  await chrome.storage.local.set(params.data);
  return { ok: true };
}

// ── Notifications ───────────────────────────────────────────

async function handleNotify(params) {
  return new Promise((resolve) => {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: params.iconUrl || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      title: params.title || 'AlyBrowser',
      message: params.message || '',
    }, (id) => resolve({ id }));
  });
}

// ── Bookmarks ───────────────────────────────────────────────

async function handleBookmarkList(params) {
  const results = params.query
    ? await chrome.bookmarks.search(params.query)
    : await chrome.bookmarks.getTree();
  return results;
}

async function handleBookmarkCreate(params) {
  const bookmark = await chrome.bookmarks.create({
    title: params.title, url: params.url,
    ...(params.parentId && { parentId: params.parentId }),
  });
  return bookmark;
}

async function handleBookmarkDelete(params) {
  await chrome.bookmarks.remove(params.id);
  return { ok: true };
}

// ── Top Sites ───────────────────────────────────────────────

async function handleTopSites() {
  return await chrome.topSites.get();
}

// ── Clipboard ───────────────────────────────────────────────

async function handleClipboardRead(tabId) {
  const target = tabId || activeTabId;
  const results = await chrome.scripting.executeScript({
    target: { tabId: target },
    world: 'MAIN',
    func: async () => {
      try { return await navigator.clipboard.readText(); }
      catch (e) { return { error: e.message }; }
    },
  });
  const r = results?.[0]?.result;
  if (r?.error) throw new Error(r.error);
  return r;
}

async function handleClipboardWrite(params, tabId) {
  const target = tabId || activeTabId;
  await chrome.scripting.executeScript({
    target: { tabId: target },
    world: 'MAIN',
    func: async (text) => { await navigator.clipboard.writeText(text); },
    args: [params.text],
  });
  return { ok: true };
}

// ── Helpers ─────────────────────────────────────────────────

function waitForContentScript(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (contentReady.get(tabId)) { resolve(); return; }

    let settled = false;
    const settle = (fn) => { if (!settled) { settled = true; fn(); } };

    const timeout = setTimeout(() => settle(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Content script ready timeout'));
    }), timeoutMs);

    function listener(msg, sender) {
      if (msg.type === 'contentReady' && sender.tab?.id === tabId) {
        settle(() => {
          chrome.runtime.onMessage.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        });
      }
    }
    chrome.runtime.onMessage.addListener(listener);

    // Re-check after registration to cover the gap between initial check and addListener
    if (contentReady.get(tabId)) {
      settle(() => {
        chrome.runtime.onMessage.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      });
    }
  });
}

function sendToContent(cmd, tabId) {
  const targetTab = tabId || activeTabId;
  return new Promise((resolve, reject) => {
    if (!targetTab) { reject(new Error('No active tab')); return; }

    const timeout = setTimeout(() => {
      reject(new Error('Content script response timeout'));
    }, 30000);

    chrome.tabs.sendMessage(targetTab, cmd, (response) => {
      clearTimeout(timeout);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response?.result);
      }
    });
  });
}

// ── Start ───────────────────────────────────────────────────
connect();
