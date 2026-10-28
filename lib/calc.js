// Dues, payments and status calculations. Months are indexed as year*12 + (month-1).
// The unit of account is a *tenancy* (one resident row: apartment + entry..exit months), so a debt
// stays with the tenant who incurred it and a new tenant starts clean.
const START = 2022 * 12 + 5; // building committee collection starts June 2022
const mi = (y, m) => y * 12 + (m - 1);
const fromMi = (i) => ({ y: Math.floor(i / 12), m: (i % 12) + 1 });
const nowMi = (d = new Date()) => mi(d.getFullYear(), d.getMonth() + 1);

function tenancies(db) {
  return db.residents.map((r, idx) => ({
    key: r.key || `${r.apt}#${idx}`, apt: r.apt, idx, resident: r,
    from: r.entryYear ? mi(r.entryYear, r.entryMonth || 1) : START,
    to: r.status === 'עזב' && r.exitYear ? mi(r.exitYear, r.exitMonth || 12) : Infinity,
  }));
}

// Tenancy covering an apartment in a month (falls back to the apartment's latest tenancy)
function tenancyAt(ts, apt, idx) {
  const mine = ts.filter((t) => t.apt === apt);
  return mine.find((t) => t.from <= idx && idx <= t.to) || mine[mine.length - 1] || null;
}

// Tariff for an apartment in a month, regardless of who lives there
function dueFor(db, apt, y, m) {
  const t = db.tariffs.filter((x) => x.year === y);
  let base = (t.find((x) => !x.month && !x.apt) || {}).amount || 0;
  const ov = t.find((x) => !x.month && x.apt === apt);
  if (ov) base = ov.amount;
  for (const x of t) if (x.month === m && (!x.apt || x.apt === apt)) base += x.amount;
  return base;
}

// What a tenancy owes in a month (0 outside its months)
function tenantDue(db, t, idx) {
  if (idx < t.from || idx > t.to || idx < START) return 0;
  const { y, m } = fromMi(idx);
  return dueFor(db, t.apt, y, m);
}

// Total paid per tenancy key. `extra` = payments not yet saved (used while proposing an import).
function paidByKey(db, ts, extra = []) {
  const map = new Map();
  for (const p of [...db.payments, ...extra]) {
    const t = ts.find((x) => x.key === p.key) || tenancyAt(ts, p.apt, mi(p.y, p.m));
    if (!t) continue;
    map.set(t.key, (map.get(t.key) || 0) + p.amount);
  }
  return map;
}

// Month-by-month coverage for one tenancy. All of its payments form one pool that fills the oldest
// unpaid month first (catch-up lump sums cover arrears, surplus covers upcoming months).
function coverage(db, t, pool, lastIdx) {
  const out = new Map();
  for (let i = Math.max(START, t.from); i <= lastIdx; i++) {
    if (i > t.to) break;
    const due = tenantDue(db, t, i);
    const used = Math.min(pool, due);
    pool -= used;
    out.set(i, { due, paid: used });
  }
  return { cov: out, left: pool };
}

function cellStatus(due, paid, idx, now) {
  if (idx > now) return paid > 0 ? 'prepaid' : 'future';
  if (due > 0 && paid >= due) return 'paid';
  if (paid > 0) return 'partial';
  return idx === now ? 'pending' : 'unpaid';
}

// Owed through the current month (or through exit, for a former tenant); negative = credit
function balance(db, t, pool, now = nowMi()) {
  let due = 0;
  for (let i = Math.max(START, t.from); i <= Math.min(now, t.to); i++) due += tenantDue(db, t, i);
  return due - pool;
}

// One row per tenancy that overlaps the year
function grid(db, year, now = nowMi()) {
  const ts = tenancies(db);
  const paid = paidByKey(db, ts);
  const rows = [];
  for (const t of ts) {
    if (!(t.from <= mi(year, 12) && t.to >= mi(year, 1))) continue;
    const pool = paid.get(t.key) || 0;
    const bal = balance(db, t, pool, now);
    const { cov } = coverage(db, t, pool, mi(year, 12));
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const idx = mi(year, m);
      if (idx < START || idx < t.from || idx > t.to) { months.push({ m, due: 0, paid: 0, status: 'na' }); continue; }
      const c = cov.get(idx) || { due: 0, paid: 0 };
      months.push({ m, due: c.due, paid: c.paid, status: cellStatus(c.due, c.paid, idx, now) });
    }
    rows.push({
      key: t.key, apt: t.apt, name: `${t.resident.first} ${t.resident.last}`.trim(), last: t.resident.last,
      role: t.resident.role, left: t.to !== Infinity, from: fromMi(t.from), to: t.to === Infinity ? null : fromMi(t.to),
      months, debt: Math.max(0, bal), balance: bal,
    });
  }
  return rows.sort((a, b) => a.apt - b.apt || (a.from.y * 12 + a.from.m) - (b.from.y * 12 + b.from.m));
}

module.exports = { START, mi, fromMi, nowMi, tenancies, tenancyAt, dueFor, tenantDue, paidByKey, coverage, grid, balance, cellStatus };
