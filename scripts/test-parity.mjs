// Parity of the server functions (match_payer, split_payment) with the browser code (lib/match.js propose):
// the same building and the same bank rows must give the same apartment, reason, certainty, candidates and split.
//   node scripts/test-parity.mjs            synthetic building and bank rows that exercise every rule (part of npm test)
//   node scripts/test-parity.mjs --real     also the real data: data/db.json (its seed, supabase/seed.sql) and data/bank-sample.xlsx
//                                           (local files, git-ignored; only counts and row numbers are printed, never names)
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
import fs from 'fs';
import { STUB } from './test-rls.mjs';
const require = createRequire(import.meta.url);
const { propose } = require('../lib/match');
const { parseBank } = require('../lib/bank');

const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const q = (v) => (v === null || v === undefined || v === '' ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// ---- the synthetic building, in the browser's db format
const R = (key, apt, first, last, extra = {}) => ({ key, apt, first, last, first2: '', last2: '', phone1: '', phone2: '', account: '', role: 'tenant', status: 'פעיל', entryMonth: 1, entryYear: 2026, ...extra });
const synthetic = {
  apartments: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((apt) => ({ apt })),
  residents: [
    R('1-a', 1, 'משה', 'לוי', { first2: 'רינה', last2: 'לוי' }),
    R('2-a', 2, 'דוד', 'כהן', { account: '0012345678' }),
    R('3-a', 3, 'שרה', 'כהן', { account: '87654321, 55500' }),
    R('4-old', 4, 'יוסי', 'פרץ', { status: 'עזב', exitMonth: 3, exitYear: 2026 }),
    R('4-new', 4, 'אלי', 'שמש', { entryMonth: 4 }),
    R('5-a', 5, 'גיא', 'כץ'),
    R('6-a', 6, 'דן', 'ברק'),
    R('7-a', 7, 'דן', 'ברק'),
    R('8-a', 8, 'נועה', 'גל'),
    R('9-a', 9, 'רוני', "ג'ורג'"),
  ],
  owners: [{ apt: 8, first: 'רות', last: 'עמית', phone: '', account: '99001' }],
  tariffs: [{ year: 2026, amount: 570 }, { year: 2026, apt: 3, amount: 400 }, { year: 2026, month: 3, amount: 50 }, { year: 2027, amount: 600 }],
  payments: [{ key: '2-a', apt: 2, y: 2026, m: 1, amount: 570 }, { key: '2-a', apt: 2, y: 2026, m: 2, amount: 285 }, { key: '3-a', apt: 3, y: 2026, m: 1, amount: 400 }],
  aliases: { 'ישראל ישראלי': 5 },
  bankSeen: {}, refSeen: {}, ignored: {},
};
let n = 0;
const T = (date, amount, desc) => ({ key: `${date}|${++n}|${amount}`, date, desc, amount, ref: String(n), refKey: null });
const syntheticTxs = [
  T('2026-02-03', 570, 'העברה ישראל ישראלי'),                                   // alias
  T('2026-02-04', 570, 'העברה חשבון 10-800-1234-12345678 דמי ועד'),               // account (stored with leading zeros)
  T('2026-02-05', 400, 'העברה 12-345-6789-87654321 שרה'),                        // account, second of several accounts of apt 3
  T('2026-02-06', 100, 'הוק 12-345-6789-00055500'),                              // account with leading zeros in the text
  T('2026-02-07', 570, 'העברה רות עמית 12-345-6789-99001'),                      // an owner's account
  T('2026-02-08', 570, 'העברה דירה 6 תשלום'),                                   // apartment hint
  T('2026-02-09', 570, 'העברה דירה 99 משה לוי'),                                // hint to a missing apartment, then full name
  T('2026-02-10', 570, 'העברה משה לוי'),                                        // full name
  T('2026-02-11', 570, 'העברה רינה לוי'),                                       // the second person of a tenancy
  T('2026-02-12', 570, 'העברה לוי'),                                           // last name only (two people, one apartment)
  T('2026-02-13', 570, 'העברה כהן'),                                           // last name shared by apartments 2 and 3
  T('2026-02-14', 570, 'העברה דן ברק'),                                         // full name shared by apartments 6 and 7
  T('2026-02-15', 570, 'העברה אלמוני'),                                         // nobody
  T('2026-02-16', 570, 'העברה יוסי פרץ'),                                       // a former tenant
  T('2026-02-17', 570, 'העברה גיא כץ'),                                         // full name of apt 5
  T('2026-02-18', 570, 'העברה כץ'),                                            // last name of 2 letters: too short
  T('2026-02-19', 570, 'העברה רוני ג"ורג"'),                                    // quotes in the bank text
  T('2026-02-20', 570, 'העברה נועה גל'),                                        // tenant of 8, and the owner has another name
  T('2026-02-21', -300, 'חיוב עמלה'),                                          // a debit: skipped by both
  T('2026-04-02', 1000, 'העברה אלי שמש'),                                       // the new tenant of 4
  T('2026-04-20', 800, 'העברה אלי שמש'),                                        // a second credit for the same tenancy: its pool grows
  T('2026-03-05', 300, 'העברה דוד כהן'),                                        // shared first and last name? no: unique full name, apt 2 with a partial pool
  T('2026-03-06', 2500, 'העברה דירה 3'),                                        // spills over months, into 2027
  T('2035-01-15', 100, 'העברה דירה 9'),                                         // nothing due in 2035: parked
];
// two apartments sharing one bank account: the one known, documented difference (the server does not guess)
const sharedAcctDb = { ...synthetic, residents: [...synthetic.residents, R('2-b', 9, 'שכן', 'אחר', { account: '0012345678' })] };

// ---- load a browser-format db into a fresh database as building 1, with 'c@x.com' on the committee
async function load(db) {
  const d = new PGlite(); await d.exec(STUB); await d.exec(schema);
  let uid = 0; const users = []; const accts = [];
  const person = (first, last, account) => { if (!(first || last || account)) return 'null'; users.push([first, last]); String(account || '').split(/[,;]+/).map((a) => a.trim()).filter(Boolean).forEach((a) => accts.push(`(${users.length}, ${q(a)})`)); return String(users.length); };
  const res = db.residents.map((r) => [person(r.first, r.last, r.account), r.first2 || r.last2 ? person(r.first2, r.last2, '') : 'null']);
  const own = db.owners.map((o) => person(o.first, o.last, o.account));
  let sql = "insert into buildings(id, name) values (1, 'B'); insert into users(id, email) overriding system value values (1000, 'c@x.com');\n";
  sql += `insert into members(building_id, user_id, role) values (1, 1000, 'committee');\n`;
  if (users.length) sql += `insert into users(id, first_name, last_name) overriding system value values ${users.map((u, i) => `(${i + 1}, ${q(u[0])}, ${q(u[1])})`).join(',')};\n`;
  if (accts.length) sql += `insert into bank_accounts(user_id, account) values ${accts.join(',')};\n`;
  sql += `insert into apartments(building_id, apt) values ${db.apartments.map((a) => `(1, ${a.apt})`).join(',')};\n`;
  sql += `insert into residents(building_id, key, apt, user_id, user2_id, status, entry_month, entry_year, exit_month, exit_year) values ${db.residents.map((r, i) => `(1, ${q(r.key)}, ${r.apt}, ${res[i][0]}, ${res[i][1]}, ${q(r.status)}, ${q(r.entryMonth)}, ${q(r.entryYear)}, ${q(r.exitMonth)}, ${q(r.exitYear)})`).join(',')};\n`;
  if (db.owners.length) sql += `insert into owners(building_id, apt, user_id) values ${db.owners.map((o, i) => `(1, ${o.apt}, ${own[i]})`).join(',')};\n`;
  sql += `insert into tariffs(building_id, year, month, apt, amount) values ${db.tariffs.map((t) => `(1, ${t.year}, ${q(t.month)}, ${q(t.apt)}, ${t.amount})`).join(',')};\n`;
  if (db.payments.length) sql += db.payments.reduce((acc, p, i) => (i % 500 ? acc + `,(1, ${q(p.key)}, ${p.apt}, ${p.y}, ${p.m}, ${p.amount})` : acc + `${i ? ';\n' : ''}insert into payments(building_id, key, apt, y, m, amount) values (1, ${q(p.key)}, ${p.apt}, ${p.y}, ${p.m}, ${p.amount})`), '') + ';\n';
  sql += `insert into meta(building_id, name, value) values (1, 'aliases', ${q(JSON.stringify(db.aliases || {}))}::jsonb);\n`;
  await d.exec(sql);
  return d;
}

// ---- run both implementations on the same rows and list the differences
async function compare(db, txs) {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const dbB = clone(db); dbB.bankSeen = {}; dbB.refSeen = {}; dbB.ignored = {};
  const browser = propose(dbB, clone(txs)).items;
  const d = await load(db);
  await d.exec('begin');
  await d.exec(`select set_config('request.jwt.claims', '{"email":"c@x.com"}', true)`); await d.exec('set local role authenticated');
  const diffs = []; const already = {};
  for (const [i, it] of browser.entries()) {
    const m = (await d.query('select * from public.match_payer(1, $1)', [it.desc])).rows[0];
    const server = { apt: m.apt ?? null, how: m.how, sure: m.sure, candidates: [...(m.candidates || [])].sort((a, b) => a - b) };
    const want = { apt: it.apt ?? null, how: it.how, sure: it.sure, candidates: [...(it.candidates || [])].sort((a, b) => a - b) };
    const bad = [];
    for (const k of ['apt', 'how', 'sure']) if (server[k] !== want[k]) bad.push(`${k}: browser ${want[k]} / server ${server[k]}`);
    if (JSON.stringify(server.candidates) !== JSON.stringify(want.candidates)) bad.push(`candidates: browser [${want.candidates}] / server [${server.candidates}]`);
    if (it.apt) {
      const parts = (await d.query('select yr, mo, part from public.split_payment(1, $1, $2, $3::date, $4)', [it.apt, it.amount, it.date, already[it.tenancy] || 0])).rows.map((r) => `${r.yr}-${r.mo}:${+r.part}`);
      already[it.tenancy] = (already[it.tenancy] || 0) + it.amount;
      const bparts = it.allocations.map((a) => `${a.y}-${a.m}:${a.amount}`);
      if (JSON.stringify(parts) !== JSON.stringify(bparts)) bad.push(`split: browser ${bparts.join(',')} / server ${parts.join(',')}`);
    }
    if (bad.length) diffs.push({ i, desc: it.desc, date: it.date, bad });
  }
  await d.exec('rollback');
  return { rows: browser.length, diffs };
}

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++; };

