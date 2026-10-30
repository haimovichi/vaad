// Verifies supabase/schema.sql: the five roles, multi-role users, the grant hierarchy and building isolation,
// in an in-process Postgres (PGlite) with a stub of Supabase's auth.jwt().
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

export const STUB = `create role anon nologin; create role authenticated nologin; create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated;`;

export async function loadFixture(db) {
  await db.exec(`
    insert into buildings(id, name) values (1,'B1'),(2,'B2'),(3,'B3');
    select setval(pg_get_serial_sequence('public.buildings', 'id'), 3);
    insert into super_users(email) values ('super@x.com');
    insert into managers(email) values ('m12@x.com'),('m3@x.com');
    insert into manager_buildings(building_id, email) values (1,'m12@x.com'),(2,'m12@x.com'),(3,'m3@x.com');
    insert into members(building_id, email, role, apt, name) values
      (1,'c1@x.com','committee',null,'C1'),(2,'c2@x.com','committee',null,'C2'),
      (1,'t8@x.com','tenant',8,'T8'),(1,'t9@x.com','tenant',9,'T9'),(1,'ao8@x.com','apt_owner',8,'AO8'),
      (1,'multi@x.com','committee',null,'Multi'),(2,'multi@x.com','tenant',3,'Multi'),(2,'multi@x.com','apt_owner',5,'Multi');
    insert into apartments(building_id, apt) values (1,8),(1,9),(2,3),(2,5),(3,1);
    insert into residents(building_id, key, apt, first_name, last_name, phone1, status) values
      (1,'8-a',8,'Cur','Tenant','050-8',null),(1,'8-old',8,'Old','Tenant','050-0','עזב'),(1,'9-a',9,'Nine','Nine','050-9','פעיל'),
      (2,'3-a',3,'Three','T','050-3','פעיל'),(2,'5-a',5,'Five','F','050-5','פעיל'),(3,'1-a',1,'One','O','050-1','פעיל');
    insert into payments(building_id, key, apt, y, m, amount, note) values
      (1,'8-a',8,2026,10,570,'bank: secret 1'),(1,'8-old',8,2026,3,100,'previous tenant'),(1,'9-a',9,2026,10,570,'n9'),
      (2,'3-a',3,2026,10,570,'n3'),(2,'5-a',5,2026,10,570,'n5'),(3,'1-a',1,2026,10,570,'n1');
    insert into snapshot(building_id, data) values
      (1,'{"title":"B1","grids":{"2026":[{"apt":8,"months":[]},{"apt":9,"months":[]}]}}'),
      (2,'{"title":"B2","grids":{"2026":[{"apt":3,"months":[]},{"apt":5,"months":[]}]}}'),
      (3,'{"title":"B3","grids":{"2026":[{"apt":1,"months":[]}]}}');
  `);
}

export async function makeDb(schemaSql) {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(schemaSql);
  return db;
}

export function makeRunner(db) {
  // run `fn` as a logged-in email (or anon when null) inside a transaction that is always rolled back
  const asUser = async (email, fn) => {
    await db.exec('begin');
    try {
      if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
      await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
      return await fn((sql) => db.query(sql));
    } catch (e) { return 'ERR'; } finally { await db.exec('rollback'); }
  };
  const one = async (email, sql) => asUser(email, async (q) => {
    const r = await q(sql);
    return /^\s*(select|with)/i.test(sql) ? r.rows.length : r.affectedRows;
  });
  const val = async (email, sql) => asUser(email, async (q) => { const r = await q(sql); return r.rows[0] ? Object.values(r.rows[0])[0] : null; });
  return { asUser, one, val };
}

