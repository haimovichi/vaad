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
    -- people: logins have an email; tenants from the old workbook have none (identified here by phone)
    create function t_uid(e text) returns bigint language sql security definer set search_path = public as $f$ select id from public.users where email = e $f$;
    create function t_pid(p text) returns bigint language sql security definer set search_path = public as $f$ select id from public.users where phone = p $f$;
    insert into users(email, first_name, last_name) values
      ('c1@x.com','C1',null),('c2@x.com','C2',null),('t8@x.com','T8',null),('t9@x.com','T9',null),('ao8@x.com','AO8',null),
      ('multi@x.com','Multi',null),('n@x.com','New',null);
    insert into users(first_name, last_name, phone) values
      ('Cur','Tenant','050-8'),('Old','Tenant','050-0'),('Nine','Nine','050-9'),
      ('Three','T','050-3'),('Five','F','050-5'),('One','O','050-1');
    insert into bank_accounts(user_id, account) values (t_pid('050-8'),'111'),(t_pid('050-8'),'112'),(t_pid('050-9'),'999'),(t_uid('t8@x.com'),'777');
    insert into members(building_id, user_id, role, apt) values
      (1,t_uid('c1@x.com'),'committee',null),(2,t_uid('c2@x.com'),'committee',null),
      (1,t_uid('t8@x.com'),'tenant',8),(1,t_uid('t9@x.com'),'tenant',9),(1,t_uid('ao8@x.com'),'apt_owner',8),
      (1,t_uid('multi@x.com'),'committee',null),(2,t_uid('multi@x.com'),'tenant',3),(2,t_uid('multi@x.com'),'apt_owner',5);
    insert into apartments(building_id, apt) values (1,8),(1,9),(2,3),(2,5),(3,1);
    insert into residents(building_id, key, apt, user_id, status) values
      (1,'8-a',8,t_pid('050-8'),null),(1,'8-old',8,t_pid('050-0'),'עזב'),(1,'9-a',9,t_pid('050-9'),'פעיל'),
      (2,'3-a',3,t_pid('050-3'),'פעיל'),(2,'5-a',5,t_pid('050-5'),'פעיל'),(3,'1-a',1,t_pid('050-1'),'פעיל');
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
        if (who === 'super') await rows(who, email, `rename building B${b}`, `update buildings set name = 'renamed' where id = ${b}`, 1);
        else await blocked(who, email, `rename building B${b}`, `update buildings set name = 'renamed' where id = ${b}`);
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
  const addM = (b, e, r, apt) => `insert into members(building_id,user_id,role,apt) values (${b},t_uid('${e}'),'${r}',${apt ?? 'null'})`;
  await rows('super', 'super@x.com', 'add a committee member to B3', addM(3, 'n@x.com', 'committee'), 1);
  await rows('super', 'super@x.com', 'add a tenant to B2', addM(2, 'n@x.com', 'tenant', 3), 1);
  await rows('manager12', 'm12@x.com', 'add committee to own B1', addM(1, 'n@x.com', 'committee'), 1);
  await rows('manager12', 'm12@x.com', 'add apartment owner to own B2', addM(2, 'n@x.com', 'apt_owner', 3), 1);
  await blocked('manager12', 'm12@x.com', 'add committee to B3 (not theirs)', addM(3, 'n@x.com', 'committee'));
  await blocked('manager3', 'm3@x.com', 'add a tenant to B1 (not theirs)', addM(1, 'n@x.com', 'tenant', 8));
  await rows('manager12', 'm12@x.com', 'remove a committee member of own building', "delete from members where building_id = 1 and user_id = t_uid('c1@x.com')", 1);
  await rows('committee1', 'c1@x.com', 'add a tenant to own building', addM(1, 'n@x.com', 'tenant', 8), 1);
  await rows('committee1', 'c1@x.com', 'add an apartment owner to own building', addM(1, 'n@x.com', 'apt_owner', 9), 1);
  await rows('committee1', 'c1@x.com', 'relink a tenant to another apartment', "update members set apt = 9 where building_id = 1 and user_id = t_uid('t8@x.com')", 1);
  await rows('committee1', 'c1@x.com', 'remove a tenant', "delete from members where building_id = 1 and user_id = t_uid('t9@x.com')", 1);
  await blocked('committee1', 'c1@x.com', 'add a committee member', addM(1, 'n@x.com', 'committee'));
  await blocked('committee1', 'c1@x.com', 'promote a tenant to committee', "update members set role = 'committee', apt = null where building_id = 1 and user_id = t_uid('t8@x.com')");
  await blocked('committee1', 'c1@x.com', 'remove another committee member', "delete from members where building_id = 1 and user_id = t_uid('multi@x.com') and role = 'committee'");
  await blocked('committee1', 'c1@x.com', 'remove own committee role', "delete from members where building_id = 1 and user_id = t_uid('c1@x.com')");
  await blocked('committee1', 'c1@x.com', 'add a tenant to another building', addM(2, 'n@x.com', 'tenant', 3));
  await blocked('committee1', 'c1@x.com', 'move a tenant row to another building', "update members set building_id = 2 where user_id = t_uid('t8@x.com')");
  await rows('multi', 'multi@x.com', 'committee of B1 adds a tenant to B1', addM(1, 'n@x.com', 'tenant', 8), 1);
  await blocked('multi', 'multi@x.com', 'tenant of B2 adds a tenant to B2', addM(2, 'n@x.com', 'tenant', 3));
  for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
    await blocked(who, email, 'add a member', addM(1, 'n@x.com', 'tenant', 8));
    await blocked(who, email, 'relink own apartment', `update members set apt = 9 where user_id = t_uid('${email}')`);
    await blocked(who, email, 'remove own membership', `delete from members where user_id = t_uid('${email}')`);
  }
  await blocked('tenant8', 't8@x.com', 'make self committee', addM(1, 't8@x.com', 'committee'));
  await blocked('committee2', 'c2@x.com', 'add a tenant to B1', addM(1, 'n@x.com', 'tenant', 8));

  // users: one row per person; staff read their building's people, only the super user writes
  await rows('super', 'super@x.com', 'users visible (all)', 'select * from users', 13);
  await rows('manager12', 'm12@x.com', 'users visible (staff of B1 and B2)', 'select * from users', 11);
  await rows('manager3', 'm3@x.com', 'users visible (staff of B3)', 'select * from users', 1);
  await rows('committee1', 'c1@x.com', 'users visible (people of own building)', 'select * from users', 8);
  await rows('committee2', 'c2@x.com', 'users visible (people of own building)', 'select * from users', 4);
  await rows('multi', 'multi@x.com', 'users visible (committee of B1, tenant/owner of B2)', 'select * from users', 8);
  await rows('tenant8', 't8@x.com', 'users visible (own row only)', 'select * from users', 1);
  await rows('aptOwner8', 'ao8@x.com', 'users visible (own row only)', 'select * from users', 1);
  await rows('stranger', 'nobody@x.com', 'users visible', 'select * from users', 0);
  await blocked('anon', null, 'users visible', 'select * from users');
  await value('committee1', 'c1@x.com', 'a tenant has two bank accounts, both readable by staff', "select string_agg(account, ',' order by account) from bank_accounts where user_id = t_pid('050-8')", '111,112');

  // bank accounts: a separate table linked to the user; read where the user is readable, written only by the super user
  for (const [who, email, n] of [['super', 'super@x.com', 4], ['manager12', 'm12@x.com', 4], ['manager3', 'm3@x.com', 0], ['committee1', 'c1@x.com', 4], ['committee2', 'c2@x.com', 0],
    ['tenant8', 't8@x.com', 1], ['aptOwner8', 'ao8@x.com', 0], ['multi', 'multi@x.com', 4], ['stranger', 'nobody@x.com', 0]]) {
    await rows(who, email, 'bank accounts visible', 'select * from bank_accounts', n);
  }
  await blocked('anon', null, 'bank accounts visible', 'select * from bank_accounts');
  await value('tenant8', 't8@x.com', 'a tenant reads his own account', "select account from bank_accounts", '777');
  await rows('super', 'super@x.com', 'super adds an account', "insert into bank_accounts(user_id, account) values (t_pid('050-0'), '555')", 1);
  await rows('super', 'super@x.com', 'super edits an account', "update bank_accounts set note = 'joint' where account = '111'", 1);
  await rows('super', 'super@x.com', 'super removes an account', "delete from bank_accounts where account = '112'", 1);
  await blocked('super', 'super@x.com', 'the same account twice for one person', "insert into bank_accounts(user_id, account) values (t_pid('050-8'), '111')");
  await rows('super', 'super@x.com', 'two people may share an account (joint account)', "insert into bank_accounts(user_id, account) values (t_pid('050-0'), '111')", 1);
  await blocked('super', 'super@x.com', 'an empty account', "insert into bank_accounts(user_id, account) values (t_pid('050-0'), '  ')");
  for (const [who, email] of [['committee1', 'c1@x.com'], ['manager12', 'm12@x.com'], ['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
    await blocked(who, email, 'add a bank account', "insert into bank_accounts(user_id, account) values (t_pid('050-8'), '333')");
    await blocked(who, email, 'edit a bank account', "update bank_accounts set account = '1' where account = '111'");
    await blocked(who, email, 'delete a bank account', "delete from bank_accounts where account = '111'");
  }
  {
    const gone = await asUser('super@x.com', async (q) => {
      await q("insert into users(first_name, phone) values ('Temp', '000-0')");
      await q("insert into bank_accounts(user_id, account) values (t_pid('000-0'), '4242')");
      await q("delete from users where phone = '000-0'");
      return (await q("select count(*)::int n from bank_accounts where account = '4242'")).rows[0].n;
    });
    report(gone === 0, 'super', 'deleting a person deletes their bank accounts', 0, gone);
  }
  await value('tenant8', 't8@x.com', 'a tenant cannot read another user', "select count(*)::int from users where phone = '050-8'", 0);
  await rows('super', 'super@x.com', 'super edits a user', "update users set last_name = 'X' where email = 't8@x.com'", 1);
  await rows('super', 'super@x.com', 'super adds a user', "insert into users(first_name) values ('Walk-in')", 1);
  for (const [who, email] of [['committee1', 'c1@x.com'], ['manager12', 'm12@x.com'], ['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
    await blocked(who, email, 'edit a user', "update users set first_name = 'hacked' where email = 't8@x.com'");
    await blocked(who, email, 'edit own row', `update users set first_name = 'me' where email = '${email}'`);
    await blocked(who, email, 'add a user directly', "insert into users(first_name) values ('x')");
    await blocked(who, email, 'delete a user', "delete from users where email = 't9@x.com'");
  }
  await value('committee1', 'c1@x.com', 'user_for_email creates a user (email only)', "select public.user_for_email('brand.new@x.com') is not null", true);
  {
    const same = await asUser('c1@x.com', async (q) => { const a = (await q("select public.user_for_email('Same@X.com') as v")).rows[0].v; const b = (await q("select public.user_for_email('same@x.com') as v")).rows[0].v; return a === b; });
    report(same === true, 'committee1', 'user_for_email finds the same user (case-insensitive)', true, same);
  }
  await value('manager12', 'm12@x.com', 'a manager may call user_for_email', "select public.user_for_email('m.new@x.com') is not null", true);
  await value('super', 'super@x.com', 'super may call user_for_email', "select public.user_for_email('s.new@x.com') is not null", true);
  await blocked('committee1', 'c1@x.com', 'user_for_email with a bad address', "select public.user_for_email('not-an-email')");
  for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
    await blocked(who, email, 'user_for_email', "select public.user_for_email('x@y.com')");
  }
  {
    const lonely = await asUser('c1@x.com', async (q) => {
      const id = (await q("select public.user_for_email('plan@x.com') as v")).rows[0].v;
      await q(`insert into members(building_id,user_id,role,apt) values (1,${id},'tenant',8)`);
      return (await q("select count(*)::int n from users where email = 'plan@x.com'")).rows[0].n;
    });
    report(lonely === 1, 'committee1', 'a person created through user_for_email can be given a role and is then visible', 1, lonely);
  }
  {
    const many = await asUser('super@x.com', async (q) => {  // the same person: owns three apartments, is tenant in one, and is committee
      await q("insert into apartments(building_id, apt) values (1,20),(1,21),(1,22)");
      const id = (await q("select public.user_for_email('many@x.com') as v")).rows[0].v;
      for (const [role, apt] of [['apt_owner', 20], ['apt_owner', 21], ['apt_owner', 22], ['tenant', 20], ['committee', null]]) await q(`insert into members(building_id,user_id,role,apt) values (1,${id},'${role}',${apt})`);
      return (await q(`select count(*)::int n from members where user_id = ${id} and building_id = 1`)).rows[0].n;
    });
    report(many === 5, 'super', 'one user holds five roles in one building (owner x3, tenant, committee)', 5, many);
  }

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
    const role = (await q(`select role from members where building_id = ${id} and user_id = t_uid('c1@x.com')`)).rows.map((r) => r.role).join();
    const mgr = (await q(`select * from manager_buildings where building_id = ${id}`)).rows.length;
    return `${role}/${mgr}`;
  });
  report(comMade === 'committee/0', 'committee1', 'creates a building and becomes its committee', 'committee/0', comMade);
  await blocked('manager3', 'm3@x.com', 'create a building with an empty name', "select public.create_building('   ')");

  // match_payer: the bank-matching cascade of lib/match.js, in the database
  {
    const setup = `
      insert into apartments(building_id, apt) values (1,10),(1,11),(1,12),(1,13);
      insert into users(first_name, last_name, phone) values ('דוד','כהן','m-10'),('שרה','כהן','m-11'),('משה','לוי','m-12'),('רות','לוי','m-12b'),('דוד','כהן','m-13'),('יוסי','פרץ','m-left');
      insert into residents(building_id, key, apt, user_id, status) values
        (1,'10-a',10,(select id from users where phone='m-10'),null),(1,'11-a',11,(select id from users where phone='m-11'),'פעיל'),
        (1,'12-a',12,(select id from users where phone='m-12'),'פעיל'),(1,'13-a',13,(select id from users where phone='m-13'),'פעיל'),
        (1,'12-old',12,(select id from users where phone='m-left'),'עזב');
      insert into owners(building_id, apt, user_id) values (1,12,(select id from users where phone='m-12b'));
      insert into bank_accounts(user_id, account) values ((select id from users where phone='m-10'),'0012345');
      insert into meta(building_id, name, value) values (1,'aliases','{"ישראל ישראלי": 11}');`;
    const call = async (email, descr, b = 1) => {
      await db.exec('begin');
      try {
        await db.exec(setup);
        if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
        await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
        const r = await db.query('select * from public.match_payer($1, $2)', [b, descr]);
        const x = r.rows[0];
        return `${x.apt ?? '-'}|${x.how}|${x.sure}|${(x.candidates || []).join(',')}`;
      } catch (e) { return 'ERR'; } finally { await db.exec('rollback'); }
    };
    // two people are named דוד כהן here (apartments 10 and 13), so "full name" is only unambiguous with another first name
    const cases = [
      ['account number', 'העברה חשבון 10-800-1234-0012345 תשלום', '10|מספר חשבון|true|'],
      ['alias beats account', 'העברה ישראל ישראלי חשבון 10-800-1234-0012345', '11|זכור מתיקון קודם|true|'],
      ['apartment hint', 'תשלום דירה 12', '12|הערה בהעברה|true|'],
      ['hint to a missing apartment falls through to the name', 'דירה 99 משה לוי', '12|שם מלא|true|'],
      ['full name, one apartment', 'העברה שרה כהן ועד', '11|שם מלא|true|'],
      ['last name only', 'העברה לוי', '12|שם משפחה בלבד|false|'],
      ['shared last name lists candidates', 'העברה כהן', '-|כמה דירות לאותו שם|false|10,11,13'],
      ['shared full name lists candidates', 'העברה דוד כהן', '-|כמה דירות לאותו שם|false|10,13'],
      ['unknown payer', 'העברה אלמוני', '-|לא זוהה|false|'],
      ['a former tenant is not matched', 'העברה יוסי פרץ', '-|לא זוהה|false|'],
    ];
    for (const [what, descr, expect] of cases) {
      const got = await call('c1@x.com', descr);
      report(got === expect, 'committee1', `match_payer: ${what}`, expect, got);
    }
    for (const [who, email] of [['manager12', 'm12@x.com'], ['super', 'super@x.com']]) {
      const got = await call(email, 'תשלום דירה 12');
      report(got === '12|הערה בהעברה|true|', who, 'match_payer: allowed', 'ok', got);
    }
    for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['committee2', 'c2@x.com'], ['anon', null]]) {
      const got = await call(email, 'תשלום דירה 12');
      report(got === 'ERR', who, 'match_payer: refused', 'ERR', got);
    }
    const key = (await db.query('select public.payer_key($1) as k', ['העברה  דוד "כהן" 123-45 חשבון 10-800-1234-0012345'])).rows[0].k;
    report(key === 'דוד כהן', 'sql', 'payer_key strips words, quotes, digits and the account text', 'דוד כהן', key);
  }

  // split_payment: the month-allocation rules of lib/match.js, in the database
  {
    const setup = `
      insert into apartments(building_id, apt) values (1,20),(1,21),(1,22),(1,23);
      insert into residents(building_id, key, apt, entry_year, entry_month, status) values
        (1,'20-a',20,2026,1,null),(1,'21-a',21,2026,1,null),(1,'22-a',22,2026,1,null);
      insert into tariffs(building_id, year, month, apt, amount) values (1,2026,null,null,570),(1,2026,null,22,300),(1,2026,3,null,50);
      insert into payments(building_id, key, apt, y, m, amount) values (1,'20-a',20,2026,1,570),(1,'20-a',20,2026,2,285);`;
    const split = async (email, apt, amount, date, already = 0, sql = 'select * from public.split_payment(1, $1, $2, $3, $4)') => {
      await db.exec('begin');
      try {
        await db.exec(setup);
        if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
        await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
        const r = await db.query(sql, [apt, amount, date, already]);
        return r.rows.map((x) => `${x.yr}-${x.mo}:${+x.part}`).join(',');
      } catch (e) { return 'ERR'; } finally { await db.exec('rollback'); }
    };
    const cases = [
      ['transaction month, then the oldest unpaid of the last 6', 20, 1000, '2026-04-10', '2026-4:570,2026-2:285,2026-3:145'],
      ['upcoming months once nothing older is unpaid (March has a surcharge)', 21, 2000, '2026-01-05', '2026-1:570,2026-2:570,2026-3:620,2026-4:240'],
      ['only the last 6 months count as arrears; the rest is parked', 21, 4000, '2026-12-01', '2026-12:570,2026-6:570,2026-7:570,2026-8:570,2026-9:570,2026-10:570,2026-11:570,2026-12:10'],
      ['own tariff and a one-off surcharge', 22, 1000, '2026-01-01', '2026-1:300,2026-2:300,2026-3:350,2026-4:50'],
      ['nothing due anywhere: parked on the transaction month', 20, 100, '2030-01-15', '2030-1:100'],
      ['earlier proposals of the same import count as paid', 21, 570, '2026-01-05', '2026-2:570', 570],
      ['no tenancy: no rows', 23, 100, '2026-01-05', ''],
    ];
    for (const [what, apt, amount, date, expect, already] of cases) {
      const got = await split('c1@x.com', apt, amount, date, already);
      report(got === expect, 'committee1', `split_payment: ${what}`, expect, got);
      if (got !== 'ERR' && got !== '') {
        const sum = got.split(',').reduce((s, p) => s + +p.split(':')[1], 0);
        report(sum === amount, 'committee1', `split_payment: parts sum to the credit (${what})`, amount, sum);
      }
    }
    for (const [who, email] of [['manager12', 'm12@x.com'], ['super', 'super@x.com']]) {
      const got = await split(email, 21, 100, '2026-01-05');
      report(got === '2026-1:100', who, 'split_payment: allowed', 'ok', got);
    }
    for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['committee2', 'c2@x.com'], ['anon', null]]) {
      const got = await split(email, 21, 100, '2026-01-05');
      report(got === 'ERR', who, 'split_payment: refused', 'ERR', got);
    }
    const neg = await split('c1@x.com', 21, -5, '2026-01-05');
    report(neg === 'ERR', 'committee1', 'split_payment: refuses a non-positive amount', 'ERR', neg);
    const helper = await split('c1@x.com', 21, 1, '2026-01-05', 0, 'select 1 as yr, 1 as mo, public.tariff_due(1, $1, 2026, 1) as part where $2::int > 0 and $3::text <> $4::text');
    report(helper === 'ERR', 'committee1', 'tariff_due is not callable from the app', 'ERR', helper);
  }

  // pending payments: credits that wait for the committee, in a table of their own
  {
    const setup = `
      insert into apartments(building_id, apt) values (1,20);
      insert into residents(building_id, key, apt, entry_year, entry_month) values (1,'20-a',20,2026,1);
      insert into tariffs(building_id, year, month, apt, amount) values (1,2026,null,null,570);
      insert into members(building_id, user_id, role, apt) values (1,t_uid('t8@x.com'),'tenant',20);
      insert into payments(building_id, key, apt, y, m, amount) values (1,'20-a',20,2026,1,570);
      insert into pending_payments(building_id, y, m, amount, paid_on, auto_comment, tx_key) values (1,2026,2,1234,'2026-02-03','הצעה: דירה 20 (שם משפחה בלבד)','k1'),(2,2026,2,5,null,null,null);`;
    const run = async (email, sql) => {
      await db.exec('begin');
      try {
        await db.exec(setup);
        if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
        await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
        return (await db.query(sql)).rows;
      } catch (e) { return 'ERR'; } finally { await db.exec('rollback'); }
    };
    const n = (r) => (r === 'ERR' ? r : r.length);
    for (const [who, email, expect] of [['committee1', 'c1@x.com', 1], ['manager12', 'm12@x.com', 2], ['super', 'super@x.com', 2], ['committee2', 'c2@x.com', 1]]) {
      const l = await run(email, 'select * from pending_payments');
      report(n(l) === expect, who, 'reads the pending payments of the buildings they manage', expect, n(l));
    }
    const c1 = await run('c1@x.com', 'select * from pending_payments');
    report(Array.isArray(c1) && c1[0].auto_comment === 'הצעה: דירה 20 (שם משפחה בלבד)' && +c1[0].amount === 1234, 'committee1', 'the suggestion comes with the pending payment', 'ok', Array.isArray(c1) ? c1.length : c1);
    for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['anon', null]]) {
      const l = await run(email, 'select * from pending_payments');
      report(l === 'ERR' || l.length === 0, who, 'cannot read pending payments', 0, n(l));
      const w = await run(email, "insert into pending_payments(building_id, y, m, amount) values (1,2026,3,1) returning id");
      report(w === 'ERR' || w.length === 0, who, 'cannot add a pending payment', 'BLOCKED', n(w));
    }
    const other = await run('c2@x.com', "insert into pending_payments(building_id, y, m, amount) values (1,2026,3,1) returning id");
    report(other === 'ERR' || other.length === 0, 'committee2', "cannot add a pending payment to another building", 'BLOCKED', n(other));
    const add = await run('c1@x.com', "insert into pending_payments(building_id, y, m, amount, auto_comment) values (1,2026,3,50,'x') returning id");
    report(Array.isArray(add) && add.length === 1, 'committee1', 'adds a pending payment to their building', 1, n(add));
    const mine = await run('t8@x.com', 'select * from public.apt_payments(1, 20, 2026)');
    report(Array.isArray(mine) && mine.length === 1 && +mine[0].amount === 570, 'tenant20', 'own payments never include a pending credit', 1, n(mine));
    const feb = await run('c1@x.com', "select * from public.split_payment(1, 20, 100, '2026-02-10')");
    report(Array.isArray(feb) && feb.length === 1 && feb[0].yr === 2026 && feb[0].mo === 2, 'committee1', 'a pending credit fills no month: February is still unpaid', '2026-2', Array.isArray(feb) ? `${feb[0].yr}-${feb[0].mo}` : feb);
    const pay = await run('c1@x.com', 'select count(*)::int n from payments where apt = 20');
    report(Array.isArray(pay) && pay[0].n === 1, 'committee1', 'payments still holds only real payments', 1, Array.isArray(pay) ? pay[0].n : pay);
  }

  // save_pending_credits: unsure credits are stored without an apartment, with a suggestion
  {
    const setup = `
      insert into apartments(building_id, apt) values (1,10),(1,11),(1,12),(1,13);
      insert into users(first_name, last_name, phone) values ('דוד','כהן','m-10'),('שרה','כהן','m-11'),('משה','לוי','m-12'),('דוד','כהן','m-13');
      insert into residents(building_id, key, apt, user_id, status) values
        (1,'10-a',10,(select id from users where phone='m-10'),null),(1,'11-a',11,(select id from users where phone='m-11'),'פעיל'),
        (1,'12-a',12,(select id from users where phone='m-12'),'פעיל'),(1,'13-a',13,(select id from users where phone='m-13'),'פעיל');
      insert into payments(building_id, key, apt, y, m, amount, tx_key) values (1,'12-a',12,2026,1,570,'old-tx');`;
    const credits = [
      { key: 'k-last', refKey: 'r1', ref: '501', date: '2026-02-03', amount: 570, desc: 'העברה לוי' },
      { key: 'k-shared', refKey: 'r2', ref: '502', date: '2026-02-04', amount: 100, desc: 'העברה כהן' },
      { key: 'k-none', refKey: 'r3', ref: '503', date: '2026-02-05', amount: 50, desc: 'העברה אלמוני' },
    ];
    const withDb = async (email, fn) => {
      await db.exec('begin');
      try {
        await db.exec(setup);
        if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
        await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
        return await fn((sql, params) => db.query(sql, params));
      } catch (e) { return 'ERR'; } finally { await db.exec('rollback'); }
    };
    const save = (q, list) => q('select public.save_pending_credits(1, $1::jsonb) as n', [JSON.stringify(list)]).then((r) => r.rows[0].n);
    const out = await withDb('c1@x.com', async (q) => {
      const first = await save(q, credits);
      const rows = (await q('select tx_key, amount::int amount, auto_comment, paid_on::text d, y, m, method from pending_payments where building_id = 1 order by tx_key')).rows;
      const again = await save(q, credits);
      const total = (await q('select count(*)::int n from pending_payments where building_id = 1')).rows[0].n;
      const seen = (await q("select value from meta where building_id = 1 and name = 'bankSeen'")).rows[0].value;
      const refs = (await q("select value from meta where building_id = 1 and name = 'refSeen'")).rows[0].value;
      const noApt = (await q('select count(*)::int n from payments where apt is null')).rows[0].n;
      const paid = (await q("select count(*)::int n from payments where tx_key in ('k-last','k-shared','k-none')")).rows[0].n;
      return { first, rows, again, total, seen, refs, noApt, paid };
    });
    const row = (k) => (out === 'ERR' ? null : out.rows.find((r) => r.tx_key === k));
    report(out !== 'ERR' && out.first === 3, 'committee1', 'saves the three unsure credits', 3, out === 'ERR' ? out : out.first);
    report(row('k-last')?.auto_comment === 'הצעה: דירה 12 (שם משפחה בלבד)', 'committee1', 'last name only: the comment suggests the apartment', 'הצעה: דירה 12 (שם משפחה בלבד)', row('k-last')?.auto_comment);
    report(row('k-shared')?.auto_comment === 'דירות אפשריות: 10, 11, 13 (כמה דירות לאותו שם)', 'committee1', 'a shared name: the comment lists the candidate apartments', 'דירות אפשריות: 10, 11, 13 (כמה דירות לאותו שם)', row('k-shared')?.auto_comment);
    report(row('k-none')?.auto_comment === 'לא זוהה', 'committee1', 'an unknown payer is stored with "לא זוהה"', 'לא זוהה', row('k-none')?.auto_comment);
    report(row('k-last')?.amount === 570 && row('k-last')?.d === '2026-02-03' && row('k-last')?.y === 2026 && row('k-last')?.m === 2 && row('k-last')?.method === 'העברה בנקאית', 'committee1', 'amount, date and month are kept', 'ok', JSON.stringify(row('k-last')));
    report(out !== 'ERR' && out.again === 0 && out.total === 3, 'committee1', 'saving the same bank rows twice adds nothing', '0 / 3', out === 'ERR' ? out : `${out.again} / ${out.total}`);
    report(out !== 'ERR' && out.seen['k-last'] && out.seen['k-shared'] && out.seen['k-none'] && out.refs.r1 && out.refs.r3, 'committee1', 'the rows are marked as seen for the next import', 'seen', out === 'ERR' ? out : JSON.stringify(out.seen));
    report(out !== 'ERR' && out.noApt === 0 && out.paid === 0, 'committee1', 'no payment was created: payments is unchanged', '0 / 0', out === 'ERR' ? out : `${out.noApt} / ${out.paid}`);
    const dup = await withDb('c1@x.com', async (q) => save(q, [{ key: 'old-tx', date: '2026-02-03', amount: 5, desc: 'x' }, { key: 'same', date: '2026-02-03', amount: 5, desc: 'x' }, { key: 'same', date: '2026-02-03', amount: 5, desc: 'x' }]));
    report(dup === 1, 'committee1', 'a row already saved as a payment, and a row twice in one batch, are added at most once', 1, dup);
    const bad = await withDb('c1@x.com', async (q) => save(q, [{ key: 'neg', date: '2026-02-03', amount: -5, desc: 'x' }]));
    report(bad === 'ERR', 'committee1', 'refuses a credit that is not positive', 'ERR', bad);
    for (const [who, email] of [['manager12', 'm12@x.com'], ['super', 'super@x.com']]) {
      const n = await withDb(email, async (q) => save(q, credits));
      report(n === 3, who, 'save_pending_credits: allowed', 3, n);
    }
    for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['committee2', 'c2@x.com'], ['anon', null]]) {
      const n = await withDb(email, async (q) => save(q, credits));
      report(n === 'ERR', who, 'save_pending_credits: refused', 'ERR', n);
    }
  }

  // approve_pending / ignore_pending: the committee's decision on a waiting credit
  {
    const setup = `
      insert into apartments(building_id, apt) values (1,20),(1,21),(1,23);
      insert into users(first_name, last_name, phone) values ('דוד','כהן','m-20');
      insert into residents(building_id, key, apt, entry_year, entry_month, user_id) values (1,'20-a',20,2026,1,(select id from users where phone='m-20')),(1,'21-a',21,2026,1,null);
      insert into tariffs(building_id, year, month, apt, amount) values (1,2026,null,null,570);
      insert into payments(building_id, key, apt, y, m, amount, tx_key) values (1,'20-a',20,2026,1,570,'t-jan');`;
    const credits = [
      { key: 'k1', refKey: 'r1', ref: '501', date: '2026-02-03', amount: 570, desc: 'העברה דוד כהן' },
      { key: 'k2', refKey: 'r2', ref: '502', date: '2026-02-04', amount: 1000, desc: 'העברה אלמוני' },
    ];
    const go = async (email, fn) => {
      await db.exec('begin');
      try {
        await db.exec(setup);
        await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email: 'c1@x.com' })}', true)`);
        await db.exec('set local role authenticated');
        await db.query('select public.save_pending_credits(1, $1::jsonb)', [JSON.stringify(credits)]);
        if (email !== 'c1@x.com') {
          await db.exec('reset role');
          if (email) await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email })}', true)`);
          await db.exec(`set local role ${email === null ? 'anon' : 'authenticated'}`);
        }
        return await fn((sql, params) => db.query(sql, params));
      } catch (e) { return 'ERR'; } finally { await db.exec('rollback'); }
    };
    const pid = async (q, key) => (await q('select id from pending_payments where tx_key = $1', [key])).rows[0]?.id;
    const approved = await go('c1@x.com', async (q) => {
      const id = await pid(q, 'k1');
      const n = (await q('select public.approve_pending($1, 20, true) as n', [id])).rows[0].n;
      const pays = (await q("select key, apt, y, m, amount::int amount, src, tx_key, ref from payments where tx_key = 'k1' order by y, m")).rows;
      const left = (await q('select count(*)::int n from pending_payments where tx_key = $1', ['k1'])).rows[0].n;
      const alias = (await q("select value from meta where building_id = 1 and name = 'aliases'")).rows[0]?.value;
      return { n, pays, left, alias };
    });
    report(approved !== 'ERR' && approved.n === 1 && approved.pays.length === 1 && approved.pays[0].key === '20-a' && approved.pays[0].apt === 20 && approved.pays[0].m === 2 && approved.pays[0].amount === 570 && approved.pays[0].src === 'bank' && approved.pays[0].ref === '501',
      'committee1', 'approving links the credit to the apartment and its tenancy, with the bank details', '1 payment, Feb, 570', approved === 'ERR' ? approved : JSON.stringify(approved.pays));
    report(approved !== 'ERR' && approved.left === 0, 'committee1', 'approving removes the pending row', 0, approved === 'ERR' ? approved : approved.left);
    report(approved !== 'ERR' && approved.alias && approved.alias['דוד כהן'] === 20, 'committee1', 'with "remember" the payer is saved as an alias', '{"דוד כהן":20}', approved === 'ERR' ? approved : JSON.stringify(approved.alias));
    const other = await go('c1@x.com', async (q) => {
      const id = await pid(q, 'k2');
      const n = (await q('select public.approve_pending($1, 21, false) as n', [id])).rows[0].n;
      const pays = (await q("select apt, y, m, amount::int amount from payments where tx_key = 'k2' order by y, m")).rows;
      const alias = (await q("select count(*)::int n from meta where building_id = 1 and name = 'aliases'")).rows[0].n;
      return { n, sum: pays.reduce((s, r) => s + r.amount, 0), apts: [...new Set(pays.map((r) => r.apt))].join(), alias };
    });
    report(other !== 'ERR' && other.apts === '21' && other.sum === 1000 && other.n >= 2, 'committee1', 'another apartment: split over months like split_payment, sum equals the credit', 'apt 21, 1000', other === 'ERR' ? other : JSON.stringify(other));
    report(other !== 'ERR' && other.alias === 0, 'committee1', 'without "remember" no alias is stored', 0, other === 'ERR' ? other : other.alias);
    const twice = await go('c1@x.com', async (q) => { const id = await pid(q, 'k1'); await q('select public.approve_pending($1, 20)', [id]); await q('select public.approve_pending($1, 20)', [id]); });
    report(twice === 'ERR', 'committee1', 'approving the same credit twice is refused', 'ERR', twice === 'ERR' ? twice : 'ok');
    const noApt = await go('c1@x.com', async (q) => q('select public.approve_pending($1, 99)', [await pid(q, 'k1')]));
    report(noApt === 'ERR', 'committee1', 'an apartment that does not exist is refused', 'ERR', noApt === 'ERR' ? noApt : 'ok');
    const noTen = await go('c1@x.com', async (q) => q('select public.approve_pending($1, 23)', [await pid(q, 'k1')]));
    report(noTen === 'ERR', 'committee1', 'an apartment with no tenant record is refused', 'ERR', noTen === 'ERR' ? noTen : 'ok');
    const ign = await go('c1@x.com', async (q) => {
      const id = await pid(q, 'k2');
      await q('select public.ignore_pending($1)', [id]);
      const left = (await q('select count(*)::int n from pending_payments where tx_key = $1', ['k2'])).rows[0].n;
      const ignored = (await q("select value from meta where building_id = 1 and name = 'ignored'")).rows[0].value;
      const pays = (await q("select count(*)::int n from payments where tx_key = 'k2'")).rows[0].n;
      return { left, ignored, pays };
    });
    report(ign !== 'ERR' && ign.left === 0 && ign.ignored.k2 === true && ign.pays === 0, 'committee1', 'ignoring removes the row, marks it ignored and credits nobody', 'ok', ign === 'ERR' ? ign : JSON.stringify(ign));
    for (const [who, email] of [['manager12', 'm12@x.com'], ['super', 'super@x.com']]) {
      const r = await go(email, async (q) => (await q('select public.approve_pending($1, 20) as n', [await pid(q, 'k1')])).rows[0].n);
      report(r === 1, who, 'approve_pending: allowed', 1, r);
    }
    for (const [who, email] of [['tenant8', 't8@x.com'], ['aptOwner8', 'ao8@x.com'], ['stranger', 'nobody@x.com'], ['committee2', 'c2@x.com'], ['anon', null]]) {
      const a = await go(email, async (q) => q('select public.approve_pending($1, 20)', [(await q('select id from pending_payments limit 1')).rows[0]?.id ?? 1]));
      report(a === 'ERR', who, 'approve_pending: refused', 'ERR', a === 'ERR' ? a : 'ok');
      const i = await go(email, async (q) => q('select public.ignore_pending($1)', [1]));
      report(i === 'ERR', who, 'ignore_pending: refused', 'ERR', i === 'ERR' ? i : 'ok');
    }
  }

  console.log(bad ? `\n${bad} of ${n} FAILED` : `\nall ${n} passed`);
  process.exit(bad ? 1 : 0);
}
