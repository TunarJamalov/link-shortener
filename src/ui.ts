/**
 * Server-rendered pages. Client scripts are plain strings without template interpolation so
 * no server value is ever placed inside executable code.
 */
export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

const css = `
:root{--bg:#f4f6f8;--panel:#fff;--border:#dbe1e8;--text:#15202b;--muted:#5f6b7a;--ok:#15803d;--ok-bg:#dcfce7;--bad:#b91c1c;--bad-bg:#fee2e2;--warn:#b45309;--warn-bg:#fef3c7;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--bg:#0f141a;--panel:#171e26;--border:#2a3441;--text:#e6ebf0;--muted:#94a3b8;--ok:#4ade80;--ok-bg:#14532d;--bad:#fca5a5;--bad-bg:#7f1d1d;--warn:#fcd34d;--warn-bg:#78350f;--accent:#3b82f6}}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1100px;margin:auto;padding:20px 16px;background:var(--bg);color:var(--text);line-height:1.45}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:0 0 12px}h3{font-size:.95rem;margin:14px 0 6px;color:var(--muted)}
a{color:var(--accent)}
nav{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:8px 0 16px;color:var(--muted)}
.panel,.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin:12px 0}
.row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.muted{color:var(--muted);font-size:13px}
.badge{display:inline-block;background:var(--ok-bg);color:var(--ok);border-radius:20px;padding:4px 10px;font-size:12px;font-weight:600;white-space:nowrap}
.badge.off{background:var(--bad-bg);color:var(--bad)}.badge.warn{background:var(--warn-bg);color:var(--warn)}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
button{padding:7px 11px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text);cursor:pointer;font:inherit;font-size:13px}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.danger{color:var(--bad)}button:disabled{opacity:.5;cursor:default}
input,select{width:100%;padding:8px;margin-top:4px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit;font-size:14px}
label{display:block;font-size:13px}
form.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.wide{grid-column:span 2}.full{grid-column:1/-1}
@media(max-width:700px){form.grid{grid-template-columns:1fr}.wide,.full{grid-column:auto}}
.summary{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
.summary span{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:13px}
.short{font-family:ui-monospace,monospace;font-size:15px;word-break:break-all}
.target{color:var(--muted);font-size:13px;word-break:break-all}
.stats{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0}
.stats div{font-size:12px;color:var(--muted)}.stats strong{display:block;font-size:16px;color:var(--text)}
svg.bars{width:100%;height:80px;display:block}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:3px 0;border-bottom:1px solid var(--border)}td:last-child{text-align:right}
.msg{min-height:20px;margin:8px 0 0}.msg.error{color:var(--bad)}
.hidden{display:none !important}
pre{background:var(--bg);padding:10px;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:12px}
.gone{max-width:480px;margin:80px auto;text-align:center}
`;

function page(title: string, body: string, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
}

const helpers = `
var $ = function (id) { return document.getElementById(id); };
var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var csrf = function () { var m = document.cookie.match(/(?:^|; )csrf=([^;]+)/); return m ? m[1] : ''; };
var api = function (url, method, body) {
  return fetch(url, { method: method || 'GET', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf() }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(function (r) { if (r.status === 401) { location = '/login'; throw new Error('Authentication required'); } return r; });
};
var showMessage = function (id, text, isError) { var el = $(id); el.textContent = text; el.className = 'msg' + (isError ? ' error' : ''); };
var when = function (ts) { return ts ? new Date(ts).toLocaleString() : ''; };
var toLocalInput = function (ts) { var d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
`;

const nav = (active: string) =>
  `<nav>${[
    ['/dashboard', 'Links'],
    ['/dashboard/security', 'Security'],
  ]
    .map(([href, label]) =>
      href === active ? `<strong>${label}</strong>` : `<a href="${href}">${label}</a>`
    )
    .join(' · ')} · <button id="logout">Log out</button></nav>`;
const logoutScript = `$('logout').onclick = function () { api('/api/auth/logout', 'POST').then(function () { location = '/login'; }); };`;

