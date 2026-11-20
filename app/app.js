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
const PLATFORM = ME.isSuper || ME.isManager;  // may see everyone's roles
const myApts = BLD.linkedApts;                // apartments linked to this login as tenant or apartment owner
const store = Vaad.store(BLD.id, ME);
let DB = null; let SNAP = null; let SVC = null;
try {
  if (STAFF) { DB = await store.load(); SVC = VaadLib.service.createService(DB, store, Vaad.perms(ME)); } else SNAP = await store.getBoard();
} catch (e) { document.body.innerHTML = '<div class="wrap">שגיאה בטעינה: ' + esc(e.message) + '</div>'; return; }
// viewing as an apartment owner: the board shows only that owner's apartments, as the database would give them
if (ME.viewAs && ME.viewAs.role === 'apt_owner' && SNAP && SNAP.grids) {
  SNAP = { ...SNAP, grids: Object.fromEntries(Object.entries(SNAP.grids).map(([y, rows]) => [y, rows.filter((r) => r.apt === ME.viewAs.apt)])) };
}
if (!STAFF && !SNAP) { document.body.innerHTML = '<div class="wrap">עדיין לא פורסם מידע. נסו שוב מאוחר יותר.</div>'; return; }
const api = (m, u, b) => SVC.call(m, u, b);

/* ---------- header ---------- */
document.body.classList.toggle('staff', STAFF);
$('#banner').innerHTML = '📍 ' + esc(BLD.name);
$('#banner').href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(BLD.name);
document.title = BLD.name;
$('#updated').textContent = STAFF ? '' : 'עודכן ' + SNAP.updated.split('-').reverse().join('/');

/* ---------- menu and routing: one flat list of screens, ← בית on every screen but home ---------- */
const SCREENS = [
  ['home', 'בית', '🏠', '', 'home'],
  ['summary', 'גבייה מול הוצאות', '📊', 'כספים', 'summary', () => STAFF],
  ['bank', 'תנועות בנק', '🏦', 'כספים', 'bank', () => STAFF],
  ['expenses', 'הוצאות', '🧾', 'כספים', 'expenses', () => STAFF],
  ['tariffs', 'תעריפים', '💰', 'כספים', 'tariffs', () => STAFF],
  ['apts', 'דירות', '🏘️', 'ניהול', 'people', () => STAFF],
  ['everyone', 'אנשים', '👥', 'ניהול', 'people', () => STAFF],
  ['share', 'מה הדיירים רואים', '📢', 'ניהול', 'more', () => STAFF],
  ['backup', 'גיבוי נתונים', '💾', 'ניהול', 'more', () => STAFF],
];
const PANE = { apts: 'p-apts', everyone: 'p-everyone', share: 'm-share', backup: 'm-backup' };
const LEGACY = { people: 'everyone', more: 'share' };   // old #people/users style addresses
const ALIAS = { users: 'everyone' };                                          // the old roles list is now the one people table
const screens = SCREENS.filter((x) => !x[5] || x[5]());
const LOAD = { home: () => renderHome(), tariffs: () => loadTariffs(), expenses: () => loadExpenses(), bank: () => loadBank(), summary: () => renderSummary(), apts: () => loadApts(), everyone: () => loadPeople(), share: () => loadShare(), backup: () => showLastBackup() };
let menuHtml = '<div class="mh"><span>תפריט</span><button id="mclose" aria-label="סגור">✕</button></div>'; let grp = null;
for (const x of screens) {
  if (x[3] !== grp) { grp = x[3]; if (grp) menuHtml += `<h4>${grp}</h4>`; }
  menuHtml += `<a href="#${x[0]}" data-k="${x[0]}"><b>${x[2]}</b> ${x[1]}</a>`;
}
// inside a building there is no switching; only the super user leaves it, for the platform page
menuHtml += '<h4>חשבון</h4><div class="who"><span dir="ltr">' + esc(ME.email) + '</span><br><span class="mute">' + BLD.roles.map((r) => Vaad.ROLE_LABEL[r]).join(', ') + '</span></div>' + (ME.isSuper ? '<a href="platform.html' + Vaad.keep + '"><b>🏢</b> בניינים</a><a href="#" id="mview"><b>👁️</b> צפייה כתפקיד אחר</a>' : '') + (ME.viewAs ? '<a href="#" id="mviewend"><b>↩</b> חזרה למנהל על</a>' : '') + '<a href="#" id="mout"><b>🚪</b> יציאה</a>';
$('#menu').innerHTML = menuHtml;
const setMenu = (on) => document.body.classList.toggle('mopen', on);
$('#mbtn').onclick = () => setMenu(true);
$('#menu').onclick = (e) => {
  const a = e.target.closest('a'); const c = e.target.closest('#mclose');
  if (c) return setMenu(false);
  if (!a) return;
  if (a.id === 'mout') { e.preventDefault(); return Vaad.signOut(); }
  if (a.id === 'mview') { e.preventDefault(); setMenu(false); return openViewAs(); }
  if (a.id === 'mviewend') { e.preventDefault(); Vaad.setViewAs(null); return (location.href = 'app.html' + Vaad.keep); }
  setMenu(false);
};

/* ---------- the super user experiences the app as another role ---------- */
if (ME.viewAs) {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:sticky;top:0;z-index:50;background:#7c3aed;color:#fff;padding:8px 12px;font-size:14px;text-align:center';
  bar.innerHTML = `👁️ אתם צופים כ<b>${esc(ME.viewAs.label)}</b> · פעולות נשמרות באמת · <a href="#" id="vaEnd" style="color:#fff;text-decoration:underline">חזרה למנהל על</a>`;
  document.body.prepend(bar);
  $('#vaEnd').onclick = (e) => { e.preventDefault(); Vaad.setViewAs(null); location.href = 'app.html' + Vaad.keep; };
}
function openViewAs() {
  const apts = DB ? DB.apartments.map((a) => a.apt) : [];
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';
  box.innerHTML = `<div class="box pad" style="max-width:340px;width:100%"><h3>צפייה כתפקיד אחר</h3>
    <div class="mute">תראו את האפליקציה כפי שהתפקיד רואה אותה. הפעולות נשמרות באמת.</div>
    <div class="row"><select id="vaRole">${Object.entries(Vaad.VIEW_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <select id="vaApt" class="hide">${apts.map((a) => `<option>${a}</option>`).join('')}</select></div>
    <div class="row"><button class="b" id="vaGo">צפו</button><button class="g" id="vaCancel">ביטול</button></div></div>`;
  document.body.append(box);
  const sync = () => box.querySelector('#vaApt').classList.toggle('hide', !['tenant', 'apt_owner'].includes(box.querySelector('#vaRole').value));
  box.querySelector('#vaRole').onchange = sync;
  box.querySelector('#vaCancel').onclick = () => box.remove();
  box.querySelector('#vaGo').onclick = () => {
    const role = box.querySelector('#vaRole').value;
    const apt = ['tenant', 'apt_owner'].includes(role) ? +box.querySelector('#vaApt').value : null;
    Vaad.setViewAs({ b: BLD.id, role, apt });
    location.href = 'app.html' + Vaad.keep;
  };
}

const homeTabs = [...(myApts.length ? ['mine'] : []), ...(BOARD ? ['debt', 'all'] : [])];
let sec = 'home'; let sub = ''; let tab = homeTabs[0];
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  let s = h[0] || 'home'; let u = h[1] || '';
  if (LEGACY[s]) s = u && PANE[u] ? u : LEGACY[s];
  if (ALIAS[s]) s = ALIAS[s];
  if (!screens.find((x) => x[0] === s)) s = 'home';
  if (s === 'home') { if (!homeTabs.includes(u)) u = homeTabs.includes(tab) ? tab : homeTabs[0]; tab = u; } else u = '';
  sec = s; sub = u;
  const def = screens.find((x) => x[0] === s);
  $$('#menu a[data-k]').forEach((a) => a.classList.toggle('on', a.dataset.k === s));
  ['home', 'bank', 'summary', 'expenses', 'tariffs', 'people', 'more'].forEach((k) => $('#sec-' + k).classList.toggle('hide', k !== def[4]));
  Object.entries(PANE).forEach(([k, id]) => $('#' + id).classList.toggle('hide', k !== s));
  document.body.classList.toggle('wide', s === 'bank');   // the bank table has many columns: it may use the whole width
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
$('#mlabels').innerHTML = MN.map((m, i) => `<span title="${MF[i]}">${i + 1}</span>`).join('');
$$('.tab').forEach((b) => { b.hidden = !homeTabs.includes(b.dataset.t); });
if (homeTabs.includes('mine')) $('.tab[data-t="mine"]').textContent = myApts.length > 1 ? 'הדירות שלי' : 'הדירה שלי';

