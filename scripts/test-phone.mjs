// Phone numbers and emails entered on the people forms: one stored format, clear errors (lib/service.js).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createService } = require('../lib/service');
let bad = 0;
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++; };

const seen = [];
const store = {
  addTenancy: async (t) => { seen.push(t); return '1-x'; },
  addHouseholdMember: async (key, p) => { seen.push(p); },
  addOwner: async (o) => { seen.push(o); return 1; },
  load: async () => ({}), saveSnapshot: async () => {},
};
const db = { apartments: [{ apt: 1 }], residents: [], owners: [], tariffs: [], payments: [], expenses: [], settings: {} };
const svc = createService(db, store, { manage: true, isSuper: false, grantable: ['tenant', 'apt_owner'] });
const tenancy = (phone, email) => svc.call('POST', '/api/tenancy', { apt: 1, first: 'א', last: 'ב', phone, email, role: 'שוכר', entryMonth: 1, entryYear: 2090, exitMonth: '', exitYear: '' });
const phoneOf = async (v) => { seen.length = 0; try { await tenancy(v); return seen[0].phone; } catch (e) { return 'ERR'; } };

for (const [input, want] of [['0501234567', '050-1234567'], ['050-123 4567', '050-1234567'], ['+972501234567', '050-1234567'], ['972-50-1234567', '050-1234567'], ['(02) 123-4567', '02-1234567'], ['03-1234567', '03-1234567'], ['', ''], ['   ', '']]) {
  const got = await phoneOf(input);
  check(`phone "${input}" is stored as "${want}"`, got === want);
}
for (const bad_ of ['12345', 'abc', '050-12', '1501234567', '05012345678']) check(`phone "${bad_}" is refused`, (await phoneOf(bad_)) === 'ERR');

seen.length = 0; await tenancy('', 'Dana@Example.com');
check('a tenant email is trimmed and lowercased', seen[0].email === 'dana@example.com');
let msg = ''; try { await tenancy('', 'not-an-email'); } catch (e) { msg = e.message; }
check('a malformed email is refused in Hebrew', msg === 'כתובת אימייל לא תקינה');
const noGrant = createService(db, store, { manage: true, isSuper: false, grantable: [] });
let denied = ''; try { await noGrant.call('POST', '/api/tenancy', { apt: 1, first: 'א', last: 'ב', phone: '', email: 'a@b.co', role: 'שוכר', entryMonth: 1, entryYear: 2090, exitMonth: '', exitYear: '' }); } catch (e) { denied = e.message; }
check('an email login needs the right to grant the tenant role', denied !== '' && denied !== 'כתובת אימייל לא תקינה');
db.residents.push({ key: '1-a', apt: 1, status: 'פעיל' });
seen.length = 0; await svc.call('POST', '/api/household', { apt: 1, first: 'ג', last: 'ד', phone: '0521234567', email: '' });
check('a household member phone is normalized too', seen[0].phone === '052-1234567');

console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
