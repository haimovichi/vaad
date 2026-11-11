// Parse the bank "עובר ושב" export (.xlsx) into transactions
const XLSX = require('xlsx');

function parseBank(buffer) {
  const wb = XLSX.read(buffer, { type: typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer) ? 'buffer' : 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  const head = rows.findIndex((r) => r && String(r[0] || '').trim() === 'תאריך');
  if (head < 0) throw new Error('לא נמצאה שורת כותרת "תאריך" בקובץ הבנק');
  const out = [];
  for (const r of rows.slice(head + 1)) {
    if (!(r[0] instanceof Date)) continue;
    const d = new Date(r[0].getTime() + 12 * 3600e3); // xlsx lib returns local midnight minus a few seconds/hours
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const amount = Number(r[3]);
    if (isNaN(amount)) continue;
    const desc = String(r[2] || '').trim();
    const ref = String(r[5] || '').trim();
    const refNum = parseInt(ref, 10);
    const day = (v) => { if (!(v instanceof Date)) return null; const x = new Date(v.getTime() + 12 * 3600e3); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const num = (v) => { const n = Number(v); return v === null || v === '' || isNaN(n) ? null : n; };
    const text = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
    out.push({
      key: `${date}|${ref}|${amount}`, date, desc, amount, ref,
      refKey: isNaN(refNum) ? null : `${d.getFullYear()}|${refNum}`,
      // the rest of the row, as the bank wrote it (kept by record_bank_rows so the original data can be read back)
      valueDate: day(r[1]), balance: num(r[4]), fee: text(r[6]), channel: text(r[7]),
      raw: r.map((v) => (v instanceof Date ? day(v) : v)),
    });
  }
  return out;
}

// What became of a stored bank row, read from the other tables: a payment (apartments and months), a credit waiting for
// approval, an expense, ignored, recorded before the app kept bank rows (the workbook), or not imported at all.
function bankStatus(db, row) {
  const pays = (db.payments || []).filter((p) => p.txKey === row.key);
  if (pays.length) return { kind: 'payment', apts: [...new Set(pays.map((p) => p.apt))], months: pays.map((p) => `${String(p.m).padStart(2, '0')}/${p.y}`) };
  if ((db.pending || []).some((p) => p.txKey === row.key)) return { kind: 'pending' };
  if ((db.expenses || []).some((e) => e.txKey === row.key)) return { kind: 'expense' };
  if (db.ignored && db.ignored[row.key]) return { kind: 'ignored' };
  const refNum = parseInt(row.ref, 10);
  const refKey = isNaN(refNum) ? null : `${String(row.date).slice(0, 4)}|${refNum}`;
  if ((db.bankSeen && db.bankSeen[row.key]) || (refKey && db.refSeen && db.refSeen[refKey])) return { kind: 'earlier' };
  return { kind: 'none' };
}

module.exports = { parseBank, bankStatus };
