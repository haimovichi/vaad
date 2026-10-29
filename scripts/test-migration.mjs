// Upgrading a database from the earlier roles (owner/admin/tenant) to the five-role model:
// run migrate-roles.sql then schema.sql on the old schema with old data, and prove the result matches a fresh install.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { STUB, loadFixture, makeRunner } from './test-rls.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const oldSchema = read('./fixtures/schema-v1.sql');
const migrate = read('../supabase/migrate-roles.sql');
const schema = read('../supabase/schema.sql');

let bad = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) bad++; };
async function legacyDb(extra = '') {
  const d = new PGlite(); await d.exec(STUB); await d.exec(oldSchema);
  await d.exec(`
    insert into buildings(id, name) values (1, 'Old building');
    insert into apartments(building_id, apt) values (1,8),(1,18);
    insert into members(building_id, email, role, apt, name) values
      (1,'treasurer@x.com','owner',18,'Treasurer'),(1,'second@x.com','owner',null,'Second'),(1,'tenant@x.com','tenant',8,'Tenant');
    insert into payments(building_id, key, apt, y, m, amount) values (1,'8-a',8,2026,10,570);
    ${extra}`);
  return d;
}

// 1) migrate a database with owner + tenant rows
const a = await legacyDb();
await a.exec(migrate); await a.exec(schema);
const mem = (await a.query('select email, role, apt from members order by email, role, apt')).rows.map((r) => `${r.email}:${r.role}:${r.apt ?? '-'}`).join(' | ');
check('owner with apartment -> committee + apartment owner; owner without -> committee; tenant unchanged',
  mem === 'second@x.com:committee:- | tenant@x.com:tenant:8 | treasurer@x.com:apt_owner:18 | treasurer@x.com:committee:-', `(${mem})`);
check('data tables are untouched', (await a.query('select count(*)::int n from payments')).rows[0].n === 1);

// 2) the migrated database enforces the same rules
await a.exec("insert into super_users(email) values ('super@x.com')");
const { one } = makeRunner(a);
check('old owner still manages the building (as committee)', (await one('treasurer@x.com', 'select * from payments')) === 1);
check('old owner can write', (await one('treasurer@x.com', "insert into payments(building_id,key,apt,y,m,amount) values (1,'8-a',8,2026,11,1)")) === 1);
check('old tenant sees the board but not payments', (await one('tenant@x.com', 'select * from payments')) === 0 && (await one('tenant@x.com', 'select * from snapshot')) === 0);
check('stranger sees nothing', (await one('nobody@x.com', 'select * from payments')) === 0);
check('super user sees the building', (await one('super@x.com', 'select * from buildings')) === 1);
const grantEsc = await one('treasurer@x.com', "insert into members(building_id,email,role) values (1,'x@x.com','committee')");
check('committee cannot add a committee member', grantEsc === 'ERR' || grantEsc === 0);

// 3) same policies, functions and grants as a fresh install
const fresh = new PGlite(); await fresh.exec(STUB); await fresh.exec(schema);
const shape = async (d) => ({
  policies: (await d.query("select tablename, policyname, cmd, roles::text r, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2")).rows,
  functions: (await d.query("select proname, prosecdef, pg_get_functiondef(oid) def from pg_proc where pronamespace = 'public'::regnamespace order by 1")).rows,
  grants: (await d.query("select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' order by 1, 2")).rows,
  memberColumns: (await d.query("select column_name, data_type, is_nullable from information_schema.columns where table_name = 'members' order by 1")).rows,
  constraints: (await d.query("select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'public.members'::regclass order by 1")).rows,
  indexes: (await d.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('members','super_users') order by 1")).rows,
});
const [s1, s2] = [await shape(a), await shape(fresh)];
for (const k of Object.keys(s1)) check(`migrated ${k} equal a fresh install`, JSON.stringify(s1[k]) === JSON.stringify(s2[k]));

// 4) the loaded fixture + a role check also work on the migrated database
const b = await legacyDb();
await b.exec(migrate); await b.exec(schema);
await b.exec('delete from members; delete from payments; delete from apartments; delete from buildings');
await loadFixture(b);
const r2 = makeRunner(b);
check('fixture behaves the same on a migrated database (tenant sees own apartment payments only)', (await r2.one('t8@x.com', 'select * from public.apt_payments(1, 8, 2026)')) === 1 && (await r2.one('t8@x.com', 'select * from public.apt_payments(1, 9, 2026)')) === 0);

// 5) the retired view-only role: migration refuses and changes nothing
const c = await legacyDb("insert into members(building_id, email, role) values (1,'viewer@x.com','admin');");
let refused = false;
try { await c.exec(migrate); } catch (e) { refused = true; await c.exec('rollback'); }
check('migration refuses while view-only admin rows exist', refused);
check('...and leaves members unchanged', (await c.query("select count(*)::int n from members where role = 'owner'")).rows[0].n === 2);

console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
