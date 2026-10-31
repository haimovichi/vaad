// Loads schema.sql + seed.sql into PGlite and checks counts and what each role can read.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  grant usage on schema public, auth to anon, authenticated;`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
for (const t of ['buildings', 'users', 'apartments', 'residents', 'owners', 'tariffs', 'payments', 'expenses', 'meta', 'members', 'snapshot']) {
  console.log(t.padEnd(11), (await db.query(`select count(*)::int n from ${t}`)).rows[0].n);
}
const s = (await db.query('select sum(amount)::int t from payments')).rows[0].t; console.log('payments total', s);
await db.exec('begin'); await db.exec(`select set_config('request.jwt.claims','{"email":"owner@example.com"}',true)`); await db.exec('set local role authenticated');
console.log('committee sees payments:', (await db.query('select count(*)::int n from payments')).rows[0].n);
await db.exec('rollback');
const snap = (await db.query('select data from snapshot')).rows[0].data;
const txt = JSON.stringify(snap);
// a second building seeded into the same database must stay invisible to the first building's owner
await db.exec("insert into buildings(id, name) values (2, 'Other'); insert into users(email) values ('other@example.com'); insert into members(building_id, user_id, role) select 2, id, 'committee' from users where email = 'other@example.com'; insert into snapshot(building_id, data) values (2, '{}');");
await db.exec('begin'); await db.exec(`select set_config('request.jwt.claims','{"email":"owner@example.com"}',true)`); await db.exec('set local role authenticated');
console.log('owner sees building 2 snapshot:', (await db.query('select count(*)::int n from snapshot where building_id = 2')).rows[0].n, '(expect 0)');
await db.exec('rollback');
console.log('snapshot has phone/account fields:', /phone|account|050-|052-|054-/.test(txt));