function rowsFor(y) {
  if (STAFF) {
    const g = calc.grid(DB, y); const cnt = {}; g.forEach((r) => { cnt[r.apt] = (cnt[r.apt] || 0) + 1; });
    return g.map((r) => ({ apt: r.apt, key: r.key, name: r.name, tag: cnt[r.apt] > 1 ? (r.left ? 'דייר קודם' : 'דייר נוכחי') : undefined, left: r.left, debt: r.debt, balance: r.balance, months: r.months.map((c) => c.status), cells: r.months, vacant: r.vacant }));
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
  if (r.vacant) return '<span class="badge b-old">ללא דייר</span>';
  const cur = r.months[now.m - 1];
  if (r.debt > 0) return `<span class="badge ${cur === 'partial' ? 'b-warn' : 'b-bad'}">חוב ${fmt(r.debt)} ₪</span>`;
  if (r.debt === undefined && isOwing(r)) return '<span class="badge b-bad">חסר תשלום</span>';
  if (r.left) return '<span class="badge b-old">שולם</span>';
  if (cur === 'pending' && year === now.y) return '<span class="badge b-wait">ממתין לחודש זה</span>';
  if (r.months.includes('prepaid')) return '<span class="badge b-pre">שולם מראש</span>';
  return '<span class="badge b-ok">שולם</span>';
}
function missing(r) {
  if (r.vacant) return '';
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
    (list.some((p) => !p.date) ? '<div class="foot">תשלומים ישנים מוצגים בלי תאריך.</div>' : '') + '</div>';
}
// full detail for whoever manages the building: exact amounts per month, balance, payments with dates, add and delete
function detailPanel(r) {
  if (r.vacant) return '<div class="pays"><div class="foot">אין דייר בדירה. הוסיפו דייר כדי לרשום תשלומים.</div></div>';
  const list = staffPayments(r, year);
  const cells = r.cells.filter((c) => c.status !== 'na');
  const total = list.reduce((s, p) => s + p.amount, 0);
  const bal = r.balance;
  const balTxt = bal > 0 ? `<b class="bad">חוב ${fmt(bal)} ₪</b>` : bal < 0 ? `<b class="good">זכות ${fmt(-bal)} ₪</b>` : '<b>מאוזן</b>';
  const pick = cells.find((c) => ['unpaid', 'partial', 'pending'].includes(c.status)) || cells.find((c) => c.m === now.m) || cells[0];
  const sugg = pick ? Math.max(0, pick.due - pick.paid) || pick.due : '';
  PAYROW[r.key] = { cells, pick, sugg };
  return `<div class="pays"><div class="balrow">יתרה כוללת: ${balTxt}</div>` +
    (cells.length ? `<h3>חודשים ב-${year}</h3><table class="p"><tr><th>חודש</th><th>לתשלום</th><th>שולם</th><th>מצב</th></tr>` +
      cells.map((c) => `<tr><td>${MF[c.m - 1]}</td><td class="n">${fmt(c.due)} ₪</td><td class="n">${fmt(c.paid)} ₪</td><td>${STATUS_TXT[c.status]}</td></tr>`).join('') + '</table>' : '') +
    `<h3>תשלומים ב-${year}</h3>` + (list.length
      ? '<table class="p"><tr><th>תאריך</th><th>עבור</th><th>סכום</th><th>אמצעי</th><th></th></tr>' +
        list.map((p) => `<tr><td>${fdate(p.date)}</td><td>${MN[p.m - 1]}</td><td class="n">${fmt(p.amount)} ₪</td><td title="${esc(p.note || '')}">${esc(p.method || '')}${p.src === 'bank' ? ' 🏦' : ''}</td><td><button class="g" data-delpay="${p.id}" aria-label="מחק">✕</button></td></tr>`).join('') +
        `<tr class="tot"><td colspan="2">סה״כ שולם</td><td class="n">${fmt(total)} ₪</td><td colspan="2"></td></tr></table>` +
        (list.some((p) => !p.date) ? '<div class="foot">תשלומים ישנים מוצגים בלי תאריך.</div>' : '')
      : `<div class="foot">אין תשלומים רשומים בשנת ${year}.</div>`) +
    `<div class="row"><button class="b" data-addpay="${esc(r.key)}">+ הוסף תשלום</button></div></div>`;
}
// recording a payment for one apartment (the apartment's open panel only shows a button): month, amount, method and date in a dialog
const PAYROW = {};   // apartment key -> the months and the suggested month and amount of its panel
function addPaymentDialog(key) {
  const c = PAYROW[key]; if (!c) return Promise.resolve(null);
  return Vaad.form({
    title: 'הוספת תשלום',
    ok: 'הוסף תשלום',
    fields: [
      { k: 'm', label: 'חודש', type: 'select', options: c.cells.map((x) => ({ v: String(x.m), t: MF[x.m - 1] })), value: c.pick ? String(c.pick.m) : undefined, row: 'for' },
      { k: 'amount', label: 'סכום ₪', type: 'number', width: 100, value: c.sugg, row: 'for' },
      { k: 'method', label: 'אמצעי תשלום', type: 'select', options: ['מזומן', 'שיק', 'העברה בנקאית', 'הוראת קבע'].map((t) => ({ v: t, t })), row: 'how' },
      { k: 'date', label: 'תאריך', type: 'date', value: new Date().toISOString().slice(0, 10), row: 'how' },
    ],
    onSubmit: (v) => api('POST', '/api/payment', { key, y: year, m: +v.m, amount: v.amount, method: v.method, date: v.date || null }),
  });
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
  return '<div class="pays"><h3>הדייר בדירה</h3>' + here.map((r) => `<div class="res"><div>${esc(r.first)} ${esc(r.last)}${r.first2 ? ` ו${esc(r.first2)} ${esc(r.last2 || r.last)}` : ''}${(r.others || []).map((o) => `, ${esc(o.first)} ${esc(o.last)}`).join('')}<small>${esc(r.role || '')}</small></div><div>${telLink(r.phone1)}${r.phone2 ? '<br>' + telLink(r.phone2) : ''}${(r.others || []).filter((o) => o.phone).map((o) => '<br>' + telLink(o.phone)).join('')}</div></div>`).join('') + '</div>';
}

let seq = 0;
// what a committee enters first in a new building; it disappears when all three are done
function renderChecklist() {
  const box = $('#checklist');
  const steps = STAFF ? [
    ['הגדירו תעריף חודשי', DB.tariffs.some((t) => !t.month && !t.apt), '#tariffs'],
    ['הוסיפו את הדיירים', DB.residents.length > 0, '#apts'],
    ['רשמו את בעלי הדירות', DB.owners.length > 0, '#apts'],
  ] : [];
  box.classList.toggle('hide', !steps.length || steps.every((x) => x[1]));
  box.classList.add('checklist');
  box.innerHTML = '<h3>להתחיל להפעיל את הבניין</h3><div class="mute">שלושה צעדים ראשונים:</div><ul style="padding-inline-start:20px;margin:8px 0 0">' +
    steps.map((x) => `<li class="${x[1] ? 'done' : ''}">${x[1] ? '✅' : '⬜'} <a href="${x[2]}">${x[0]}</a></li>`).join('') + '</ul>';
}
async function renderHome() {
  updatePend();
  renderChecklist();
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
  const all = rowsFor(year); const listed = all.filter((r) => !r.left); const current = listed.filter((r) => !r.vacant); const idx = now.m - 1;
  if (!STAFF && !all.length) {   // a building nobody has set up yet
    $('#sum').innerHTML = ''; $('#q').hidden = true; $('#mlabels').style.display = 'none'; $('#oldBox').style.display = 'none';
    $('#list').innerHTML = '<div class="empty">הבניין עוד לא הוגדר. כשהוועד ישלים, התשלומים יופיעו כאן.</div>';
    return;
  }
  const paidNow = current.filter((r) => ['paid', 'prepaid'].includes(r.months[idx])).length;
  const owing = new Set(all.filter(isOwing).map((r) => r.apt)).size;
  $('#sum').innerHTML = BOARD && year === now.y ? `<div><small>שילמו ${MF[idx]}</small><b>${paidNow} מתוך ${current.length}</b></div><div><small>דירות עם חוב</small><b class="${owing ? 'bad' : ''}">${owing}</b></div>` : '';
  if (STAFF && BOARD && year === now.y) refreshBankInfo().then((i) => { if (i && i.balance && !$('#balBox')) $('#sum').insertAdjacentHTML('beforeend', `<div id="balBox"><small>יתרת הבנק (${fdate(i.balance.date)})</small><b class="${i.balance.amount < 0 ? 'bad' : ''}">${fmt(i.balance.amount)} ₪</b></div>`); });
  $('#q').hidden = tab !== 'all';
  $('#mlabels').style.display = tab === 'mine' && !myApts.length ? 'none' : '';
  const my = ++seq;
  $('#oldBox').style.display = 'none';

  if (tab === 'mine') {
    if (!myApts.length) { $('#list').innerHTML = `<div class="empty">אין דירה מקושרת לחשבון הזה.<br>${BLD.grantable.includes('tenant') ? 'אפשר לקשר דירה בתפריט "אנשים".' : 'בקשו מוועד הבית לקשר את הדירה שלכם.'}</div>`; return; }
    const rowOf = (a) => listed.find((r) => r.apt === a);
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
  const cur = listed.filter(match).sort((a, b) => (isOwing(b) ? 1 : 0) - (isOwing(a) ? 1 : 0) || a.apt - b.apt);
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
  const ap = e.target.closest('[data-addpay]');
  if (ap) { if (await addPaymentDialog(ap.dataset.addpay)) { toast('התשלום נוסף'); renderHome(); } return; }
  const del = e.target.closest('[data-delpay]');
  if (del) {
    if (!(await Vaad.ask({ ok: 'מחק', text: 'למחוק את התשלום?' }))) return;
    try { await api('DELETE', '/api/payment/' + del.dataset.delpay); toast('התשלום נמחק'); renderHome(); } catch (err) { toast(err.message); }
    return;
  }
  const c = e.target.closest('.card[data-id]');
  if (!c || tab === 'mine' || e.target.closest('.more')) return;
  openId = openId === c.dataset.id ? null : c.dataset.id; renderHome();
});

/* ================= BANK FILE UPLOAD (review panel on the bank movements screen) ================= */
let IMP = null; let FILE = null;
$('#bankFile').onchange = (e) => { FILE = e.target.files[0]; preview(); };
// a file that is not loaded: say why where it stays visible, and forget it
function rejectFile(msg) {
  FILE = null; $('#bankFile').value = ''; IMP = null;
  $('#impCard').classList.add('hide'); $('#expCard').classList.add('hide'); $('#impActions').classList.add('hide');
  $('#impInfo').innerHTML = `<b class="bad">${esc(msg)}</b>`; toast(msg);
}
async function preview() {
  if (!FILE) return;
  const buf = await FILE.arrayBuffer();
  try { IMP = await api('POST', '/api/import/preview', buf); } catch (e) { return rejectFile(e.message); }
  if (IMP.needAccount) {   // the building has no bank account yet: the file's account becomes the building's account only if the user confirms it
    const a = IMP.needAccount;
    if (!(await Vaad.ask({ ok: 'קבע וטען', text: `לבניין עוד לא הוגדר חשבון בנק.\nהקובץ שייך לחשבון ${a.number}${a.name ? `\n(${a.name})` : ''}.\nלקבוע אותו כחשבון הבנק של הבניין ולטעון את הקובץ?` }))) return rejectFile('הקובץ לא נטען: חשבון הבנק של הבניין לא הוגדר.');
    try { await api('POST', '/api/bank/account', { account: a.number }); } catch (e) { return rejectFile(e.message); }
    return preview();
  }
  // a credit the server is not sure about waits for approval unless an apartment is picked here: the suggestion is only shown
  for (const it of IMP.items) if (!it.sure) { it.suggest = it.apt; it.apt = null; it.tenancy = null; it.tenant = ''; it.allocations = []; }
  $('#impInfo').textContent = `בקובץ ${IMP.total} תנועות · כבר רשומות: ${IMP.known} · לפני ${IMP.from || '—'} (נחשבות כרשומות): ${IMP.before} · הפקדות חדשות לבדיקה: ${IMP.items.length} · חיובים להוצאות: ${IMP.expenses.length}`;
  renderImp();
  await loadBank();
}
const allocText = (a) => a.map((x) => `${x.m}/${x.y}:${x.amount}`).join(', ');
function parseAlloc(t) { return t.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(\d{1,2})\/(\d{4}):(\d+(?:\.\d+)?)$/.exec(s); if (!m) throw new Error('פורמט חלוקה: 9/2026:570, 10/2026:570'); return { m: +m[1], y: +m[2], amount: +m[3] }; }); }
function renderImp() {
  $('#impCard').classList.toggle('hide', !IMP.items.length); $('#impActions').classList.toggle('hide', !IMP.items.length && !IMP.expenses.length);
  $('#expCard').classList.toggle('hide', !IMP.expenses.length);
  $('#expTable').innerHTML = '<tr><th>✓</th><th>תאריך</th><th class="l">תיאור בבנק</th><th>סכום</th></tr>' +
    IMP.expenses.map((x, i) => `<tr data-x="${i}"><td><input type="checkbox" class="xsel" checked></td><td>${fdate(x.date)}</td><td class="l">${esc(x.desc.slice(0, 90))}</td><td class="n">${fmt(x.amount)} ₪</td></tr>`).join('');
  $('#impTable').innerHTML = '<tr><th>✓</th><th>תאריך</th><th class="l">תיאור</th><th>סכום</th><th>דירה</th><th class="l">חלוקה לחודשים</th><th>זכור</th></tr>' +
    IMP.items.map((it, i) => `<tr class="${it.sure ? '' : 'warn'}" data-i="${i}">
    <td><input type="checkbox" class="sel" checked></td>
    <td>${it.date.split('-').reverse().join('/')}</td>
    <td class="l">${esc(it.desc.slice(0, 70))}<div class="mute">${esc(it.how)}${it.sure ? '' : ' — ימתין לאישור הוועד' + (it.suggest ? ` · הצעה: דירה ${it.suggest}` : '') + (it.candidates.length ? ` · דירות אפשריות: ${it.candidates.join(', ')}` : '')}</div></td>
    <td>${fmt(it.amount)}</td>
    <td><select class="apt"><option value="">—</option><option value="ignore">התעלם</option>${IMP.apartments.map((a) => `<option ${a == it.apt ? 'selected' : ''}>${a}</option>`).join('')}</select><div class="mute who2">${esc(it.tenant || '')}</div></td>
    <td class="l"><input class="al" style="width:230px" value="${allocText(it.allocations)}"></td>
    <td><input type="checkbox" class="learn" title="זכור את הקישור הזה לפעם הבאה"></td></tr>`).join('');
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
      if (!it.apt) { items.push({ key: it.key, date: it.date, desc: it.desc, amount: it.amount, ref: it.ref, refKey: it.refKey }); return; }   // no apartment: waits for approval
      items.push({ key: it.key, date: it.date, desc: it.desc, amount: it.amount, ref: it.ref, refKey: it.refKey, apt: it.apt, allocations: parseAlloc(tr.querySelector('.al').value), learn: tr.querySelector('.learn').checked });
    });
    $$('#expTable tr[data-x]').forEach((tr) => {
      if (!tr.querySelector('.xsel').checked) return;
      const x = IMP.expenses[tr.dataset.x];
      items.push({ key: x.key, refKey: x.refKey, ref: x.ref, date: x.date, desc: x.desc, amount: x.amount, expense: true });
    });
    const r = await api('POST', '/api/import/commit', { items });
    toast(`נשמרו ${r.added} תשלומים, ${r.pending} ממתינים לאישור, ${r.expenses} הוצאות, ${r.ignored} הותעלמו`);
    await preview(); updatePend();
  } catch (e) { toast(e.message); }
};

