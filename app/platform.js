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
      || '<tr><td colspan="3" class="empty">עוד אין בניינים. צרו את הראשון בכפתור ״בניין חדש״.</td></tr>');
}
const BANKS = [['12', 'הפועלים'], ['10', 'לאומי'], ['11', 'דיסקונט'], ['20', 'מזרחי טפחות'], ['31', 'הבינלאומי'], ['14', 'אוצר החייל'], ['13', 'איגוד'], ['17', 'מרכנתיל'], ['4', 'יהב'], ['9', 'הדואר'], ['46', 'מסד'], ['52', 'פועלי אגודת ישראל'], ['54', 'ירושלים']];
// the address picker inside a dialog: the dialog gets the chosen address (or null) as the value of this field
const addressField = (k) => ({ k, type: 'custom', row: 'address', build: (box, notify) => { let addr = null; Vaad.addressPicker(box, (a) => { addr = a; notify(); }); return () => addr; } });
const needAddress = 'בחרו עיר ורחוב מהרשימה והקלידו מספר בית';
function newBuildingDialog() {
  return Vaad.form({
    title: 'בניין חדש',
    width: 640,
    ok: 'צור בניין',
    fields: [
      { k: 'intro', type: 'note', text: () => 'כתובת הבניין היא שמו: בחרו עיר ורחוב והקלידו מספר בית. דירות 1 עד המספר שתזינו נוצרות עכשיו.' },
      addressField('addr'),
      { k: 'apts', label: 'מספר דירות', width: 70, digits: 3, row: 'address' },
      { k: 'bank', label: 'בנק', type: 'select', options: [{ v: '', t: '—' }, ...BANKS.map(([v, t]) => ({ v, t: `${t} (${v})` }))], width: 150, row: 'bank' },
      { k: 'branch', label: 'סניף', width: 70, ltr: true, digits: 3, row: 'bank' },
      { k: 'acct', label: 'חשבון', width: 130, ltr: true, digits: 9, row: 'bank' },
      { k: 'bankNote', type: 'note', text: () => 'חשבון הבנק של הבניין (לא חובה): קובץ בנק ייטען רק אם החשבון שבכותרתו תואם. אפשר להשאיר ריק.' },
    ],
    onSubmit: async (v) => {
      if (!v.addr) throw new Error(needAddress);
      if ((v.branch || v.acct) && (v.branch.length !== 3 || v.acct.length < 4)) throw new Error('חשבון הבנק: סניף של 3 ספרות ומספר חשבון (או להשאיר את שניהם ריקים)');
      const b = await api('POST', '/api/building', { name: v.addr, bankAccount: v.branch && v.acct ? v.branch + '-' + v.acct : '', bankCode: v.bank, apartments: v.apts });
      Vaad.choose(b.id); Vaad.go('app.html');
    },
  });
}
function editAddressDialog(m) {
  return Vaad.form({
    title: 'שינוי כתובת: ' + m.name,
    ok: 'שמור כתובת',
    fields: [addressField('addr')],
    onSubmit: async (v) => {
      if (!v.addr) throw new Error(needAddress);
      await api('PUT', '/api/building', { id: m.id, name: v.addr });
      m.name = v.addr;
    },
  });
}
// delete a building: an empty one after one confirmation; one with payments, expenses or bank rows only when its address is typed
async function deleteBuilding(id) {
  const m = ME.memberships.find((x) => String(x.id) === String(id)); if (!m) return;
  try {
    const c = await api('GET', '/api/building/counts?id=' + id);
    const n = c.payments + c.pending + c.expenses + c.bank;
    let typed = '';
    if (n) {
      typed = await Vaad.ask({ ok: 'מחק לצמיתות', input: 'כתובת הבניין', text: `למחוק את הבניין "${m.name}"?\nיימחקו לצמיתות: ${c.payments} תשלומים, ${c.pending} תשלומים ממתינים, ${c.expenses} הוצאות, ${c.bank} שורות בנק, וכל הדירות והאנשים.\nאי אפשר לשחזר.\n\nלאישור, הקלידו את כתובת הבניין בדיוק:` });
      if (typed === null) return;
    } else if (!(await Vaad.ask({ ok: 'מחק', text: `למחוק את הבניין "${m.name}" וכל הדירות והאנשים שבו? אי אפשר לשחזר.` }))) return;
    await api('DELETE', '/api/building', { id, confirm: typed });
    ME.memberships.splice(ME.memberships.indexOf(m), 1);
    loadBuildings(); loadManagers(); toast('הבניין נמחק');
  } catch (err) { toast(err.message.includes('confirm') ? 'הכתובת שהוקלדה לא תואמת, הבניין לא נמחק' : err.message); }
}
$('#bNew').onclick = () => { newBuildingDialog(); };
$('#bTable').onclick = async (e) => {
  const d = e.target.dataset;
  if (d.open) { Vaad.choose(d.open); return Vaad.go('app.html'); }
  if (d.del) return deleteBuilding(d.del);
  if (d.edit) { const m = ME.memberships.find((x) => String(x.id) === d.edit); if (m && await editAddressDialog(m)) { loadBuildings(); loadManagers(); toast('הכתובת עודכנה'); } }
};

