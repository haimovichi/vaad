// The platform page: all the buildings, outside any one building. Only the super user is here: he creates, renames and deletes
// buildings and appoints their managers. Opening a building goes to app.html.
(async () => {
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (t) => { const e = $('#msg'); e.textContent = t; e.style.display = 'block'; setTimeout(() => { e.style.display = 'none'; }, 3500); };

const ME = await Vaad.whoami();
if (!ME) { Vaad.go('index.html'); return; }
if (!ME.isSuper) { Vaad.go(ME.building ? 'app.html' : 'index.html'); return; }
const store = Vaad.store(null, ME);
const SVC = VaadLib.service.createService({}, store, Vaad.perms(ME));
const api = (m, u, b) => SVC.call(m, u, b);
$('#who').textContent = ME.email + ' · ' + Vaad.ROLE_LABEL.super;
$('#logout').onclick = (e) => { e.preventDefault(); Vaad.signOut(); };

/* ---------- the buildings ---------- */
function loadBuildings() {
  $('#bTable').innerHTML = '<tr><th>#</th><th class="l">שם</th><th></th></tr>' +
    (ME.memberships.map((m) => `<tr><td>${m.id}</td><td class="l">${esc(m.name)}</td><td><button class="b" data-open="${m.id}">פתח</button> <button class="g" data-edit="${m.id}">שנה כתובת</button> <button class="g" data-del="${m.id}">מחק בניין</button></td></tr>`).join('')
      || '<tr><td colspan="3" class="empty">עוד אין בניינים. צרו את הראשון למטה.</td></tr>');
}
let newAddr = null;
Vaad.addressPicker($('#bPick'), (a) => { newAddr = a; $('#bAdd').disabled = !a; });
const digits = (el, n) => { el.oninput = () => { el.value = el.value.replace(/\D/g, '').slice(0, n); }; };
digits($('#bBranch'), 3); digits($('#bAcct'), 9);
$('#bApts').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3); };
$('#bAdd').onclick = async () => {
  if (!newAddr) return;
  const br = $('#bBranch').value, ac = $('#bAcct').value;
  if ((br || ac) && (br.length !== 3 || ac.length < 4)) return toast('חשבון הבנק: סניף של 3 ספרות ומספר חשבון (או להשאיר את שניהם ריקים)');
  const acct = br && ac ? br + '-' + ac : '';
  try {
    const b = await api('POST', '/api/building', { name: newAddr, bankAccount: acct, apartments: $('#bApts').value });
    Vaad.choose(b.id); Vaad.go('app.html');
  } catch (e) { toast(e.message); }
};
let editId = null; let editAddr = null;
const editPick = Vaad.addressPicker($('#bEditPick'), (a) => { editAddr = a; $('#bEditSave').disabled = !a; });
const closeEdit = () => { editId = null; $('#bEditBox').classList.add('hide'); editPick.reset(); };
$('#bEditCancel').onclick = closeEdit;
$('#bEditSave').onclick = async () => {
  if (!editAddr) return;
  try { await api('PUT', '/api/building', { id: editId, name: editAddr }); const m = ME.memberships.find((x) => String(x.id) === String(editId)); if (m) m.name = editAddr; closeEdit(); loadBuildings(); loadManagers(); toast('הכתובת עודכנה'); } catch (err) { toast(err.message); }
};
// delete a building: an empty one after one confirmation; one with payments, expenses or bank rows only when its address is typed
async function deleteBuilding(id) {
  const m = ME.memberships.find((x) => String(x.id) === String(id)); if (!m) return;
  try {
    const c = await api('GET', '/api/building/counts?id=' + id);
    const n = c.payments + c.pending + c.expenses + c.bank;
    let typed = '';
    if (n) {
      typed = prompt(`למחוק את הבניין "${m.name}"?\nיימחקו לצמיתות: ${c.payments} תשלומים, ${c.pending} תשלומים ממתינים, ${c.expenses} הוצאות, ${c.bank} שורות בנק, וכל הדירות והאנשים.\nאי אפשר לשחזר.\n\nלאישור, הקלידו את כתובת הבניין בדיוק:`);
      if (typed === null) return;
    } else if (!confirm(`למחוק את הבניין "${m.name}" וכל הדירות והאנשים שבו? אי אפשר לשחזר.`)) return;
    await api('DELETE', '/api/building', { id, confirm: typed });
    ME.memberships.splice(ME.memberships.indexOf(m), 1);
    loadBuildings(); loadManagers(); toast('הבניין נמחק');
  } catch (err) { toast(err.message.includes('confirm') ? 'הכתובת שהוקלדה לא תואמת, הבניין לא נמחק' : err.message); }
}
$('#bTable').onclick = (e) => {
  const d = e.target.dataset;
  if (d.open) { Vaad.choose(d.open); return Vaad.go('app.html'); }
  if (d.del) return deleteBuilding(d.del);
  if (d.edit) { editId = d.edit; const m = ME.memberships.find((x) => String(x.id) === d.edit); $('#bEditT').textContent = 'שינוי כתובת: ' + m.name; $('#bEditBox').classList.remove('hide'); $('#bEditBox').scrollIntoView(); }
};

/* ---------- the buildings managers ---------- */
async function loadManagers() {
  const list = await api('GET', '/api/managers'); const names = Object.fromEntries(ME.memberships.map((m) => [m.id, m.name])); const enc = encodeURIComponent;
  $('#mTable').innerHTML = '<tr><th class="l">אימייל</th><th class="l">הבניינים שלו</th><th>הוסף בניין</th><th></th></tr>' +
    list.map((x) => `<tr><td class="l" dir="ltr">${esc(x.email)}</td><td class="l">${x.buildings.map((b) => `<span class="chip">${esc(names[b] || b)} <a href="#" data-mb="${enc(x.email)}~${b}">✕</a></span>`).join('') || '<span class="mute">אין בניינים</span>'}</td>` +
      `<td><select data-addb="${enc(x.email)}"><option value="">בחרו…</option>${ME.memberships.filter((m) => !x.buildings.includes(m.id)).map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></td>` +
      `<td><button class="g" data-rmm="${enc(x.email)}">הסר מנהל</button></td></tr>`).join('');
}
$('#mAdd').onclick = async () => { try { await api('POST', '/api/manager', { email: $('#mEmail').value }); $('#mEmail').value = ''; toast('נוסף'); loadManagers(); } catch (e) { toast(e.message); } };
$('#mTable').onchange = async (e) => { const em = e.target.dataset.addb; if (!em || !e.target.value) return; try { await api('POST', '/api/manager-building', { email: decodeURIComponent(em), building_id: e.target.value }); loadManagers(); } catch (err) { toast(err.message); } };
$('#mTable').onclick = async (e) => {
  if (e.target.dataset.mb) e.preventDefault();
  try {
    if (e.target.dataset.mb) { await api('DELETE', '/api/manager-building/' + e.target.dataset.mb); loadManagers(); }
    if (e.target.dataset.rmm && confirm('להסיר את מנהל הבניינים?')) { await api('DELETE', '/api/manager/' + e.target.dataset.rmm); loadManagers(); }
  } catch (err) { toast(err.message); }
};

loadBuildings();
loadManagers().catch((e) => toast(e.message));
})();
