// Collected versus spent per year (lib/calc.js yearlySummary): synthetic checks always; with --real also the real workbook
// totals (data/db.json, local and git-ignored; only totals are printed).
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { yearlySummary } = require('../lib/calc');

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++; };

const db = {
  payments: [{ y: 2025, amount: 570 }, { y: 2025, amount: 570 }, { y: 2026, amount: 500 }, { y: 2029, amount: 100 }],
  pending: [{ y: 2026, amount: 9999 }],
  expenses: [{ y: 2025, amount: 300.5 }, { y: 2026, amount: 200 }, { y: 2024, amount: 50 }],
};
const s = yearlySummary(db);
check('a row for every year that has payments or expenses, newest first', JSON.stringify(s.map((r) => r.y)) === '[2029,2026,2025,2024]', JSON.stringify(s.map((r) => r.y)));
const by = Object.fromEntries(s.map((r) => [r.y, r]));
check('collected, spent and the difference per year', by[2025].collected === 1140 && by[2025].spent === 300.5 && by[2025].balance === 839.5 && by[2026].balance === 300 && by[2024].collected === 0 && by[2024].balance === -50, JSON.stringify(by[2025]));
check('pending payments are not counted', by[2026].collected === 500, `(2026 collected ${by[2026].collected})`);
check('no payments and no expenses: no rows', yearlySummary({ payments: [], expenses: [] }).length === 0);
check('a database without an expenses list still works', yearlySummary({ payments: [{ y: 2026, amount: 1 }] })[0].spent === 0);

if (process.argv.includes('--real')) {
  const file = new URL('../data/db.json', import.meta.url);
  if (!fs.existsSync(file)) { console.log('--real: data/db.json is missing'); process.exit(1); }
  const real = JSON.parse(fs.readFileSync(file, 'utf8'));
  const r = yearlySummary(real);
  const total = r.reduce((t, x) => t + x.collected, 0);
  const y26 = r.find((x) => x.y === 2026);
  console.log('real data:', r.map((x) => `${x.y}: collected ${Math.round(x.collected)}, spent ${Math.round(x.spent)}`).join(' | '));
  check('real data: all years add up to the workbook totals (739,560 ₪ collected, 2026 = 164,520 ₪)', Math.round(total) === 739560 && Math.round(y26.collected) === 164520, `(${Math.round(total)} / ${Math.round(y26.collected)})`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
