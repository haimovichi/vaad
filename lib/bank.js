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
    out.push({
      key: `${date}|${ref}|${amount}`, date, desc, amount, ref,
      refKey: isNaN(refNum) ? null : `${d.getFullYear()}|${refNum}`,
    });
  }
  return out;
}

module.exports = { parseBank };