/* ---------- the buildings managers ---------- */
let MGRS = [];
async function loadManagers() {
  MGRS = await api('GET', '/api/managers'); const names = Object.fromEntries(ME.memberships.map((m) => [m.id, m.name])); const enc = encodeURIComponent;
  $('#mTable').innerHTML = '<tr><th class="l">אימייל</th><th class="l">הבניינים שלו</th><th></th></tr>' +
    (MGRS.map((x, i) => `<tr><td class="l" dir="ltr">${esc(x.email)}</td><td class="l">${x.buildings.map((b) => `<span class="chip">${esc(names[b] || b)}</span>`).join('') || '<span class="mute">אין בניינים</span>'}</td>` +
      `<td><button class="g" data-me="${i}">עריכה</button> <button class="g" data-rmm="${enc(x.email)}">הסר מנהל</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">עוד אין מנהלי בניינים.</td></tr>');
}
// add a buildings manager (with the buildings they manage), or (with x) change which buildings they manage
function managerDialog(x) {
  const has = (id) => !!x && x.buildings.includes(id);
  return Vaad.form({
    title: x ? `הבניינים של ${x.email}` : 'מנהל בניינים חדש',
    ok: x ? 'שמור' : 'הוסף מנהל',
    fields: [
      ...(x ? [] : [{ k: 'email', label: 'אימייל', type: 'email', width: 240, ltr: true }]),
      { k: 'intro', type: 'note', text: () => 'מנהל בניינים מנהל את הבניינים המסומנים ואינו יוצר חדשים.' },
      ...ME.memberships.map((m) => ({ k: 'b' + m.id, label: m.name, type: 'check', value: has(m.id), row: 'buildings' })),
    ],
    onSubmit: async (v) => {
      const email = x ? x.email : String(v.email || '').trim().toLowerCase();
      if (!x) await api('POST', '/api/manager', { email });
      for (const m of ME.memberships) {
        const want = !!v['b' + m.id];
        if (want && !has(m.id)) await api('POST', '/api/manager-building', { email, building_id: m.id });
        if (!want && has(m.id)) await api('DELETE', '/api/manager-building/' + encodeURIComponent(email) + '~' + m.id);
      }
    },
  });
}
$('#mNew').onclick = async () => { if (await managerDialog(null)) { toast('נוסף'); loadManagers(); } };
$('#mTable').onclick = async (e) => {
  const me = e.target.closest('[data-me]');
  if (me) { if (await managerDialog(MGRS[+me.dataset.me])) { toast('נשמר'); loadManagers(); } return; }
  try {
    if (e.target.dataset.rmm && await Vaad.ask({ ok: 'הסר', text: 'להסיר את מנהל הבניינים?' })) { await api('DELETE', '/api/manager/' + e.target.dataset.rmm); loadManagers(); }
  } catch (err) { toast(err.message); }
};

loadBuildings();
loadManagers().catch((e) => toast(e.message));
})();