/* ================= BANK BALANCE (from the newest row of the bank file) ================= */
let BANKINFO = null;
async function refreshBankInfo() { if (!STAFF) return null; try { BANKINFO = await api('GET', '/api/bank/info'); } catch (e) { BANKINFO = null; } return BANKINFO; }
const balLine = (i) => (i && i.balance ? `${i.bank ? `בנק ${esc(i.bank)}, ` : ''}יתרת חשבון הבנק: <b class="${i.balance.amount < 0 ? 'bad' : 'good'}">${i.balance.amount < 0 ? '−' : ''}${fmt2(Math.abs(i.balance.amount))} ₪</b> <span class="mute">(לפי תנועות הבנק עד ${fdate(i.balance.date)})</span>` : '');

/* ================= COLLECTED VERSUS SPENT ================= */
function renderSummary() {
  refreshBankInfo().then((i) => { $('#sumBal').innerHTML = balLine(i); });
  const rows = calc.yearlySummary(DB);
  const tot = rows.reduce((t, r) => ({ collected: t.collected + r.collected, spent: t.spent + r.spent }), { collected: 0, spent: 0 });
  const bal = (n) => `<b class="${n < 0 ? 'bad' : 'good'}">${n < 0 ? '−' : ''}${fmt(Math.abs(n))} ₪</b>`;
  $('#sumTable').innerHTML = '<tr><th>שנה</th><th>נגבה</th><th>הוצא</th><th>הפרש</th></tr>' +
    (rows.length ? rows.map((r) => `<tr><td>${r.y}${r.y > now.y ? ' <span class="mute" title="שנה עתידית: כנראה טעות הקלדה בתשלום">⚠️</span>' : ''}</td><td class="n">${fmt(r.collected)} ₪</td><td class="n">${fmt(r.spent)} ₪</td><td class="n">${bal(r.collected - r.spent)}</td></tr>`).join('') +
      `<tr class="tot"><td>סה״כ</td><td class="n">${fmt(tot.collected)} ₪</td><td class="n">${fmt(tot.spent)} ₪</td><td class="n">${bal(tot.collected - tot.spent)}</td></tr>`
      : '<tr><td colspan="4" class="empty">עוד אין תשלומים או הוצאות.</td></tr>');
  const n = DB.pending.length;
  $('#sumNote').innerHTML = n ? `${n} ${n === 1 ? 'תשלום ממתין' : 'תשלומים ממתינים'} לאישור ולכן לא נספרים בסיכום. <a href="#bank" data-kind="pending">לאישור</a>` : '';
}

