const connectCard = document.getElementById('connectCard');
const csvCard = document.getElementById('csvCard');
const scheduleCard = document.getElementById('scheduleCard');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Hattrick's real training types (incl. combined ones), fetched from the
// server so the list can't drift from the sync/model's own mapping.
let trainingTypes = [];

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
    renderCsvCard(); // a successful connect just overwrote data_source with 'chpp'
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

// ---- CSV import/export card -----------------------------------------

function renderCsvCard() {
  const isCsvSourced = status.dataSource === 'csv';
  csvCard.innerHTML = `
    <h3 style="margin-bottom:6px;">Squad data via CSV</h3>
    <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 10px;">
      Waiting on your CHPP keys, or just prefer a spreadsheet? Two ways in: upload a CSV export of your Hattrick
      players directly (e.g. from Hattrick Organizer or a similar CHPP-based tool — Coach's Office recognizes
      that column format automatically), or <a href="/api/csv/template">download our simpler template ↓</a> and
      hand-type a squad from scratch. Either way it fills in the dashboard, player detail, and digest the same
      way a real sync would. <b>Each import fully replaces the squad</b> — it isn't a partial patch, so a
      re-import missing some columns blanks those out rather than merging. Match Prep still needs a real CHPP
      connection regardless, since it needs live fixture and opponent data no CSV can provide.
    </p>
    ${isCsvSourced ? `
      <div class="banner info" style="margin-bottom:10px;">
        Currently showing CSV-imported data for "<b>${status.teamName || 'your squad'}</b>", not a live Hattrick
        connection. Connecting to Hattrick above will replace this with your real, synced squad.
      </div>
    ` : ''}
    <div id="csvError"></div>
    <div class="field"><label for="csvTeamName">Team name</label>
      <input type="text" id="csvTeamName" value="${isCsvSourced ? (status.teamName || '') : ''}" placeholder="e.g. My Squad">
    </div>
    <div class="field"><label for="csvFile">CSV file</label><input type="file" id="csvFile" accept=".csv,text/csv"></div>
    <details style="margin-bottom:14px;">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;">Team finances (optional)</summary>
      <p class="muted" style="font-size:12px;margin:6px 0;">
        Per-player exports don't include club finances — if you want the Dashboard's weekly net income chart to
        have something to show, copy these from Hattrick's own Club → Finances page.
      </p>
      <div class="field"><label for="csvCash">Cash</label><input type="text" id="csvCash" inputmode="numeric" placeholder="e.g. 500000"></div>
      <div class="field"><label for="csvIncome">Weekly income</label><input type="text" id="csvIncome" inputmode="numeric" placeholder="e.g. 50000"></div>
      <div class="field"><label for="csvExpenses">Weekly expenses</label><input type="text" id="csvExpenses" inputmode="numeric" placeholder="e.g. 42000"></div>
    </details>
    <details style="margin-bottom:14px;">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;">Training focus (optional)</summary>
      <p class="muted" style="font-size:12px;margin:6px 0;">
        Copy this from Hattrick's own "Set current training" page. It only labels which skill is highlighted as
        "Training" on a player's page — it doesn't change any ETA math, and it's a snapshot of what you reported
        at import time, not something Coach's Office keeps in sync on its own. Leave blank to clear it.
      </p>
      <div class="field"><label for="csvTrainingType">Currently training</label>
        <select id="csvTrainingType">
          <option value="">— not set —</option>
          ${trainingTypes.map((t) => `<option value="${t.id}">${t.label}</option>`).join('')}
        </select>
        <span class="hint">Pick the exact type from Hattrick's "Set current training" dropdown — combined types (Wing Attacks, Shooting, …) train at different speeds than their pure counterparts.</span>
      </div>
      <div class="field"><label for="csvTrainingIntensity">Training intensity %</label><input type="text" id="csvTrainingIntensity" inputmode="numeric" placeholder="e.g. 96"></div>
      <div class="field"><label for="csvTrainingStamina">Stamina training %</label><input type="text" id="csvTrainingStamina" inputmode="numeric" placeholder="e.g. 14"></div>
      <div class="field"><label for="csvCoachLevel">Coach skill level (4–8)</label><input type="text" id="csvCoachLevel" inputmode="numeric" placeholder="e.g. 7 for Solid">
        <span class="hint">From Club → Staff. Feeds the modeled training estimate; blank assumes Solid (7).</span></div>
      <div class="field"><label for="csvAssistants">Assistant coach levels, summed (0–10)</label><input type="text" id="csvAssistants" inputmode="numeric" placeholder="e.g. 8 for two level-4 assistants">
        <span class="hint">Add up your assistant coaches' levels. Blank assumes none.</span></div>
    </details>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="pill-btn primary" id="importCsvBtn" type="button">Import CSV</button>
      ${status.hasSquadData ? '<a class="pill-btn" href="/api/csv/export">Export current squad</a>' : ''}
    </div>
  `;
  document.getElementById('importCsvBtn').addEventListener('click', importCsv);
}

async function importCsv() {
  const fileInput = document.getElementById('csvFile');
  const teamName = document.getElementById('csvTeamName').value.trim();
  const cash = document.getElementById('csvCash').value.trim();
  const weeklyIncome = document.getElementById('csvIncome').value.trim();
  const weeklyExpenses = document.getElementById('csvExpenses').value.trim();
  const trainingTypeId = document.getElementById('csvTrainingType').value;
  const trainingIntensity = document.getElementById('csvTrainingIntensity').value.trim();
  const trainingStaminaPct = document.getElementById('csvTrainingStamina').value.trim();
  const coachLevel = document.getElementById('csvCoachLevel').value.trim();
  const assistantLevels = document.getElementById('csvAssistants').value.trim();
  const file = fileInput.files[0];
  const btn = document.getElementById('importCsvBtn');
  if (!file) return showError('csvError', 'Choose a CSV file first.');

  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    const text = await file.text();
    const result = await apiPost('/api/csv/import', {
      csv: text, teamName, cash, weeklyIncome, weeklyExpenses,
      trainingTypeId, trainingIntensity, trainingStaminaPct, coachLevel, assistantLevels,
    });
    status = await apiGet('/api/chpp/status');
    renderCsvCard();
    const formatNote = result.format === 'hattrick' ? ' (recognized as a Hattrick players export)' : ' (template format)';
    document.getElementById('csvError').innerHTML =
      `<div class="banner good">Imported ${result.playerCount} players${formatNote}. <a href="/index.html">Go to Dashboard →</a></div>`;
  } catch (err) {
    const rowErrors = err.data?.rowErrors || [];
    showError('csvError', [err.message, ...rowErrors.map((e) => `• ${e}`)].join('<br>'));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import CSV';
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
    let scheduleRes, typesRes;
    [status, scheduleRes, typesRes] = await Promise.all([
      apiGet('/api/chpp/status'),
      apiGet('/api/settings/schedule'),
      apiGet('/api/settings/training-types'),
    ]);
    schedule = scheduleRes.schedule;
    trainingTypes = typesRes.types;
    renderConnectCard();
    renderCsvCard();
    renderScheduleCard();
  } catch (err) {
    connectCard.innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

load();
