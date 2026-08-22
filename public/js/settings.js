const connectCard = document.getElementById('connectCard');
const scheduleCard = document.getElementById('scheduleCard');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let status = null;
let pendingAuthorizeUrl = null; // set once /connect has returned, cleared once verified

// ---- Connect card ------------------------------------------------------

function renderConnectCard() {
  if (!status.consumerKeysConfigured) {
    connectCard.innerHTML = `
      <h3 style="margin-bottom:6px;">1. Add your CHPP application keys</h3>
      <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
        Register a CHPP application at
        <a href="https://www.hattrick.org/en/Chpp/" target="_blank" rel="noopener">hattrick.org/en/Chpp</a>
        to get a consumer key and secret, then paste them in below. They're stored locally in this app's
        database, never sent anywhere except to Hattrick's own CHPP servers.
      </p>
      <div id="keyError"></div>
      <div class="field"><label for="consumerKey">Consumer key</label><input type="text" id="consumerKey" autocomplete="off"></div>
      <div class="field"><label for="consumerSecret">Consumer secret</label><input type="password" id="consumerSecret" autocomplete="off"></div>
      <button class="pill-btn primary" id="saveKeysBtn">Save keys</button>
    `;
    document.getElementById('saveKeysBtn').addEventListener('click', saveKeys);
    return;
  }

  if (status.connected) {
    connectCard.innerHTML = `
      <h3 style="margin-bottom:6px;">Connected to Hattrick</h3>
      <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
        Team: <b>${status.teamName || '—'}</b> · Last synced: ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'never'}
      </p>
      <div id="connectError"></div>
      <button class="pill-btn" id="disconnectBtn">Disconnect</button>
    `;
    document.getElementById('disconnectBtn').addEventListener('click', disconnect);
    return;
  }

  // Keys configured, not yet connected.
  connectCard.innerHTML = `
    <h3 style="margin-bottom:6px;">2. Connect your Hattrick account</h3>
    <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
      This opens Hattrick's own authorization page in a new tab. Approve access there, then Hattrick will show
      you a verification code — paste it back in below to finish connecting.
    </p>
    <div id="connectError"></div>
    ${pendingAuthorizeUrl ? `
      <p style="font-size:13px;margin:0 0 10px;"><a class="pill-btn primary" href="${pendingAuthorizeUrl}" target="_blank" rel="noopener">Open Hattrick authorization ↗</a></p>
      <div class="field"><label for="verifier">Verification code</label><input type="text" id="verifier" autocomplete="off"></div>
      <button class="pill-btn primary" id="verifyBtn">Finish connecting</button>
      <button class="pill-btn" id="restartConnectBtn" style="margin-left:8px;">Start over</button>
    ` : `
      <button class="pill-btn primary" id="connectBtn">Connect to Hattrick</button>
    `}
  `;
  if (pendingAuthorizeUrl) {
    document.getElementById('verifyBtn').addEventListener('click', verify);
    document.getElementById('restartConnectBtn').addEventListener('click', () => { pendingAuthorizeUrl = null; renderConnectCard(); });
  } else {
    document.getElementById('connectBtn').addEventListener('click', startConnect);
  }
}

function showError(elId, message) {
  const el = document.getElementById(elId);
  if (el) el.innerHTML = `<div class="banner error">${message}</div>`;
}

async function saveKeys() {
  const consumerKey = document.getElementById('consumerKey').value.trim();
  const consumerSecret = document.getElementById('consumerSecret').value.trim();
  try {
    await apiPost('/api/chpp/consumer-keys', { consumerKey, consumerSecret });
    status = await apiGet('/api/chpp/status');
    renderConnectCard();
  } catch (err) {
    showError('keyError', err.message);
  }
}

async function startConnect() {
  try {
    const { authorizeUrl } = await apiPost('/api/chpp/connect');
    pendingAuthorizeUrl = authorizeUrl;
    renderConnectCard();
    window.open(authorizeUrl, '_blank', 'noopener');
  } catch (err) {
    showError('connectError', err.message);
  }
}

