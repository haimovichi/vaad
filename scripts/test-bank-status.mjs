// What became of a stored bank row (lib/bank.js bankStatus), including a debit the workbook already has as an expense.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { bankStatus } = require('../lib/bank');

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++; };

const db = {
  payments: [{ txKey: 'p', apt: 3, m: 8, y: 2026 }], pending: [{ txKey: 'w' }], ignored: { i: true }, bankSeen: { s: true }, refSeen: {},
  expenses: [
    { y: 2026, m: 10, d: 25, amount: 2993, category: 'מעליות' },                                  // from the workbook: no bank key
    { y: 2026, m: 10, d: 18, amount: 2934.33, category: 'חשמל', txKey: 'x' },                    // already linked to a bank row
  ],
};
const row = (o) => ({ key: 'k', date: '2026-10-25', amount: -2993, ref: '985', ...o });
check('a debit with the same day and amount as a workbook expense is "recorded earlier"', bankStatus(db, row()).kind === 'earlier' && bankStatus(db, row()).expense.category === 'מעליות');
check('a different amount is not matched', bankStatus(db, row({ amount: -2992 })).kind === 'none');
check('a different day is not matched', bankStatus(db, row({ date: '2026-10-24' })).kind === 'none');
check('an expense already linked to a bank row is not matched again', bankStatus(db, row({ date: '2026-10-18', amount: -2934.33 })).kind === 'none');
check('a credit is never matched against expenses', bankStatus(db, row({ amount: 2993 })).kind === 'none');
check('a debit linked by key is "expense"', bankStatus({ ...db, expenses: [{ txKey: 'k' }] }, row()).kind === 'expense');
check('payment, waiting, ignored and seen rows keep their status', ['p', 'w', 'i', 's'].map((k) => bankStatus(db, row({ key: k, amount: 570 })).kind).join() === 'payment,pending,ignored,earlier');
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
