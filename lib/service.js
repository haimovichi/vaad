// Application operations, shared by the browser app. `store` persists changes (Supabase in production,
// in-memory in demo mode); `role` gates writes in the UI (the database enforces the same rules for real).
const calc = require('./calc');
const { parseBank } = require('./bank');
const { suggestedFrom, propose, allocateFor } = require('./match');
const { snapshot } = require('./snapshot');

const DENIED = 'אין לך הרשאה לבצע פעולה זו';

function createService(db, store, role) {
  const isOwner = role === 'owner';
  const need = () => { if (!isOwner) throw new Error(DENIED); };
  const fail = (m) => { throw new Error(m); };

  async function refreshSnapshot() {
    const data = snapshot(db);
    await store.saveSnapshot(data);
    return data;
  }

  const routes = {
    'GET /api/grid': async (q) => {
      const year = +q.get('year') || new Date().getFullYear();
      const years = []; for (let y = calc.fromMi(calc.START).y; y <= new Date().getFullYear(); y++) years.push(y);
      return { year, years, now: calc.fromMi(calc.nowMi()), rows: calc.grid(db, year) };
    },
    'GET /api/cell': async (q) => {
      const key = q.get('key'); const y = +q.get('y'); const m = +q.get('m');
      const ts = calc.tenancies(db); const t = ts.find((x) => x.key === key);
      if (!t) fail('לא נמצא');
      const payments = db.payments.filter((p) => (ts.find((x) => x.key === p.key) || calc.tenancyAt(ts, p.apt, calc.mi(p.y, p.m))) === t);
      return { due: calc.tenantDue(db, t, calc.mi(y, m)), apt: t.apt, payments };
    },
    'GET /api/apartments': async () => ({ apartments: db.apartments, residents: db.residents, owners: db.owners }),
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
    'GET /api/settings': async () => db.settings,
    'PUT /api/settings': async (q, b) => {
      need();
      db.settings = { title: String(b.title || 'ועד הבית'), showNames: !!b.showNames, showDebt: !!b.showDebt };
      await store.saveMeta('settings', db.settings);
      await refreshSnapshot();
      return db.settings;
    },
    'POST /api/publish': async () => { need(); const d = await refreshSnapshot(); return { updated: d.updated }; },
    'GET /api/members': async () => { need(); return store.listMembers(); },
    'PUT /api/member': async (q, b) => {
      need();
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) fail('כתובת אימייל לא תקינה');
      if (!['owner', 'admin', 'tenant'].includes(b.role)) fail('תפקיד לא תקין');
      return store.saveMember({ email, role: b.role, apt: b.apt ? +b.apt : null, name: b.name || '' });
    },
    'DELETE /api/member': async (q, b, email) => { need(); await store.deleteMember(decodeURIComponent(email)); return { ok: true }; },
  };

  return {
    role,
    async call(method, url, body) {
      const u = new URL(url, 'http://x');
      let path = u.pathname; let arg = null;
      const m = /^(\/api\/(?:payment|member))\/(.+)$/.exec(path);
      if (m) { path = m[1]; arg = m[2]; }
      const h = routes[`${method} ${path}`];
      if (!h) fail('לא נמצא');
      return h(u.searchParams, body, arg);
    },
  };
}

module.exports = { createService, DENIED };
