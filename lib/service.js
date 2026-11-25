// Application operations, shared by the browser app. `store` persists changes (Supabase in production,
// in-memory in demo mode). `perms` only decides what the UI offers; the database enforces the same rules for real:
//   perms = { manage, isSuper, isManager, grantable: [roles this person may give out] }
const calc = require('./calc');
const { parseBank, parseBankAccount, sameAccount, currentBalance, bankStatus, chequeCancellations } = require('./bank');
const { suggestedFrom, freshCredits, payerKey } = require('./match');
const { snapshot } = require('./snapshot');

const DENIED = 'אין לך הרשאה לבצע פעולה זו';
const ROLES = ['committee', 'tenant', 'apt_owner'];

// A store that only changes a copy of the data (the same rules as the real store, nothing persisted): used to try a list of steps
// before doing any of them, so that a step that fails leaves everything as it was.
function dryStore(d) {
  let n = 1e9; const find = (key) => d.residents.find((r) => r.key === key); const owner = (id) => d.owners.find((o) => String(o.id) === String(id));
  return {
    load: async () => d, saveSnapshot: async () => {}, syncLogin: async () => {}, updateUser: async () => ({}),
    addTenancy: async (t) => { const key = `${t.apt}-${t.last || 'x'}-dry${n++}`; d.residents.push({ key, apt: t.apt, first: t.first, last: t.last, first2: '', last2: '', phone1: t.phone, phone2: '', role: t.role, status: t.exitYear ? 'עזב' : 'פעיל', entryYear: t.entryYear, entryMonth: t.entryMonth, exitYear: t.exitYear, exitMonth: t.exitMonth, userId: t.userId || null, user2Id: null }); return key; },
    endTenancy: async (key, y, m) => { const r = find(key); r.status = 'עזב'; r.exitYear = y; r.exitMonth = m; },
    editTenancy: async (key, t) => { Object.assign(find(key), { apt: t.apt, role: t.role, entryYear: t.entryYear, entryMonth: t.entryMonth, exitYear: t.exitYear, exitMonth: t.exitMonth, status: t.exitYear ? 'עזב' : 'פעיל' }); },
    removeTenancy: async (key) => { d.residents = d.residents.filter((r) => r.key !== key); },
    addOwner: async (o) => {
      if (d.owners.some((x) => x.apt === o.apt && !x.exitYear && (o.userId ? x.userId === o.userId : x.first === o.first && x.last === o.last))) throw new Error('האדם הזה כבר רשום כבעל הדירה');
      const row = { id: n++, apt: o.apt, userId: o.userId || null, first: o.first, last: o.last, phone: o.phone, entryYear: o.entryYear ?? null, entryMonth: o.entryMonth ?? null, exitYear: null, exitMonth: null }; d.owners.push(row); return row.id;
    },
    endOwner: async (id, y, m) => { const o = owner(id); o.exitYear = y; o.exitMonth = m; },
    editOwner: async (id, o) => { Object.assign(owner(id), { apt: o.apt, entryYear: o.entryYear, entryMonth: o.entryMonth, exitYear: o.exitYear, exitMonth: o.exitMonth }); },
    removeOwner: async (id) => { d.owners = d.owners.filter((o) => String(o.id) !== String(id)); },
    addHouseholdMember: async (key, p) => {
      const r = find(key); if (!r) throw new Error('לא נמצא');
      if (p.userId && [r.userId, r.user2Id, ...(r.others || []).map((x) => x.userId)].includes(p.userId)) throw new Error('האדם הזה כבר רשום בדירה');
      (r.others = r.others || []).push({ userId: p.userId || null, first: p.first, last: p.last, phone: p.phone });
    },
  };
}

