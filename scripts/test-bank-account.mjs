// The account of a bank file, the account check and the balance taken from the newest row (lib/bank.js).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const { parseBankAccount, sameAccount, currentBalance, parseBank } = require('../lib/bank');
let bad = 0;
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++; };

const buf = fs.readFileSync(new URL('../data/bank-sample.xlsx', import.meta.url));
const acct = parseBankAccount(buf);
check('the account is read from the file header', acct.number === '0184949434' && /אורי אלמוג/.test(acct.name));
check('leading zeros and dashes do not matter', sameAccount('0184949434', '184-949434') && sameAccount(' 184949434', '0184949434'));
check('another account is different', !sameAccount('0184949434', '0184949435'));
check('an empty account never matches', !sameAccount('', '') && !sameAccount('0184949434', '') && !sameAccount(null, '0'));

const rows = parseBank(buf);
const bal = currentBalance(rows);
check('the balance is the one after the newest row of the file', bal.date === rows[0].date && bal.amount === rows[0].balance);
check('no rows, no balance', currentBalance([]) === null && currentBalance([{ date: '2026-01-01', amount: 1, balance: null }]) === null);
// two rows on the same day: the newest is the one that no other row follows
const day = [{ date: '2026-05-01', amount: -100, balance: 900 }, { date: '2026-05-01', amount: -50, balance: 1000 }, { date: '2026-05-01', amount: -20, balance: 880 }, { date: '2026-04-30', amount: 5, balance: 1050 }];
check('the newest of several rows on one day, whatever the order', currentBalance(day).amount === 880 && currentBalance([...day].reverse()).amount === 880);
process.exit(bad ? 1 : 0);
