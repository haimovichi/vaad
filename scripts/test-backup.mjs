// Round trip: export a building as the app does (table rows as JSON), turn the backup into restore SQL,
// load it into a fresh database and into a damaged one, and check the data comes back exactly.
import { PGlite } from '@electric-sql/pglite';
import { createRequire } from 'module';
import fs from 'fs';
const { buildRestoreSql } = createRequire(import.meta.url)('./restore-backup.js');

const stub = `create role anon nologin; create role authenticated nologin; create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated;`;
const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
async function fresh() { const d = new PGlite(); await d.exec(stub); await d.exec(schema); return d; }

const src = await fresh();
await src.exec(`
  insert into buildings(id, name) values (1, 'בניין א''  (with apostrophe)'), (2, 'Other');
  insert into apartments(building_id, apt, floor, rooms, sqm) values (1,8,'2',4,109),(1,9,'ק',5,null),(2,3,'1',4,100);
  insert into residents(building_id, key, apt, first_name, last_name, phone1, status, entry_month, entry_year, account) values
    (1,'8-קלדרו',8,'רועי','קלדרו','050-1','עזב',6,2022,'87086516'),(1,'8-עדות',8,'דני','עדות','050-2','פעיל',3,2026,null),(2,'3-x',3,'X','Y','050-3','פעיל',1,2026,null);
  insert into owners(building_id, apt, first_name, last_name, phone, account, note) values (1,8,'אברהם','אבן-חן','054-1','111','note with ''quotes''');
  insert into tariffs(building_id, year, month, apt, amount, note) values (1,2026,null,null,570.00,'base'),(1,2026,1,null,130.50,'surcharge');
  insert into payments(building_id, key, apt, y, m, amount, method, paid_on, note, ref, src, tx_key) values
    (1,'8-עדות',8,2026,3,570,'הוראת קבע','2026-03-15','בנק: מ''ש','975','bank','2026-03-15|975|570'),
    (1,'8-עדות',8,2026,4,1140.25,'העברה',null,'',null,'excel',null),(2,'3-x',3,2026,1,1,'x',null,'',null,'manual',null);
  insert into expenses(building_id, y, m, d, category, descr, amount) values (1,2026,5,3,'חשמל','חשבון',2934.33);
  insert into meta(building_id, name, value) values (1,'aliases','{"נפתלי נאור":26,"o''brien":3}'),(1,'bankSeen','{"k1":true}'),(1,'settings','{"title":"ועד","showNames":false,"showDebt":true}');
  insert into members(building_id, email, role, apt, name) values (1,'owner@x.com','owner',18,'Owner'),(1,'t@x.com','tenant',8,null),(2,'o2@x.com','owner',null,'O2');
  insert into snapshot(building_id, data) values (1,'{"updated":"2026-10-29","grids":{}}'),(2,'{}');
`);

// "export" building 1 the way the app does: every table's rows for that building, as JSON
const tables = {};
for (const t of ['apartments', 'residents', 'owners', 'tariffs', 'payments', 'expenses', 'meta', 'members', 'snapshot']) {
  tables[t] = JSON.parse(JSON.stringify((await src.query(`select * from ${t} where building_id = 1 order by 1, 2`)).rows));
}
const backup = { app: 'vaad-backup', version: 1, exportedAt: '2026-10-29T00:00:00Z', building: { id: 1, name: (await src.query('select name from buildings where id = 1')).rows[0].name }, tables };

const digest = async (d, b) => {
  const out = {};
  for (const t of Object.keys(tables)) {
    const r = (await d.query(`select to_jsonb(x) j from ${t} x where building_id = ${b}`)).rows.map((x) => JSON.stringify(Object.fromEntries(Object.entries(x.j).sort())));
    out[t] = r.sort();
  }
  return JSON.stringify(out);
};
let bad = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) bad++; };
const want = await digest(src, 1);

// 1) restore into an empty database
const a = await fresh();
await a.exec(buildRestoreSql(backup));
check('restore into an empty database reproduces every row exactly', (await digest(a, 1)) === want);
const idBefore = (await a.query('select max(id)::int m from payments')).rows[0].m;
await a.exec("insert into payments(building_id,key,apt,y,m,amount) values (1,'8-עדות',8,2026,5,1)");
const idAfter = (await a.query('select max(id)::int m from payments')).rows[0].m;
check('new payments after a restore get fresh ids (no collision)', idAfter > idBefore, `(${idBefore} -> ${idAfter})`);

// 2) restoring twice without --replace fails safely and changes nothing
const b = await fresh();
await b.exec(buildRestoreSql(backup));
let failed = false; try { await b.exec(buildRestoreSql(backup)); } catch (e) { failed = true; await b.exec('rollback'); } // the SQL editor rolls back a failed script by itself
check('restoring twice without --replace is refused', failed);
check('...and leaves the data untouched', (await digest(b, 1)) === want);

// 3) --replace repairs a damaged building and leaves other buildings alone
const c = await fresh();
await c.exec(buildRestoreSql(backup));
await c.exec("update payments set amount = 999999 where building_id = 1; delete from residents where building_id = 1 and key = '8-קלדרו'; insert into payments(building_id,key,apt,y,m,amount) values (1,'8-עדות',8,2026,12,5)");
await c.exec("insert into buildings(id,name) values (2,'Other'); insert into apartments(building_id,apt) values (2,3); insert into payments(building_id,key,apt,y,m,amount) values (2,'3-x',3,2026,1,1)");
const other = await digest(c, 2);
await c.exec(buildRestoreSql(backup, { replace: true }));
check('--replace brings the damaged building back to the backup', (await digest(c, 1)) === want);
check('--replace leaves another building untouched', (await digest(c, 2)) === other);

// 4) a backup of one building cannot smuggle rows of another
let refused = false;
try { buildRestoreSql({ ...backup, tables: { ...tables, payments: [...tables.payments, { ...tables.payments[0], building_id: 2 }] } }); } catch (e) { refused = true; }
check('a backup containing another building\'s rows is refused', refused);
let notBackup = false; try { buildRestoreSql({ foo: 1 }); } catch (e) { notBackup = true; }
check('a file that is not a vaad backup is refused', notBackup);

console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
