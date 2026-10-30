// Application operations, shared by the browser app. `store` persists changes (Supabase in production,
// in-memory in demo mode). `perms` only decides what the UI offers; the database enforces the same rules for real:
//   perms = { manage, isSuper, isManager, grantable: [roles this person may give out] }
const calc = require('./calc');
const { parseBank } = require('./bank');
const { suggestedFrom, propose, allocateFor } = require('./match');
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
      for (const k of ['first', 'last', 'first2', 'last2', 'phone1', 'phone2', 'account', 'status']) if (k in b.patch) r[k] = String(b.patch[k]);
      await store.updateResident(r);
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
    'POST /api/import/preview': async (q, body) => {
      need();
      const txs = parseBank(new Uint8Array(body));
      const sug = suggestedFrom(db, txs);
      const from = q.get('from') ? q.get('from') : sug;
      const r = propose(db, txs, from);
      return { ...r, from, suggestedFrom: sug, total: txs.length, apartments: db.apartments.map((a) => a.apt) };
    },
    'POST /api/import/commit': async (q, b) => {
      need();
      const rows = []; const meta = { bankSeen: false, refSeen: false, aliases: false, ignored: false };
      let ignored = 0;
      const ts = calc.tenancies(db);
      for (const it of b.items) {
        if (db.bankSeen[it.key] || db.ignored[it.key]) continue;
        if (it.ignore) { db.ignored[it.key] = true; meta.ignored = true; ignored++; continue; }
        if (!it.apt) continue;
        const total = it.allocations.reduce((s, a) => s + a.amount, 0);
        if (Math.abs(total - it.amount) > 0.01) fail(`סכום החלוקה לא תואם בשורה ${it.date} ${it.amount}`);
        const [ty, tm] = it.date.split('-').map(Number);
        const key = it.tenancy || (calc.tenancyAt(ts, +it.apt, calc.mi(ty, tm)) || {}).key;
        for (const a of it.allocations) {
          rows.push({ key, apt: +it.apt, y: a.y, m: a.m, amount: a.amount, method: 'העברה בנקאית', date: it.date, note: `בנק: ${it.desc.slice(0, 60)}`, ref: it.ref, src: 'bank', txKey: it.key });
        }
        db.bankSeen[it.key] = true; meta.bankSeen = true;
        if (it.refKey) { db.refSeen[it.refKey] = true; meta.refSeen = true; }
        if (it.learn && it.payer) { db.aliases[it.payer] = +it.apt; meta.aliases = true; }
      }
      if (rows.length) db.payments.push(...(await store.addPayments(rows)));
      for (const k of Object.keys(meta)) if (meta[k]) await store.saveMeta(k, db[k]);
      await refreshSnapshot();
      return { added: rows.length, ignored };
    },
    'GET /api/allocate': async (q) => {
      need();
      const r = allocateFor(db, +q.get('apt'), +q.get('amount'), q.get('date'));
      if (!r) fail('אין דייר');
      return r;
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
      return store.addMember({ email: email(b.email), role: b.role, apt: aptRule(b.role, b.apt), name: String(b.name || '').trim() });
    },
    'PUT /api/member': async (q, b) => {
      need();
      const row = await memberRow(b.id);
      canGrant(row.role);
      return store.updateMember(row.id, { apt: aptRule(row.role, b.apt), name: 'name' in b ? String(b.name || '').trim() : row.name });
    },
    'DELETE /api/member': async (q, b, id) => {
      need();
      const row = await memberRow(id);
      canGrant(row.role);
      await store.deleteMember(row.id);
      return { ok: true };
    },

    // everyone's roles across the buildings you can see (super user: all; a manager: the buildings they manage)
    'GET /api/people': async () => { needPlatform(); return store.listPeople(); },

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
    // buildings: the super user, managers and committee members create them (a manager becomes the manager, a committee member the committee); the name is the address and can't be renamed
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
