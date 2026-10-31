// Turns a backup file (downloaded from the admin console, "גיבוי") into SQL for the Supabase SQL editor.
// Usage:  node scripts/restore-backup.js vaad-backup-b1-2026-10-29.json [--replace]
//   (default)  restore into a database that does not have this building yet (fails safely if rows exist)
// Backups taken before the five-role model (members with role owner/admin) or before the users table cannot be restored as they are.
//   --replace  first delete this building's rows (other buildings are untouched), then restore
// Output: supabase/restore.sql  (contains personal data; git-ignored — never commit or share it)
const fs = require('fs');
const path = require('path');

const ORDER = ['users', 'apartments', 'residents', 'owners', 'tariffs', 'payments', 'expenses', 'meta', 'members', 'snapshot'];
const IDENTITY = ['users', 'residents', 'owners', 'tariffs', 'payments', 'expenses', 'members']; // "generated always" id columns

function lit(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function buildRestoreSql(backup, { replace = false } = {}) {
  if (!backup || backup.app !== 'vaad-backup' || !backup.building || !backup.tables) throw new Error('not a vaad backup file');
  const B = Number(backup.building.id);
  let sql = `-- restore of building ${B} from a vaad backup taken ${backup.exportedAt || '?'} — contains personal data, do not commit\nbegin;\n`;
  if (replace) sql += `delete from public.buildings where id = ${B};\n`;
  sql += `insert into public.buildings (id, name) values (${B}, ${lit(backup.building.name)})` + (replace ? ';\n' : ' on conflict (id) do nothing;\n');
  for (const t of ORDER) {
    const rows = backup.tables[t] || [];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]);
    for (const r of rows) if (r.building_id !== undefined && Number(r.building_id) !== B) throw new Error(`row of another building in ${t}`);
    // people are shared across buildings: a person who already exists (same id) is kept as is
    const tail = t === 'users' ? ' on conflict (id) do nothing' : '';
    const over = IDENTITY.includes(t) && cols.includes('id') ? ' overriding system value' : '';
    for (let i = 0; i < rows.length; i += 200) {
      sql += `insert into public.${t} (${cols.join(', ')})${over} values\n` +
        rows.slice(i, i + 200).map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n') + tail + ';\n';
    }
  }
  for (const t of IDENTITY) sql += `select setval(pg_get_serial_sequence('public.${t}', 'id'), greatest((select coalesce(max(id), 1) from public.${t}), 1));\n`;
  sql += `select setval(pg_get_serial_sequence('public.buildings', 'id'), greatest((select coalesce(max(id), 1) from public.buildings), 1));\n`;
  sql += 'commit;\n';
  return sql;
}

module.exports = { buildRestoreSql };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/restore-backup.js <backup.json> [--replace]'); process.exit(1); }
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sql = buildRestoreSql(backup, { replace: process.argv.includes('--replace') });
  const out = path.join(__dirname, '..', 'supabase', 'restore.sql');
  fs.writeFileSync(out, sql);
  const n = Object.entries(backup.tables).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`supabase/restore.sql written (${Math.round(sql.length / 1024)} KB) for building ${backup.building.id}: ${n}`);
  console.log('Paste it into the Supabase SQL editor and run it.' + (process.argv.includes('--replace') ? ' This REPLACES the building\'s current data.' : ''));
}
