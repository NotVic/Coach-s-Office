// The youth-CSV upload form, shared by the Youth Academy page and Settings:
// the file plus the academy's primary/secondary training, which Hattrick's
// youth export doesn't include. Prefilled from the last import, since the
// training rarely changes between weekly uploads.
async function mountYouthImportForm(container, { onImported } = {}) {
  const [{ types }, youth] = await Promise.all([apiGet('/api/settings/training-types'), apiGet('/api/youth')]);
  const current = youth.training || {};
  const options = (selectedId) => `<option value="">— not set —</option>`
    + types.map((t) => `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${t.label}</option>`).join('');

  container.innerHTML = `
    <div class="youthImportMsg"></div>
    <div class="field"><label>Primary training</label>
      <select class="youthPrimary">${options(current.primary?.typeId)}</select></div>
    <div class="field"><label>Secondary training</label>
      <select class="youthSecondary">${options(current.secondary?.typeId)}</select>
      <span class="hint">As set on Hattrick's youth academy training page.${current.reportedOn ? ` Prefilled from your import of ${formatDate(current.reportedOn)}.` : ''}</span></div>
    <div class="field"><label>Youth CSV file</label><input type="file" class="youthFile" accept=".csv,text/csv"></div>
    <button class="pill-btn primary youthImportBtn" type="button">Import youth CSV</button>
  `;

  const msg = container.querySelector('.youthImportMsg');
  const btn = container.querySelector('.youthImportBtn');
  btn.addEventListener('click', async () => {
    const file = container.querySelector('.youthFile').files[0];
    if (!file) {
      msg.innerHTML = '<div class="banner error">Choose the youth CSV file first.</div>';
      return;
    }
    btn.disabled = true;
    try {
      const result = await apiPost('/api/csv/youth-import', {
        csv: await file.text(),
        primaryTypeId: container.querySelector('.youthPrimary').value,
        secondaryTypeId: container.querySelector('.youthSecondary').value,
      });
      msg.innerHTML = `<div class="banner good">Imported ${result.playerCount} youth players${result.released ? ` · ${result.released} no longer in the academy` : ''}.</div>`;
      container.querySelector('.youthFile').value = '';
      if (onImported) await onImported(result);
    } catch (err) {
      const rowErrors = err.data?.rowErrors || [];
      msg.innerHTML = `<div class="banner error">${[err.message, ...rowErrors.map((r) => `• ${r}`)].join('<br>')}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}
