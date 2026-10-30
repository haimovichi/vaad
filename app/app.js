// One page for everyone: a menu (bottom bar on phones, side menu on computers) and the sections the person's roles allow.
// Home = my apartment / debtors / all, with a full drill-down on every card for whoever manages the building.
(async () => {
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmt = (n) => Math.round(n).toLocaleString('he-IL');
const fdate = (d) => (d ? d.split('-').reverse().join('/') : '—');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MN = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
const MF = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const STATUS_TXT = { paid: 'שולם', partial: 'חלקי', unpaid: 'לא שולם', pending: 'החודש, טרם שולם', prepaid: 'שולם מראש', future: 'עוד לא הגיע' };
const ROLE = { committee: 'ועד הבית', tenant: 'דייר', apt_owner: 'בעל דירה' };
const toast = (t) => { const e = $('#msg'); e.textContent = t; e.style.display = 'block'; setTimeout(() => { e.style.display = 'none'; }, 3500); };
const calc = VaadLib.calc;

/* ---------- who, and what they may see ---------- */
const ME = await Vaad.whoami();
if (!ME || !ME.building) { Vaad.go('index.html'); return; }
const BLD = ME.building;
const STAFF = BLD.manage;                     // committee, buildings manager or super user: the building's full data
const BOARD = BLD.seesBoard;                  // may see every apartment's status
const PLATFORM = ME.isSuper || ME.isManager;  // may create buildings and see everyone's roles
const myApts = BLD.linkedApts;                // apartments linked to this login as tenant or apartment owner
const store = Vaad.store(BLD.id, ME);
let DB = null; let SNAP = null; let SVC = null;
try {
  if (STAFF) { DB = await store.load(); SVC = VaadLib.service.createService(DB, store, Vaad.perms(ME)); } else SNAP = await store.getBoard();
} catch (e) { document.body.innerHTML = '<div class="wrap">שגיאה בטעינה: ' + esc(e.message) + '</div>'; return; }
if (!STAFF && !SNAP) { document.body.innerHTML = '<div class="wrap">עדיין לא פורסם מידע. נסו שוב מאוחר יותר.</div>'; return; }
const api = (m, u, b) => SVC.call(m, u, b);

/* ---------- header ---------- */
document.body.classList.toggle('staff', STAFF);
$('#banner').innerHTML = '📍 ' + esc(BLD.name);
$('#banner').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(BLD.name);
document.title = BLD.name;
$('#updated').textContent = STAFF ? '' : 'עודכן ' + SNAP.updated.split('-').reverse().join('/');
$('#who').textContent = ME.email + ' · ' + BLD.roles.map((r) => Vaad.ROLE_LABEL[r]).join(', ');
$('#logout').onclick = (e) => { e.preventDefault(); Vaad.signOut(); };
Vaad.mountSwitcher($('#bsel'), ME);

/* ---------- menu and routing: one flat list of screens, ← בית on every screen but home ---------- */
const SCREENS = [
  ['home', 'בית', '🏠', '', 'home'],
  ['import', 'ייבוא מהבנק', '📥', 'כספים', 'import', () => STAFF],
  ['backup', 'גיבוי נתונים', '💾', 'כספים', 'more', () => STAFF],
  ['users', 'משתמשים', '🔑', 'אנשים', 'people', () => STAFF],
  ['apts', 'דירות ודיירים', '🏘️', 'אנשים', 'people', () => STAFF],
  ['everyone', 'כל האנשים', '👥', 'אנשים', 'people', () => PLATFORM],
  ['list', 'הבניינים שלי', '🏢', 'בניינים', 'buildings', () => PLATFORM],
  ['managers', 'מנהלי בניינים', '🧑‍💼', 'בניינים', 'buildings', () => ME.isSuper],
  ['share', 'מה הדיירים רואים', '📢', 'הגדרות', 'more', () => STAFF],
];
const PANE = { users: 'p-users', apts: 'p-apts', everyone: 'p-everyone', list: 'b-list', managers: 'b-managers', share: 'm-share', backup: 'm-backup' };
const LEGACY = { people: 'users', buildings: 'list', more: 'share' };   // old #people/users style addresses
const screens = SCREENS.filter((x) => !x[5] || x[5]());
const LOAD = { home: () => renderHome(), import: () => {}, users: () => loadUsers(), apts: () => loadApts(), everyone: () => loadPeople(), list: () => loadBuildings(), managers: () => loadManagers(), share: () => loadShare(), backup: () => showLastBackup() };
let menuHtml = '<div class="mh"><span>תפריט</span><button id="mclose" aria-label="סגור">✕</button></div>'; let grp = null;
for (const x of screens) {
  if (x[3] !== grp) { grp = x[3]; if (grp) menuHtml += `<h4>${grp}</h4>`; }
  menuHtml += `<a href="#${x[0]}" data-k="${x[0]}"><b>${x[2]}</b> ${x[1]}</a>`;
}
const others = ME.memberships.filter((m) => !ME.building || m.id !== ME.building.id);
menuHtml += '<h4>חשבון</h4>' + others.map((m) => `<a href="#" data-b="${m.id}"><b>🔄</b> עבור ל${esc(m.name)}</a>`).join('') + '<a href="#" id="mout"><b>🚪</b> יציאה</a>';
$('#menu').innerHTML = menuHtml;
const setMenu = (on) => document.body.classList.toggle('mopen', on);
$('#mbtn').onclick = () => setMenu(true);
$('#menu').onclick = (e) => {
  const a = e.target.closest('a'); const c = e.target.closest('#mclose');
  if (c) return setMenu(false);
  if (!a) return;
  if (a.id === 'mout') { e.preventDefault(); return Vaad.signOut(); }
  if (a.dataset.b) { e.preventDefault(); Vaad.choose(a.dataset.b); return (location.href = 'index.html' + Vaad.keep); }
  setMenu(false);
};

const homeTabs = [...(myApts.length ? ['mine'] : []), ...(BOARD ? ['debt', 'all'] : [])];
let sec = 'home'; let sub = ''; let tab = homeTabs[0];
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  let s = h[0] || 'home'; let u = h[1] || '';
  if (LEGACY[s] && (!u || PANE[u])) s = u || LEGACY[s];
  if (!screens.find((x) => x[0] === s)) s = 'home';
  if (s === 'home') { if (!homeTabs.includes(u)) u = homeTabs.includes(tab) ? tab : homeTabs[0]; tab = u; } else u = '';
  sec = s; sub = u;
  const def = screens.find((x) => x[0] === s);
  $$('#menu a[data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === s));
  ['home', 'import', 'people', 'buildings', 'more'].forEach((k) => $('#sec-' + k).classList.toggle('hide', k !== def[4]));
  Object.entries(PANE).forEach(([k, id]) => $('#' + id).classList.toggle('hide', k !== s));
  $('#scr').textContent = s === 'home' ? 'בית' : def[1];
  $('#homeBtn').classList.toggle('hide', s === 'home');
  setMenu(false);
  LOAD[s]();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ================= HOME ================= */
const now = STAFF ? calc.fromMi(calc.nowMi()) : SNAP.now;
const years = STAFF ? Array.from({ length: now.y - calc.fromMi(calc.START).y + 1 }, (_, i) => calc.fromMi(calc.START).y + i) : SNAP.years;
let year = now.y; let openId = null;
for (const y of years) $('#year').add(new Option(y, y));
$('#year').value = year;
$('#mlabels').innerHTML = MN.map((m) => `<span>${m[0]}</span>`).join('');
$$('.tab').forEach((b) => { b.hidden = !homeTabs.includes(b.dataset.t); });
if (homeTabs.includes('mine')) $('.tab[data-t="mine"]').textContent = myApts.length > 1 ? 'הדירות שלי' : 'הדירה שלי';

function rowsFor(y) {
  if (STAFF) {
    const g = calc.grid(DB, y); const cnt = {}; g.forEach((r) => { cnt[r.apt] = (cnt[r.apt] || 0) + 1; });
    return g.map((r) => ({ apt: r.apt, key: r.key, name: r.name, tag: cnt[r.apt] > 1 ? (r.left ? 'דייר קודם' : 'דייר נוכחי') : undefined, left: r.left, debt: r.debt, balance: r.balance, months: r.months.map((c) => c.status), cells: r.months }));
  }
  return (SNAP.grids[y] || []).map((r) => ({ ...r, left: r.tag === 'דייר קודם' }));
}
function staffPayments(row, y) {
  const ts = calc.tenancies(DB); const t = ts.find((x) => x.key === row.key);
  return DB.payments.filter((p) => p.y === y && (ts.find((x) => x.key === p.key) || calc.tenancyAt(ts, p.apt, calc.mi(p.y, p.m))) === t)
    .map((p) => ({ id: p.id, y: p.y, m: p.m, amount: p.amount, method: p.method, date: p.date, src: p.src, note: p.note }))
    .sort((a, b) => a.m - b.m || String(a.date).localeCompare(String(b.date)));
}
const isOwing = (r) => r.debt > 0 || (r.debt === undefined && r.months.some((s) => s === 'unpaid' || s === 'partial'));
function badge(r) {
  const cur = r.months[now.m - 1];
  if (r.debt > 0) return `<span class="badge ${cur === 'partial' ? 'b-warn' : 'b-bad'}">חוב ${fmt(r.debt)} ₪</span>`;
  if (r.debt === undefined && isOwing(r)) return '<span class="badge b-bad">חסר תשלום</span>';
  if (r.left) return '<span class="badge b-old">שולם</span>';
  if (cur === 'pending' && year === now.y) return '<span class="badge b-wait">ממתין לחודש זה</span>';
  if (r.months.includes('prepaid')) return '<span class="badge b-pre">שולם מראש</span>';
  return '<span class="badge b-ok">שולם</span>';
}
function missing(r) {
  const m = r.months.map((s, i) => (s === 'unpaid' || s === 'partial' ? MF[i] + (s === 'partial' ? ' (חלקי)' : '') : null)).filter(Boolean);
  if (m.length) return 'חסר: ' + m.join(', ') + '.';
  if (r.debt > 0) return 'יש חוב מחודשים בשנים קודמות.';
  if (r.months[now.m - 1] === 'pending' && year === now.y) return 'החודש הנוכחי טרם שולם.';
  return 'הכל שולם עד היום.';
}
function payTable(list, title) {
  if (!list.length) return `<div class="pays"><h3>${title}</h3><div class="foot">אין תשלומים רשומים בשנת ${year}.</div></div>`;
  const total = list.reduce((s, p) => s + p.amount, 0);
  return `<div class="pays"><h3>${title}</h3><table class="p"><tr><th>תאריך</th><th>עבור חודש</th><th>סכום</th><th>אמצעי</th></tr>` +
    list.map((p) => `<tr><td>${fdate(p.date)}</td><td>${MF[p.m - 1]}</td><td class="n">${fmt(p.amount)} ₪</td><td>${esc(p.method || '')}</td></tr>`).join('') +
    `<tr class="tot"><td colspan="2">סה״כ שולם</td><td class="n">${fmt(total)} ₪</td><td></td></tr></table>` +
    (list.some((p) => !p.date) ? '<div class="foot">תשלומים שנרשמו לפני המעבר לאפליקציה מוצגים בלי תאריך.</div>' : '') + '</div>';
}
// full detail for whoever manages the building: exact amounts per month, balance, payments with dates, add and delete
function detailPanel(r) {
  const list = staffPayments(r, year);
  const cells = r.cells.filter((c) => c.status !== 'na');
  const total = list.reduce((s, p) => s + p.amount, 0);
  const bal = r.balance;
  const balTxt = bal > 0 ? `<b class="bad">חוב ${fmt(bal)} ₪</b>` : bal < 0 ? `<b class="good">זכות ${fmt(-bal)} ₪</b>` : '<b>מאוזן</b>';
  const pick = cells.find((c) => ['unpaid', 'partial', 'pending'].includes(c.status)) || cells.find((c) => c.m === now.m) || cells[0];
  const sugg = pick ? Math.max(0, pick.due - pick.paid) || pick.due : '';
  return `<div class="pays"><div class="balrow">יתרה כוללת: ${balTxt}</div>` +
    (cells.length ? `<h3>חודשים ב-${year}</h3><table class="p"><tr><th>חודש</th><th>לתשלום</th><th>שולם</th><th>מצב</th></tr>` +
      cells.map((c) => `<tr><td>${MF[c.m - 1]}</td><td class="n">${fmt(c.due)} ₪</td><td class="n">${fmt(c.paid)} ₪</td><td>${STATUS_TXT[c.status]}</td></tr>`).join('') + '</table>' : '') +
    `<h3>תשלומים ב-${year}</h3>` + (list.length
      ? '<table class="p"><tr><th>תאריך</th><th>עבור</th><th>סכום</th><th>אמצעי</th><th></th></tr>' +
        list.map((p) => `<tr><td>${fdate(p.date)}</td><td>${MN[p.m - 1]}</td><td class="n">${fmt(p.amount)} ₪</td><td title="${esc(p.note || '')}">${esc(p.method || '')}${p.src === 'bank' ? ' 🏦' : ''}</td><td><button class="g" data-delpay="${p.id}" aria-label="מחק">✕</button></td></tr>`).join('') +
        `<tr class="tot"><td colspan="2">סה״כ שולם</td><td class="n">${fmt(total)} ₪</td><td colspan="2"></td></tr></table>` +
        (list.some((p) => !p.date) ? '<div class="foot">תשלומים שנרשמו לפני המעבר לאפליקציה מוצגים בלי תאריך.</div>' : '')
      : `<div class="foot">אין תשלומים רשומים בשנת ${year}.</div>`) +
    `<div class="addp" data-key="${esc(r.key)}"><select class="ap-m">${cells.map((c) => `<option value="${c.m}" ${pick && c.m === pick.m ? 'selected' : ''}>${MF[c.m - 1]}</option>`).join('')}</select>` +
    `<input class="ap-a" type="number" min="1" placeholder="סכום ₪" value="${sugg}"><select class="ap-t"><option>מזומן</option><option>שיק</option><option>העברה בנקאית</option><option>הוראת קבע</option></select>` +
    `<input class="ap-d" type="date" value="${new Date().toISOString().slice(0, 10)}"><button class="b ap-go">הוסף תשלום</button></div></div>`;
}
const idOf = (r) => r.key || (r.apt + '|' + (r.tag || ''));
function card(r, withMore) {
  const open = withMore && openId === idOf(r);
  const more = withMore ? `<div class="more">${esc(missing(r))}${STAFF && open ? detailPanel(r) : ''}</div>` : '';
  return `<div class="card ${open ? 'open' : ''}" data-id="${esc(idOf(r))}"><div class="top"><div class="num">${r.apt}</div>
    <div class="who">${esc(r.name || 'דירה ' + r.apt)}<small>${r.tag || ''}</small></div>${badge(r)}</div>
    <div class="strip">${r.months.map((s, i) => `<i class="${s}" title="${MF[i]}"></i>`).join('')}</div>${more}</div>`;
}
async function tenantsOfMyApartments() {
  const owned = new Set(BLD.ownerApts);
  if (!owned.size) return [];
  if (STAFF) return DB.residents.filter((r) => owned.has(r.apt) && r.status !== 'עזב');
  return store.getAptTenants();
}
const telLink = (p) => (p ? `<a class="tel" href="tel:${esc(p.replace(/[^\d+]/g, ''))}">${esc(p)}</a>` : '');
function tenantsBox(list, apt) {
  const here = list.filter((r) => r.apt === apt);
  if (!here.length) return '<div class="pays"><h3>הדייר בדירה</h3><div class="foot">אין דייר רשום בדירה כרגע.</div></div>';
  return '<div class="pays"><h3>הדייר בדירה</h3>' + here.map((r) => `<div class="res"><div>${esc(r.first)} ${esc(r.last)}${r.first2 ? ` ו${esc(r.first2)} ${esc(r.last2 || r.last)}` : ''}<small>${esc(r.role || '')}</small></div><div>${telLink(r.phone1)}${r.phone2 ? '<br>' + telLink(r.phone2) : ''}</div></div>`).join('') + '</div>';
}

let seq = 0;
async function renderHome() {
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  const all = rowsFor(year); const current = all.filter((r) => !r.left); const idx = now.m - 1;
  const paidNow = current.filter((r) => ['paid', 'prepaid'].includes(r.months[idx])).length;
  const owing = new Set(all.filter(isOwing).map((r) => r.apt)).size;
  $('#sum').innerHTML = BOARD && year === now.y ? `<div><small>שילמו ${MF[idx]}</small><b>${paidNow} מתוך ${current.length}</b></div><div><small>דירות עם חוב</small><b class="${owing ? 'bad' : ''}">${owing}</b></div>` : '';
  $('#q').hidden = tab !== 'all';
  $('#mlabels').style.display = tab === 'mine' && !myApts.length ? 'none' : '';
  const my = ++seq;
  $('#oldBox').style.display = 'none';

  if (tab === 'mine') {
    if (!myApts.length) { $('#list').innerHTML = `<div class="empty">אין דירה מקושרת לחשבון הזה.<br>${BLD.grantable.includes('tenant') ? 'אפשר לקשר דירה בתפריט "אנשים".' : 'בקשו מוועד הבית לקשר את הדירה שלכם.'}</div>`; return; }
    const rowOf = (a) => current.find((r) => r.apt === a);
    $('#list').innerHTML = myApts.map((a) => `<div class="aptsec" data-apt="${a}">${rowOf(a) ? card(rowOf(a), false) : `<div class="empty">דירה ${a} לא נמצאה</div>`}<div class="tn"></div><div class="pp"><div class="pays foot">טוען תשלומים…</div></div></div>`).join('');
    let tenants = []; let tenErr = '';
    try { tenants = await tenantsOfMyApartments(); } catch (e) { tenErr = e.message; }
    for (const a of myApts) {
      const sec2 = $(`.aptsec[data-apt="${a}"]`); if (!sec2) continue;
      if (BLD.ownerApts.includes(a)) sec2.querySelector('.tn').innerHTML = tenErr ? `<div class="pays foot">לא הצלחנו לטעון את פרטי הדייר: ${esc(tenErr)}</div>` : tenantsBox(tenants, a);
      const title = BLD.tenantApts.includes(a) ? 'התשלומים שלי ב-' + year : 'תשלומי הדייר הנוכחי ב-' + year;
      try {
        if (STAFF) sec2.querySelector('.pp').innerHTML = rowOf(a) ? detailPanel(rowOf(a)) : '';
        else { const list = await store.getAptPayments(a, year); if (my !== seq) return; sec2.querySelector('.pp').innerHTML = payTable(list, title); }
      } catch (e) { if (my === seq) sec2.querySelector('.pp').innerHTML = '<div class="pays foot">לא הצלחנו לטעון תשלומים: ' + esc(e.message) + '</div>'; }
    }
    return;
  }
  if (tab === 'debt') {
    const owe = all.filter(isOwing).sort((a, b) => (b.debt || 0) - (a.debt || 0) || a.apt - b.apt);
    $('#list').innerHTML = owe.map((r) => card(r, true)).join('') || '<div class="empty">אין חייבים. כולם שילמו 🎉</div>';
    return;
  }
  const q = $('#q').value.trim();
  const match = (r) => !q || String(r.apt) === q || (r.name || '').includes(q);
  const cur = current.filter(match).sort((a, b) => (isOwing(b) ? 1 : 0) - (isOwing(a) ? 1 : 0) || a.apt - b.apt);
  $('#list').innerHTML = cur.map((r) => card(r, true)).join('') || '<div class="empty">לא נמצאו דירות</div>';
  const old = all.filter((r) => r.left && match(r));
  $('#oldBox').style.display = old.length ? '' : 'none';
  $('#oldSum').textContent = `דיירים קודמים (${old.length})`;
  $('#oldList').innerHTML = old.map((r) => card(r, true)).join('');
}
$$('.tab').forEach((b) => { b.onclick = () => { openId = null; location.hash = '#home/' + b.dataset.t; }; });
$('#year').onchange = (e) => { year = +e.target.value; openId = null; renderHome(); };
$('#q').oninput = renderHome;
$('#sec-home').addEventListener('click', async (e) => {
  const go = e.target.closest('.ap-go');
  if (go) {
    const box = go.closest('.addp');
    try {
      await api('POST', '/api/payment', { key: box.dataset.key, y: year, m: +box.querySelector('.ap-m').value, amount: box.querySelector('.ap-a').value, method: box.querySelector('.ap-t').value, date: box.querySelector('.ap-d').value || null });
      toast('התשלום נוסף'); renderHome();
    } catch (err) { toast(err.message); }
    return;
  }
  const del = e.target.closest('[data-delpay]');
  if (del) {
    if (!confirm('למחוק את התשלום?')) return;
    try { await api('DELETE', '/api/payment/' + del.dataset.delpay); toast('התשלום נמחק'); renderHome(); } catch (err) { toast(err.message); }
    return;
  }
  const c = e.target.closest('.card[data-id]');
  if (!c || tab === 'mine' || e.target.closest('.more')) return;
  openId = openId === c.dataset.id ? null : c.dataset.id; renderHome();
});

/* ================= BANK IMPORT ================= */
let IMP = null; let FILE = null;
$('#bankFile').onchange = (e) => { FILE = e.target.files[0]; $('#fromDate').value = ''; preview(); };
$('#reload').onclick = () => FILE && preview();
async function preview() {
  if (!FILE) return;
  const buf = await FILE.arrayBuffer();
  const from = $('#fromDate').value;
  try { IMP = await api('POST', '/api/import/preview?from=' + from, buf); } catch (e) { return toast(e.message); }
  if (!from && IMP.from) $('#fromDate').value = IMP.from;
  $('#impInfo').textContent = `בקובץ ${IMP.total} תנועות · כבר רשומות: ${IMP.known} · לפני ${IMP.from || '—'} (נחשבות כרשומות): ${IMP.before} · הפקדות חדשות לבדיקה: ${IMP.items.length}`;
  renderImp();
}
const allocText = (a) => a.map((x) => `${x.m}/${x.y}:${x.amount}`).join(', ');
function parseAlloc(t) { return t.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(\d{1,2})\/(\d{4}):(\d+(?:\.\d+)?)$/.exec(s); if (!m) throw new Error('פורמט חלוקה: 9/2026:570, 10/2026:570'); return { m: +m[1], y: +m[2], amount: +m[3] }; }); }
function renderImp() {
  $('#impCard').classList.toggle('hide', !IMP.items.length); $('#impActions').classList.toggle('hide', !IMP.items.length);
  $('#impTable').innerHTML = '<tr><th>✓</th><th>תאריך</th><th class="l">תיאור</th><th>סכום</th><th>דירה</th><th class="l">חלוקה לחודשים</th><th>זכור</th></tr>' +
    IMP.items.map((it, i) => `<tr class="${it.sure ? '' : 'warn'}" data-i="${i}">
    <td><input type="checkbox" class="sel" ${it.apt ? 'checked' : ''}></td>
    <td>${it.date.split('-').reverse().join('/')}</td>
    <td class="l">${esc(it.desc.slice(0, 70))}<div class="mute">${esc(it.how)}${it.sure ? '' : ' — לבדיקה'}</div></td>
    <td>${fmt(it.amount)}</td>
    <td><select class="apt"><option value="">—</option><option value="ignore">התעלם</option>${IMP.apartments.map((a) => `<option ${a == it.apt ? 'selected' : ''}>${a}</option>`).join('')}</select><div class="mute who2">${esc(it.tenant || '')}</div></td>
    <td class="l"><input class="al" style="width:230px" value="${allocText(it.allocations)}"></td>
    <td><input type="checkbox" class="learn" ${it.apt && !it.sure ? 'checked' : ''} title="זכור את הקישור הזה לפעם הבאה"></td></tr>`).join('');
}
$('#impTable').onchange = async (e) => {
  const tr = e.target.closest('tr'); if (!tr || !tr.dataset.i) return; const it = IMP.items[tr.dataset.i];
  if (e.target.classList.contains('apt')) {
    const v = e.target.value; it.apt = v && v !== 'ignore' ? +v : null; it.ignore = v === 'ignore';
    if (it.apt) {
      const r = await api('GET', `/api/allocate?apt=${it.apt}&amount=${it.amount}&date=${it.date}`);
      it.tenancy = r.key; it.tenant = r.tenant; it.allocations = r.allocations; tr.querySelector('.al').value = allocText(it.allocations); tr.querySelector('.who2').textContent = r.tenant;
    } else { tr.querySelector('.al').value = ''; tr.querySelector('.who2').textContent = ''; }
    tr.querySelector('.sel').checked = !!it.apt || it.ignore; tr.querySelector('.learn').checked = !!it.apt;
  }
};
$('#commit').onclick = async () => {
  const items = [];
  try {
    $$('#impTable tr[data-i]').forEach((tr) => {
      if (!tr.querySelector('.sel').checked) return;
      const it = IMP.items[tr.dataset.i];
      if (it.ignore) { items.push({ key: it.key, ignore: true }); return; }
      if (!it.apt) return;
      items.push({ key: it.key, tenancy: it.tenancy, date: it.date, desc: it.desc, amount: it.amount, ref: it.ref, refKey: it.refKey, apt: it.apt, allocations: parseAlloc(tr.querySelector('.al').value), payer: it.payer, learn: tr.querySelector('.learn').checked });
    });
    const r = await api('POST', '/api/import/commit', { items });
    toast(`נשמרו ${r.added} תשלומים, ${r.ignored} הותעלמו`);
    await preview();
  } catch (e) { toast(e.message); }
};

/* ================= PEOPLE ================= */
function syncAptField() { $('#uApt').style.display = $('#uRole').value === 'committee' ? 'none' : ''; }
$('#uRole').onchange = syncAptField;
async function loadUsers() {
  const g = BLD.grantable;
  $('#uRole').innerHTML = g.map((r) => `<option value="${r}">${ROLE[r]}</option>`).join('');
  syncAptField();
  $('#grantNote').textContent = g.includes('committee') ? 'אתם יכולים לתת את כל שלושת התפקידים.' : 'אתם יכולים להוסיף דיירים ובעלי דירות. הוספת חברי ועד נעשית על ידי מנהל הבניינים.';
  const m = await api('GET', '/api/members');
  $('#uTable').innerHTML = '<tr><th class="l">אימייל</th><th>תפקיד</th><th>דירה</th><th class="l">שם</th><th></th></tr>' +
    m.map((x) => { const can = g.includes(x.role);
      const aptCell = x.role === 'committee' ? '' : `<input type="number" min="1" style="width:70px" value="${x.apt || ''}" data-id="${x.id}" ${can && x.role !== 'apt_owner' ? '' : 'disabled'} title="הדירה המקושרת. לבעל דירה — מחיקה והוספה מחדש">`;
      return `<tr><td class="l" dir="ltr">${esc(x.email)}</td><td>${ROLE[x.role]}</td><td>${aptCell}</td><td class="l">${esc(x.name || '')}</td><td>${can && x.email !== ME.email ? `<button class="g" data-rm="${x.id}">הסר</button>` : ''}</td></tr>`; }).join('');
}
$('#uAdd').onclick = async () => {
  try { await api('POST', '/api/member', { email: $('#uEmail').value, role: $('#uRole').value, apt: $('#uApt').value, name: $('#uName').value }); ['#uEmail', '#uApt', '#uName'].forEach((i) => { $(i).value = ''; }); toast('נוסף'); loadUsers(); } catch (e) { toast(e.message); }
};
$('#uTable').onchange = async (e) => { const i = e.target; if (!i.dataset.id) return; try { await api('PUT', '/api/member', { id: i.dataset.id, apt: i.value }); toast(i.value ? `קושרה דירה ${i.value}` : 'הקישור הוסר'); } catch (err) { toast(err.message); loadUsers(); } };
$('#uTable').onclick = async (e) => { const r = e.target.dataset.rm; if (!r || !confirm('להסיר את התפקיד?')) return; try { await api('DELETE', '/api/member/' + r); loadUsers(); } catch (err) { toast(err.message); } };

let PEOPLE = null;
async function loadPeople() {
  PEOPLE = await api('GET', '/api/people');
  $('#pB').innerHTML = '<option value="">כל הבניינים</option>' + ME.memberships.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  $('#peopleNote').textContent = ME.isSuper ? '' : ' כמנהל בניינים אתם רואים את האנשים בבניינים שלכם בלבד.';
  renderPeople();
}
function renderPeople() {
  const names = Object.fromEntries(ME.memberships.map((m) => [m.id, m.name]));
  const by = {}; const add = (e, r) => { (by[e] = by[e] || []).push(r); };
  for (const m of PEOPLE.members) add(m.email, { b: m.building_id, t: ROLE[m.role] + (m.apt ? ` · דירה ${m.apt}` : ''), k: m.role });
  for (const x of PEOPLE.managers) {
    if (!x.buildings.length) add(x.email, { b: null, t: 'מנהל בניינים (עדיין בלי בניין)', k: 'manager' });
    for (const b of x.buildings) add(x.email, { b, t: 'מנהל בניינים', k: 'manager' });
  }
  if (ME.isSuper) add(ME.email, { b: null, t: 'מנהל על · כל הבניינים', k: 'super' });
  const q = $('#pQ').value.trim().toLowerCase(); const fb = $('#pB').value; const multi = $('#pMulti').checked;
  const list = Object.entries(by).filter(([e, rs]) => (!q || e.includes(q)) && (!fb || rs.some((r) => String(r.b) === fb || r.k === 'super')) && (!multi || rs.length > 1))
    .sort((a, b) => (a[0] === ME.email ? -1 : b[0] === ME.email ? 1 : 0) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  $('#pCount').textContent = `${list.length} אנשים`;
  $('#pTable').innerHTML = '<tr><th class="l">אימייל</th><th class="l">תפקידים</th></tr>' + (list.map(([e, rs]) =>
    `<tr><td class="l" dir="ltr">${esc(e)}${e === ME.email ? ' <span class="mute">(אתם)</span>' : ''}</td><td class="l">` +
    rs.map((r) => (r.b ? `<a href="#" class="chip" data-open="${r.b}">${esc(names[r.b] || 'בניין ' + r.b)}: ${esc(r.t)}</a>` : `<span class="chip">${r.t}</span>`)).join(' ') + '</td></tr>').join('') || '<tr><td class="mute">אין אנשים להצגה</td></tr>');
}
['#pQ', '#pB', '#pMulti'].forEach((i) => { $(i).oninput = () => PEOPLE && renderPeople(); $(i).onchange = () => PEOPLE && renderPeople(); });
$('#pTable').onclick = (e) => { const a = e.target.closest('a[data-open]'); if (!a) return; e.preventDefault(); Vaad.choose(a.dataset.open); location.href = 'app.html' + Vaad.keep + '#people/users'; };

async function loadApts() {
  const d = await api('GET', '/api/apartments');
  let h = '<tr><th>דירה</th><th>קומה</th><th>חדרים</th><th>מ״ר</th><th class="l">דיירים (פעילים)</th><th>טלפון</th><th>חשבון בנק</th></tr>';
  d.apartments.forEach((a) => {
    const rs = d.residents.map((r, i) => ({ r, i })).filter((x) => x.r.apt === a.apt && x.r.status !== 'עזב');
    h += `<tr><td><b>${a.apt}</b></td><td>${esc(a.floor)}</td><td>${a.rooms ?? ''}</td><td>${a.sqm ?? ''}</td>` +
      `<td class="l">${rs.map((x) => `${esc(x.r.first)} ${esc(x.r.last)}${x.r.first2 ? ' ו' + esc(x.r.first2) : ''} <span class="mute">(${esc(x.r.role)})</span>`).join('<br>')}</td>` +
      `<td>${rs.map((x) => `<input data-i="${x.i}" data-k="phone1" value="${esc(x.r.phone1)}" style="width:110px">`).join('<br>')}</td>` +
      `<td>${rs.map((x) => `<input data-i="${x.i}" data-k="account" value="${esc(x.r.account)}" style="width:100px" title="מספר חשבון בנק של הדייר — משמש לזיהוי אוטומטי">`).join('<br>')}</td></tr>`;
  });
  $('#aptTable').innerHTML = h;
}
$('#aptTable').onchange = async (e) => { const i = e.target.dataset.i; if (i === undefined) return; try { await api('PUT', '/api/resident', { index: +i, patch: { [e.target.dataset.k]: e.target.value } }); toast('נשמר'); } catch (err) { toast(err.message); } };

/* ================= BUILDINGS (super user, managers) ================= */
function loadBuildings() {
  $('#bTable').innerHTML = '<tr><th>#</th><th class="l">שם</th><th class="l">התפקידים שלכם</th><th></th></tr>' +
    ME.memberships.map((m) => `<tr><td>${m.id}</td><td class="l"><input value="${esc(m.name)}" data-rename="${m.id}" ${m.manage ? '' : 'disabled'}></td><td class="l">${m.roles.map((r) => Vaad.ROLE_LABEL[r]).join(', ')}</td><td>${m.id === BLD.id ? '<span class="mute">פתוח עכשיו</span>' : `<button class="g" data-open="${m.id}">פתח</button>`}</td></tr>`).join('');
}
$('#bAdd').onclick = async () => { try { const b = await api('POST', '/api/building', { name: $('#bName').value }); Vaad.choose(b.id); Vaad.go('index.html'); } catch (e) { toast(e.message); } };
$('#bTable').onchange = async (e) => { const id = e.target.dataset.rename; if (!id) return; try { await api('PUT', '/api/building', { id, name: e.target.value }); const m = ME.memberships.find((x) => String(x.id) === id); if (m) m.name = e.target.value.trim(); toast('השם עודכן'); } catch (err) { toast(err.message); loadBuildings(); } };
$('#bTable').onclick = (e) => { const id = e.target.dataset.open; if (id) { Vaad.choose(id); Vaad.go('index.html'); } };

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

/* ================= MORE: what tenants see, backup ================= */
async function loadShare() { const s = await api('GET', '/api/settings'); $('#sTitle').value = s.title; $('#sNames').checked = s.showNames; $('#sDebt').checked = s.showDebt; }
$('#saveShare').onclick = async () => { try { await api('PUT', '/api/settings', { title: $('#sTitle').value, showNames: $('#sNames').checked, showDebt: $('#sDebt').checked }); $('#pubOut').textContent = 'נשמר, הדיירים רואים את העדכון.'; } catch (e) { toast(e.message); } };
const bkKey = () => 'vaad-lastbackup-' + BLD.id;
function showLastBackup() {
  let t = null; try { t = localStorage.getItem(bkKey()); } catch (e) { /* storage blocked */ }
  if (!t) { $('#lastBackup').textContent = 'עדיין לא הורדתם גיבוי במכשיר הזה.'; return; }
  const days = Math.floor((Date.now() - new Date(t)) / 86400000);
  $('#lastBackup').textContent = `גיבוי אחרון במכשיר הזה: ${t.slice(0, 10).split('-').reverse().join('/')}${days > 30 ? ' (לפני יותר מחודש)' : ''}`;
}
$('#dlBackup').onclick = async () => {
  try {
    const data = await api('GET', '/api/export');
    const payload = { app: 'vaad-backup', version: 1, exportedAt: new Date().toISOString(), ...data };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `vaad-backup-b${BLD.id}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    $('#backupOut').textContent = 'הורד: ' + Object.entries(data.tables).map(([k, v]) => `${k} ${v.length}`).join(' · ');
    try { localStorage.setItem(bkKey(), new Date().toISOString()); } catch (e) { /* storage blocked */ }
    showLastBackup();
  } catch (e) { toast(e.message); }
};

route();
})();
