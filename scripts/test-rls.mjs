// Verifies supabase/schema.sql role + building isolation rules in an in-process Postgres (PGlite)
// with a stub of Supabase's auth.jwt().
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated;
`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`
  insert into buildings(id, name) values (1,'Building One'),(2,'Building Two');
  insert into members(building_id, email, role, apt, name) values
    (1,'owner1@x.com','owner',null,'O1'),(1,'admin1@x.com','admin',null,'A1'),(1,'t1@x.com','tenant',8,'T1'),
    (2,'owner2@x.com','owner',null,'O2'),(2,'t2@x.com','tenant',3,'T2'),
    (1,'both@x.com','owner',null,'Both'),(2,'both@x.com','tenant',5,'Both');
  insert into apartments(building_id, apt) values (1,8),(2,3),(2,5);
  insert into residents(building_id, key, apt, first_name, last_name, phone1) values (1,'8-a',8,'A','B','050-1'),(2,'3-a',3,'C','D','050-2');
  insert into payments(building_id, key, apt, y, m, amount, note) values (1,'8-a',8,2026,10,570,'bank: secret 1'),(2,'3-a',3,2026,10,570,'bank: secret 2');
  insert into snapshot(building_id, data) values (1,'{"b":1}'),(2,'{"b":2}');
  insert into residents(building_id, key, apt, first_name, last_name, status) values (1,'8-old',8,'Old','Tenant','עזב');
  insert into payments(building_id, key, apt, y, m, amount, note) values (1,'8-old',8,2026,3,100,'previous tenant');
`);

async function as(email, sql) {
  await db.exec('begin');
  try {
    if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
    await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
    const r = await db.query(sql);
    await db.exec('rollback');
    return /^\s*select/i.test(sql) ? r.rows.length : r.affectedRows;
  } catch (e) { await db.exec('rollback'); return 'ERR'; }
}

let bad = 0; let n = 0;
async function check(who, email, what, sql, expect) {
  const got = await as(email, sql);
  const ok = expect === 'BLOCKED' ? (got === 0 || got === 'ERR') : got === expect;
  n++; if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${who.padEnd(9)} ${what.padEnd(40)} expected ${expect} got ${got}`);
}
const P = (b) => `select * from payments where building_id = ${b}`;
const R = (b) => `select * from residents where building_id = ${b}`;
const S = (b) => `select * from snapshot where building_id = ${b}`;
const ins = (b) => `insert into payments(building_id,key,apt,y,m,amount) values (${b},'x',1,2026,11,1)`;
const upd = (b) => `update payments set amount = 1 where building_id = ${b}`;
const del = (b) => `delete from payments where building_id = ${b}`;
const snapW = (b) => `update snapshot set data = '{}' where building_id = ${b}`;
const esc = (b, e) => `insert into members(building_id,email,role) values (${b},'${e}','owner') on conflict (building_id,email) do update set role='owner'`;
const ren = (b) => `update buildings set name = 'hacked' where id = ${b}`;

const CNT = { pay: { 1: 2, 2: 1 }, res: { 1: 2, 2: 1 }, snap: { 1: 1, 2: 1 } };
const users = [
  // who, email, [read pay B1, B2], [read residents B1, B2], [snapshot B1, B2], writes allowed in [B1, B2]
  ['owner1', 'owner1@x.com', [1, 0], [1, 0], [1, 0], [1, 0]],
  ['admin1', 'admin1@x.com', [1, 0], [1, 0], [1, 0], [0, 0]],
  ['tenant1', 't1@x.com', [0, 0], [0, 0], [1, 0], [0, 0]],
  ['owner2', 'owner2@x.com', [0, 1], [0, 1], [0, 1], [0, 1]],
  ['tenant2', 't2@x.com', [0, 0], [0, 0], [0, 1], [0, 0]],
  ['both', 'both@x.com', [1, 0], [1, 0], [1, 1], [1, 0]],   // owner of 1, tenant of 2
  ['stranger', 'nobody@x.com', [0, 0], [0, 0], [0, 0], [0, 0]],
];
for (const [who, email, pay, res, snap, w] of users) {
  for (const b of [1, 2]) {
    const i = b - 1;
    await check(who, email, `read payments B${b}`, P(b), pay[i] ? CNT.pay[b] : 0);
    await check(who, email, `read residents (phones) B${b}`, R(b), res[i] ? CNT.res[b] : 0);
    await check(who, email, `read snapshot B${b}`, S(b), snap[i] ? CNT.snap[b] : 0);
    const can = w[i] === 1;
    await check(who, email, `insert payment B${b}`, ins(b), can ? 1 : 'BLOCKED');
    await check(who, email, `update payment B${b}`, upd(b), can ? CNT.pay[b] : 'BLOCKED');
    await check(who, email, `delete payment B${b}`, del(b), can ? CNT.pay[b] : 'BLOCKED');
    await check(who, email, `write snapshot B${b}`, snapW(b), can ? 1 : 'BLOCKED');
    await check(who, email, `make self owner of B${b}`, esc(b, email), can ? 1 : 'BLOCKED');
    await check(who, email, `rename building B${b}`, ren(b), can ? 1 : 'BLOCKED');
  }
}
// members visibility
await check('tenant1', 't1@x.com', 'sees only own member row', 'select * from members', 1);
await check('owner1', 'owner1@x.com', 'sees own building members only', 'select * from members', 4);
await check('both', 'both@x.com', 'sees own rows + building 1 members', 'select * from members', 5);
await check('owner1', 'owner1@x.com', 'cannot add member to other building', "insert into members(building_id,email,role) values (2,'e@x.com','tenant')", 'BLOCKED');
await check('owner1', 'owner1@x.com', 'cannot create a building', "insert into buildings(name) values ('new')", 'BLOCKED');
await check('owner1', 'owner1@x.com', 'cannot delete a building', 'delete from buildings where id = 1', 'BLOCKED');
await check('owner1', 'owner1@x.com', 'sees only own building', 'select * from buildings', 1);
await check('owner1', 'owner1@x.com', 'cannot move a payment to building 2', "update payments set building_id = 2 where building_id = 1", 'BLOCKED');
await check('anon', null, 'read payments', 'select * from payments', 'BLOCKED');
await check('anon', null, 'read snapshot', 'select * from snapshot', 'BLOCKED');