export function gonePage(message: string) {
  return page(
    'Link unavailable',
    `<div class="gone card"><h1>Link unavailable</h1><p>${escapeHtml(message)}</p></div>`
  );
}

export function loginPage() {
  return page(
    'Sign in',
    `<section class="panel" style="max-width:420px;margin:40px auto"><h1>Sign in</h1><form id="f"><label>Username<input id="u" autocomplete="username" required></label><label>Password<input id="p" type="password" autocomplete="current-password" required></label><label>Authenticator or recovery code<input id="t" autocomplete="one-time-code" placeholder="Leave empty if TOTP is not enabled"></label><p><button class="primary">Sign in</button></p></form><p id="m" class="msg"></p></section>`,
    `document.getElementById('f').onsubmit = async function (e) {
  e.preventDefault();
  var auth = 'Basic ' + btoa(document.getElementById('u').value + ':' + document.getElementById('p').value);
  var r = await fetch('/api/auth/login', { method: 'POST', headers: { Authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('t').value }) });
  if (r.ok) { location = '/dashboard'; return; }
  var data = await r.json().catch(function () { return {}; });
  var m = document.getElementById('m'); m.textContent = data.error || 'Sign-in failed'; m.className = 'msg error';
};`
  );
}

const dashboardScript = `
${helpers}
var links = [], editing = null, open = {};
function fillForm(l) {
  editing = l ? l.id : null;
  $('target').value = l ? l.target : '';
  $('slug').value = l ? l.slug : '';
  $('title').value = l ? l.title : '';
  $('expiresAt').value = l && l.expiresAt ? toLocalInput(l.expiresAt) : '';
  $('maxClicks').value = l && l.maxClicks ? l.maxClicks : '';
  $('enabled').value = l ? String(l.enabled) : 'true';
  $('form-title').textContent = l ? 'Edit link' : 'Shorten a link';
  $('save').textContent = l ? 'Update link' : 'Create short link';
  $('cancel').classList.toggle('hidden', !l);
  if (l) window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('cancel').onclick = function () { fillForm(null); showMessage('form-message', ''); };
$('link-form').onsubmit = async function (e) {
  e.preventDefault();
  var body = { target: $('target').value, slug: $('slug').value, title: $('title').value, expiresAt: $('expiresAt').value ? new Date($('expiresAt').value).getTime() : null, maxClicks: $('maxClicks').value ? Number($('maxClicks').value) : null, enabled: $('enabled').value === 'true' };
  var r = await api('/api/admin/links' + (editing ? '/' + editing : ''), editing ? 'PUT' : 'POST', body);
  if (r.ok) { var l = await r.json(); showMessage('form-message', (editing ? 'Updated ' : 'Created ') + l.shortUrl); fillForm(null); load(); }
  else showMessage('form-message', await r.text(), true);
};
function state(l) {
  var now = Date.now();
  if (!l.enabled) return '<span class="badge off">DISABLED</span>';
  if (l.expiresAt && l.expiresAt <= now) return '<span class="badge off">EXPIRED</span>';
  if (l.maxClicks && l.clicks >= l.maxClicks) return '<span class="badge off">LIMIT REACHED</span>';
  if (l.expiresAt || l.maxClicks) return '<span class="badge warn">LIMITED</span>';
  return '<span class="badge">ACTIVE</span>';
}
function bars(perDay) {
  var max = Math.max.apply(null, perDay.map(function (d) { return d.clicks; }).concat([1]));
  var w = 600, h = 80, step = w / perDay.length;
  return '<svg class="bars" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + perDay.map(function (d, i) {
    var height = Math.max(d.clicks ? 3 : 1, Math.round((d.clicks / max) * (h - 4)));
    return '<rect x="' + (i * step + 1).toFixed(1) + '" y="' + (h - height) + '" width="' + (step - 2).toFixed(1) + '" height="' + height + '" rx="1" fill="' + (d.clicks ? 'var(--accent)' : 'var(--border)') + '"><title>' + d.day + ': ' + d.clicks + '</title></rect>';
  }).join('') + '</svg>';
}
function table(title, rows, key) {
  return '<div><h3>' + title + '</h3><table>' + (rows.length ? rows.map(function (r) { return '<tr><td>' + esc(r[key] || 'direct') + '</td><td>' + r.clicks + '</td></tr>'; }).join('') : '<tr><td class="muted">No data</td></tr>') + '</table></div>';
}
function statsHtml(s) {
  return '<div class="stats"><div>Total<strong>' + s.total + '</strong></div><div>Unique (30d)<strong>' + s.unique + '</strong></div><div>24h<strong>' + s.last24h + '</strong></div><div>7d<strong>' + s.last7d + '</strong></div></div><p class="muted">Clicks per day, last 30 days</p>' + bars(s.perDay) + '<div class="cols">' + table('Referrers', s.referrers, 'referrer') + table('Browsers', s.browsers, 'browser') + table('Operating systems', s.os, 'os') + table('Devices', s.devices, 'device') + '</div>';
}
function card(l) {
  var details = open[l.id] ? '<div class="details" data-stats>' + (open[l.id].stats ? statsHtml(open[l.id].stats) : '<p class="muted">Loading...</p>') + '<p><img src="/api/admin/links/' + l.id + '/qr.png" alt="QR code" width="160" height="160" style="background:#fff;padding:6px;border-radius:6px"></p></div>' : '';
  return '<article class="card" data-id="' + l.id + '"><div class="row"><div><div class="short"><a href="' + esc(l.shortUrl) + '" target="_blank" rel="noopener">' + esc(l.shortUrl) + '</a></div>' + (l.title ? '<div><strong>' + esc(l.title) + '</strong></div>' : '') + '<div class="target">→ ' + esc(l.target) + '</div><div class="muted">' + l.clicks + ' clicks · created ' + esc(when(l.createdAt)) + (l.expiresAt ? ' · expires ' + esc(when(l.expiresAt)) : '') + (l.maxClicks ? ' · limit ' + l.maxClicks : '') + '</div></div>' + state(l) + '</div>' + details +
    '<div class="actions"><button data-action="copy">Copy</button><button data-action="stats">' + (open[l.id] ? 'Hide stats' : 'Stats & QR') + '</button><button data-action="edit">Edit</button><button data-action="toggle">' + (l.enabled ? 'Disable' : 'Enable') + '</button><button data-action="delete" class="danger">Delete</button></div><p class="msg" data-msg></p></article>';
}
function render() {
  $('links').innerHTML = links.map(card).join('') || '<div class="card muted">No links yet. Create the first one above.</div>';
}
async function load() {
  var o = await (await api('/api/admin/overview')).json();
  $('summary').innerHTML = '<span>Links ' + o.links + '</span><span>Clicks ' + o.clicks + '</span><span>24h ' + o.last24h + '</span><span>7d ' + o.last7d + '</span>';
  links = await (await api('/api/admin/links?q=' + encodeURIComponent($('search').value))).json();
  render();
}
$('search').oninput = function () { clearTimeout(window.searchTimer); window.searchTimer = setTimeout(load, 250); };
$('links').onclick = async function (e) {
  var button = e.target.closest('[data-action]'); if (!button) return;
  var article = button.closest('[data-id]'), id = Number(article.getAttribute('data-id')), msg = article.querySelector('[data-msg]');
  var l = links.find(function (x) { return x.id === id; }), action = button.getAttribute('data-action');
  button.disabled = true;
  try {
    if (action === 'copy') { await navigator.clipboard.writeText(l.shortUrl); button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy'; }, 1500); }
    else if (action === 'edit') fillForm(l);
    else if (action === 'stats') {
      if (open[id]) { delete open[id]; render(); }
      else { open[id] = {}; render(); open[id].stats = (await (await api('/api/admin/links/' + id)).json()).stats; render(); }
    }
    else if (action === 'toggle') { await api('/api/admin/links/' + id, 'PUT', { target: l.target, slug: l.slug, title: l.title, expiresAt: l.expiresAt, maxClicks: l.maxClicks, enabled: !l.enabled }); load(); }
    else if (action === 'delete') { if (!confirm('Delete ' + l.shortUrl + ' and its statistics?')) return; await api('/api/admin/links/' + id, 'DELETE'); if (editing === id) fillForm(null); load(); }
  } catch (err) { msg.textContent = err.message; msg.className = 'msg error'; }
  finally { button.disabled = false; }
};
${logoutScript}
load();
`;