function createService(db, store, perms) {
  const need = () => { if (!perms.manage) throw new Error(DENIED); };
  const needSuper = () => { if (!perms.isSuper) throw new Error(DENIED); };
  const needCreate = () => { if (!perms.isSuper) throw new Error(DENIED); };   // only the super user creates buildings
  const needPlatform = () => { if (!perms.isSuper && !perms.isManager) throw new Error(DENIED); };
  const canGrant = (role) => { if (!(perms.grantable || []).includes(role)) throw new Error(DENIED); };
  const fail = (m) => { throw new Error(m); };
  const email = (v) => {
    const e = String(v || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) fail('כתובת אימייל לא תקינה');
    return e;
  };
  // an Israeli phone number, stored one way (050-1234567, 02-1234567) so the same person is never two people; empty is fine
  const phone = (v) => {
    let d = String(v || '').replace(/[\s\-().]/g, '');
    if (!d) return '';
    d = d.replace(/^\+?9720?/, '0');
    if (!/^0\d{8,9}$/.test(d)) fail('מספר טלפון לא תקין: 9 או 10 ספרות שמתחילות ב-0, למשל 050-1234567');
    const area = d.length === 10 ? 3 : 2;
    return d.slice(0, area) + '-' + d.slice(area);
  };
  const aptRule = (role, apt) => {
    const a = apt === '' || apt === null || apt === undefined ? null : +apt;
    if (role === 'apt_owner' && !a) fail('בעל דירה חייב מספר דירה');
    if (role === 'committee') return null;
    return a;
  };
  async function memberRow(id) {
    const row = (await store.listMembers()).find((x) => String(x.id) === String(id));
    if (!row) fail('לא נמצא');
    return row;
  }

  async function refreshSnapshot() {
    const data = snapshot(db);
    await store.saveSnapshot(data);
    return data;
  }

  const routes = {
    'GET /api/grid': async (q) => {
      need();
      const year = +q.get('year') || new Date().getFullYear();
      const years = []; for (let y = calc.fromMi(calc.START).y; y <= new Date().getFullYear(); y++) years.push(y);
      return { year, years, now: calc.fromMi(calc.nowMi()), rows: calc.grid(db, year) };
    },
    'GET /api/cell': async (q) => {
      need();
      const key = q.get('key'); const y = +q.get('y'); const m = +q.get('m');
      const ts = calc.tenancies(db); const t = ts.find((x) => x.key === key);
      if (!t) fail('לא נמצא');
      const payments = db.payments.filter((p) => (ts.find((x) => x.key === p.key) || calc.tenancyAt(ts, p.apt, calc.mi(p.y, p.m))) === t);
      return { due: calc.tenantDue(db, t, calc.mi(y, m)), apt: t.apt, payments };
    },
    'GET /api/expenses': async () => { need(); return db.expenses; },
    // the comment is the only thing about an expense that can change; the rest is imported and locked
    'PUT /api/expense': async (q, b) => {
      need();
      const e = db.expenses.find((x) => String(x.id) === String(b.id));
      if (!e) fail('לא נמצא');
      const comment = String(b.comment || '').trim();
      await store.setExpenseComment(e.id, comment);
      e.comment = comment;
      return e;
    },
    'GET /api/tariffs': async () => { need(); return db.tariffs; },
    // base tariff of a year (no month, no apartment), an apartment's own tariff (apartment, no month), or a one-off
    // surcharge of a month (month, for all apartments or one). Setting one that exists changes its amount.
    'POST /api/tariff': async (q, b) => {
      need();
      const year = Number(b.year); const amount = Number(b.amount);
      const month = b.month === '' || b.month === null || b.month === undefined ? null : Number(b.month);
      const apt = b.apt === '' || b.apt === null || b.apt === undefined ? null : Number(b.apt);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) fail('שנה לא תקינה');
      if (month !== null && !(Number.isInteger(month) && month >= 1 && month <= 12)) fail('חודש לא תקין');
      if (apt !== null && !db.apartments.some((a) => a.apt === apt)) fail('אין דירה כזו בבניין');
      if (b.amount === '' || b.amount === null || b.amount === undefined || !Number.isFinite(amount)) fail('סכום חסר');
      if (month === null && amount < 0) fail('תעריף לא יכול להיות שלילי');
      const row = { year, month, apt, amount, note: String(b.note || '').trim() };
      const old = db.tariffs.find((t) => t.year === year && (t.month || null) === month && (t.apt || null) === apt);
      if (old) { await store.updateTariff(old.id, row); Object.assign(old, row); await refreshSnapshot(); return old; }
      const saved = await store.addTariff(row);
      db.tariffs.push(saved);
      await refreshSnapshot();
      return saved;
    },
    'DELETE /api/tariff': async (q, b, id) => {
      need();
      const i = db.tariffs.findIndex((t) => String(t.id) === String(id));
      if (i < 0) fail('לא נמצא');
      await store.deleteTariff(db.tariffs[i].id);
      db.tariffs.splice(i, 1);
      await refreshSnapshot();
      return { ok: true };
    },
    // floor, rooms and area of an existing apartment (its number never changes: payments and people point at it)
    'PUT /api/apartment': async (q, b) => {
      need();
      const apt = Number(b.apt);
      const cur = db.apartments.find((a) => a.apt === apt);
      if (!cur) fail('דירה לא נמצאה');
      const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      const a = { apt, floor: String(b.floor || '').trim(), rooms: num(b.rooms), sqm: num(b.sqm) };
      if ((a.rooms !== null && !(Number.isInteger(a.rooms) && a.rooms > 0)) || (a.sqm !== null && !(Number.isInteger(a.sqm) && a.sqm > 0))) fail('חדרים ושטח חייבים להיות מספרים שלמים חיוביים');
      await store.updateApartment(a);
      Object.assign(cur, a);
      await refreshSnapshot();
      return cur;
    },
    'POST /api/apartment': async (q, b) => {
      need();
      const apt = Number(b.apt);
      if (!Number.isInteger(apt) || apt < 1) fail('מספר דירה לא תקין');
      if (db.apartments.some((a) => a.apt === apt)) fail(`דירה ${apt} כבר קיימת בבניין`);
      const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      const a = { apt, floor: String(b.floor || '').trim(), rooms: num(b.rooms), sqm: num(b.sqm) };
      if ((a.rooms !== null && !(a.rooms > 0)) || (a.sqm !== null && !(a.sqm > 0))) fail('חדרים ושטח חייבים להיות מספרים חיוביים');
      await store.addApartment(a);
      db.apartments.push(a); db.apartments.sort((x, y) => x.apt - y.apt);
      await refreshSnapshot();
      return a;
    },
    'GET /api/apartments': async () => { need(); return { apartments: db.apartments, residents: db.residents, owners: db.owners }; },
    'PUT /api/resident': async (q, b) => {
      need();
      const r = db.residents[b.index];
      if (!r) fail('לא נמצא');
      // the staff of the building may change the first person's name and phone (the database allows it for people tied
      // only to buildings they manage); a second person and bank accounts belong to the super user
      const own = ['first', 'last', 'phone1']; const superOnly = ['first2', 'last2', 'phone2', 'account'];
      if (superOnly.some((k) => k in b.patch)) needSuper();
      const before = { ...r };
      for (const k of [...own, ...superOnly, 'status']) if (k in b.patch) r[k] = k.startsWith('phone') ? phone(b.patch[k]) : String(b.patch[k]);
      try {
        if (!perms.isSuper && own.some((k) => k in b.patch)) await store.editPerson(r.userId, r.first, r.last, r.phone1);
        else await store.updateResident(r);
      } catch (e) { Object.assign(r, before); throw e; }
      return r;
    },
    // a new tenancy: the person is created or reused by the server; the dates of an apartment's tenancies must not overlap
    'POST /api/tenancy': async (q, b) => {
      need();
      const apt = Number(b.apt);
      if (!db.apartments.some((a) => a.apt === apt)) fail('בחרו דירה');
      const last = String(b.last || '').trim(); const uid = b.userId ? Number(b.userId) : null;
      if (!last && !uid) fail('שם משפחה חסר');
      const mail = String(b.email || '').trim(); if (mail) { email(mail); canGrant('tenant'); }
      if (!['בעלים', 'שוכר'].includes(b.role)) fail('בחרו אם הדייר בעלים או שוכר');
      const ey = Number(b.entryYear); const em = Number(b.entryMonth);
      if (!Number.isInteger(ey) || ey < 2000 || ey > 2100 || !Number.isInteger(em) || em < 1 || em > 12) fail('חודש כניסה לא תקין');
      const hasExit = (b.exitYear !== '' && b.exitYear != null) || (b.exitMonth !== '' && b.exitMonth != null);
      const xy = hasExit ? Number(b.exitYear) : null; const xm = hasExit ? Number(b.exitMonth) : null;
      if (hasExit && (!Number.isInteger(xy) || !Number.isInteger(xm) || xm < 1 || xm > 12)) fail('חודש יציאה לא תקין');
      const from = calc.mi(ey, em); const to = hasExit ? calc.mi(xy, xm) : Infinity;
      if (to < from) fail('חודש היציאה קודם לחודש הכניסה');
      // endPrevious: the current tenants moved out the month before the new ones came in
      const prev = b.endPrevious ? calc.tenancies(db).find((t) => t.apt === apt && t.to === Infinity) : null;
      if (prev && from - 1 < prev.from) fail('חודש הכניסה חייב להיות אחרי חודש הכניסה של הדיירים הנוכחיים');
      if (calc.tenancies(db).some((t) => t.apt === apt && !(prev && t.key === prev.key) && from <= t.to && t.from <= to)) fail('התאריכים חופפים לדיירות אחרת בדירה. סיימו קודם את הדיירות הקודמת.');
      if (prev) { const x = calc.fromMi(from - 1); await store.endTenancy(prev.key, x.y, x.m); }
      const key = await store.addTenancy({ apt, first: String(b.first || '').trim(), last, phone: phone(b.phone), email: mail.toLowerCase(), userId: uid, role: b.role, entryYear: ey, entryMonth: em, exitYear: xy, exitMonth: xm });
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { key };
    },
    // one more person in the household of an apartment's current tenancy (a couple, a family, flatmates): same tenancy, same payments
    'POST /api/household': async (q, b) => {
      need();
      const apt = Number(b.apt);
      const cur = db.residents.find((r) => r.apt === apt && r.status !== 'עזב');
      if (!cur) fail('אין דיירות פעילה בדירה. הוסיפו דייר חדש עם חודש כניסה.');
      const uid = b.userId ? Number(b.userId) : null;
      if (!String(b.last || '').trim() && !uid) fail('שם משפחה חסר');
      const mail = String(b.email || '').trim(); if (mail) { email(mail); canGrant('tenant'); }
      try { await store.addHouseholdMember(cur.key, { first: String(b.first || '').trim(), last: String(b.last || '').trim(), phone: phone(b.phone), email: mail.toLowerCase(), userId: uid }); } catch (e) { fail(e.message); }
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { key: cur.key };
    },
    'POST /api/household/remove': async (q, b) => {
      need();
      const r = db.residents.find((x) => x.key === b.key);
      if (!r) fail('לא נמצא');
      try { await store.removeHouseholdMember(r.key, Number(b.userId)); } catch (e) { fail(e.message); }
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { ok: true };
    },
    // a person's name and phone (the building's staff; the database refuses people who are also tied to another building)
    'PUT /api/person': async (q, b) => {
      need();
      const first = String(b.first || '').trim(); const last = String(b.last || '').trim();
      if (!last) fail('שם משפחה חסר');
      await store.editPerson(Number(b.userId), first, last, phone(b.phone));
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { ok: true };
    },
    // who owns an apartment; with an email the owner can log in and sees only their apartments
    'POST /api/owner': async (q, b) => {
      need();
      const apt = Number(b.apt);
      if (!db.apartments.some((a) => a.apt === apt)) fail('בחרו דירה');
      const mail = String(b.email || '').trim();
      if (mail) email(mail);
      const uid = b.userId ? Number(b.userId) : null;
      if (!String(b.last || '').trim() && !mail && !uid) fail('שם משפחה חסר');
      if (mail) canGrant('apt_owner');
      const noStart = (b.entryYear === '' || b.entryYear == null) && (b.entryMonth === '' || b.entryMonth == null);
      const ey = noStart ? null : Number(b.entryYear); const em = noStart ? null : Number(b.entryMonth);
      if (!noStart && (!Number.isInteger(ey) || ey < 2000 || ey > 2100 || !Number.isInteger(em) || em < 1 || em > 12)) fail('חודש תחילת הבעלות לא תקין');
      // endPrevious: the current owners sold the month before the new owner started
      let sold = [];
      if (b.endPrevious) {
        if (noStart) fail('כדי לסיים בעלות קודמת צריך חודש תחילת בעלות');
        sold = db.owners.filter((o) => o.apt === apt && !o.exitYear);
        const x = calc.fromMi(calc.mi(ey, em) - 1);
        for (const o of sold) if (o.entryYear && calc.mi(x.y, x.m) < calc.mi(o.entryYear, o.entryMonth || 1)) fail(`הבעלות של ${[o.first, o.last].join(' ').trim() || 'בעל הדירה'} התחילה אחרי החודש שלפני הבעלות החדשה`);
      }
      let id;
      try { id = await store.addOwner({ apt, first: String(b.first || '').trim(), last: String(b.last || '').trim(), phone: phone(b.phone), email: mail.toLowerCase(), userId: uid, entryYear: ey, entryMonth: em }); } catch (e) { fail(e.message); }
      if (sold.length) { const x = calc.fromMi(calc.mi(ey, em) - 1); for (const o of sold) await store.endOwner(o.id, x.y, x.m); }
      Object.assign(db, await store.load());
      return { id };
    },
    'DELETE /api/owner': async (q, b, id) => {
      needSuper();   // removing a record is for the super user; the others end the ownership
      if (!db.owners.some((o) => String(o.id) === String(id))) fail('לא נמצא');
      await store.removeOwner(id);
      Object.assign(db, await store.load());
      return { ok: true };
    },
    // the owner sold: the ownership ends in that month (the record stays as history; the owner's access to the apartment goes)
    'POST /api/owner/end': async (q, b) => {
      need();
      const o = db.owners.find((x) => String(x.id) === String(b.id));
      if (!o) fail('לא נמצא');
      if (o.exitYear) fail('הבעלות כבר הסתיימה');
      const y = Number(b.exitYear); const m = Number(b.exitMonth);
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) fail('חודש סיום לא תקין');
      if (o.entryYear && calc.mi(y, m) < calc.mi(o.entryYear, o.entryMonth || 1)) fail('חודש הסיום קודם לתחילת הבעלות');
      await store.endOwner(o.id, y, m);
      Object.assign(db, await store.load());
      return { ok: true };
    },
    'POST /api/tenancy/end': async (q, b) => {
      need();
      const t = calc.tenancies(db).find((x) => x.key === b.key);
      if (!t) fail('לא נמצא');
      if (t.to !== Infinity) fail('הדיירות כבר הסתיימה');
      const y = Number(b.exitYear); const m = Number(b.exitMonth);
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) fail('חודש יציאה לא תקין');
      if (calc.mi(y, m) < t.from) fail('חודש היציאה קודם לחודש הכניסה');
      await store.endTenancy(t.key, y, m);
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { ok: true };
    },
    // a correction of a tenancy (not a move): the apartment, tenant or owner, and the dates; an empty exit means the person still lives there
    'PUT /api/tenancy': async (q, b) => {
      need();
      const r = db.residents.find((x) => x.key === b.key);
      if (!r) fail('לא נמצא');
      const apt = Number(b.apt);
      if (!db.apartments.some((a) => a.apt === apt)) fail('בחרו דירה');
      if (!['בעלים', 'שוכר'].includes(b.role)) fail('בחרו אם הדייר בעלים או שוכר');
      const ey = Number(b.entryYear); const em = Number(b.entryMonth);
      if (!Number.isInteger(ey) || ey < 2000 || ey > 2100 || !Number.isInteger(em) || em < 1 || em > 12) fail('חודש כניסה לא תקין');
      const hasExit = (b.exitYear !== '' && b.exitYear != null) || (b.exitMonth !== '' && b.exitMonth != null);
      const xy = hasExit ? Number(b.exitYear) : null; const xm = hasExit ? Number(b.exitMonth) : null;
      if (hasExit && (!Number.isInteger(xy) || xy < 2000 || xy > 2100 || !Number.isInteger(xm) || xm < 1 || xm > 12)) fail('חודש יציאה לא תקין');
      const from = calc.mi(ey, em); const to = hasExit ? calc.mi(xy, xm) : Infinity;
      if (to < from) fail('חודש היציאה קודם לחודש הכניסה');
      if (calc.tenancies(db).some((t) => t.apt === apt && t.key !== r.key && from <= t.to && t.from <= to)) fail('התאריכים חופפים לדיירות אחרת בדירה');
      if (apt !== r.apt && db.payments.some((p) => p.key === r.key)) fail('לדיירות הזו יש תשלומים, אי אפשר להעביר אותה לדירה אחרת');
      try { await store.editTenancy(r.key, { apt, role: b.role, entryYear: ey, entryMonth: em, exitYear: xy, exitMonth: xm }); } catch (e) { fail(e.message); }
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { ok: true };
    },
    // a tenancy recorded by mistake is removed with its household (the super user; never one that has payments)
    'POST /api/tenancy/remove': async (q, b) => {
      needSuper();
      const r = db.residents.find((x) => x.key === b.key);
      if (!r) fail('לא נמצא');
      if (db.payments.some((p) => p.key === r.key)) fail('לדיירות הזו יש תשלומים, אי אפשר להסיר אותה');
      try { await store.removeTenancy(r.key); } catch (e) { fail(e.message); }
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { ok: true };
    },
    // a correction of an ownership: the apartment and the start and end months (an empty end means still the owner)
    'PUT /api/owner': async (q, b) => {
      need();
      const o = db.owners.find((x) => String(x.id) === String(b.id));
      if (!o) fail('לא נמצא');
      const apt = Number(b.apt);
      if (!db.apartments.some((a) => a.apt === apt)) fail('בחרו דירה');
      const none = (y, m) => (y === '' || y == null) && (m === '' || m == null);
      const ey = none(b.entryYear, b.entryMonth) ? null : Number(b.entryYear); const em = ey === null ? null : Number(b.entryMonth);
      const xy = none(b.exitYear, b.exitMonth) ? null : Number(b.exitYear); const xm = xy === null ? null : Number(b.exitMonth);
      const bad = (y, m) => y !== null && (!Number.isInteger(y) || y < 2000 || y > 2100 || !Number.isInteger(m) || m < 1 || m > 12);
      if (bad(ey, em)) fail('חודש תחילת הבעלות לא תקין');
      if (bad(xy, xm)) fail('חודש סיום הבעלות לא תקין');
      if (ey !== null && xy !== null && calc.mi(xy, xm) < calc.mi(ey, em)) fail('חודש הסיום קודם לתחילת הבעלות');
      try { await store.editOwner(o.id, { apt, entryYear: ey, entryMonth: em, exitYear: xy, exitMonth: xm }); } catch (e) { fail(e.message); }
      Object.assign(db, await store.load());
      return { ok: true };
    },
    // a list of steps done as one: all are tried first on a copy of the data, and none is done if one of them fails
    'POST /api/batch': async (q, b) => {
      need();
      const steps = Array.isArray(b.steps) ? b.steps : [];
      const allowed = ['PUT /api/user', 'PUT /api/tenancy', 'PUT /api/owner', 'POST /api/tenancy/remove', 'DELETE /api/owner', 'POST /api/owner', 'POST /api/tenancy', 'POST /api/household'];
      for (const st of steps) if (!allowed.includes(`${st.method} ${String(st.url).split('?')[0].replace(/\/\d+$/, '')}`)) fail('פעולה לא מותרת');
      const copy = JSON.parse(JSON.stringify(db));
      const dry = createService(copy, dryStore(copy), perms);
      for (const st of steps) await dry.call(st.method, st.url, st.body);
      for (const st of steps) await svc.call(st.method, st.url, st.body);
      return { ok: true };
    },
    'POST /api/payment': async (q, b) => {
      need();
      const t = calc.tenancies(db).find((x) => x.key === b.key);
      if (!t) fail('דייר לא נמצא');
      const p = { key: t.key, apt: t.apt, y: +b.y, m: +b.m, amount: +b.amount, method: b.method || 'מזומן', date: b.date || null, note: b.note || '', src: 'manual' };
      if (!p.y || !p.m || !(p.amount > 0)) fail('פרטים חסרים');
      const [saved] = await store.addPayments([p]);
      db.payments.push(saved);
      await refreshSnapshot();
      return saved;
    },
    'DELETE /api/payment': async (q, b, id) => {
      need();
      const i = db.payments.findIndex((p) => String(p.id) === String(id));
      if (i < 0) fail('לא נמצא');
      await store.deletePayment(db.payments[i].id);
      const [p] = db.payments.splice(i, 1);
      await refreshSnapshot();
      return p;
    },
    // The matching and the split over months are decided by the server functions (propose_credits); the file is parsed here.
    'POST /api/import/preview': async (q, body) => {
      need();
      const bytes = new Uint8Array(body);
      const txs = parseBank(bytes);
      // the file must belong to this building's bank account, or nothing is loaded
      const acct = parseBankAccount(bytes);
      if (!acct.number) fail('לא נמצא מספר חשבון בכותרת קובץ הבנק, לכן הקובץ לא נטען');
      const have = await store.bankAccount();
      if (!have) return { needAccount: { number: acct.number, name: acct.name } };   // the building has no account yet: the user confirms this one
      if (!sameAccount(have, acct.number)) fail(`הקובץ שייך לחשבון ${acct.number}${acct.name ? ` (${acct.name})` : ''}, ואילו חשבון הבנק של הבניין הוא ${have}. הקובץ לא נטען.`);
      // every row of the file is kept as the bank wrote it (the bank records screen), whether or not it is imported below
      try { await store.recordBank(txs, acct.number); } catch (e) { fail(`לא ניתן לשמור את שורות הבנק, לא נשמר דבר: ${e.message}`); }
      const sug = suggestedFrom(db, txs);
      const from = q.get('from') ? q.get('from') : sug;
      const { fresh, expenses, known, debits, before } = freshCredits(db, txs, from);
      let proposals = [];
      try { proposals = fresh.length ? await store.proposeCredits(fresh) : []; } catch (e) { fail(`לא ניתן לנתח את הקובץ מול השרת, לא נשמר דבר: ${e.message}`); }
      const name = (key) => { const r = db.residents.find((x) => x.key === key); return r ? `${r.first} ${r.last}`.trim() : ''; };
      const items = fresh.map((tx, i) => {
        const p = proposals[i];
        return { ...tx, payer: payerKey(tx.desc), apt: p.apt, how: p.how, sure: p.sure, candidates: p.candidates || [], tenancy: p.tenancy, tenant: p.tenancy ? name(p.tenancy) : '', allocations: p.allocations };
      });
      return { items, expenses, known, debits, before, from, suggestedFrom: sug, total: txs.length, apartments: db.apartments.map((a) => a.apt) };
    },
    // One all-or-nothing save: credited rows, rows that wait for approval (no apartment) and ignored rows.
    'POST /api/import/commit': async (q, b) => {
      need();
      let r;
      try { r = await store.saveImport(b.items); } catch (e) { fail(`השמירה נכשלה, לא נשמר דבר: ${e.message}`); }
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return r;
    },
    // the building's bank account and its balance after the newest bank row
    'GET /api/bank/info': async () => { need(); return { account: await store.bankAccount(), bank: await store.bankCode(), balance: currentBalance(await store.recentBank()) }; },
    'POST /api/bank/account': async (q, b) => {
      need();
      const number = String(b.account || '').trim();
      if (!/\d/.test(number)) fail('חסר מספר חשבון');
      try { await store.setBankAccount(number); } catch (e) { fail(`לא ניתן לשמור את חשבון הבנק: ${e.message}`); }
      return { account: number };
    },
    // every stored bank row, newest first, with what became of it
    'GET /api/bank': async () => {
      need();
      const rows = await store.bankRows();
      const cancels = chequeCancellations(rows);
      return rows.map((r) => {
        const s = bankStatus(db, r); const c = cancels.get(r.key);
        // a deposit and its cancellation cancel each other; if the deposit was already recorded somewhere, say so (that record needs undoing)
        return { ...r, status: c ? { kind: 'cancelled', deposit: c.deposit, warn: !['none', 'ignored'].includes(s.kind) } : s };
      }).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    },
    'GET /api/pending': async () => { need(); return db.pending; },
    'POST /api/pending/approve': async (q, b) => {
      need();
      if (!b.apt) fail('בחרו דירה');
      await store.approvePending(+b.id, +b.apt, !!b.learn);
      Object.assign(db, await store.load());
      await refreshSnapshot();
      return { ok: true };
    },
    'POST /api/pending/ignore': async (q, b) => {
      need();
      await store.ignorePending(+b.id);
      Object.assign(db, await store.load());
      return { ok: true };
    },
    'GET /api/allocate': async (q) => {
      need();
      const [p] = await store.proposeCredits([{ key: 'manual', date: q.get('date'), amount: +q.get('amount'), desc: '', apt: +q.get('apt') }]);
      if (!p.tenancy) fail('אין דייר');
      const r = db.residents.find((x) => x.key === p.tenancy);
      return { key: p.tenancy, tenant: r ? `${r.first} ${r.last}`.trim() : '', allocations: p.allocations };
    },
    'GET /api/settings': async () => { need(); return db.settings; },
    'PUT /api/settings': async (q, b) => {
      need();
      db.settings = { title: String(b.title || 'ועד הבית'), showNames: !!b.showNames, showDebt: !!b.showDebt };
      await store.saveMeta('settings', db.settings);
      await refreshSnapshot();
      return db.settings;
    },
    'POST /api/publish': async () => { need(); const d = await refreshSnapshot(); return { updated: d.updated }; },
    'GET /api/export': async () => { need(); return store.exportAll(); },

    // people in this building: super user and managers give any of the three roles, the committee only tenant/apt_owner
    'GET /api/members': async () => { need(); return store.listMembers(); },
    'POST /api/member': async (q, b) => {
      need();
      if (!ROLES.includes(b.role)) fail('תפקיד לא תקין');
      canGrant(b.role);
      return store.addMember({ email: email(b.email), role: b.role, apt: aptRule(b.role, b.apt), name: perms.isSuper ? String(b.name || '').trim() : '' });
    },
    'PUT /api/member': async (q, b) => {
      need();
      const row = await memberRow(b.id);
      canGrant(row.role);
      return store.updateMember(row.id, { apt: aptRule(row.role, b.apt) });
    },
    'DELETE /api/member': async (q, b, id) => {
      need();
      const row = await memberRow(id);
      canGrant(row.role);
      await store.deleteMember(row.id);
      return { ok: true };
    },

    // the people you can see, with their access roles (super user: all; a manager: the buildings they manage; committee: their building)
    'GET /api/people': async () => { need(); return store.listPeople(); },
    // the users table: only the super user adds and edits people (name, email, phone, bank account)
    'POST /api/user': async (q, b) => {
      needSuper();
      const u = { first: String(b.first || '').trim(), last: String(b.last || '').trim(), email: String(b.email || '').trim(), phone: phone(b.phone), account: String(b.account || '').trim() };
      if (!u.first && !u.last && !u.email) fail('חסר שם או אימייל');
      if (u.email) u.email = email(u.email);
      return store.addUser(u);
    },
    'PUT /api/user': async (q, b) => {
      needSuper();
      const patch = {};
      for (const k of ['first', 'last', 'phone', 'account']) if (k in b.patch) patch[k] = k === 'phone' ? phone(b.patch[k]) : String(b.patch[k] || '').trim();
      if ('email' in b.patch) patch.email = String(b.patch.email || '').trim() ? email(b.patch.email) : '';
      const out = await store.updateUser(+b.id, patch);
      // an email means app access: the person gets a login for every apartment they own or live in
      if (patch.email) await store.syncLogin(+b.id);
      return out;
    },

    'PUT /api/building': async (q, b) => {
      needSuper();
      const name = String(b.name || '').trim();
      if (!name) fail('חסר שם בניין');
      await store.renameBuilding(+b.id, name);
      return { id: +b.id, name };
    },
    // deleting a building removes everything in it: the super user only, and a building with money records needs its name typed
    'GET /api/building/counts': async (q) => { needSuper(); return store.buildingCounts(+q.get('id')); },
    'DELETE /api/building': async (q, b) => {
      needSuper();
      await store.deleteBuilding(+b.id, String(b.confirm || ''));
      return { ok: true };
    },
    // platform: only the super user appoints buildings managers
    'GET /api/managers': async () => { needSuper(); return store.listManagers(); },
    'POST /api/manager': async (q, b) => { needSuper(); return store.addManager(email(b.email)); },
    'DELETE /api/manager': async (q, b, e) => { needSuper(); await store.removeManager(decodeURIComponent(e)); return { ok: true }; },
    'POST /api/manager-building': async (q, b) => { needSuper(); await store.addManagerBuilding(email(b.email), +b.building_id); return { ok: true }; },
    'DELETE /api/manager-building': async (q, b, arg) => {
      needSuper();
      const [e, id] = decodeURIComponent(arg).split('~');
      await store.removeManagerBuilding(e, +id);
      return { ok: true };
    },
    // buildings: the super user, managers and committee members create them (a manager becomes the manager, a committee member the committee); only the super user changes an address
    'POST /api/building': async (q, b) => {
      needCreate();
      const name = String(b.name || '').trim();
      if (!name) fail('חסר שם בניין');
      const apts = Number(b.apartments);
      if (!Number.isInteger(apts) || apts < 1 || apts > 500) fail('מספר הדירות בבניין חייב להיות מספר שלם בין 1 ל-500');
      return { id: await store.createBuilding(name, String(b.bankAccount || '').trim(), apts, String(b.bankCode || '').trim()), name };
    },
  };

  const svc = {
    perms,
    async call(method, url, body) {
      const u = new URL(url, 'http://x');
      let path = u.pathname; let arg = null;
      const m = /^(\/api\/(?:payment|member|manager-building|manager|owner|tariff))\/(?!end$)(.+)$/.exec(path);   // /api/owner/end is its own route, not owner number "end"
      if (m) { path = m[1]; arg = m[2]; }
      const h = routes[`${method} ${path}`];
      if (!h) fail('לא נמצא');
      return h(u.searchParams, body, arg);
    },
  };
  return svc;
}

module.exports = { createService, DENIED };