/* ================= BANK RECORDS (every uploaded row, as the bank wrote it) ================= */
let bList = []; let wantKind = ''; let wantYear = '';
// the year to open for the waiting credits: this year when one of them is from it, else the newest year they come from
const pendingYear = () => {
  const ys = DB.pending.map((p) => String(p.date || p.txKey || '').slice(0, 4)).filter((y) => /^\d{4}$/.test(y)).sort();
  return ys.includes(String(new Date().getFullYear())) ? String(new Date().getFullYear()) : (ys.pop() || '');
};
const pendApt = (it) => { const m = /^הצעה: דירה (\d+)/.exec(it.autoComment || ''); return m ? +m[1] : ''; };
const pendOf = (r) => DB.pending.find((p) => p.txKey === r.key);
const refKeyOf = (r) => { const n = parseInt(r.ref, 10); return isNaN(n) ? null : `${r.date.slice(0, 4)}|${n}`; };
const B_KIND = { payment: 'נרשמה כתשלום', pending: 'ממתינה לאישור', expense: 'נרשמה כהוצאה', ignored: 'הותעלמה', earlier: 'נרשמה קודם (אקסל)', cancelled: 'שיק שהופקד ובוטל', none: 'עוד לא יובאה' };
async function loadBank() {
  bList = await api('GET', '/api/bank');
  refreshBankInfo().then((i) => { $('#bBal').innerHTML = balLine(i); });
  const years = [...new Set(bList.map((r) => +r.date.slice(0, 4)))].sort((a, b) => b - a);
  const keep = { y: wantYear || $('#bYear').value, m: wantYear ? '' : $('#bMonth').value, k: wantKind || $('#bKind').value }; wantKind = ''; wantYear = '';
  $('#bYear').innerHTML = years.map((y) => `<option>${y}</option>`).join('');
  $('#bMonth').innerHTML = '<option value="">כל החודשים</option>' + MF.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const cnt = (k) => bList.filter((r) => r.status.kind === k).length;
  $('#bKind').innerHTML = `<option value="">כל המצבים (${bList.length})</option>` + Object.entries(B_KIND).map(([k, v]) => `<option value="${k}">${v} (${cnt(k)})</option>`).join('');
  // the current year unless the user picked another; with no rows this year, the newest year there is
  $('#bYear').value = keep.y && years.includes(+keep.y) ? keep.y : String(years.includes(new Date().getFullYear()) ? new Date().getFullYear() : (years[0] || '')); $('#bMonth').value = keep.m || ''; $('#bKind').value = keep.k || '';
  renderBank();
}
const fmt2 = (n) => n.toLocaleString('he-IL', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
function renderBank() {
  const y = $('#bYear').value; const m = $('#bMonth').value; const k = $('#bKind').value; const dir = $('#bDir').value; const q = $('#bQ').value.trim();
  const rows = bList.filter((r) => (!y || r.date.slice(0, 4) === y) && (!m || +r.date.slice(5, 7) === +m) && (!k || r.status.kind === k)
    && (!dir || (dir === 'in' ? r.amount > 0 : r.amount < 0)) && (!q || r.desc.includes(q) || String(r.ref).includes(q)));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.amount, 0);
  $('#bTotal').textContent = bList.length ? `${rows.length} מתוך ${bList.length} שורות · הכנסות ${fmt2(sum((r) => r.amount > 0))} ₪ · הוצאות ${fmt2(-sum((r) => r.amount < 0))} ₪` : '';
  const orphan = DB.pending.filter((p) => !bList.some((r) => r.key === p.txKey)).length;
  if (orphan) $('#bTotal').textContent += ` · ${orphan} ${orphan === 1 ? 'תשלום ממתין' : 'תשלומים ממתינים'} שהשורה שלהם לא נשמרה: העלו שוב את קובץ הבנק.`;
  const what = (s) => {
    if (s.kind === 'payment') return `${B_KIND.payment}: דירה ${s.apts.join(', ')} <span class="mute">(${s.months.join(', ')})</span>`;
    if (s.kind === 'pending') return `<b class="bad">${B_KIND.pending}</b>`;
    if (s.kind === 'expense') return `<a href="#expenses">${B_KIND.expense}</a>`;
    if (s.kind === 'cancelled') return `${B_KIND.cancelled} <span class="mute">(${s.deposit ? 'ההפקדה בוטלה' : 'ביטול של הפקדה'} — לא הכנסה ולא הוצאה)</span>${s.warn ? ' <b class="bad">⚠ ההפקדה כבר נרשמה — יש לבטל את הרישום</b>' : ''}`;
    if (s.kind === 'earlier' && s.expense) return `${B_KIND.earlier}: הוצאה${s.expense.category ? ' — ' + esc(s.expense.category) : ''}`;
    return s.kind === 'none' ? `<b class="bad">${B_KIND.none}</b>` : B_KIND[s.kind];
  };
  const dm = (d) => (d ? d.split('-').reverse().join('/') : '');
  $('#bankTable').innerHTML = '<tr><th>תאריך</th><th>יום ערך</th><th class="l">תיאור</th><th>זכות/חובה</th><th>יתרה</th><th>אסמכתא</th><th>עמלה</th><th>ערוץ</th><th class="l">מה קרה</th></tr>' +
    (rows.length ? rows.map((r) => `<tr data-k="${esc(r.key)}" title="הועלה ${esc((r.uploadedAt || '').slice(0, 10))} ${esc(r.uploadedBy || '')}"><td>${dm(r.date)}</td><td>${dm(r.valueDate)}</td><td class="l">${esc(r.desc)}</td><td class="n"><b class="${r.amount < 0 ? 'bad' : 'good'}">${r.amount < 0 ? '−' : ''}${fmt2(Math.abs(r.amount))}</b></td><td class="n">${r.balance === null || r.balance === undefined ? '' : fmt2(r.balance)}</td><td>${esc(r.ref)}</td><td>${esc(r.fee)}</td><td>${esc(r.channel)}</td><td class="l">${what(r.status)}</td></tr>${bankAct(r) ? `<tr data-k="${esc(r.key)}"><td colspan="9" class="l actrow">${bankAct(r)}</td></tr>` : ''}`).join('')
      : `<tr><td colspan="9" class="empty">${bList.length ? 'אין שורות שמתאימות לסינון.' : 'עוד לא הועלה קובץ בנק.'}</td></tr>`);
}

