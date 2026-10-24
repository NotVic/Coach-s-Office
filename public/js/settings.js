const connectCard = document.getElementById('connectCard');
const csvCard = document.getElementById('csvCard');
const scheduleCard = document.getElementById('scheduleCard');
const advisorCard = document.getElementById('advisorCard');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Hattrick's real training types (incl. combined ones), fetched from the
// server so the list can't drift from the sync/model's own mapping.
let trainingTypes = [];
// Last import's stored values — prefills the CSV form so a weekly
// re-import doesn't mean re-typing info that rarely changes.
let csvDefaults = {};

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
        Team: <b>${esc(status.teamName || '—')}</b> · Last synced: ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'never'}
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
  // message: a string, or an array of lines (escaped one by one, then joined).
  const html = (Array.isArray(message) ? message : [message]).map(esc).join('<br>');
  if (el) el.innerHTML = `<div class="banner error">${html}</div>`;
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

// ---- Weekly update card ------------------------------------------------
//
// One upload for the weekly routine: drop the senior players export and/or
// the youth players export together (each is recognized by its header row),
// plus the few things the exports don't carry (cash, senior training, youth
// training). Imports run senior first, then youth.

const STALE_DAYS = 7;
// Files waiting to be imported, by kind: { name, text }.
let pendingFiles = {};
// Youth training menu, and the youth academy's state (last import date,
// last reported training) for the prefill.
let youthTrainingTypes = [];
let youthStatus = {};

function daysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

function lastImportLine() {
  const parts = [];
  const senior = daysAgo(status.lastSyncAt);
  const youth = daysAgo(youthStatus.asOfDate);
  parts.push(`Senior squad: ${senior == null ? 'never imported' : `${formatDate(status.lastSyncAt)} (${senior === 0 ? 'today' : `${senior} day${senior === 1 ? '' : 's'} ago`})`}`);
  parts.push(`Youth academy: ${youth == null ? 'never imported' : `${formatDate(youthStatus.asOfDate)} (${youth === 0 ? 'today' : `${youth} day${youth === 1 ? '' : 's'} ago`})`}`);
  const stale = (senior != null && senior >= STALE_DAYS) || (youth != null && youth >= STALE_DAYS);
  return `<div class="banner ${stale ? 'error' : 'info'}" style="margin-bottom:14px;">
    ${stale ? '<b>Time for the weekly update.</b> ' : ''}Last import · ${parts.join(' · ')}
  </div>`;
}

/** Which export is this? Youth exports have a promotion countdown column. */
function detectKind(text) {
  const header = text.split(/\r?\n/, 1)[0] || '';
  return header.includes('Days until you can promote') ? 'youth' : 'senior';
}

function youthTrainingOptions(selectedId) {
  const groups = [...new Set(youthTrainingTypes.map((t) => t.group))];
  return '<option value="">— not set —</option>' + groups.map((g) => `<optgroup label="${esc(g)}">${youthTrainingTypes
    .filter((t) => t.group === g)
    .map((t) => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</optgroup>`).join('');
}

function renderPendingFiles() {
  const el = document.getElementById('pendingFiles');
  const rows = Object.entries(pendingFiles).map(([kind, f]) => `<span class="chip good">${kind === 'youth' ? 'Youth academy' : 'Senior squad'}: ${esc(f.name)}</span>`);
  el.innerHTML = rows.length ? rows.join(' ') : '';
  document.getElementById('importBtn').disabled = !rows.length;
}

async function addFiles(fileList) {
  for (const file of fileList) {
    const text = await file.text();
    pendingFiles[detectKind(text)] = { name: file.name, text };
  }
  renderPendingFiles();
}