const syn = await compare(synthetic, syntheticTxs);
check(`synthetic building: ${syn.rows} credits, apartment, reason, certainty, candidates and split identical`, syn.diffs.length === 0, syn.diffs.map((x) => `\n   row ${x.i} ${x.date} "${x.desc}": ${x.bad.join('; ')}`).join(''));
const reasons = new Set();
{ const b = propose(JSON.parse(JSON.stringify({ ...synthetic, bankSeen: {}, refSeen: {}, ignored: {} })), JSON.parse(JSON.stringify(syntheticTxs))).items; b.forEach((x) => reasons.add(x.how)); }
check('the synthetic rows exercise every rule', ['זכור מתיקון קודם', 'מספר חשבון', 'הערה בהעברה', 'שם מלא', 'שם משפחה בלבד', 'כמה דירות לאותו שם', 'לא זוהה'].every((r) => reasons.has(r)), `(${[...reasons].join(' | ')})`);

// the documented difference: an account held by two apartments is not guessed by the server
const sh = await compare(sharedAcctDb, [T('2026-02-04', 570, 'העברה 10-800-1234-12345678')]);
check('shared bank account: the one documented difference (browser picks one apartment, server lists both and is not sure)',
  sh.diffs.length === 1 && sh.diffs[0].bad.some((x) => x.startsWith('apt:')) && sh.diffs[0].bad.some((x) => x.startsWith('sure:')), JSON.stringify(sh.diffs.map((x) => x.bad)));

// ---- the real data, only when asked (local files, never committed; names and amounts are not printed)
if (process.argv.includes('--real')) {
  const dbFile = new URL('../data/db.json', import.meta.url); const bankFile = new URL('../data/bank-sample.xlsx', import.meta.url);
  if (!fs.existsSync(dbFile) || !fs.existsSync(bankFile)) { console.log('--real: data/db.json or data/bank-sample.xlsx is missing'); process.exit(1); }
  const real = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const txs = parseBank(fs.readFileSync(bankFile)).filter((t) => t.amount > 0);
  const r = await compare({ ...real, apartments: real.apartments, owners: real.owners }, txs);
  console.log(`real data: ${r.rows} credits compared`);
  for (const x of r.diffs) console.log(`  difference in credit #${x.i} of ${x.date}: ${x.bad.map((b) => b.split(':')[0]).join(', ')}`);
  check(`real data: no differences`, r.diffs.length === 0, `(${r.diffs.length} differing credits)`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