// what can be done to a row: a waiting credit is approved or ignored; an unlinked credit is linked to an apartment (months split like in the upload review);
// an unrecorded debit is recorded as an expense; any of them can be ignored
function bankAct(r) {
  const s = r.status;
  const aptSel = (sel) => `<select class="apt"><option value="">דירה</option>${DB.apartments.map((a) => `<option ${a.apt === sel ? 'selected' : ''}>${a.apt}</option>`).join('')}</select>`;
  const learn = '<label class="mute"><input type="checkbox" class="learn"> זכור</label>';
  if (s.kind === 'pending') { const p = pendOf(r); return p ? `${aptSel(pendApt(p))} ${learn} <button class="b ok">אשר</button> <button class="g ign">התעלם</button>` : ''; }
  if (s.kind === 'none' && r.amount > 0) return `${aptSel('')} <input class="al" placeholder="9/2026:570, 10/2026:570" style="width:190px"> ${learn} <button class="b lnk">קשר</button> <button class="g ign">התעלם</button>`;
  if (s.kind === 'none' && r.amount < 0) return '<button class="b exp">רשום כהוצאה</button> <button class="g ign">התעלם</button>';
  return '';
}
$('#bankTable').onchange = async (e) => {
  const tr = e.target.closest('tr[data-k]'); if (!tr || !e.target.classList.contains('apt') || !tr.querySelector('.al')) return;
  const r = bList.find((x) => x.key === tr.dataset.k); const apt = +e.target.value;
  if (!apt) { tr.querySelector('.al').value = ''; return; }
  try { const a = await api('GET', `/api/allocate?apt=${apt}&amount=${r.amount}&date=${r.date}`); tr.querySelector('.al').value = allocText(a.allocations); } catch (err) { toast(err.message); }
};
$('#bankTable').onclick = async (e) => {
  const tr = e.target.closest('tr[data-k]'); const btn = e.target.closest('button'); if (!tr || !btn) return;
  const r = bList.find((x) => x.key === tr.dataset.k); const base = { key: r.key, date: r.date, desc: r.desc, ref: r.ref, refKey: refKeyOf(r) };
  const apt = +(tr.querySelector('.apt') || {}).value; const learn = !!(tr.querySelector('.learn') || {}).checked;
  try {
    if (btn.classList.contains('ok')) {
      if (!apt) return toast('בחרו דירה');
      await api('POST', '/api/pending/approve', { id: pendOf(r).id, apt, learn }); toast('התשלום אושר ונרשם');
    } else if (btn.classList.contains('ign')) {
      if (r.status.kind === 'pending') await api('POST', '/api/pending/ignore', { id: pendOf(r).id });
      else await api('POST', '/api/import/commit', { items: [{ key: r.key, ignore: true }] });
      toast('השורה הותעלמה');
    } else if (btn.classList.contains('lnk')) {
      if (!apt) return toast('בחרו דירה');
      const al = parseAlloc(tr.querySelector('.al').value); if (!al.length) return toast('חסרה חלוקה לחודשים');
      await api('POST', '/api/import/commit', { items: [{ ...base, amount: r.amount, apt, allocations: al, learn }] }); toast('התשלום נרשם');
    } else if (btn.classList.contains('exp')) {
      await api('POST', '/api/import/commit', { items: [{ ...base, amount: -r.amount, expense: true }] }); toast('נרשם כהוצאה');
    } else return;
    if (FILE) await preview(); else await loadBank();   // the upload review above must not keep offering what was just handled here
    updatePend();
  } catch (err) { toast(err.message); }
};
document.addEventListener('click', (e) => { if (e.target.closest('#pendBadge, [data-kind="pending"]')) { wantKind = 'pending'; wantYear = pendingYear(); } });
['#bYear', '#bMonth', '#bKind', '#bDir'].forEach((id) => { $(id).onchange = renderBank; }); $('#bQ').oninput = renderBank;

/* ================= EXPENSES (read-only) ================= */
let xList = [];
async function loadExpenses() {
  xList = await api('GET', '/api/expenses');
  const years = [...new Set(xList.map((e) => e.y))].sort((a, b) => b - a);
  if (!years.length) years.push(now.y);
  const keepY = $('#xYear').value;
  $('#xYear').innerHTML = years.map((y) => `<option>${y}</option>`).join('');
  $('#xYear').value = years.includes(+keepY) ? keepY : years[0];
  const keepC = $('#xCat').value;
  const cats = [...new Set(xList.map((e) => e.category || ''))].sort((a, b) => a.localeCompare(b, 'he'));
  $('#xCat').innerHTML = '<option value="__all">כל הקטגוריות</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c || 'ללא קטגוריה')}</option>`).join('');
  $('#xCat').value = cats.includes(keepC) || keepC === '__all' ? keepC : '__all';
  renderExpenses();
}
function renderExpenses() {
  const y = +$('#xYear').value; const cat = $('#xCat').value;
  const rows = xList.filter((e) => e.y === y && (cat === '__all' || (e.category || '') === cat))
    .sort((a, b) => a.m - b.m || (a.d || 0) - (b.d || 0) || a.id - b.id);
  const sum = (l) => l.reduce((s, e) => s + e.amount, 0);
  $('#xTotal').textContent = `סה״כ ${y}: ${fmt(sum(rows))} ₪ · ${rows.length} הוצאות`;
  let h = '<tr><th>תאריך</th><th class="l">קטגוריה</th><th class="l">תיאור</th><th>סכום</th><th>אמצעי</th><th class="l">הערה</th></tr>';
  for (let m = 1; m <= 12; m++) {
    const ms = rows.filter((e) => e.m === m); if (!ms.length) continue;
    h += `<tr><td colspan="6" class="l"><b>${MF[m - 1]}</b> <span class="mute">· ${fmt(sum(ms))} ₪</span></td></tr>`;
    h += ms.map((e) => `<tr><td>${e.d ? `${String(e.d).padStart(2, '0')}/${String(e.m).padStart(2, '0')}` : '—'}</td><td class="l">${esc(e.category)}</td><td class="l">${esc(e.desc)}${e.source === 'bank' ? ' 🏦' : ''}</td><td class="n">${fmt(e.amount)} ₪</td><td>${esc(e.method)}</td><td class="l"><input class="xc" data-id="${e.id}" value="${esc(e.comment)}" placeholder="הערה" style="width:170px"></td></tr>`).join('');
  }
  $('#xTable').innerHTML = rows.length ? h : '<tr><td class="empty">אין הוצאות בשנה ובקטגוריה שנבחרו.</td></tr>';
}
$('#xTable').onchange = async (e) => {
  const inp = e.target.closest('.xc'); if (!inp) return;
  try { await api('PUT', '/api/expense', { id: inp.dataset.id, comment: inp.value }); toast('ההערה נשמרה'); } catch (err) { toast(err.message); }
};
$('#xYear').onchange = renderExpenses; $('#xCat').onchange = renderExpenses;

