// Start and end months of tenancies and ownerships, and ending the previous tenants / owners when new ones come (lib/service.js).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createService } = require('../lib/service');
let bad = 0;
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++; };

const make = () => {
  const db = { apartments: [{ apt: 1 }, { apt: 2 }], residents: [], owners: [], tariffs: [], payments: [], expenses: [], settings: {} };
  const log = []; let id = 1;
  const store = {
    addTenancy: async (t) => { log.push(['tenancy', t.apt, t.entryYear, t.entryMonth]); db.residents.push({ key: `${t.apt}-${t.last}-${id++}`, apt: t.apt, last: t.last, role: t.role, status: t.exitYear ? 'עזב' : 'פעיל', entryYear: t.entryYear, entryMonth: t.entryMonth, exitYear: t.exitYear, exitMonth: t.exitMonth }); return 'k'; },
    endTenancy: async (key, y, m) => { log.push(['endTenancy', key, y, m]); const r = db.residents.find((x) => x.key === key); r.status = 'עזב'; r.exitYear = y; r.exitMonth = m; },
    addOwner: async (o) => { log.push(['owner', o.apt, o.entryYear, o.entryMonth]); db.owners.push({ id: id++, apt: o.apt, last: o.last, entryYear: o.entryYear, entryMonth: o.entryMonth, exitYear: null, exitMonth: null }); return id; },
    endOwner: async (oid, y, m) => { log.push(['endOwner', oid, y, m]); const o = db.owners.find((x) => x.id === oid); o.exitYear = y; o.exitMonth = m; },
    load: async () => ({}), saveSnapshot: async () => {},
  };
  return { db, log, svc: createService(db, store, { manage: true, isSuper: true, grantable: ['tenant', 'apt_owner'] }) };
};
const fails = async (p, text) => { try { await p; return false; } catch (e) { return !text || e.message.includes(text); } };   // text: the refusal must be this one, not any other
const ten = (apt, y, m, extra = {}) => ({ apt, first: 'א', last: 'ב', phone: '', email: '', role: 'שוכר', entryYear: y, entryMonth: m, exitYear: '', exitMonth: '', ...extra });

// tenants: the previous ones move out the month before
{
  const { db, log, svc } = make();
  await svc.call('POST', '/api/tenancy', ten(1, 2020, 3));
  await svc.call('POST', '/api/tenancy', ten(1, 2026, 11, { endPrevious: true }));
  const [first, second] = db.residents;
  check('endPrevious closes the current tenancy the month before the new one', first.status === 'עזב' && first.exitYear === 2026 && first.exitMonth === 10);
  check('the new tenancy starts in the chosen month and is open', second.entryYear === 2026 && second.entryMonth === 11 && second.status === 'פעיל');
  check('the old tenancy is closed before the new one is added', log.findIndex((l) => l[0] === 'endTenancy') < log.findIndex((l, i) => l[0] === 'tenancy' && i > 0));
}
{
  const { svc } = make();
  await svc.call('POST', '/api/tenancy', ten(1, 2020, 3));
  check('a new tenancy over a current one is refused without endPrevious', await fails(svc.call('POST', '/api/tenancy', ten(1, 2026, 11))));
}
{
  const { db, svc } = make();
  await svc.call('POST', '/api/tenancy', ten(1, 2026, 6));
  check('endPrevious is refused when the new start is not after the current start', await fails(svc.call('POST', '/api/tenancy', ten(1, 2026, 6, { endPrevious: true }))));
  check('and nothing was changed by the refusal', db.residents.length === 1 && db.residents[0].status === 'פעיל');
}
{
  const { svc } = make();
  await svc.call('POST', '/api/tenancy', ten(1, 2018, 1, { exitYear: 2020, exitMonth: 12 }));
  await svc.call('POST', '/api/tenancy', ten(1, 2021, 1));
  check('endPrevious cannot reach back over an older tenancy that ended later', await fails(svc.call('POST', '/api/tenancy', ten(1, 2020, 6, { endPrevious: true }))));
}

// owners: a start month; the ones who sold end the month before; co-owners stay
{
  const { db, svc } = make();
  await svc.call('POST', '/api/owner', { apt: 1, first: 'א', last: 'ראשון', entryYear: 2015, entryMonth: 4 });
  await svc.call('POST', '/api/owner', { apt: 1, first: 'ב', last: 'שותף', entryYear: 2026, entryMonth: 6 });
  check('a co-owner is added next to the current owner, who stays', db.owners.length === 2 && db.owners.every((o) => !o.exitYear));
  await svc.call('POST', '/api/owner', { apt: 1, first: 'ג', last: 'קונה', entryYear: 2026, entryMonth: 11, endPrevious: true });
  const open = db.owners.filter((o) => !o.exitYear);
  check('endPrevious ends every current owner the month before and keeps the new one', open.length === 1 && open[0].last === 'קונה' && db.owners.filter((o) => o.exitYear === 2026 && o.exitMonth === 10).length === 2);
}
{
  const { db, svc } = make();
  await svc.call('POST', '/api/owner', { apt: 1, first: 'א', last: 'ראשון', entryYear: 2026, entryMonth: 11 });
  check('endPrevious is refused when a current owner started after the month before', await fails(svc.call('POST', '/api/owner', { apt: 1, first: 'ג', last: 'קונה', entryYear: 2026, entryMonth: 11, endPrevious: true })));
  check('and no owner is added by the refusal', db.owners.length === 1);
  check('endPrevious needs a start month', await fails(svc.call('POST', '/api/owner', { apt: 1, first: 'ג', last: 'קונה', endPrevious: true })));
  check('a bad start month is refused', await fails(svc.call('POST', '/api/owner', { apt: 2, first: 'ג', last: 'קונה', entryYear: 2026, entryMonth: 13 })));
  const ok = await svc.call('POST', '/api/owner', { apt: 2, first: 'ג', last: 'ישן' });
  check('an owner with no start month is still accepted (not recorded)', ok.id && db.owners.some((o) => o.apt === 2 && o.entryYear === null));
}
{
  const { db, svc } = make();
  await svc.call('POST', '/api/owner', { apt: 1, first: 'א', last: 'ראשון', entryYear: 2020, entryMonth: 5 });
  const id = db.owners[0].id;
  check('an owner cannot be ended before the start', await fails(svc.call('POST', '/api/owner/end', { id, exitYear: 2020, exitMonth: 4 }), 'קודם לתחילת'));
  await svc.call('POST', '/api/owner/end', { id, exitYear: 2026, exitMonth: 8 });
  check('an owner is ended in the chosen month', db.owners[0].exitYear === 2026 && db.owners[0].exitMonth === 8);
  check('an ended ownership cannot be ended again', await fails(svc.call('POST', '/api/owner/end', { id, exitYear: 2026, exitMonth: 9 }), 'כבר הסתיימה'));
}

console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
