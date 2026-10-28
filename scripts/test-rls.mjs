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
    await check(who, email, `read payments B${b}`, P(b), pay[i]);
    await check(who, email, `read residents (phones) B${b}`, R(b), res[i]);
    await check(who, email, `read snapshot B${b}`, S(b), snap[i]);
    const can = w[i] === 1;
    await check(who, email, `insert payment B${b}`, ins(b), can ? 1 : 'BLOCKED');
    await check(who, email, `update payment B${b}`, upd(b), can ? 1 : 'BLOCKED');
    await check(who, email, `delete payment B${b}`, del(b), can ? 1 : 'BLOCKED');
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

console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} passed`);
process.exit(bad ? 1 : 0);