/* ================= TARIFFS ================= */
const tariffWhat = (t) => (t.month ? `תוספת ל${MF[t.month - 1]}${t.apt ? `, דירה ${t.apt}` : ', כל הדירות'}` : t.apt ? `תעריף מיוחד לדירה ${t.apt}` : 'תעריף בסיס');
// add a tariff, or (with t) change the amount and note of an existing one: setting the same tariff again replaces it
function tariffDialog(t) {
  const aptOpts = (first) => [{ v: '', t: first }, ...DB.apartments.map((a) => ({ v: String(a.apt), t: String(a.apt) }))];
  const save = (v, ident) => api('POST', '/api/tariff', { ...ident, amount: v.amount, note: v.note });
  if (t) {
    return Vaad.form({
      title: 'עריכת תעריף',
      fields: [
        { k: 'what', type: 'note', text: () => `${tariffWhat(t)}, שנת ${t.year}` },
        { k: 'amount', label: 'סכום ₪', type: 'number', width: 100, value: t.amount, row: 'value' },
        { k: 'note', label: 'הערה (לא חובה)', width: 200, value: t.note || '', row: 'value' },
      ],
      onSubmit: (v) => save(v, { year: t.year, month: t.month || '', apt: t.apt || '' }),
    });
  }
  return Vaad.form({
    title: 'תעריף חדש',
    ok: 'שמור',
    fields: [
      { k: 'kind', label: 'סוג', type: 'select', options: [{ v: 'base', t: 'תעריף בסיס לשנה' }, { v: 'apt', t: 'תעריף מיוחד לדירה' }, { v: 'extra', t: 'תוספת חד-פעמית לחודש' }], row: 'what' },
      { k: 'year', label: 'שנה', type: 'number', width: 90, value: now.y, row: 'what' },
      { k: 'month', label: 'חודש', type: 'select', options: MF.map((m, i) => ({ v: String(i + 1), t: m })), show: (v) => v.kind === 'extra', row: 'what' },
      { k: 'aptA', label: 'דירה', type: 'select', options: aptOpts('בחרו דירה'), show: (v) => v.kind === 'apt', row: 'what' },
      { k: 'aptX', label: 'דירה', type: 'select', options: aptOpts('כל הדירות'), show: (v) => v.kind === 'extra', row: 'what' },
      { k: 'amount', label: 'סכום ₪', type: 'number', width: 100, row: 'value' },
      { k: 'note', label: 'הערה (לא חובה)', width: 200, row: 'value' },
      { k: 'hint', type: 'note', text: () => 'הגדרה חוזרת משנה את הסכום הקיים.' },
    ],
    onSubmit: (v) => {
      if (v.kind === 'apt' && !v.aptA) throw new Error('בחרו דירה');
      return save(v, { year: v.year, month: v.kind === 'extra' ? v.month : '', apt: v.kind === 'apt' ? v.aptA : v.kind === 'extra' ? v.aptX : '' });
    },
  });
}
async function loadTariffs() {
  const list = await api('GET', '/api/tariffs');
  TARIFFS = list;
  const rows = [...list].sort((a, b) => b.year - a.year || (a.month || 0) - (b.month || 0) || (a.apt || 0) - (b.apt || 0));
  $('#tTable').innerHTML = '<tr><th>שנה</th><th class="l">מה</th><th>סכום</th><th class="l">הערה</th><th></th></tr>' +
    (rows.length ? rows.map((t) => `<tr><td>${t.year}</td><td class="l">${tariffWhat(t)}</td><td class="n">${fmt(t.amount)} ₪</td><td class="l mute">${esc(t.note)}</td><td><button class="g" data-edtr="${t.id}" aria-label="עריכה">✎ עריכה</button> <button class="g" data-deltar="${t.id}" aria-label="מחק">✕</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">עוד לא הוגדרו תעריפים.</td></tr>');
}
let TARIFFS = [];
$('#tNew').onclick = async () => { if (await tariffDialog(null)) { toast('התעריף נשמר'); loadTariffs(); } };
$('#tTable').onclick = async (e) => {
  const ed = e.target.closest('[data-edtr]');
  if (ed) { const t = TARIFFS.find((x) => String(x.id) === ed.dataset.edtr); if (t && await tariffDialog(t)) { toast('התעריף נשמר'); loadTariffs(); } return; }
  const b = e.target.closest('[data-deltar]'); if (!b) return;
  try { await api('DELETE', '/api/tariff/' + b.dataset.deltar); toast('נמחק'); loadTariffs(); } catch (err) { toast(err.message); }
};

/* ================= WAITING PAYMENTS: the counter on the home screen (they are approved on the bank movements screen) ================= */
function updatePend() {
  const n = DB ? DB.pending.length : 0; const b = $('#pendBadge');
  b.classList.toggle('hide', !n);
  b.textContent = `⏳ ${n} ${n === 1 ? 'תשלום ממתין' : 'תשלומים ממתינים'} לאישור`;
}

/* ================= PEOPLE ================= */
// A person of the users table (the super user adds and edits them): name, phone, email and bank accounts.
function personDialog(u) {
  const edit = !!u; const val = (k) => (edit ? u[k] || '' : '');
  const canCommittee = BLD.grantable.includes('committee');   // whoever may give the committee role
  const cm = edit && u.id ? PEOPLE.members.find((m) => m.building_id === BLD.id && m.user_id === u.id && m.role === 'committee') : null;
  return Vaad.form({
    title: edit ? `עריכת ${(val('first') + ' ' + val('last')).trim() || val('email') || 'אדם'}` : 'הוספת אדם',
    ok: edit ? 'שמור' : 'הוסף',
    fields: [
      { k: 'first', label: 'שם פרטי', width: 110, value: val('first'), row: 'name' },
      { k: 'last', label: 'שם משפחה', width: 120, value: val('last'), row: 'name' },
      { k: 'phone', label: 'טלפון', type: 'tel', width: 120, ltr: true, value: val('phone'), row: 'contact' },
      { k: 'email', label: 'אימייל (לא חובה)', type: 'email', width: 220, ltr: true, value: val('email'), row: 'contact' },
      { k: 'emailNote', type: 'note', text: () => 'אימייל נותן כניסה לדירות של האדם.' },
      { k: 'account', label: 'חשבונות בנק (מופרדים בפסיק)', width: 200, ltr: true, value: val('account') },
      ...(canCommittee ? [{ k: 'committee', label: 'חבר ועד (דורש אימייל)', type: 'check', value: !!cm, show: (v) => !!(v.email || '').trim() || !!cm }] : []),
    ],
    onSubmit: async (v) => {
      if (!edit) await api('POST', '/api/user', v);
      else {
        const patch = {};   // only what changed, so an untouched old-format phone is not rewritten
        for (const k of ['first', 'last', 'phone', 'email', 'account']) if ((v[k] || '').trim() !== val(k)) patch[k] = v[k];
        if (Object.keys(patch).length) await api('PUT', '/api/user', { id: u.id, patch });
      }
      const em = (v.email || '').trim();
      if (canCommittee && v.committee && em && !cm) await api('POST', '/api/member', { email: em, role: 'committee', apt: '' });
      else if (canCommittee && !v.committee && cm) await api('DELETE', '/api/member/' + cm.id);
    },
  });
}
$('#pNew').onclick = async () => { if (await personDialog(null)) { toast('נוסף'); loadPeople(); } };

/* One table of people: each person once, with every tie they have (apartments owned, apartments rented, app access) */
let PEOPLE = null;
async function loadPeople() {
  const g = BLD.grantable;
  $('#pNew').classList.toggle('hide', !ME.isSuper);
  PEOPLE = await api('GET', '/api/people');
  $('#peopleNote').textContent = '';
  renderPeople();
}
const PEXP = new Set();   // people rows opened to show their details (a user id, or the email of a login without a user row)
function renderPeople() {
  const names = Object.fromEntries(ME.memberships.map((m) => [m.id, m.name]));
  const here = {};                      // user id -> ties in THIS building from the records (owners, tenancies)
  const tie = (id, t) => { if (id) (here[id] = here[id] || []).push(t); };
  DB.owners.forEach((o) => tie(o.userId, { b: BLD.id, t: `בעל דירה ${o.apt}`, k: 'owner', apt: o.apt }));
  DB.residents.forEach((r) => { const gone = r.status === 'עזב'; tie(r.userId, { b: BLD.id, t: `דייר ${r.apt}${gone ? ' (עזב)' : ''}`, k: gone ? 'old' : 'tenant', apt: r.apt }); tie(r.user2Id, { b: BLD.id, t: `דייר ${r.apt}${gone ? ' (עזב)' : ''}`, k: gone ? 'old' : 'tenant', apt: r.apt }); });
  const access = {};                    // user id -> app-access roles (any building)
  for (const m of PEOPLE.members.filter((x) => x.building_id === BLD.id)) (access[m.user_id] = access[m.user_id] || []).push({ b: m.building_id, t: ROLE[m.role] + (m.apt ? ` ${m.apt}` : ''), k: 'access', id: m.id, role: m.role });
  const chipsFor = (u) => {
    const rs = [...(here[u.id] || []), ...(access[u.id] || [])];
    const mg = u.email ? PEOPLE.managers.find((x) => x.email === u.email) : null;
    if (mg) { if (!mg.buildings.length) rs.push({ b: null, t: 'מנהל בניינים (עדיין בלי בניין)', k: 'manager' }); for (const b of mg.buildings.filter((x) => x === BLD.id)) rs.push({ b, t: 'מנהל בניינים', k: 'manager' }); }
    if (ME.isSuper && u.email && u.email === ME.email) rs.push({ b: null, t: 'מנהל על · כל הבניינים', k: 'super' });
    return rs;
  };
  const byEmail = {};
  const people = (PEOPLE.users || []).map((u) => { if (u.email) byEmail[u.email] = u; return { u, rs: chipsFor(u) }; });
  // logins that have no users row yet (a manager added by email, the super user): shown read-only
  for (const x of PEOPLE.managers) if (!byEmail[x.email]) { const u = { id: null, email: x.email, first: '', last: '', phone: '', account: '' }; byEmail[x.email] = u; people.push({ u, rs: chipsFor(u) }); }
  if (ME.isSuper && !byEmail[ME.email]) people.push({ u: { id: null, email: ME.email, first: '', last: '', phone: '', account: '' }, rs: [{ b: null, t: 'מנהל על · כל הבניינים', k: 'super' }] });
  const q = $('#pQ').value.trim().toLowerCase(); const fb = String(BLD.id); const who = $('#pWho').value;
  const isPast = (rs) => rs.length > 0 && rs.every((r) => r.k === 'old');
  const list = people.filter(({ u, rs }) => (!q || [u.first, u.last, u.email, u.phone].join(' ').toLowerCase().includes(q)) && (!fb || rs.some((r) => String(r.b) === fb || r.k === 'super')) && (rs.length || !fb) && (who === 'all' || (who === 'past') === isPast(rs)))
    .sort((a, c) => (a.u.email === ME.email ? -1 : c.u.email === ME.email ? 1 : 0) || (a.u.last + ' ' + a.u.first).localeCompare(c.u.last + ' ' + c.u.first, 'he') || (a.u.email || '').localeCompare(c.u.email || ''));
  $('#pCount').textContent = `${list.length} אנשים`;
  const cell = (u, k, ltr) => `<span${ltr ? ' dir="ltr"' : ''}>${esc(u[k]) || '<span class="mute">—</span>'}</span>`;
  const chip = (r, u) => {
    if (r.k === 'access') {
      const rm = r.b === BLD.id && BLD.grantable.includes(r.role) && u.email !== ME.email ? ` <a href="#" data-rm="${r.id}" title="הסר הרשאה" style="text-decoration:none">✕</a>` : '';
      return `<span class="chip">${r.b === BLD.id ? '' : esc(names[r.b] || 'בניין ' + r.b) + ': '}${esc(r.t)}${rm}</span>`;
    }
    return `<span class="chip${r.k === 'old' ? ' mute' : ''}">${esc(r.t)}</span>`;
  };
  const aptsOf = (rs, k) => [...new Set(rs.filter((r) => r.k === k).map((r) => r.apt))].sort((x, y) => x - y);
  const nums = (arr) => (arr.length ? arr.join(', ') : '<span class="mute">—</span>');
  const roles = (rs) => rs.filter((r) => r.k === 'super' || r.k === 'manager' || (r.k === 'access' && r.role === 'committee')).map((r) => (r.k === 'super' ? 'מנהל על' : r.k === 'manager' ? 'מנהל בניינים' : 'ועד')).join(' · ') || '<span class="mute">—</span>';
  const field = (label, html) => `<div><span class="mute">${label}:</span> ${html}</div>`;
  const detail = (u, rs) => {
    const acc = rs.filter((r) => r.k === 'access'); const old = rs.filter((r) => r.k === 'old');
    return '<tr class="xr"><td></td><td colspan="5" class="l"><div class="xd">' +
      field('אימייל', cell(u, 'email', true)) + (ME.isSuper ? field('חשבונות בנק', cell(u, 'account', true)) : '') +
      (acc.length ? field('כניסה לאפליקציה', acc.map((r) => chip(r, u)).join(' ')) : u.email ? field('כניסה לאפליקציה', '<span class="mute">אין (לאימייל אין דירה או תפקיד)</span>') : '') +
      (old.length ? field('דיירים לשעבר', old.map((r) => chip(r, u)).join(' ')) : '') +
      '<div>' + (ME.isSuper && u.id ? `<button class="g" data-pe="${u.id}">✎ עריכה</button> ` : '') + '</div></div></td></tr>';
  };
  $('#pTable').innerHTML = '<tr><th></th><th class="l">שם</th><th class="l">טלפון</th><th class="l">דייר</th><th class="l">בעלים</th><th class="l">מנהל</th></tr>' + (list.map(({ u, rs }) => {
    const key = esc(String(u.id || u.email)); const open = PEXP.has(String(u.id || u.email));
    const name = (u.first + ' ' + u.last).trim();
    return `<tr class="pr" data-x="${key}"><td>${open ? '▾' : '◂'}</td><td class="l">${name ? esc(name) : u.email ? '<span dir="ltr">' + esc(u.email) + '</span>' : '<span class="mute">(ללא שם)</span>'}${u.email === ME.email ? ' <span class="mute">(אתם)</span>' : ''}</td><td class="l">${cell(u, 'phone', true)}</td><td class="l">${nums(aptsOf(rs, 'tenant'))}</td><td class="l">${nums(aptsOf(rs, 'owner'))}</td><td class="l">${roles(rs)}</td></tr>` + (open ? detail(u, rs) : '');
  }).join('') || '<tr><td class="mute">אין אנשים להצגה</td></tr>');
}
$('#pQ').oninput = () => PEOPLE && renderPeople();
$('#pWho').onchange = () => PEOPLE && renderPeople();
$('#pTable').onclick = async (e) => {
  const pe = e.target.closest('[data-pe]');
  if (pe) { if (await personDialog(PEOPLE.users.find((x) => String(x.id) === pe.dataset.pe))) { toast('נשמר'); loadPeople(); } return; }
  const rm = e.target.closest('a[data-rm]');
  if (rm) { e.preventDefault(); if (!(await Vaad.ask({ ok: 'הסר', text: 'להסיר את הרשאת הכניסה?' }))) return; try { await api('DELETE', '/api/member/' + rm.dataset.rm); loadPeople(); } catch (err) { toast(err.message); } return; }
  const px = e.target.closest('tr[data-x]');
  if (px) { const k = px.dataset.x; if (PEXP.has(k)) PEXP.delete(k); else PEXP.add(k); renderPeople(); }
};

/* ---------- apartments and the people in them: owners, tenants, or both; any number per apartment ---------- */
let APTS = null;   // the last GET /api/apartments
// everyone living in a tenancy: the first two people, then the others
const household = (r) => [
  ...(r.last || r.first ? [{ userId: r.userId, first: r.first, last: r.last, phone: r.phone1 }] : []),
  ...(r.last2 || r.first2 ? [{ userId: r.user2Id, first: r.first2, last: r.last2, phone: r.phone2 }] : []),
  ...(r.others || []),
];
const pname = (p) => `${p.first || ''} ${p.last || ''}`.trim();
const curTenancy = (apt) => (APTS ? APTS.residents.find((r) => r.apt === apt && r.status !== 'עזב') : null);
// The people of the apartments are added and edited in a dialog (Vaad.form); the table only shows them.
// A person is added to an apartment as a tenant, an owner or both; an email gives them a login (as the owner when they are one, otherwise as a tenant).
const monthOptions = MF.map((m, i) => ({ v: String(i + 1), t: m }));
function addPersonDialog(preApt) {
  const aptOpts = [{ v: '', t: 'בחרו דירה' }, ...APTS.apartments.map((a) => ({ v: String(a.apt), t: String(a.apt) }))];
  const curOf = (v) => (v.apt ? curTenancy(+v.apt) : null);
  return Vaad.form({
    title: preApt ? `הוספת אדם לדירה ${preApt}` : 'הוספת אדם לדירה',
    ok: 'הוסף',
    fields: [
      { k: 'apt', label: 'דירה', type: 'select', options: aptOpts, value: preApt ? String(preApt) : '' },
      { k: 'first', label: 'שם פרטי', width: 110, row: 'name' },
      { k: 'last', label: 'שם משפחה', width: 120, row: 'name' },
      { k: 'phone', label: 'טלפון', type: 'tel', width: 120, ltr: true, row: 'contact' },
      { k: 'email', label: 'אימייל לכניסה לאפליקציה (לא חובה)', type: 'email', width: 240, ltr: true, row: 'contact' },
      { k: 'tenant', label: 'דייר', type: 'check', value: true, row: 'kind' },
      { k: 'owner', label: 'בעל דירה', type: 'check', value: false, row: 'kind' },
      { k: 'info', type: 'note', text: (v) => { const cur = curOf(v); return !v.apt ? '' : cur ? `גרים כאן: ${household(cur).map(pname).join(', ')} (${cur.role}). אדם חדש יצטרף אליהם.` : 'אין דיירים בדירה.'; } },
      { k: 'em', label: 'חודש כניסה', type: 'select', options: monthOptions, value: String(now.m), show: (v) => v.apt && v.tenant && !curOf(v), row: 'entry' },
      { k: 'ey', label: 'שנה', type: 'number', width: 80, value: now.y, show: (v) => v.apt && v.tenant && !curOf(v), row: 'entry' },
    ],
    onSubmit: async (v) => {
      if (!v.apt) throw new Error('בחרו דירה');
      if (!v.tenant && !v.owner) throw new Error('בחרו אם האדם דייר, בעל דירה או שניהם');
      const who = { apt: v.apt, first: v.first, last: v.last, phone: v.phone };
      // the owner goes first, so a login created here is the same person the tenancy then finds
      if (v.owner) await api('POST', '/api/owner', { ...who, email: v.email });
      const login = v.owner ? {} : { email: v.email };
      if (v.tenant) {
        if (curTenancy(+v.apt)) await api('POST', '/api/household', { ...who, ...login });
        else await api('POST', '/api/tenancy', { ...who, ...login, role: v.owner ? 'בעלים' : 'שוכר', entryMonth: v.em, entryYear: v.ey, exitMonth: '', exitYear: '' });
      }
    },
  });
}
// one person of the table: the name and phone (and, for the super user, the bank account of the tenancy)
function editPersonDialog(p) {
  return Vaad.form({
    title: `עריכת ${pname(p) || 'אדם'}`,
    fields: [
      { k: 'first', label: 'שם פרטי', width: 110, value: p.first, row: 'name' },
      { k: 'last', label: 'שם משפחה', width: 120, value: p.last, row: 'name' },
      { k: 'phone', label: 'טלפון', type: 'tel', width: 120, ltr: true, value: p.phone },
      ...(ME.isSuper && p.resIndex !== undefined ? [{ k: 'account', label: 'חשבון בנק של הדיירות', width: 140, ltr: true, value: p.account, hint: 'לזיהוי תשלומים' }] : []),
      { k: 'note', type: 'note', text: () => 'אימייל וכניסה: במסך ״אנשים״.' },
    ],
    onSubmit: async (v) => {
      await api('PUT', '/api/person', { userId: p.userId, first: v.first, last: v.last, phone: v.phone });
      if (ME.isSuper && p.resIndex !== undefined && v.account !== (p.account || '')) await api('PUT', '/api/resident', { index: p.resIndex, patch: { account: v.account } });
    },
  });
}
function editAptDialog(a) {
  return Vaad.form({
    title: `פרטי דירה ${a.apt}`,
    fields: [
      { k: 'floor', label: 'קומה', width: 70, value: a.floor, row: 'details' },
      { k: 'rooms', label: 'חדרים', type: 'number', width: 70, value: a.rooms, row: 'details' },
      { k: 'sqm', label: 'מ״ר', type: 'number', width: 80, value: a.sqm, row: 'details' },
    ],
    onSubmit: (v) => api('PUT', '/api/apartment', { apt: a.apt, floor: v.floor, rooms: v.rooms, sqm: v.sqm }),
  });
}
let PERSONS = {};   // what the edit buttons of the table point at
async function loadApts() {
  const d = APTS = await api('GET', '/api/apartments');
  PERSONS = {};
  const btn = (cls, attr, label, text) => `<button class="${cls}" ${attr} aria-label="${label}">${text}</button>`;
  let h = '<tr><th>דירה</th><th>קומה</th><th>חדרים</th><th>מ״ר</th><th class="l">בעלים</th><th class="l">דיירים (פעילים)</th>' + (ME.isSuper ? '<th>חשבון בנק</th>' : '') + '<th></th></tr>';
  d.apartments.forEach((a) => {
    const rs = d.residents.map((r, i) => ({ r, i })).filter((x) => x.r.apt === a.apt && x.r.status !== 'עזב');
    const ph = (p) => (p.phone ? ` <span class="mute" dir="ltr">${esc(p.phone)}</span>` : '');
    const owners = d.owners.filter((o) => o.apt === a.apt).map((o) => {
      const id = 'o' + o.id; PERSONS[id] = { userId: o.userId, first: o.first, last: o.last, phone: o.phone };
      return `${esc(o.first)} ${esc(o.last)}${ph(o)} ${o.userId ? btn('g', `data-ep="${id}"`, 'עריכה', '✎') : ''} ${btn('g', `data-rmown="${o.id}"`, 'הסר', '✕')}`;
    });
    const people = rs.flatMap((x) => household(x.r).map((p, j, all) => {
      const id = `t${x.i}_${j}`; PERSONS[id] = { ...p, resIndex: x.i, account: x.r.account };
      return `${esc(pname(p))} <span class="mute">(${esc(x.r.role)})</span>${ph(p)}${p.userId ? ` ${btn('g', `data-ep="${id}"`, 'עריכה', '✎')}` : ''}${all.length > 1 && p.userId ? ` ${btn('g', `data-hrm="${esc(x.r.key)}|${p.userId}"`, 'הסר מהדירה', '✕')}` : ''}`;
    }));
    h += `<tr><td><b>${a.apt}</b></td><td>${esc(a.floor)}</td><td>${a.rooms ?? ''}</td><td>${a.sqm ?? ''}</td>` +
      `<td class="l">${owners.join('<br>')}</td><td class="l">${people.join('<br>')}</td>` +
      (ME.isSuper ? `<td dir="ltr">${rs.map((x) => esc(x.r.account) || '<span class="mute">—</span>').join('<br>')}</td>` : '') +
      `<td>${btn('b', `data-add="${a.apt}"`, 'הוסף אדם', '+ אדם')} ${btn('g', `data-ea="${a.apt}"`, 'עריכת פרטי הדירה', 'עריכה')} ${rs.map((x) => btn('g', `data-end="${esc(x.r.key)}"`, 'עזב', 'עזב')).join(' ')}</td></tr>`;
  });
  $('#aptTable').innerHTML = h;
}
$('#hOpen').onclick = async () => { if (!APTS) await loadApts(); if (await addPersonDialog('')) { toast('נוסף'); loadApts(); } };
$('#aptTable').onclick = async (e) => {
  const ad = e.target.closest('[data-add]');
  if (ad) { if (await addPersonDialog(ad.dataset.add)) { toast('נוסף'); loadApts(); } return; }
  const ep = e.target.closest('[data-ep]');
  if (ep) { if (await editPersonDialog(PERSONS[ep.dataset.ep])) { toast('נשמר'); loadApts(); } return; }
  const ea = e.target.closest('[data-ea]');
  if (ea) { if (await editAptDialog(APTS.apartments.find((a) => String(a.apt) === ea.dataset.ea))) { toast('נשמר'); loadApts(); } return; }
  const ro = e.target.closest('[data-rmown]');
  if (ro) {
    if (!(await Vaad.ask({ ok: 'הסר', text: 'להסיר את בעל הדירה? גם הכניסה שלו לדירה תוסר.' }))) return;
    try { await api('DELETE', '/api/owner/' + ro.dataset.rmown); toast('בעל הדירה הוסר'); loadApts(); } catch (err) { toast(err.message); }
    return;
  }
  const hr = e.target.closest('[data-hrm]');
  if (hr) {
    if (!(await Vaad.ask({ ok: 'הסר', text: 'להסיר את האדם מהדירה?' }))) return;
    const [key, userId] = hr.dataset.hrm.split('|');
    try { await api('POST', '/api/household/remove', { key, userId }); toast('האדם הוסר מהדירה'); loadApts(); } catch (err) { toast(err.message); }
    return;
  }
  const b = e.target.closest('[data-end]'); if (!b) return;
  const v = await Vaad.ask({ ok: 'סיים דיירות', input: 'חודש/שנה, למשל 8/2026', text: 'באיזה חודש הדיירים עזבו? (כל הדיירים בדירה)' }); if (!v) return;
  const m = /^\s*(\d{1,2})\s*[\/.-]\s*(\d{4})\s*$/.exec(v);
  if (!m) return toast('פורמט: חודש/שנה, למשל 8/2026');
  try { await api('POST', '/api/tenancy/end', { key: b.dataset.end, exitMonth: m[1], exitYear: m[2] }); toast('הדיירות הסתיימה'); loadApts(); } catch (err) { toast(err.message); }
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
