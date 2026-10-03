const $ = id => document.getElementById(id);
function time(value) { return value ? new Date(value).toLocaleString() : '—'; }
function refresh() { chrome.runtime.sendMessage({ type: 'status' }, result => { if (!result) return; $('status').textContent = result.paired ? 'Paired' : 'Not paired'; $('enabled').checked = result.enabled; $('domain').textContent = result.lastDomain || '—'; $('accepted').textContent = time(result.lastAccepted); }); }
$('pair').onclick = () => { $('status').textContent = 'Waiting for desktop approval…'; chrome.runtime.sendMessage({ type: 'pair' }, result => { $('status').textContent = result?.ok ? 'Paired' : 'Pairing pending or unavailable'; refresh(); }); };
$('enabled').onchange = event => chrome.runtime.sendMessage({ type: 'set-enabled', enabled: event.target.checked });
refresh();