async function verify() {
  const verifier = document.getElementById('verifier').value.trim();
  const btn = document.getElementById('verifyBtn');
  btn.disabled = true;
  btn.textContent = 'Connecting…';
  try {
    await apiPost('/api/chpp/verify', { verifier });
    pendingAuthorizeUrl = null;
    status = await apiGet('/api/chpp/status');
    renderConnectCard();
  } catch (err) {
    showError('connectError', err.message);
    btn.disabled = false;
    btn.textContent = 'Finish connecting';
  }
}

async function disconnect() {
  try {
    await apiPost('/api/chpp/disconnect');
    status = await apiGet('/api/chpp/status');
    renderConnectCard();
  } catch (err) {
    showError('connectError', err.message);
  }
}

// ---- Schedule card -------------------------------------------------

let schedule = [];

function scheduleRowHtml(slot, i) {
  return `<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;" data-row="${i}">
    <select class="daySelect" style="border:1px solid var(--sb-border);border-radius:var(--sb-radius-sm);padding:7px;">
      ${DAY_NAMES.map((d, di) => `<option value="${di}" ${di === slot.day ? 'selected' : ''}>${d}</option>`).join('')}
    </select>
    <input type="time" class="timeInput" value="${slot.time}" style="border:1px solid var(--sb-border);border-radius:var(--sb-radius-sm);padding:6px;">
    <input type="text" class="labelInput" value="${slot.label || ''}" placeholder="e.g. Training update" style="border:1px solid var(--sb-border);border-radius:var(--sb-radius-sm);padding:6px 8px;flex:1;">
    <button class="pill-btn removeRowBtn" type="button">Remove</button>
  </div>`;
}

function renderScheduleCard() {
  scheduleCard.innerHTML = `
    <h3 style="margin-bottom:6px;">Sync schedule</h3>
    <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
      Hattrick's weekly processing time depends on your league's country bloc — set the day/time your training
      and match results actually post (e.g. Belgium is training ~Friday 07:00, match results ~Sunday 16:00).
      A manual "Sync now" is always available on the Dashboard too.
    </p>
    <div id="scheduleRows">${schedule.map(scheduleRowHtml).join('') || '<p class="muted" style="font-size:13px;">No scheduled syncs yet — add one below.</p>'}</div>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="pill-btn" id="addRowBtn" type="button">+ Add time</button>
      <button class="pill-btn primary" id="saveScheduleBtn" type="button">Save schedule</button>
    </div>
    <div id="scheduleMsg"></div>
  `;
  document.getElementById('addRowBtn').addEventListener('click', () => {
    schedule.push({ day: 5, time: '07:00', label: '' });
    renderScheduleCard();
  });
  document.getElementById('saveScheduleBtn').addEventListener('click', saveSchedule);
  scheduleCard.querySelectorAll('.removeRowBtn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const i = Number(e.target.closest('[data-row]').dataset.row);
      schedule.splice(i, 1);
      renderScheduleCard();
    });
  });
}

function collectScheduleFromForm() {
  return [...scheduleCard.querySelectorAll('#scheduleRows > div')].map((row) => ({
    day: Number(row.querySelector('.daySelect').value),
    time: row.querySelector('.timeInput').value,
    label: row.querySelector('.labelInput').value,
  }));
}

async function saveSchedule() {
  const msgEl = document.getElementById('scheduleMsg');
  try {
    const clean = collectScheduleFromForm();
    const result = await apiPost('/api/settings/schedule', { schedule: clean });
    schedule = result.schedule;
    msgEl.innerHTML = `<div class="banner good">Schedule saved.</div>`;
  } catch (err) {
    msgEl.innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

// ---- Boot ------------------------------------------------------------

async function load() {
  try {
    [status, { schedule }] = await Promise.all([
      apiGet('/api/chpp/status'),
      apiGet('/api/settings/schedule'),
    ]);
    renderConnectCard();
    renderScheduleCard();
  } catch (err) {
    connectCard.innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

load();
