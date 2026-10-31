// Upgrading a database: (1) from the earlier roles (owner/admin/tenant): migrate-roles.sql, migrate-users.sql, schema.sql;
// (2) from the five-role model that keeps names on residents/owners: migrate-users.sql, schema.sql.
// Both must keep the data, enforce the same rules, and end up identical to a fresh install.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { STUB, loadFixture, makeRunner } from './test-rls.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const oldSchema = read('./fixtures/schema-v1.sql');
const migrateRoles = read('../supabase/migrate-roles.sql');
const migrateUsers = read('../supabase/migrate-users.sql');
const oldSchemaV2 = read('./fixtures/schema-v2.sql');
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
await a.exec(migrateRoles); await a.exec(migrateUsers); await a.exec(schema);
const mem = (await a.query('select u.email, m.role, m.apt from members m join users u on u.id = m.user_id order by 1, 2, 3')).rows.map((r) => `${r.email}:${r.role}:${r.apt ?? '-'}`).join(' | ');
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
const grantEsc = await one('treasurer@x.com', "insert into members(building_id,user_id,role) values (1,(select id from users where email = 'tenant@x.com'),'committee')");
check('committee cannot add a committee member', grantEsc === 'ERR' || grantEsc === 0);

// 3) same policies, functions and grants as a fresh install
const fresh = new PGlite(); await fresh.exec(STUB); await fresh.exec(schema);
const shape = async (d) => ({
  policies: (await d.query("select tablename, policyname, cmd, roles::text r, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2")).rows,
  functions: (await d.query("select proname, prosecdef, pg_get_functiondef(oid) def from pg_proc where pronamespace = 'public'::regnamespace order by 1")).rows,
  grants: (await d.query("select table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee = 'authenticated' order by 1, 2")).rows,
  columns: (await d.query("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name in ('members','users','residents','owners') order by 1, 2")).rows,
  constraints: (await d.query("select conrelid::regclass::text t, conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid in ('public.members'::regclass, 'public.users'::regclass, 'public.residents'::regclass, 'public.owners'::regclass) order by 1, 2")).rows,
  indexes: (await d.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename in ('members','super_users','users') order by 1")).rows,
});
const [s1, s2] = [await shape(a), await shape(fresh)];
for (const k of Object.keys(s1)) check(`migrated ${k} equal a fresh install`, JSON.stringify(s1[k]) === JSON.stringify(s2[k]));

// 4) the loaded fixture + a role check also work on the migrated database
const b = await legacyDb();
await b.exec(migrateRoles); await b.exec(migrateUsers); await b.exec(schema);
await b.exec('delete from members; delete from payments; delete from apartments; delete from buildings; delete from users');
await loadFixture(b);
const r2 = makeRunner(b);
check('fixture behaves the same on a migrated database (tenant sees own apartment payments only)', (await r2.one('t8@x.com', 'select * from public.apt_payments(1, 8, 2026)')) === 1 && (await r2.one('t8@x.com', 'select * from public.apt_payments(1, 9, 2026)')) === 0);

// 5) the retired view-only role: migration refuses and changes nothing
const c = await legacyDb("insert into members(building_id, email, role) values (1,'viewer@x.com','admin');");
let refused = false;
try { await c.exec(migrateRoles); } catch (e) { refused = true; await c.exec('rollback'); }
check('migration refuses while view-only admin rows exist', refused);
check('...and leaves members unchanged', (await c.query("select count(*)::int n from members where role = 'owner'")).rows[0].n === 2);

// 6) the five-role database that keeps names on residents/owners: people move into users, links and data are kept
async function v2Db() {
  const d = new PGlite(); await d.exec(STUB); await d.exec(oldSchemaV2);
  await d.exec(`
    insert into buildings(id, name) values (1, 'Real building');
    insert into apartments(building_id, apt) values (1,8),(1,9),(1,18);
    insert into super_users(email) values ('boss@x.com');
    insert into managers(email) values ('mgr@x.com');
    insert into members(building_id, email, role, apt, name) values
      (1,'me@x.com','committee',null,'Oren Haim'),(1,'me@x.com','apt_owner',18,'Oren Haim'),(1,'ten@x.com','tenant',8,null);
    insert into residents(building_id, key, apt, first_name, last_name, first2, last2, phone1, phone2, role, status, account) values
      (1,'8-a',8,'Roi','Kaldero','Dana','Kaldero','050-1','050-2','tenant','עזב','87086516'),
      (1,'8-b',8,'Danny','Edut',null,null,'050-3',null,'tenant','פעיל',null),
      (1,'9-a',9,'Lone','Phone',null,null,'050-4','050-5','tenant','פעיל',null),
      (1,'9-b',9,null,null,null,null,null,null,'tenant','פעיל',null);
    insert into owners(building_id, apt, first_name, last_name, phone, account, note) values
      (1,8,'Abe','Stone','054-1','999','note'),(1,9,null,null,null,null,null);
    insert into payments(building_id, key, apt, y, m, amount) values (1,'8-b',8,2026,10,570);
    insert into snapshot(building_id, data) values (1,'{"title":"x","grids":{}}');`);
  return d;
}
const v = await v2Db();
await v.exec(migrateUsers); await v.exec(schema);
const un = async (sql) => (await v.query(sql)).rows;
const people = (await un("select email, first_name, last_name, phone, bank_account from users order by id")).map((r) => `${r.email ?? '-'}:${r.first_name ?? '-'}:${r.last_name ?? '-'}:${r.phone ?? '-'}:${r.bank_account ?? '-'}`);
check('users: logins first (split names), then each tenant, a second person or phone, and each owner',
  JSON.stringify([...people].sort()) === JSON.stringify([
    'me@x.com:Oren:Haim:-:-', 'ten@x.com:-:-:-:-', 'boss@x.com:-:-:-:-', 'mgr@x.com:-:-:-:-',
    '-:Roi:Kaldero:050-1:87086516', '-:Dana:Kaldero:050-2:-', '-:Danny:Edut:050-3:-', '-:Lone:Phone:050-4:-', '-:-:-:050-5:-', '-:Abe:Stone:054-1:999'].sort()), `(${people.join(' | ')})`);
const links = (await un("select r.key, u1.first_name f1, u2.first_name f2, u2.phone p2 from residents r left join users u1 on u1.id = r.user_id left join users u2 on u2.id = r.user2_id order by r.id")).map((r) => `${r.key}:${r.f1 ?? '-'}:${r.f2 ?? '-'}:${r.p2 ?? '-'}`);
check('residents point at their person and second person; an empty tenancy points at nobody',
  JSON.stringify(links) === JSON.stringify(['8-a:Roi:Dana:050-2', '8-b:Danny:-:-', '9-a:Lone:-:050-5', '9-b:-:-:-']), `(${links.join(' | ')})`);
check('owners point at their person (an owner with no details points at nobody)', (await un("select count(*)::int n from owners where user_id is not null"))[0].n === 1);
check('roles keep their rows (a person holds committee and owner of 18 at once)', (await un("select count(*)::int n from members m join users u on u.id = m.user_id where u.email = 'me@x.com'"))[0].n === 2);
check('the old personal columns are gone', (await un("select count(*)::int n from information_schema.columns where table_schema = 'public' and ((table_name = 'residents' and column_name in ('first_name','last_name','first2','last2','phone1','phone2','account')) or (table_name = 'owners' and column_name in ('first_name','last_name','phone','account')) or (table_name = 'members' and column_name in ('email','name')))"))[0].n === 0);
check('payments and snapshot untouched', (await un("select count(*)::int n from payments"))[0].n === 1 && (await un("select count(*)::int n from snapshot"))[0].n === 1);
const before = JSON.stringify(await un('select * from users order by id'));
await v.exec(migrateUsers); await v.exec(schema);
check('running both scripts again changes nothing', JSON.stringify(await un('select * from users order by id')) === before);
const s3 = await shape(v);
for (const k of Object.keys(s3)) check(`v2-migrated ${k} equal a fresh install`, JSON.stringify(s3[k]) === JSON.stringify(s2[k]));
{
  const { one: one3 } = makeRunner(v);
  check('migrated committee member reads their building\'s people and payments', (await one3('me@x.com', 'select * from users')) === 8 && (await one3('me@x.com', 'select * from payments')) === 1);
  check('migrated tenant sees only their own user row', (await one3('ten@x.com', 'select * from users')) === 1);
  check('migrated owner of 18 sees the tenants of 18 (none) without error', (await one3('me@x.com', 'select * from public.apt_tenants(1)')) === 0);
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