if (process.argv[1].endsWith('test-rls.mjs')) {
  const schemaSql = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const db = await makeDb(schemaSql);
  await loadFixture(db);
  const { asUser, one, val } = makeRunner(db);

  let bad = 0; let n = 0;
  const report = (ok, who, what, expect, got) => { n++; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${who.padEnd(9)} ${what.padEnd(48)} expected ${expect} got ${got}`); };
  // an anonymous caller has no table access at all, so "0 rows" and "permission denied" both mean nothing was readable
  const rows = async (who, email, what, sql, expect) => { const got = await one(email, sql); report(got === expect || (email === null && expect === 0 && got === 'ERR'), who, what, expect, got); };
  const blocked = async (who, email, what, sql) => { const got = await one(email, sql); report(got === 0 || got === 'ERR', who, what, 'BLOCKED', got); };
  const value = async (who, email, what, sql, expect) => { const got = await val(email, sql); report(got === expect, who, what, expect, got); };

  // who -> email, buildings they can manage (staff data), buildings whose board they may read
  const people = {
    super:    ['super@x.com',    [1, 2, 3], [1, 2, 3]],
    manager12:['m12@x.com',      [1, 2],    [1, 2]],
    manager3: ['m3@x.com',       [3],       [3]],
    committee1:['c1@x.com',      [1],       [1]],
    committee2:['c2@x.com',      [2],       [2]],
    tenant8:  ['t8@x.com',       [],        [1]],
    tenant9:  ['t9@x.com',       [],        [1]],
    aptOwner8:['ao8@x.com',      [],        []],
    multi:    ['multi@x.com',    [1],       [1, 2]],     // committee of 1; tenant + apartment owner in 2
    stranger: ['nobody@x.com',   [],        []],
    anon:     [null,             [],        []],
  };
  const PAY = { 1: 3, 2: 2, 3: 1 };      // payments per building in the fixture
  const RES = { 1: 3, 2: 2, 3: 1 };      // residents per building in the fixture

  for (const [who, [email, manage, board]] of Object.entries(people)) {
    for (const b of [1, 2, 3]) {
      const m = manage.includes(b);
      await rows(who, email, `read payments B${b}`, `select * from payments where building_id = ${b}`, m ? PAY[b] : (email ? 0 : 0));
      await rows(who, email, `read residents (phones) B${b}`, `select * from residents where building_id = ${b}`, m ? RES[b] : 0);
      await rows(who, email, `read snapshot table B${b}`, `select * from snapshot where building_id = ${b}`, board.includes(b) ? 1 : 0);
      if (m) {
        await rows(who, email, `insert payment B${b}`, `insert into payments(building_id,key,apt,y,m,amount) values (${b},'x',1,2026,11,1)`, 1);
        await rows(who, email, `update payment B${b}`, `update payments set amount = 1 where building_id = ${b}`, PAY[b]);
        await rows(who, email, `delete payment B${b}`, `delete from payments where building_id = ${b}`, PAY[b]);
        await rows(who, email, `write snapshot B${b}`, `update snapshot set data = data where building_id = ${b}`, 1);
        await rows(who, email, `rename building B${b}`, `update buildings set name = 'renamed' where id = ${b}`, 1);
      } else {
        await blocked(who, email, `insert payment B${b}`, `insert into payments(building_id,key,apt,y,m,amount) values (${b},'x',1,2026,11,1)`);
        await blocked(who, email, `update payment B${b}`, `update payments set amount = 1 where building_id = ${b}`);
        await blocked(who, email, `delete payment B${b}`, `delete from payments where building_id = ${b}`);
        await blocked(who, email, `write snapshot B${b}`, `update snapshot set data = '{}' where building_id = ${b}`);
        await blocked(who, email, `rename building B${b}`, `update buildings set name = 'hacked' where id = ${b}`);
      }
    }
  }

  // buildings each person can see
  const SEES = { super: 3, manager12: 2, manager3: 1, committee1: 1, committee2: 1, tenant8: 1, tenant9: 1, aptOwner8: 1, multi: 2, stranger: 0 };
  for (const [who, [email]] of Object.entries(people)) if (email) await rows(who, email, 'buildings visible', 'select * from buildings', SEES[who]);
  await blocked('anon', null, 'buildings visible', 'select * from buildings');
  await blocked('super', 'super@x.com', 'delete a building (SQL editor only)', 'delete from buildings where id = 3');
  await blocked('manager12', 'm12@x.com', 'create a building by direct insert', "insert into buildings(name) values ('x')");

  // my_snapshot(): board for tenants/managers; only owned apartments for an apartment owner
  const snapLen = (b) => `select coalesce(jsonb_array_length(public.my_snapshot(${b}) -> 'grids' -> '2026'), -1) as v`;
  await value('super', 'super@x.com', 'my_snapshot B1 (full board)', snapLen(1), 2);
  await value('committee1', 'c1@x.com', 'my_snapshot B1 (full board)', snapLen(1), 2);
  await value('tenant8', 't8@x.com', 'my_snapshot B1 (full board)', snapLen(1), 2);
  await value('tenant8', 't8@x.com', 'my_snapshot B2 (not a member)', snapLen(2), -1);
  await value('aptOwner8', 'ao8@x.com', 'my_snapshot B1 (only owned apartment 8)', snapLen(1), 1);
  await value('aptOwner8', 'ao8@x.com', 'my_snapshot only shows apartment 8', "select (public.my_snapshot(1) -> 'grids' -> '2026' -> 0 ->> 'apt')::int as v", 8);
  await value('multi', 'multi@x.com', 'my_snapshot B2 (tenant: full board)', snapLen(2), 2);
  await value('stranger', 'nobody@x.com', 'my_snapshot B1', snapLen(1), -1);
  await value('anon', null, 'my_snapshot B1', snapLen(1), 'ERR');

  // apt_payments(): own apartment, current tenancy only; managers any apartment in their buildings
  const AP = (b, a) => `select * from public.apt_payments(${b}, ${a}, 2026)`;
  await rows('committee1', 'c1@x.com', 'apt_payments own building apt 8 (both tenancies)', AP(1, 8), 2);
  await rows('super', 'super@x.com', 'apt_payments any building', AP(2, 3), 1);
  await rows('manager12', 'm12@x.com', 'apt_payments B1 apt 8', AP(1, 8), 2);
  await rows('manager12', 'm12@x.com', 'apt_payments B3 (not theirs)', AP(3, 1), 0);
  await rows('manager3', 'm3@x.com', 'apt_payments B3', AP(3, 1), 1);
  await rows('tenant8', 't8@x.com', 'apt_payments own apt (current tenancy only)', AP(1, 8), 1);
  await rows('tenant8', 't8@x.com', 'apt_payments another apartment', AP(1, 9), 0);
  await rows('aptOwner8', 'ao8@x.com', 'apt_payments owned apt (current tenancy only)', AP(1, 8), 1);
  await rows('aptOwner8', 'ao8@x.com', 'apt_payments not owned apt', AP(1, 9), 0);
  await rows('multi', 'multi@x.com', 'apt_payments as tenant of B2 apt 3', AP(2, 3), 1);
  await rows('multi', 'multi@x.com', 'apt_payments as apt owner of B2 apt 5', AP(2, 5), 1);
  await rows('multi', 'multi@x.com', 'apt_payments as committee of B1', AP(1, 8), 2);
  await rows('committee2', 'c2@x.com', 'apt_payments other building', AP(1, 8), 0);
  await rows('stranger', 'nobody@x.com', 'apt_payments', AP(1, 8), 0);
  await blocked('anon', null, 'apt_payments', AP(1, 8));
  {
    const cols = await asUser('t8@x.com', async (q) => (await q(AP(1, 8))).fields.map((f) => f.name).join(','));
    report(cols === 'y,m,amount,method,paid_on', 'tenant8', 'columns exposed: month/amount/method/date only', 'y,m,amount,method,paid_on', cols);
  }

  // apt_tenants(): names and phones of the current tenants of apartments you own
  await rows('aptOwner8', 'ao8@x.com', 'apt_tenants (current tenant of owned apt)', 'select * from public.apt_tenants(1)', 1);
  await value('aptOwner8', 'ao8@x.com', 'apt_tenants shows the tenant phone', 'select phone1 from public.apt_tenants(1)', '050-8');
  await rows('aptOwner8', 'ao8@x.com', 'apt_tenants other building', 'select * from public.apt_tenants(2)', 0);
  await rows('multi', 'multi@x.com', 'apt_tenants B2 (owns apt 5)', 'select * from public.apt_tenants(2)', 1);
  await rows('tenant8', 't8@x.com', 'apt_tenants as a plain tenant', 'select * from public.apt_tenants(1)', 0);
  await rows('stranger', 'nobody@x.com', 'apt_tenants', 'select * from public.apt_tenants(1)', 0);

  // members: who sees which rows
  await rows('tenant8', 't8@x.com', 'members visible', 'select * from members', 1);
  await rows('aptOwner8', 'ao8@x.com', 'members visible', 'select * from members', 1);
  await rows('committee1', 'c1@x.com', 'members visible (own building)', 'select * from members', 5);
  await rows('manager12', 'm12@x.com', 'members visible (both buildings)', 'select * from members', 8);
  await rows('super', 'super@x.com', 'members visible (all)', 'select * from members', 8);
  await rows('multi', 'multi@x.com', 'members visible (own rows + B1 as committee)', 'select * from members', 7);
  await rows('stranger', 'nobody@x.com', 'members visible', 'select * from members', 0);

  // granting: super > manager > committee
  const addM = (b, e, r, apt) => `insert into members(building_id,email,role,apt) values (${b},'${e}','${r}',${apt ?? 'null'})`;
  await rows('super', 'super@x.com', 'add a committee member to B3', addM(3, 'n@x.com', 'committee'), 1);
  await rows('super', 'super@x.com', 'add a tenant to B2', addM(2, 'n@x.com', 'tenant', 3), 1);
  await rows('manager12', 'm12@x.com', 'add committee to own B1', addM(1, 'n@x.com', 'committee'), 1);
  await rows('manager12', 'm12@x.com', 'add apartment owner to own B2', addM(2, 'n@x.com', 'apt_owner', 3), 1);
  await blocked('manager12', 'm12@x.com', 'add committee to B3 (not theirs)', addM(3, 'n@x.com', 'committee'));
  await blocked('manager3', 'm3@x.com', 'add a tenant to B1 (not theirs)', addM(1, 'n@x.com', 'tenant', 8));
  await rows('manager12', 'm12@x.com', 'remove a committee member of own building', "delete from members where building_id = 1 and email = 'c1@x.com'", 1);
  await rows('committee1', 'c1@x.com', 'add a tenant to own building', addM(1, 'n@x.com', 'tenant', 8), 1);
  await rows('committee1', 'c1@x.com', 'add an apartment owner to own building', addM(1, 'n@x.com', 'apt_owner', 9), 1);
  await rows('committee1', 'c1@x.com', 'relink a tenant to another apartment', "update members set apt = 9 where building_id = 1 and email = 't8@x.com'", 1);
  await rows('committee1', 'c1@x.com', 'remove a tenant', "delete from members where building_id = 1 and email = 't9@x.com'", 1);
  await blocked('committee1', 'c1@x.com', 'add a committee member', addM(1, 'n@x.com', 'committee'));
  await blocked('committee1', 'c1@x.com', 'promote a tenant to committee', "update members set role = 'committee', apt = null where building_id = 1 and email = 't8@x.com'");
  await blocked('committee1', 'c1@x.com', 'remove another committee member', "delete from members where building_id = 1 and email = 'multi@x.com' and role = 'committee'");
  await blocked('committee1', 'c1@x.com', 'remove own committee role', "delete from members where building_id = 1 and email = 'c1@x.com'");
  await blocked('committee1', 'c1@x.com', 'add a tenant to another building', addM(2, 'n@x.com', 'tenant', 3));
  await blocked('committee1', 'c1@x.com', 'move a tenant row to another building', "update members set building_id = 2 where email = 't8@x.com'");
  await rows('multi', 'multi@x.com', 'committee of B1 adds a tenant to B1', addM(1, 'n@x.com', 'tenant', 8), 1);
  await blocked('multi', 'multi@x.com', 'tenant of B2 adds a tenant to B2', addM(2, 'n@x.com', 'tenant', 3));
  for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
    await blocked(who, email, 'add a member', addM(1, 'n@x.com', 'tenant', 8));
    await blocked(who, email, 'relink own apartment', `update members set apt = 9 where email = '${email}'`);
    await blocked(who, email, 'remove own membership', `delete from members where email = '${email}'`);
  }
  await blocked('tenant8', 't8@x.com', 'make self committee', addM(1, 't8@x.com', 'committee'));
  await blocked('committee2', 'c2@x.com', 'add a tenant to B1', addM(1, 'n@x.com', 'tenant', 8));

  // super user and manager tables
  for (const [who, [email]] of Object.entries(people)) {
    await blocked(who, email, 'read super_users', 'select * from super_users');
    await blocked(who, email, 'add a super user', "insert into super_users(email) values ('evil@x.com')");
    await blocked(who, email, 'delete the super user', 'delete from super_users');
  }
  let second = false;
  try { await db.exec("insert into super_users(email) values ('b@x.com')"); } catch (e) { second = true; }
  report(second, 'sql', 'even the SQL editor cannot add a second super user', 'refused', second ? 'refused' : 'ADDED');
  await rows('super', 'super@x.com', 'add a manager', "insert into managers(email) values ('new@x.com')", 1);
  await rows('super', 'super@x.com', 'assign a manager to a building', "insert into manager_buildings(building_id,email) values (3,'m12@x.com')", 1);
  await rows('super', 'super@x.com', 'read managers', 'select * from managers', 2);
  await blocked('manager12', 'm12@x.com', 'add a manager', "insert into managers(email) values ('new@x.com')");
  await blocked('manager12', 'm12@x.com', 'assign self to another building', "insert into manager_buildings(building_id,email) values (3,'m12@x.com')");
  await rows('manager12', 'm12@x.com', 'reads only own manager rows', 'select * from manager_buildings', 2);
  await rows('manager12', 'm12@x.com', 'reads only own manager row', 'select * from managers', 1);
  await blocked('committee1', 'c1@x.com', 'add a manager', "insert into managers(email) values ('new@x.com')");
  await rows('committee1', 'c1@x.com', 'sees no managers', 'select * from managers', 0);
  await blocked('tenant8', 't8@x.com', 'assign a manager', "insert into manager_buildings(building_id,email) values (1,'t8@x.com')");

  // create_building
  const created = await asUser('m3@x.com', async (q) => {
    const id = (await q("select public.create_building('  New  ') as id")).rows[0].id;
    const mine = (await q(`select * from manager_buildings where building_id = ${id} and email = 'm3@x.com'`)).rows.length;
    const visible = (await q('select * from buildings')).rows.length;
    const name = (await q(`select name from buildings where id = ${id}`)).rows[0].name;
    return `${mine}/${visible}/${name}`;
  });
  report(created === '1/2/New', 'manager3', 'creates a building and becomes its manager', '1/2/New', created);
  const superMade = await asUser('super@x.com', async (q) => {
    const id = (await q("select public.create_building('S') as id")).rows[0].id;
    return (await q(`select * from manager_buildings where building_id = ${id}`)).rows.length;
  });
  report(superMade === 0, 'super', 'creates a building (no manager row needed)', 0, superMade);
  const leak = await asUser('m12@x.com', async (q) => { await q("select public.create_building('Z')"); return (await q('select * from buildings')).rows.length; });
  report(leak === 3, 'manager12', 'sees own buildings plus the new one', 3, leak);
  for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
    await blocked(who, email, 'create a building', "select public.create_building('X')");
  }
  const comMade = await asUser('c1@x.com', async (q) => {
    const id = (await q("select public.create_building('Com') as id")).rows[0].id;
    const role = (await q(`select role from members where building_id = ${id} and email = 'c1@x.com'`)).rows.map((r) => r.role).join();
    const mgr = (await q(`select * from manager_buildings where building_id = ${id}`)).rows.length;
    return `${role}/${mgr}`;
  });
  report(comMade === 'committee/0', 'committee1', 'creates a building and becomes its committee', 'committee/0', comMade);
  await blocked('manager3', 'm3@x.com', 'create a building with an empty name', "select public.create_building('   ')");

  console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} passed`);
  process.exit(bad ? 1 : 0);
}
