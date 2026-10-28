// Match a bank credit to an apartment, and propose how to split it across months.
const { tenancies, tenancyAt, tenantDue, paidByKey, coverage, mi, fromMi } = require('./calc');

const norm = (s) => String(s || '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim();
const strip0 = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

function payerKey(desc) {
  return norm(desc).replace(/^(העברה|הוק)\s+/, '').replace(/חשבון.*$/, '').replace(/\d[\d-]*/g, '').replace(/\s+/g, ' ').trim();
}

function buildIndex(db) {
  const accounts = new Map();
  const add = (acc, apt) => { const k = strip0(acc); if (k.length >= 5) accounts.set(k, apt); };
  db.owners.forEach((o) => add(o.account, o.apt));
  db.residents.forEach((r) => add(r.account, r.apt));
  const people = []; // {apt, first, last, weight}
  const push = (apt, first, last) => { if (last) people.push({ apt, first: norm(first), last: norm(last) }); };
  db.residents.filter((r) => r.status !== 'עזב').forEach((r) => { push(r.apt, r.first, r.last); push(r.apt, r.first2, r.last2); });
  db.owners.forEach((o) => push(o.apt, o.first, o.last));
  return { accounts, people };
}

function matchPayer(db, idx, tx) {
  const key = payerKey(tx.desc);
  if (db.aliases[key]) return { apt: db.aliases[key], how: 'זכור מתיקון קודם', sure: true };

  const acc = /\d{2,3}-\d{3}-\d{4}-(\d{5,9})/.exec(tx.desc);
  if (acc && idx.accounts.has(strip0(acc[1]))) return { apt: idx.accounts.get(strip0(acc[1])), how: 'מספר חשבון', sure: true };

  const hint = /דירה\s*(\d{1,2})/.exec(tx.desc);
  if (hint && db.apartments.some((a) => a.apt === +hint[1])) return { apt: +hint[1], how: 'הערה בהעברה', sure: true };

  const text = norm(tx.desc);
  const full = new Set(); const lastOnly = new Set();
  for (const p of idx.people) {
    if (p.last.length < 3 || !text.includes(p.last)) continue;
    if (p.first && text.includes(p.first)) full.add(p.apt); else lastOnly.add(p.apt);
  }
  if (full.size === 1) return { apt: [...full][0], how: 'שם מלא', sure: true };
  if (full.size > 1) return { apt: null, how: 'כמה דירות לאותו שם', candidates: [...full], sure: false };
  if (lastOnly.size === 1) return { apt: [...lastOnly][0], how: 'שם משפחה בלבד', sure: false };
  if (lastOnly.size > 1) return { apt: null, how: 'כמה דירות לאותו שם', candidates: [...lastOnly], sure: false };
  return { apt: null, how: 'לא זוהה', sure: false };
}

// Split an amount over a tenancy's months: transaction month, then unpaid months of the last 6 months,
// then upcoming months. `pool` = what the tenancy has already paid in total.
function allocate(db, t, amount, dateStr, pool) {
  const [y, m] = dateStr.split('-').map(Number);
  const txIdx = mi(y, m);
  const { cov } = coverage(db, t, pool, txIdx + 24);
  const remaining = (i) => { const c = cov.get(i); return c ? c.due - c.paid : 0; };
  const order = [txIdx];
  for (let i = txIdx - 6; i < txIdx; i++) order.push(i);
  for (let i = txIdx + 1; i <= txIdx + 24; i++) order.push(i);
  const out = []; let left = amount;
  for (const i of order) {
    if (left <= 0) break;
    const r = remaining(i);
    if (r <= 0) continue;
    const take = Math.min(left, r);
    out.push({ ...fromMi(i), amount: take });
    left -= take;
  }
  if (left > 0) out.push({ ...fromMi(txIdx), amount: left }); // nothing due anywhere: park on the transaction month
  return out;
}

// The workbook only carries bank reference numbers for recent entries. Older rows are presumed
// already recorded: suggest importing only what comes after the latest bank row we can prove is recorded.
function suggestedFrom(db, txs) {
  const proven = txs.filter((t) => db.bankSeen[t.key] || (t.refKey && db.refSeen[t.refKey])).map((t) => t.date);
  if (!proven.length) return null;
  const last = proven.sort().pop();
  const d = new Date(last + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Allocation for an apartment picked by hand in the UI
function allocateFor(db, apt, amount, dateStr) {
  const ts = tenancies(db);
  const [y, m] = dateStr.split('-').map(Number);
  const t = tenancyAt(ts, apt, mi(y, m));
  if (!t) return null;
  const pool = paidByKey(db, ts).get(t.key) || 0;
  return { key: t.key, tenant: `${t.resident.first} ${t.resident.last}`, allocations: allocate(db, t, amount, dateStr, pool) };
}

function propose(db, txs, from = null) {
  const idx = buildIndex(db);
  const ts = tenancies(db);
  const pools = paidByKey(db, ts);
  const items = [];
  let known = 0; let debits = 0; let before = 0;
  for (const tx of txs.sort((a, b) => a.date.localeCompare(b.date))) {
    if (tx.amount <= 0) { debits++; continue; }
    if (db.bankSeen[tx.key] || db.ignored[tx.key] || (tx.refKey && db.refSeen[tx.refKey])) { known++; continue; }
    if (from && tx.date < from) { before++; continue; }
    const mt = matchPayer(db, idx, tx);
    const item = { ...tx, payer: payerKey(tx.desc), apt: mt.apt, how: mt.how, sure: mt.sure, candidates: mt.candidates || [], allocations: [] };
    if (mt.apt) {
      const [ty, tm] = tx.date.split('-').map(Number);
      const t = tenancyAt(ts, mt.apt, mi(ty, tm));
      item.tenancy = t.key; item.tenant = `${t.resident.first} ${t.resident.last}`;
      item.allocations = allocate(db, t, tx.amount, tx.date, pools.get(t.key) || 0);
      pools.set(t.key, (pools.get(t.key) || 0) + tx.amount);
    }
    items.push(item);
  }
  return { items, known, debits, before };
}

module.exports = { allocateFor, suggestedFrom, propose, allocate, payerKey, matchPayer, buildIndex };