// own-apartment payments function
const fn = (b, a, y) => `select * from apt_payments(${b}, ${a}, ${y})`;
await check('tenant1', 't1@x.com', 'own apartment payments (current tenancy only)', fn(1, 8, 2026), 1);
await check('tenant1', 't1@x.com', 'other apartment payments', fn(1, 3, 2026), 0);
await check('tenant1', 't1@x.com', 'other building payments', fn(2, 3, 2026), 0);
await check('tenant2', 't2@x.com', 'own apartment payments (B2)', fn(2, 3, 2026), 1);
await check('tenant2', 't2@x.com', 'building 1 apartment', fn(1, 8, 2026), 0);
await check('admin1', 'admin1@x.com', 'any apartment in own building', fn(1, 8, 2026), 2);
await check('owner1', 'owner1@x.com', 'any apartment in own building', fn(1, 8, 2026), 2);
await check('owner2', 'owner2@x.com', 'other building apartment', fn(1, 8, 2026), 0);
await check('stranger', 'nobody@x.com', 'any apartment', fn(1, 8, 2026), 0);
await check('both', 'both@x.com', 'owner of B1 reads B1', fn(1, 8, 2026), 2);
await check('both', 'both@x.com', 'tenant of B2 (apt 5) cannot read apt 3', fn(2, 3, 2026), 0);
await check('anon', null, 'apt_payments', fn(1, 8, 2026), 'BLOCKED');
{ // only month/amount/method/date columns, never notes or references
  await db.exec('begin'); await db.exec(`select set_config('request.jwt.claims','{"email":"t1@x.com"}',true)`); await db.exec('set local role authenticated');
  const r = await db.query(fn(1, 8, 2026)); await db.exec('rollback');
  const cols = r.fields.map((f) => f.name).join(',');
  const ok = cols === 'y,m,amount,method,paid_on'; n++; if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  columns exposed to tenants: ${cols}`);
}

// linking an apartment to a person (members.apt) is an owner-only action
const link = (e, apt) => `update members set apt = ${apt} where email = '${e}' and building_id = 1`;
await check('owner1', 'owner1@x.com', 'link apartment to a tenant', link('t1@x.com', 3), 1);
await check('owner1', 'owner1@x.com', 'link apartment to an owner', link('owner1@x.com', 18), 1);
await check('owner1', 'owner1@x.com', 'add a tenant with an apartment', "insert into members(building_id,email,role,apt) values (1,'new@x.com','tenant',5)", 1);
await check('admin1', 'admin1@x.com', 'link apartment to a tenant', link('t1@x.com', 3), 'BLOCKED');
await check('admin1', 'admin1@x.com', 'link own apartment', link('admin1@x.com', 8), 'BLOCKED');
await check('admin1', 'admin1@x.com', 'add a member with an apartment', "insert into members(building_id,email,role,apt) values (1,'new@x.com','tenant',5)", 'BLOCKED');
await check('tenant1', 't1@x.com', 'change own apartment link', link('t1@x.com', 3), 'BLOCKED');
await check('tenant1', 't1@x.com', 'change anyone else\'s link', link('admin1@x.com', 3), 'BLOCKED');
await check('tenant1', 't1@x.com', 'add a member with an apartment', "insert into members(building_id,email,role,apt) values (1,'new@x.com','tenant',5)", 'BLOCKED');
await check('tenant1', 't1@x.com', 'remove own membership', "delete from members where email = 't1@x.com' and building_id = 1", 'BLOCKED');
await check('owner2', 'owner2@x.com', 'link a person in another building', link('t1@x.com', 3), 'BLOCKED');
await check('stranger', 'nobody@x.com', 'link an apartment', link('t1@x.com', 3), 'BLOCKED');
await check('both', 'both@x.com', 'tenant of B2 changing own B2 link', "update members set apt = 3 where email = 'both@x.com' and building_id = 2", 'BLOCKED');

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(bad ? 1 : 0);