export function dashboardPage() {
  return page(
    'Links',
    `<h1>Link shortener</h1>${nav('/dashboard')}<div id="summary" class="summary"></div>
<section class="panel"><h2 id="form-title">Shorten a link</h2><form id="link-form" class="grid">
<label class="wide">Destination URL<input id="target" type="url" placeholder="https://example.com/very/long/page" required></label>
<label>Custom slug (optional)<input id="slug" placeholder="launch" pattern="[A-Za-z0-9_-]{1,64}"></label>
<label class="wide">Title (optional)<input id="title" placeholder="Product launch post"></label>
<label>Status<select id="enabled"><option value="true">Active</option><option value="false">Disabled</option></select></label>
<label>Expires (optional)<input id="expiresAt" type="datetime-local"></label>
<label>Click limit (optional)<input id="maxClicks" type="number" min="1"></label>
<div class="full actions"><button class="primary" id="save">Create short link</button><button type="button" id="cancel" class="hidden">Cancel edit</button></div>
</form><p id="form-message" class="msg"></p></section>
<label>Search<input id="search" placeholder="Filter by slug, title or destination"></label>
<div id="links"></div>`,
    dashboardScript
  );
}

const securityScript = `
${helpers}
async function load() {
  var x = await (await api('/api/admin/security')).json();
  $('auth-state').textContent = x.authConfigured ? 'Admin credentials are configured. ' + (x.totpConfigured ? 'TOTP is enabled.' : 'TOTP is not enabled: sign-in only needs the password.') : 'Admin credentials are not configured: the dashboard is open. Set ADMIN_USERNAME, ADMIN_PASSWORD and AUTH_ENCRYPTION_KEY to protect it.';
  $('setup').disabled = !x.authConfigured; $('disable').disabled = !x.totpConfigured;
  $('setup').textContent = x.totpConfigured ? 'Regenerate authenticator' : 'Enable authenticator';
}
$('setup').onclick = async function () {
  if (!confirm('This replaces any existing authenticator and recovery codes. Continue?')) return;
  var x = await (await api('/api/admin/security/regenerate', 'POST')).json();
  $('qr').src = x.qrDataUrl; $('qr').classList.remove('hidden');
  $('secret').textContent = 'Secret: ' + x.secret;
  $('codes').textContent = 'Recovery codes (each works once):\\n' + x.recoveryCodes.join('\\n');
  load();
};
$('disable').onclick = async function () {
  if (!confirm('Disable TOTP?')) return;
  await api('/api/admin/security/disable', 'POST');
  $('qr').classList.add('hidden'); $('codes').textContent = ''; $('secret').textContent = '';
  load();
};
${logoutScript}
load();
`;

export function securityPage() {
  return page(
    'Security',
    `<h1>Security</h1>${nav('/dashboard/security')}<section class="panel"><h2>Two-factor authentication (TOTP)</h2><p id="auth-state" class="muted">Loading...</p><div class="actions"><button id="setup" class="primary">Enable authenticator</button><button id="disable" class="danger">Disable TOTP</button></div><p><img id="qr" class="hidden" alt="TOTP QR code" style="max-width:260px;background:#fff;padding:8px;border-radius:8px"></p><p id="secret" class="muted"></p><pre id="codes"></pre></section>`,
    securityScript
  );
}
