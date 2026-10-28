// Import the existing workbook (הכנסות_הוצאות.xlsx) into data/db.json
const XLSX = require('xlsx');
const { empty, save } = require('./db');

const rows = (wb, name, from) => {
  const ws = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }).slice(from);
};
const num = (v) => (v === null || v === '' || isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

function seed(file) {
  const wb = XLSX.readFile(file);
  const db = empty();

  for (const r of rows(wb, 'דירות', 3)) {
    if (num(r[0])) db.apartments.push({ apt: num(r[0]), floor: str(r[1]), rooms: num(r[2]), sqm: num(r[3]) });
  }
  for (const r of rows(wb, 'בעלים', 3)) {
    if (num(r[0])) db.owners.push({ apt: num(r[0]), first: str(r[1]), last: str(r[2]), phone: str(r[3]), account: str(r[4]), note: str(r[6]) });
  }
  for (const r of rows(wb, 'דיירים', 4)) {
    if (!num(r[0])) continue;
    db.residents.push({
      apt: num(r[0]), first: str(r[1]), last: str(r[2]), first2: str(r[3]), last2: str(r[4]),
      phone1: str(r[5]), phone2: str(r[6]), role: str(r[7]), status: str(r[8]),
      entryMonth: num(r[9]), entryYear: num(r[10]), exitMonth: num(r[11]), exitYear: num(r[12]),
      account: str(r[13]), key: str(r[14]),
    });
  }
  for (const r of rows(wb, 'תעריפים', 4)) {
    if (num(r[0]) && num(r[3]) !== null) db.tariffs.push({ year: num(r[0]), month: num(r[1]), apt: num(r[2]), amount: num(r[3]), note: str(r[4]) });
  }
  for (const r of rows(wb, 'תשלומים', 1)) {
    if (!r[0] || num(r[3]) === null) continue;
    const apt = parseInt(String(r[0]), 10);
    const y = num(r[1]); const m = num(r[2]);
    let fy = num(r[6]) ?? num(r[8]) ?? y; const fm = num(r[7]) ?? num(r[9]) ?? m;
    if (fy > y + 1) fy = y; // workbook typo guard (e.g. "for year 2029" on a 2026 payment)
    const note = str(r[5]);
    const p = { id: db.nextId++, key: String(r[0]).trim(), apt, y: fy, m: fm, amount: num(r[3]), method: str(r[4]), date: null, note, src: 'excel' };
    const ref = /אסמכתא\s*(\d+)/.exec(note);
    if (ref) { p.ref = ref[1]; db.refSeen[`${y}|${parseInt(ref[1], 10)}`] = p.id; }
    db.payments.push(p);
  }
  for (const r of rows(wb, 'הוצאות', 1)) {
    if (!num(r[0]) || num(r[5]) === null) continue;
    db.expenses.push({ y: num(r[0]), m: num(r[1]), d: num(r[2]), category: str(r[3]), desc: str(r[4]), amount: num(r[5]), method: str(r[6]), note: str(r[7]) });
  }
  save(db);
  return db;
}

module.exports = { seed };

if (require.main === module) {
  const db = seed(process.argv[2]);
  console.log(`apartments ${db.apartments.length}, residents ${db.residents.length}, owners ${db.owners.length}, tariffs ${db.tariffs.length}, payments ${db.payments.length}, expenses ${db.expenses.length}`);
}