function renderCsvCard() {
  const isCsvSourced = status.dataSource === 'csv';
  const yt = youthStatus.training || {};
  csvCard.innerHTML = `
    <h3 style="margin-bottom:6px;">Weekly update</h3>
    <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
      Export your players and youth players from Hattrick and drop both files here. Each file is recognized on its own,
      so one of the two is fine too. <b>A squad import fully replaces the squad</b>: columns left out are blanked, not merged.
      Typing a squad by hand? <a href="/api/csv/template">Download our simpler template ↓</a>
    </p>
    ${lastImportLine()}
    <div id="csvError"></div>
    <label class="dropzone" id="dropzone">
      <input type="file" id="csvFiles" accept=".csv,text/csv" multiple hidden>
      <b>Drop your CSV files here</b> or click to choose
      <span class="muted">players_….csv and/or youthplayers_….csv</span>
    </label>
    <div id="pendingFiles" style="margin:10px 0 4px;"></div>

    <div class="upload-cols">
      <div>
        <h4 class="upload-sub">Senior squad</h4>
        <div class="field"><label for="csvTeamName">Team name</label>
          <input type="text" id="csvTeamName" value="${esc(csvDefaults.teamName || (isCsvSourced ? (status.teamName || '') : ''))}" placeholder="e.g. My Squad">
        </div>
        <div class="field"><label for="csvCash">Cash</label>
          <input type="text" id="csvCash" inputmode="numeric" placeholder="e.g. 500000">
          <span class="hint">
            Your current balance, from Club → Finances. The change between imports becomes the Dashboard's weekly cash chart.
            ${csvDefaults.cash != null ? `Last import: ${formatNumber(csvDefaults.cash)}.` : ''}
          </span>
        </div>
        <details style="margin-bottom:14px;" ${csvDefaults.trainingTypeId != null ? '' : 'open'}>
          <summary style="cursor:pointer;font-size:13px;font-weight:600;">Training focus${csvDefaults.trainingTypeId != null
            ? ` <span class="muted" style="font-weight:400;">· ${esc(trainingTypes.find((t) => t.id === csvDefaults.trainingTypeId)?.label ?? '')}, prefilled from your last import</span>` : ''}</summary>
          <p class="muted" style="font-size:12px;margin:6px 0;">
            From Hattrick's "Set current training" page; adjust only what changed. "— not set —" clears the stored focus.
          </p>
          <div class="field"><label for="csvTrainingType">Currently training</label>
            <select id="csvTrainingType">
              <option value="">— not set —</option>
              ${trainingTypes.map((t) => `<option value="${t.id}" ${t.id === csvDefaults.trainingTypeId ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select></div>
          <div class="field"><label for="csvTrainingIntensity">Training intensity %</label><input type="text" id="csvTrainingIntensity" inputmode="numeric" value="${csvDefaults.trainingIntensity ?? ''}" placeholder="e.g. 96"></div>
          <div class="field"><label for="csvTrainingStamina">Stamina training %</label><input type="text" id="csvTrainingStamina" inputmode="numeric" value="${csvDefaults.trainingStaminaPct ?? ''}" placeholder="e.g. 14"></div>
          <div class="field"><label for="csvCoachLevel">Coach skill (out of 5, as shown in Hattrick)</label>
            <select id="csvCoachLevel">
              <option value="">— not set (assumes 4/5, Solid) —</option>
              ${[1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${v === csvDefaults.coachLevel5 ? 'selected' : ''}>${v}/5 (${['Weak', 'Inadequate', 'Passable', 'Solid', 'Excellent'][v - 1]})</option>`).join('')}
            </select></div>
          <div class="field"><label for="csvAssistant1">Assistant coach 1 level (out of 5)</label>
            <select id="csvAssistant1"><option value="">— none —</option>
              ${[1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${v === csvDefaults.assistant1Level ? 'selected' : ''}>${v}/5</option>`).join('')}
            </select></div>
          <div class="field"><label for="csvAssistant2">Assistant coach 2 level (out of 5)</label>
            <select id="csvAssistant2"><option value="">— none —</option>
              ${[1, 2, 3, 4, 5].map((v) => `<option value="${v}" ${v === csvDefaults.assistant2Level ? 'selected' : ''}>${v}/5</option>`).join('')}
            </select></div>
        </details>
      </div>
      <div>
        <h4 class="upload-sub">Youth academy</h4>
        <div class="field"><label for="youthPrimary">Primary training</label>
          <select id="youthPrimary">${youthTrainingOptions(yt.primary?.typeId)}</select></div>
        <div class="field"><label for="youthSecondary">Secondary training</label>
          <select id="youthSecondary">${youthTrainingOptions(yt.secondary?.typeId)}</select>
          <span class="hint">As set on Hattrick's youth academy training page.${yt.reportedOn ? ` Prefilled from your import of ${formatDate(yt.reportedOn)}.` : ''}</span></div>
      </div>
    </div>

    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button class="pill-btn primary" id="importBtn" type="button" disabled>Import</button>
      ${status.hasSquadData ? '<a class="pill-btn" href="/api/csv/export">Export current squad</a>' : ''}
    </div>
  `;

  const zone = document.getElementById('dropzone');
  const input = document.getElementById('csvFiles');
  input.addEventListener('change', () => addFiles(input.files));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
  document.getElementById('importBtn').addEventListener('click', importFiles);
  renderPendingFiles();
}

async function importFiles() {
  const btn = document.getElementById('importBtn');
  const done = [];
  btn.disabled = true;
  btn.textContent = 'Importing…';
  try {
    if (pendingFiles.senior) {
      const result = await apiPost('/api/csv/import', {
        csv: pendingFiles.senior.text,
        teamName: document.getElementById('csvTeamName').value.trim(),
        // Thousands separators as Hattrick shows them ("1 234 567" / "1.234.567") are fine to paste.
        cash: document.getElementById('csvCash').value.replace(/[\s.,']/g, ''),
        trainingTypeId: document.getElementById('csvTrainingType').value,
        trainingIntensity: document.getElementById('csvTrainingIntensity').value.trim(),
        trainingStaminaPct: document.getElementById('csvTrainingStamina').value.trim(),
        coachLevel5: document.getElementById('csvCoachLevel').value,
        assistant1Level: document.getElementById('csvAssistant1').value,
        assistant2Level: document.getElementById('csvAssistant2').value,
      });
      delete pendingFiles.senior;
      done.push(`${result.playerCount} senior players`);
    }
    if (pendingFiles.youth) {
      const result = await apiPost('/api/csv/youth-import', {
        csv: pendingFiles.youth.text,
        primaryTypeId: document.getElementById('youthPrimary').value,
        secondaryTypeId: document.getElementById('youthSecondary').value,
      });
      delete pendingFiles.youth;
      done.push(`${result.playerCount} youth players${result.released ? ` (${result.released} no longer in the academy)` : ''}`);
    }
    [status, csvDefaults, youthStatus] = await Promise.all([apiGet('/api/chpp/status'), apiGet('/api/csv/defaults'), apiGet('/api/youth')]);
    renderCsvCard();
    document.getElementById('csvError').innerHTML = `<div class="banner good">
      Imported ${done.join(' and ')}. <a href="/index.html">Dashboard →</a>
      · <a href="/advisor.html?ask=weekly">Ask the assistant for this week's summary →</a>
    </div>`;
  } catch (err) {
    // Whatever imported before the failure stays imported; say which file failed.
    const rowErrors = err.data?.rowErrors || [];
    const which = pendingFiles.senior ? 'senior squad' : 'youth academy';
    showError('csvError', [`${done.length ? `Imported ${done.join(' and ')}, but the ` : 'The '}${which} file failed: ${err.message}`, ...rowErrors.map((e) => `• ${e}`)]);
    btn.disabled = false;
    btn.textContent = 'Import';
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
    <input type="text" class="labelInput" value="${esc(slot.label || '')}" placeholder="e.g. Training update" style="border:1px solid var(--sb-border);border-radius:var(--sb-radius-sm);padding:6px 8px;flex:1;">
    <button class="pill-btn removeRowBtn" type="button">Remove</button>
  </div>`;
}

function renderScheduleCard() {
  scheduleCard.innerHTML = `
    <h3 style="margin-bottom:6px;">Sync schedule</h3>
    <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
      Only used with a Hattrick connection. Hattrick's weekly processing time depends on your league's country
      bloc: set the day/time your training and match results actually post (e.g. Belgium is training ~Friday
      07:00, match results ~Sunday 16:00). A manual "Sync now" is always available on the Dashboard too.
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
    msgEl.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

// ---- Assistant (Anthropic API key) card --------------------------------

let advisorStatus = null;

function renderAdvisorCard() {
  const configuredText = {
    settings: 'A key is saved in this app\'s database.',
    env: 'Using the ANTHROPIC_API_KEY environment variable. A key saved here would take precedence.',
  }[advisorStatus.source] || 'No key configured yet.';
  advisorCard.innerHTML = `
    <h3 style="margin-bottom:6px;">Assistant (Claude API)</h3>
    <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 12px;">
      The <a href="/advisor.html">Assistant</a> page uses your own Anthropic API key.
      Questions and the squad data the assistant looks up are sent to Anthropic's API; usage is billed to your Anthropic account.
      ${configuredText} Limited to ${advisorStatus.maxPerHour} questions per hour.
    </p>
    ${advisorStatus.passwordProtected ? '' : `<div class="banner info" style="margin-bottom:12px;">
      This app has no password (APP_PASSWORD isn't set). Fine on your home network, but if it's reachable from the
      internet, anyone who finds it could use the assistant on your key. Set APP_PASSWORD in your stack's environment.
    </div>`}
    <div id="advisorMsg"></div>
    <div class="field"><label for="advisorModel">Model</label>
      <select id="advisorModel">
        ${advisorStatus.models.map((m) => `<option value="${m.id}" ${m.id === advisorStatus.model ? 'selected' : ''}>${m.label} (${m.note})</option>`).join('')}
      </select>
      <span class="hint">Saved as soon as you pick one; applies from the next question. Prices are per million tokens, input / output.</span>
    </div>
    <div class="field"><label for="anthropicKey">Anthropic API key</label><input type="password" id="anthropicKey" autocomplete="off" placeholder="sk-ant-…"></div>
    <button class="pill-btn primary" id="saveAnthropicKeyBtn">Save key</button>
    ${advisorStatus.source === 'settings' ? '<button class="pill-btn" id="clearAnthropicKeyBtn" style="margin-left:8px;">Remove saved key</button>' : ''}
  `;
  document.getElementById('advisorModel').addEventListener('change', saveAdvisorModel);
  document.getElementById('saveAnthropicKeyBtn').addEventListener('click', saveAnthropicKey);
  document.getElementById('clearAnthropicKeyBtn')?.addEventListener('click', () => updateAnthropicKey({ clear: true }, 'Saved key removed.'));
}

async function saveAdvisorModel(e) {
  const msgEl = document.getElementById('advisorMsg');
  const select = e.target;
  try {
    await apiPost('/api/advisor/model', { model: select.value });
    advisorStatus.model = select.value;
    msgEl.innerHTML = `<div class="banner good">Assistant now uses ${select.options[select.selectedIndex].text.replace(/ \(.*$/, '')}.</div>`;
  } catch (err) {
    select.value = advisorStatus.model;
    msgEl.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

function saveAnthropicKey() {
  const apiKey = document.getElementById('anthropicKey').value.trim();
  updateAnthropicKey({ apiKey }, 'Key verified and saved.');
}

async function updateAnthropicKey(body, successText) {
  const btn = document.getElementById('saveAnthropicKeyBtn');
  btn.disabled = true;
  try {
    await apiPost('/api/advisor/key', body);
    advisorStatus = await apiGet('/api/advisor/status');
    renderAdvisorCard();
    document.getElementById('advisorMsg').innerHTML = `<div class="banner good">${successText}</div>`;
  } catch (err) {
    btn.disabled = false;
    document.getElementById('advisorMsg').innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

// ---- Boot ------------------------------------------------------------

async function load() {
  try {
    let scheduleRes, typesRes, youthTypesRes;
    [status, scheduleRes, typesRes, csvDefaults, advisorStatus, youthTypesRes, youthStatus] = await Promise.all([
      apiGet('/api/chpp/status'),
      apiGet('/api/settings/schedule'),
      apiGet('/api/settings/training-types'),
      apiGet('/api/csv/defaults'),
      apiGet('/api/advisor/status'),
      apiGet('/api/settings/youth-training-types'),
      apiGet('/api/youth'),
    ]);
    schedule = scheduleRes.schedule;
    trainingTypes = typesRes.types;
    youthTrainingTypes = youthTypesRes.types;
    renderCsvCard();
    renderAdvisorCard();
    if (CHPP_ENABLED) {
      renderConnectCard();
      renderScheduleCard();
    }
    connectCard.hidden = !CHPP_ENABLED;
    scheduleCard.hidden = !CHPP_ENABLED;
  } catch (err) {
    csvCard.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

load();
