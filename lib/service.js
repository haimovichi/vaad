// Application operations, shared by the browser app. `store` persists changes (Supabase in production,
// in-memory in demo mode). `perms` only decides what the UI offers; the database enforces the same rules for real:
//   perms = { manage, isSuper, isManager, grantable: [roles this person may give out] }
const calc = require('./calc');
const { parseBank } = require('./bank');
const { suggestedFrom, freshCredits, payerKey } = require('./match');
const { snapshot } = require('./snapshot');

const DENIED = 'אין לך הרשאה לבצע פעולה זו';
const ROLES = ['committee', 'tenant', 'apt_owner'];

function createService(db, store, perms) {
  const need = () => { if (!perms.manage) throw new Error(DENIED); };
  const needSuper = () => { if (!perms.isSuper) throw new Error(DENIED); };
  const needCreate = () => { if (!perms.isSuper && !perms.isManager && !perms.canCreate) throw new Error(DENIED); };
  const needPlatform = () => { if (!perms.isSuper && !perms.isManager) throw new Error(DENIED); };
  const canGrant = (role) => { if (!(perms.grantable || []).includes(role)) throw new Error(DENIED); };
  const fail = (m) => { throw new Error(m); };
  const email = (v) => {
    const e = String(v || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) fail('כתובת אימייל לא תקינה');
    return e;
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
    'GET /api/apartments': async () => { need(); return { apartments: db.apartments, residents: db.residents, owners: db.owners }; },
    'PUT /api/resident': async (q, b) => {
      need();
      const r = db.residents[b.index];
      if (!r) fail('לא נמצא');
      const personal = ['first', 'last', 'first2', 'last2', 'phone1', 'phone2', 'account'];
      if (personal.some((k) => k in b.patch)) needSuper();   // names, phones and bank accounts belong to the users table: only the super user edits them
      const before = { ...r };
      for (const k of [...personal, 'status']) if (k in b.patch) r[k] = String(b.patch[k]);
      try { await store.updateResident(r); } catch (e) { Object.assign(r, before); throw e; }
      return r;
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
      const txs = parseBank(new Uint8Array(body));
      const sug = suggestedFrom(db, txs);
      const from = q.get('from') ? q.get('from') : sug;
      const { fresh, known, debits, before } = freshCredits(db, txs, from);
      let proposals = [];
      try { proposals = fresh.length ? await store.proposeCredits(fresh) : []; } catch (e) { fail(`לא ניתן לנתח את הקובץ מול השרת, לא נשמר דבר: ${e.message}`); }
      const name = (key) => { const r = db.residents.find((x) => x.key === key); return r ? `${r.first} ${r.last}`.trim() : ''; };
      const items = fresh.map((tx, i) => {
        const p = proposals[i];
        return { ...tx, payer: payerKey(tx.desc), apt: p.apt, how: p.how, sure: p.sure, candidates: p.candidates || [], tenancy: p.tenancy, tenant: p.tenancy ? name(p.tenancy) : '', allocations: p.allocations };
      });
      return { items, known, debits, before, from, suggestedFrom: sug, total: txs.length, apartments: db.apartments.map((a) => a.apt) };
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
      const u = { first: String(b.first || '').trim(), last: String(b.last || '').trim(), email: String(b.email || '').trim(), phone: String(b.phone || '').trim(), account: String(b.account || '').trim() };
      if (!u.first && !u.last && !u.email) fail('חסר שם או אימייל');
      if (u.email) u.email = email(u.email);
      return store.addUser(u);
    },
    'PUT /api/user': async (q, b) => {
      needSuper();
      const patch = {};
      for (const k of ['first', 'last', 'phone', 'account']) if (k in b.patch) patch[k] = String(b.patch[k] || '').trim();
      if ('email' in b.patch) patch.email = String(b.patch.email || '').trim() ? email(b.patch.email) : '';
      return store.updateUser(+b.id, patch);
    },

    'PUT /api/building': async (q, b) => {
      needSuper();
      const name = String(b.name || '').trim();
      if (!name) fail('חסר שם בניין');
      await store.renameBuilding(+b.id, name);
      return { id: +b.id, name };
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
      return { id: await store.createBuilding(name), name };
    },
  };

  return {
    perms,
    async call(method, url, body) {
      const u = new URL(url, 'http://x');
      let path = u.pathname; let arg = null;
      const m = /^(\/api\/(?:payment|member|manager-building|manager))\/(.+)$/.exec(path);
      if (m) { path = m[1]; arg = m[2]; }
      const h = routes[`${method} ${path}`];
      if (!h) fail('לא נמצא');
      return h(u.searchParams, body, arg);
    },
  };
}

module.exports = { createService, DENIED };
