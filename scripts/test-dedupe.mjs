// supabase/dedupe-users.sql: one person = one users record, whatever the number of apartments, tenancies and roles.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { STUB } from './test-rls.mjs';

const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const dedupe = fs.readFileSync(new URL('../supabase/dedupe-users.sql', import.meta.url), 'utf8');
let bad = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) bad++; };

const db = new PGlite(); await db.exec(STUB); await db.exec(schema);
await db.exec(`
  insert into buildings(id, name) values (1, 'B'), (2, 'C');
  insert into apartments(building_id, apt) values (1,8),(1,16),(1,3),(1,5),(1,6),(2,1);
  -- Abraham: owner of 8, owner of 16, tenant of 16 (3 records), two accounts, and a login role twice
  insert into users(id, email, first_name, last_name, phone) overriding system value values
    (1,null,'Abraham','Stone','054-1'),(2,null,'Abraham','Stone','054-1'),(3,null,'Abraham','Stone','054-1'),
    (4,null,'Dina','Cohen','050-1'),(5,null,'Dina','Cohen','050-2'),            -- same name, different phones: kept apart
    (6,null,'Eli','Levi','052-1'),(7,null,null,null,'052-1'),                    -- phone-only record belongs to Eli
    (8,null,null,null,'053-1'),(9,null,null,null,'053-1'),(10,null,null,null,'053-2'),   -- same contact twice; another contact
    (11,'x@x.com','Sam','Katz',null),(12,'y@x.com','Sam','Katz',null),           -- two logins: two people
    (13,null,'Noa','Bar','054-9'),(14,'noa@x.com','Noa','Bar',null),           -- same person, the email arrives from the second record
    (15,null,'Gil','Dor','051-1'),(16,null,'Gil','Dor','051-1');                -- a couple that is one person
  insert into bank_accounts(user_id, account) values (1,'111'),(2,'111'),(3,'222'),(14,'333'),(13,'444');
  insert into owners(building_id, apt, user_id) values (1,8,1),(1,16,2);
  insert into residents(building_id, key, apt, user_id, user2_id, status) values
    (1,'16-a',16,3,null,'פעיל'),(1,'3-a',3,4,null,'פעיל'),(1,'5-a',5,5,7,'פעיל'),(1,'6-a',6,13,null,'פעיל'),(1,'6-b',6,15,16,'פעיל'),(2,'1-a',1,8,9,'פעיל');
  insert into members(building_id, user_id, role, apt) values (1,1,'apt_owner',8),(1,2,'apt_owner',8),(1,3,'tenant',16),(1,2,'committee',null),(2,3,'committee',null);
  insert into payments(building_id, key, apt, y, m, amount) values (1,'16-a',16,2026,10,570);
`);
const q = async (sql) => (await db.query(sql)).rows;
const before = (await q('select count(*)::int n from users'))[0].n;
await db.exec(dedupe);
const after = (await q('select count(*)::int n from users'))[0].n;

const abr = await q("select id, phone, (select string_agg(account, ', ' order by account) from bank_accounts b where b.user_id = users.id) bank_account from users where first_name = 'Abraham'");
check('three records of one person become one', abr.length === 1 && abr[0].phone === '054-1', `(${JSON.stringify(abr)})`);
check('...with both bank accounts kept', abr[0].bank_account === '111, 222', `(${abr[0].bank_account})`);
const id = abr[0].id;
check('he owns 8 and 16 and rents 16 through that one record', (await q(`select count(*)::int n from owners where user_id = ${id}`))[0].n === 2 && (await q(`select count(*)::int n from residents where user_id = ${id}`))[0].n === 1);
const roles = (await q(`select building_id b, role, coalesce(apt::text,'-') a from members where user_id = ${id} order by 1, 2, 3`)).map((r) => `${r.b}:${r.role}:${r.a}`).join(' | ');
check('his roles are kept once each (the duplicate apartment-owner role disappeared)', roles === '1:apt_owner:8 | 1:committee:- | 1:tenant:16 | 2:committee:-', `(${roles})`);
check('same name with different phones stays two people', (await q("select count(*)::int n from users where first_name = 'Dina'"))[0].n === 2);
const eli = await q("select id from users where first_name = 'Eli'");
check('a phone-only record joins the named person with that phone', (await q("select count(*)::int n from users where phone = '052-1'"))[0].n === 1 && (await q(`select user2_id from residents where key = '5-a'`))[0].user2_id !== null);
check('the same phone-only contact twice is one', (await q("select count(*)::int n from users where phone = '053-1'"))[0].n === 1 && (await q("select count(*)::int n from users where phone = '053-2'"))[0].n === 1);
check('two different logins with the same name stay two', (await q("select count(*)::int n from users where first_name = 'Sam'"))[0].n === 2);
const noa = await q("select email, phone, (select string_agg(account, ', ' order by account) from bank_accounts b where b.user_id = users.id) bank_account from users where first_name = 'Noa'");
check('email, phone and both accounts survive the merge', noa.length === 1 && noa[0].email === 'noa@x.com' && noa[0].phone === '054-9' && noa[0].bank_account === '333, 444', `(${JSON.stringify(noa)})`);
const gil = await q("select user_id, user2_id from residents where key = '6-b'");
check('a "couple" that is one person keeps one link', gil[0].user_id !== null && gil[0].user2_id === null);
check('payments untouched', (await q('select count(*)::int n from payments'))[0].n === 1);
check('no record points at a deleted user', (await q('select count(*)::int n from residents r where (user_id is not null and not exists (select 1 from users u where u.id = r.user_id)) or (user2_id is not null and not exists (select 1 from users u where u.id = r.user2_id))'))[0].n === 0);
console.log(`users ${before} -> ${after}`);
const snap = JSON.stringify([await q('select * from users order by id'), await q('select user_id, account from bank_accounts order by 1, 2')]);
await db.exec(dedupe);
check('running it again changes nothing', JSON.stringify([await q('select * from users order by id'), await q('select user_id, account from bank_accounts order by 1, 2')]) === snap);

console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
