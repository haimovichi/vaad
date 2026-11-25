// The platform page: all the buildings, outside any one building. Only the super user is here: he creates, renames and deletes
// buildings and attaches their managers (a manager is created as a person, in the people table of a building). Opening a building goes to app.html.
(async () => {
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toast = (t) => { const e = $('#msg'); e.textContent = t; e.style.display = 'block'; setTimeout(() => { e.style.display = 'none'; }, 3500); };

const ME = await Vaad.whoami();
if (!ME) { Vaad.go('index.html'); return; }
if (!ME.isSuper) { Vaad.go(ME.building ? 'app.html' : 'index.html'); return; }
const ic = Vaad.ic;
const store = Vaad.store(null, ME);
const SVC = VaadLib.service.createService({}, store, Vaad.perms(ME));
const api = (m, u, b) => SVC.call(m, u, b);
$('#who').textContent = ME.email + ' · ' + Vaad.ROLE_LABEL.super;
$('#logout').onclick = (e) => { e.preventDefault(); Vaad.signOut(); };

/* ---------- the buildings ---------- */
let MGRS = [];            // the buildings managers: { email, buildings: [id] }
const OPEN = new Set();    // buildings (by id) and 'none' (managers with no building) shown opened
let QUERY = '';
const enc = encodeURIComponent;
function renderBuildings() {
  const q = QUERY.trim();
  const list = ME.memberships.filter((m) => !q || m.name.includes(q));
  const mine = (id) => MGRS.filter((x) => x.buildings.includes(id));
  const chip = (x, id) => `<span class="chip">${esc(x.email)} <button class="cx" data-rm="${id}" data-em="${enc(x.email)}" aria-label="הסר מנהל">${ic('x')}</button></span>`;
  let h = '<tr><th></th><th class="l">בניין</th><th class="l">מנהלים</th><th></th></tr>';
  for (const m of list) {
    const ms = mine(m.id); const open = OPEN.has(String(m.id));
    h += `<tr class="pr" data-x="${m.id}"><td>${open ? ic('down') : ic('left')}</td><td class="l"><b>${esc(m.name)}</b></td><td class="l mute">${ms.length ? ms.length + (ms.length === 1 ? ' מנהל' : ' מנהלים') : 'אין מנהל'}</td><td><button class="b" data-open="${m.id}">כניסה</button></td></tr>`;
    if (open) h += `<tr class="xr"><td></td><td colspan="3" class="l"><div class="xd"><div>${ms.map((x) => chip(x, m.id)).join('') || '<span class="mute">אין מנהל לבניין</span>'} <button class="g" data-addm="${m.id}">+ הוסף מנהל</button></div><div><button class="g" data-edit="${m.id}">שנה כתובת</button> <button class="g" data-del="${m.id}">מחק בניין</button></div></div></td></tr>`;
  }
  const none = MGRS.filter((x) => !x.buildings.length);
  if (none.length && !q) {
    const open = OPEN.has('none');
    h += `<tr class="pr" data-x="none"><td>${open ? ic('down') : ic('left')}</td><td class="l mute">ללא בניין</td><td class="l mute">${none.length} ${none.length === 1 ? 'מנהל' : 'מנהלים'}</td><td></td></tr>`;
    if (open) h += `<tr class="xr"><td></td><td colspan="3" class="l"><div class="xd"><div>${none.map((x) => chip(x, '')).join('')}</div><div class="mute">מנהל בלי בניין נוסף מתוך הבניין, בכפתור ״הוסף מנהל״.</div></div></td></tr>`;
  }
  if (!ME.memberships.length) h += '<tr><td colspan="4" class="empty">עוד אין בניינים. צרו את הראשון בכפתור ״בניין חדש״.</td></tr>';
  else if (!list.length && !none.length) h += '<tr><td colspan="4" class="empty">לא נמצא בניין.</td></tr>';
  $('#bTable').innerHTML = h;
  $('#bSearch').classList.toggle('hide', ME.memberships.length <= 8);
}
async function loadBuildings() { MGRS = await api('GET', '/api/managers'); renderBuildings(); }
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
    loadBuildings(); toast('הבניין נמחק');
  } catch (err) { toast(err.message.includes('confirm') ? 'הכתובת שהוקלדה לא תואמת, הבניין לא נמחק' : err.message); }
}
$('#bNew').onclick = () => { newBuildingDialog(); };
$('#bSearch').oninput = (e) => { QUERY = e.target.value; renderBuildings(); };
// attach a manager that already exists (one made in the people table of some building) to this building
async function addManagerDialog(id) {
  const m = ME.memberships.find((x) => String(x.id) === String(id)); if (!m) return false;
  const free = MGRS.filter((x) => !x.buildings.includes(m.id));
  if (!free.length) { toast('אין מנהל פנוי. הוסיפו אדם עם אימייל באנשים (בכל בניין) וסמנו ״מנהל בניינים״.'); return false; }
  return Vaad.form({
    title: 'מנהל לבניין ' + m.name,
    ok: 'הוסף מנהל',
    fields: [{ k: 'email', label: 'מנהל', type: 'select', options: free.map((x) => ({ v: x.email, t: x.email })), value: free[0].email, width: 260, ltr: true }],
    onSubmit: async (v) => { await api('POST', '/api/manager-building', { email: v.email, building_id: m.id }); },
  });
}
$('#bTable').onclick = async (e) => {
  const d = (e.target.closest('button') || {}).dataset || {};
  try {
    if (d.open) { Vaad.choose(d.open); return Vaad.go('app.html'); }
    if (d.del) return deleteBuilding(d.del);
    if (d.edit) { const m = ME.memberships.find((x) => String(x.id) === d.edit); if (m && await editAddressDialog(m)) { await loadBuildings(); toast('הכתובת עודכנה'); } return; }
    if (d.addm) { if (await addManagerDialog(d.addm)) { await loadBuildings(); toast('נוסף'); } return; }
    if (d.em) {
      const email = decodeURIComponent(d.em);
      if (d.rm) { if (await Vaad.ask({ ok: 'הסר', text: `להסיר את ${email} מניהול הבניין? האדם נשאר, בלי הבניין הזה.` })) { await api('DELETE', '/api/manager-building/' + enc(email) + '~' + d.rm); await loadBuildings(); } }
      else if (await Vaad.ask({ ok: 'הסר', text: `להסיר את ${email} כמנהל בניינים? האדם נשאר באנשים.` })) { await api('DELETE', '/api/manager/' + d.em); await loadBuildings(); }
      return;
    }
  } catch (err) { toast(err.message); return; }
  const tr = e.target.closest('tr[data-x]');
  if (tr && !e.target.closest('button')) { const k = tr.dataset.x; if (OPEN.has(k)) OPEN.delete(k); else OPEN.add(k); renderBuildings(); }
};

loadBuildings().catch((e) => toast(e.message));
})();
