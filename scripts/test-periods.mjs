// Start and end months of tenancies and ownerships, and ending the previous tenants / owners when new ones come (lib/service.js).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { createService } = require('../lib/service');
let bad = 0;
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) bad++; };

const make = (perms = { manage: true, isSuper: true, grantable: ['tenant', 'apt_owner'] }) => {
  const db = { apartments: [{ apt: 1 }, { apt: 2 }], residents: [], owners: [], tariffs: [], payments: [], expenses: [], settings: {} };
  const log = []; let id = 1;
  const store = {
    addTenancy: async (t) => { log.push(['tenancy', t.apt, t.entryYear, t.entryMonth]); db.residents.push({ key: `${t.apt}-${t.last}-${id++}`, apt: t.apt, last: t.last, role: t.role, status: t.exitYear ? 'עזב' : 'פעיל', entryYear: t.entryYear, entryMonth: t.entryMonth, exitYear: t.exitYear, exitMonth: t.exitMonth }); return 'k'; },
    endTenancy: async (key, y, m) => { log.push(['endTenancy', key, y, m]); const r = db.residents.find((x) => x.key === key); r.status = 'עזב'; r.exitYear = y; r.exitMonth = m; },
    addOwner: async (o) => { log.push(['owner', o.apt, o.entryYear, o.entryMonth]); db.owners.push({ id: id++, apt: o.apt, last: o.last, entryYear: o.entryYear, entryMonth: o.entryMonth, exitYear: null, exitMonth: null }); return id; },
    endOwner: async (oid, y, m) => { log.push(['endOwner', oid, y, m]); const o = db.owners.find((x) => x.id === oid); o.exitYear = y; o.exitMonth = m; },
    editTenancy: async (key, t) => { log.push(['editTenancy', key, t.apt]); const r = db.residents.find((x) => x.key === key); Object.assign(r, { apt: t.apt, role: t.role, entryYear: t.entryYear, entryMonth: t.entryMonth, exitYear: t.exitYear, exitMonth: t.exitMonth, status: t.exitYear ? 'עזב' : 'פעיל' }); },
    removeTenancy: async (key) => { log.push(['removeTenancy', key]); db.residents = db.residents.filter((x) => x.key !== key); },
    editOwner: async (oid, o) => { log.push(['editOwner', oid, o.apt]); Object.assign(db.owners.find((x) => x.id === oid), { apt: o.apt, entryYear: o.entryYear, entryMonth: o.entryMonth, exitYear: o.exitYear, exitMonth: o.exitMonth }); },
    removeOwner: async (oid) => { log.push(['removeOwner', oid]); db.owners = db.owners.filter((x) => String(x.id) !== String(oid)); },
    load: async () => ({}), saveSnapshot: async () => {},
  };
  return { db, log, svc: createService(db, store, perms) };
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

// corrections in place: a tenancy and an ownership edited, and removed (super user only)
{
  const { db, svc } = make();
  await svc.call('POST', '/api/tenancy', ten(1, 2020, 3));
  await svc.call('POST', '/api/tenancy', ten(2, 2020, 3));
  const [a, b2] = db.residents; const edit = (x, extra = {}) => ({ key: a.key, apt: 1, role: 'שוכר', entryYear: 2020, entryMonth: 3, exitYear: '', exitMonth: '', ...x, ...extra });
  await svc.call('PUT', '/api/tenancy', edit({ entryMonth: 5, exitYear: 2026, exitMonth: 8 }));
  check('a tenancy is corrected in place: start and end months', a.entryMonth === 5 && a.exitYear === 2026 && a.exitMonth === 8 && a.status === 'עזב');
  await svc.call('PUT', '/api/tenancy', edit({}));
  check('an empty end makes the tenancy current again', a.status === 'פעיל' && !a.exitYear);
  check('an end before the start is refused', await fails(svc.call('PUT', '/api/tenancy', edit({ exitYear: 2019, exitMonth: 1 })), 'קודם'));
  check('a bad role is refused', await fails(svc.call('PUT', '/api/tenancy', edit({ role: 'x' }))));
  check('an unknown tenancy is refused', await fails(svc.call('PUT', '/api/tenancy', edit({ key: 'nope' }))));
  check('moving over another tenancy of the target apartment is refused', await fails(svc.call('PUT', '/api/tenancy', edit({ apt: 2 })), 'חופפים'));
  await svc.call('PUT', '/api/tenancy', edit({ apt: 2, exitYear: 2019, exitMonth: 12, entryYear: 2018, entryMonth: 1 }));
  check('moving to another apartment works when the dates do not overlap', a.apt === 2 && a.status === 'עזב');
  await svc.call('POST', '/api/tenancy/remove', { key: b2.key });
  check('a tenancy is removed', !db.residents.includes(b2));
  db.payments.push({ key: a.key, apt: 2, y: 2019, m: 5, amount: 100 });
  check('a tenancy with payments is not removed', await fails(svc.call('POST', '/api/tenancy/remove', { key: a.key }), 'תשלומים'));
}
{
  const { db, svc } = make();
  await svc.call('POST', '/api/owner', { apt: 1, first: 'א', last: 'ראשון', entryYear: 2020, entryMonth: 5 });
  const id = db.owners[0].id; const edit = (x) => ({ id, apt: 1, entryYear: 2020, entryMonth: 5, exitYear: '', exitMonth: '', ...x });
  await svc.call('PUT', '/api/owner', edit({ entryYear: 2018, entryMonth: 2, exitYear: 2024, exitMonth: 6 }));
  check('an ownership is corrected in place: start and end', db.owners[0].entryYear === 2018 && db.owners[0].exitYear === 2024 && db.owners[0].exitMonth === 6);
  await svc.call('PUT', '/api/owner', edit({ apt: 2, entryYear: '', entryMonth: '' }));
  check('an ownership moves to another apartment, and its start may be cleared', db.owners[0].apt === 2 && db.owners[0].entryYear === null && db.owners[0].exitYear === null);
  check('an end before the start is refused', await fails(svc.call('PUT', '/api/owner', edit({ exitYear: 2019, exitMonth: 1 })), 'קודם'));
  check('a bad start month is refused', await fails(svc.call('PUT', '/api/owner', edit({ entryMonth: 13 }))));
  check('a missing apartment is refused', await fails(svc.call('PUT', '/api/owner', edit({ apt: 99 }))));
  await svc.call('DELETE', '/api/owner/' + id);
  check('an ownership is removed', db.owners.length === 0);
}
{
  const { db, svc } = make({ manage: true, isSuper: false, grantable: ['tenant'] });
  db.residents.push({ key: 'k', apt: 1, status: 'פעיל', role: 'שוכר', entryYear: 2020, entryMonth: 1 });
  db.owners.push({ id: 7, apt: 1, last: 'א', entryYear: 2020, entryMonth: 1, exitYear: null, exitMonth: null });
  check('the committee cannot remove a tenancy', await fails(svc.call('POST', '/api/tenancy/remove', { key: 'k' })));
  check('the committee cannot remove an owner record', await fails(svc.call('DELETE', '/api/owner/7')));
  await svc.call('PUT', '/api/owner', { id: 7, apt: 1, entryYear: 2020, entryMonth: 1, exitYear: 2026, exitMonth: 3 });
  check('but the committee can correct an ownership', db.owners[0].exitYear === 2026);
}

// one step: a list of steps is tried first on a copy; if one fails, none is done
{
  const { db, log, svc } = make();
  await svc.call('POST', '/api/tenancy', ten(1, 2020, 3));
  await svc.call('POST', '/api/tenancy', ten(2, 2020, 3));
  const [a, b2] = db.residents; const before = JSON.stringify(db); log.length = 0;
  const ok = await fails(svc.call('POST', '/api/batch', { steps: [
    { method: 'PUT', url: '/api/tenancy', body: { key: a.key, apt: 1, role: 'שוכר', entryYear: 2020, entryMonth: 5, exitYear: '', exitMonth: '' } },
    { method: 'PUT', url: '/api/tenancy', body: { key: b2.key, apt: 1, role: 'שוכר', entryYear: 2020, entryMonth: 3, exitYear: '', exitMonth: '' } },   // overlaps apartment 1's tenancy: refused
  ] }), 'חופפים');
  check('a step that fails stops the whole batch', ok);
  check('and nothing was done: no store call, the data is as it was', log.length === 0 && JSON.stringify(db) === before);
  await svc.call('POST', '/api/batch', { steps: [
    { method: 'PUT', url: '/api/tenancy', body: { key: a.key, apt: 1, role: 'שוכר', entryYear: 2020, entryMonth: 5, exitYear: 2026, exitMonth: 3 } },
    { method: 'POST', url: '/api/tenancy', body: ten(1, 2026, 4) },   // only free because the first step ended the old tenancy
    { method: 'POST', url: '/api/owner', body: { apt: 1, first: 'א', last: 'חדש', entryYear: 2026, entryMonth: 4 } },
  ] });
  check('a list of steps is done in order, later steps seeing the earlier ones', a.status === 'עזב' && a.entryMonth === 5 && db.residents.length === 3 && db.owners.length === 1);
  check('a step that is not allowed in a batch is refused', await fails(svc.call('POST', '/api/batch', { steps: [{ method: 'POST', url: '/api/payment', body: {} }] }), 'לא מותרת'));
  check('a person picked by id needs no name', (await svc.call('POST', '/api/tenancy', ten(2, 2018, 1, { last: '', userId: 7, exitYear: 2019, exitMonth: 12 }))).key === 'k');
  check('a person picked by id needs no name as an owner', !!(await svc.call('POST', '/api/owner', { apt: 2, userId: 7, entryYear: 2030, entryMonth: 1 })).id);
  check('a tenancy with payments does not move to another apartment', await (async () => { db.payments.push({ key: b2.key, apt: 2, y: 2020, m: 5, amount: 1 }); return fails(svc.call('PUT', '/api/tenancy', { key: b2.key, apt: 1, role: 'שוכר', entryYear: 2010, entryMonth: 1, exitYear: 2010, exitMonth: 2 }), 'תשלומים'); })());
}

console.log(bad ? `${bad} FAILED` : 'all ok');
process.exit(bad ? 1 : 0);
