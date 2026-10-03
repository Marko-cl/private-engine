const CONNECTOR = 'http://127.0.0.1:47631';
const EXTENSION_ID = 'private-context-engine-connector';
let active = null;
let enabled = true;

async function settings() {
  const value = await chrome.storage.local.get(['token', 'enabled']);
  enabled = value.enabled !== false;
  return value;
}
function domainOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
async function submit(tab, duration) {
  const value = await settings();
  if (!enabled || !value.token || !tab?.url || !/^https?:$/i.test(new URL(tab.url).protocol)) return false;
  const domain = domainOf(tab.url); if (!domain) return false;
  const payload = { domain, url: tab.url.slice(0, 2000), title: typeof tab.title === 'string' ? tab.title.slice(0, 240) : undefined, timestamp: new Date().toISOString(), duration: Math.max(0, Math.min(86400, Math.round(duration || 0))) };
  try { const response = await fetch(`${CONNECTOR}/submit`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${value.token}` }, body: JSON.stringify(payload) }); if (response.ok) { await chrome.storage.local.set({ lastAccepted: Date.now(), lastDomain: domain }); return true; } if (response.status === 401) await chrome.storage.local.remove('token'); return false; } catch { return false; }
}
async function activeTab() { const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return tabs[0]; }
async function finalize() { if (!active) return; const tab = active.tab; const duration = (Date.now() - active.startedAt) / 1000; await submit(tab, duration); active = null; }
async function observe() { const tab = await activeTab(); if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) { await finalize(); return; } if (active && (active.tab.id !== tab.id || active.tab.url !== tab.url)) await finalize(); if (!active) active = { tab: { id: tab.id, url: tab.url, title: tab.title }, startedAt: Date.now() }; }
chrome.tabs.onActivated.addListener(() => void observe());
chrome.tabs.onUpdated.addListener((_id, info, tab) => { if (info.status === 'complete' && tab.active) void observe(); });
chrome.windows.onFocusChanged.addListener(windowId => { if (windowId === chrome.windows.WINDOW_ID_NONE) void finalize(); else void observe(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'active-tab-sample') void observe(); });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('active-tab-sample', { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('active-tab-sample', { periodInMinutes: 1 }); void observe(); });
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => { if (message?.type === 'set-enabled' && typeof message.enabled === 'boolean') { enabled = message.enabled; chrome.storage.local.set({ enabled }); if (!enabled) void finalize(); sendResponse({ ok: true }); return true; } if (message?.type === 'pair') { fetch(`${CONNECTOR}/pair-request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId: EXTENSION_ID }) }).then(r => r.json()).then(async result => { if (!result.requestId) return sendResponse({ ok: false }); for (let i = 0; i < 30; i += 1) { await new Promise(resolve => setTimeout(resolve, 1000)); const status = await fetch(`${CONNECTOR}/pair-status?requestId=${encodeURIComponent(result.requestId)}`).then(r => r.json()).catch(() => ({})); if (status.status === 'paired' && status.token) { await chrome.storage.local.set({ token: status.token }); return sendResponse({ ok: true }); } } sendResponse({ ok: false, pending: true }); }).catch(() => sendResponse({ ok: false })); return true; } if (message?.type === 'status') { settings().then(value => sendResponse({ paired: Boolean(value.token), enabled: value.enabled !== false, lastAccepted: value.lastAccepted || null, lastDomain: value.lastDomain || null })); return true; } return false; });
void observe();
