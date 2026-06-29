const tokenInput = document.querySelector('#admin-token');
const output = document.querySelector('#control-output');
let lastSummary = null;

tokenInput.value = localStorage.getItem('ollama-router-admin-token') || '';

document.querySelector('#save-token').addEventListener('click', () => {
  localStorage.setItem('ollama-router-admin-token', tokenInput.value.trim());
  refresh();
});
document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('#prewarm').addEventListener('click', () => postControl('/admin/api/prewarm', {}));
document.querySelector('#reload-config').addEventListener('click', () => postControl('/admin/api/reload-config', {}));
document.querySelector('#test-chat').addEventListener('click', () => postControl('/admin/api/test-chat', { prompt: 'Reply with a short router health check.' }));
document.querySelector('#toggle-maintenance').addEventListener('click', () => {
  const enabled = !(lastSummary && lastSummary.router && lastSummary.router.maintenanceMode);
  postControl('/admin/api/maintenance', { enabled });
});

function headers() {
  const token = tokenInput.value.trim();
  return token ? { 'x-admin-token': token, 'content-type': 'application/json' } : { 'content-type': 'application/json' };
}

async function getJson(url) {
  const response = await fetch(url, { headers: headers(), cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function postControl(url, body) {
  output.textContent = 'Running...';
  try {
    const response = await fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const text = await response.text();
    output.textContent = text;
    refresh();
  } catch (error) {
    output.textContent = error.message;
  }
}

function fmt(value) {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function card(label, value, className = '') {
  return `<div class="card"><div class="label">${label}</div><div class="value ${className}">${fmt(value)}</div></div>`;
}

function renderCards(summary) {
  const loaded = summary.activeLoadedState || {};
  const upstreamClass = summary.upstream.ok ? 'good' : 'danger';
  const loadedClass = loaded.loaded ? 'good' : 'warn';
  const metrics = summary.metrics || {};
  document.querySelector('#cards').innerHTML = [
    card('Upstream Ollama', summary.upstream.ok ? 'healthy' : 'unavailable', upstreamClass),
    card('Active model', summary.activeModel.model),
    card('Active loaded', loaded.loaded ? 'loaded' : 'not loaded', loadedClass),
    card('Until / expires', loaded.until || 'unknown'),
    card('Requests', metrics.totalRequests || 0),
    card('Keep-alive rewrites', metrics.keepAliveNormalizations || 0),
    card('Rejected', metrics.rejectedRequests || 0, metrics.rejectedRequests ? 'warn' : 'good'),
    card('Maintenance', summary.router.maintenanceMode ? 'enabled' : 'disabled', summary.router.maintenanceMode ? 'warn' : 'good')
  ].join('');
}

function renderRequests(rows) {
  const table = document.querySelector('#requests-table');
  const header = '<tr><th>Time</th><th>Client</th><th>Endpoint</th><th>Model</th><th>Keep alive</th><th>Status</th><th>Latency</th></tr>';
  const body = rows.map((row) => {
    const statusClass = row.rejected || row.upstreamError ? 'warn' : 'good';
    return `<tr>
      <td>${fmt(row.ts)}</td>
      <td>${fmt(row.clientIdentity)}<br><span class="event-time">${fmt(row.sourceIp)}</span></td>
      <td>${fmt(row.method)} ${fmt(row.endpoint)}</td>
      <td>${fmt(row.requestedModel)}</td>
      <td>in: ${fmt(row.incomingKeepAlive)}<br>out: ${fmt(row.forwardedKeepAlive)}</td>
      <td class="${statusClass}">${fmt(row.responseStatus || row.status)}</td>
      <td>${fmt(row.latencyMs)} ms</td>
    </tr>`;
  }).join('');
  table.innerHTML = header + body;
}

function renderEvents(events) {
  document.querySelector('#events').innerHTML = events.map((event) => `<div class="event"><div>${fmt(event.type)}</div><div class="event-time">${fmt(event.ts)}</div><pre>${JSON.stringify(event, null, 2)}</pre></div>`).join('');
}

async function refresh() {
  try {
    const [summary, requests, events] = await Promise.all([
      getJson('/admin/api/summary'),
      getJson('/admin/api/requests?limit=100'),
      getJson('/admin/api/events?limit=50')
    ]);
    lastSummary = summary;
    renderCards(summary);
    renderRequests(requests.requests || []);
    renderEvents(events.events || []);
    document.querySelector('#ps').textContent = JSON.stringify(summary.ollamaPs, null, 2);
    document.querySelector('#metrics').textContent = JSON.stringify(summary.metrics, null, 2);
  } catch (error) {
    document.querySelector('#cards').innerHTML = card('Dashboard error', error.message, 'danger');
  }
}

refresh();
setInterval(refresh, 10000);
