// Shared by the login / console / compact pages: session, roles, data access.
// Demo mode (?demo=super|manager|committee|tenant|apt_owner|multi) runs fully in memory from a local demo-db.json (never deployed).
window.Vaad = (function () {
  const cfg = window.VAAD_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo');
  const keep = demo ? `?demo=${encodeURIComponent(demo)}` : '';
  let sb = null;
  const client = () => {
    if (!sb) {
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('חסרות הגדרות Supabase בקובץ app/config.js');
      sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    }
    return sb;
  };

  /* ---------- roles ---------- */
  // Platform roles: super user (one person) and buildings managers. Building roles: committee, tenant, apt_owner.
  // A person may hold any mix; what each allows is combined. The database enforces all of this; the app only shapes the UI.
  const ROLE_LABEL = { super: 'מנהל על', manager: 'מנהל בניינים', committee: 'ועד הבית', tenant: 'דייר', apt_owner: 'בעל דירה' };
  function buildMe({ email, isSuper, isManager, managerOf, rows, buildings }) {
    const memberships = buildings.map((b) => {
      const mine = rows.filter((r) => r.building_id === b.id);
      const roles = [];
      if (isSuper) roles.push('super');
      else if (managerOf.includes(b.id)) roles.push('manager');
      for (const r of ['committee', 'tenant', 'apt_owner']) if (mine.some((x) => x.role === r)) roles.push(r);
      const manage = roles.some((r) => ['super', 'manager', 'committee'].includes(r));
      const tenantApts = mine.filter((x) => x.role === 'tenant' && x.apt).map((x) => x.apt);
      const ownerApts = mine.filter((x) => x.role === 'apt_owner' && x.apt).map((x) => x.apt);
      return {
        id: b.id, name: b.name, roles, manage,
        seesBoard: manage || roles.includes('tenant'),
        tenantApts, ownerApts, linkedApts: [...new Set([...tenantApts, ...ownerApts])].sort((a, c) => a - c),
        grantable: roles.includes('super') || roles.includes('manager') ? ['committee', 'tenant', 'apt_owner'] : roles.includes('committee') ? ['tenant', 'apt_owner'] : [],
      };
    });
    const picked = memberships.find((m) => m.id === getChosen()) || (memberships.length === 1 ? memberships[0] : null);
    return { email, isSuper, isManager, memberships, building: picked };
  }
  const chosenKey = 'vaad-building';
  const getChosen = () => { try { return Number(localStorage.getItem(chosenKey)) || null; } catch (e) { return null; } };
  const choose = (id) => { try { localStorage.setItem(chosenKey, String(id)); } catch (e) {} };

  const DEMOS = { // ?demo=... people, all in building 1
    super: { isSuper: true, rows: [] },
    manager: { isManager: true, managerOf: [1], rows: [] },
    committee: { rows: [{ building_id: 1, role: 'committee', apt: null }] },
    tenant: { rows: [{ building_id: 1, role: 'tenant', apt: 8 }] },
    apt_owner: { rows: [7, 8, 16].map((apt) => ({ building_id: 1, role: 'apt_owner', apt })) },
    multi: { rows: [{ building_id: 1, role: 'committee', apt: null }, { building_id: 1, role: 'tenant', apt: 8 }, { building_id: 1, role: 'apt_owner', apt: 16 }] },
  };

  async function whoami() {
    if (demo) {
      const d = DEMOS[demo] || DEMOS.committee;
      return buildMe({ email: `${demo}@demo.com`, isSuper: !!d.isSuper, isManager: !!d.isManager, managerOf: d.managerOf || [], rows: d.rows, buildings: [{ id: 1, name: 'בניין לדוגמה' }] });
    }
    const { data: { session } } = await client().auth.getSession();
    if (!session) return null;
    const email = session.user.email.toLowerCase();
    const c = client();
    const [mem, sup, mgr, mb, blds] = await Promise.all([
      c.from('members').select('building_id, role, apt, name').eq('email', email),
      c.rpc('is_super'),
      c.from('managers').select('email').eq('email', email).maybeSingle(),
      c.from('manager_buildings').select('building_id').eq('email', email),
      c.from('buildings').select('id, name').order('id'),
    ]);
    for (const r of [mem, sup, mgr, mb, blds]) if (r.error) throw new Error(r.error.message);
    return buildMe({ email, isSuper: sup.data === true, isManager: !!mgr.data, managerOf: (mb.data || []).map((x) => x.building_id), rows: mem.data || [], buildings: blds.data || [] });
  }
  // fill a <select> with the person's buildings (stays hidden when there is only one)
  function mountSwitcher(sel, me) {
    if (!sel || !me || me.memberships.length < 2) return;
    sel.innerHTML = me.memberships.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
    sel.value = me.building ? me.building.id : '';
    sel.classList.remove('hide'); sel.style.display = '';
    sel.onchange = () => { choose(sel.value); location.href = 'index.html' + keep; };
  }
  const signIn = async (email) => {
    const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html' } });
    if (error) throw error;
  };
  const signOut = async () => { if (!demo) await client().auth.signOut(); location.href = 'index.html' + keep; };
  const go = (page) => { location.href = page + keep; };
  const perms = (me) => ({ manage: !!(me.building && me.building.manage), isSuper: !!me.isSuper, isManager: !!me.isManager, grantable: me.building ? me.building.grantable : [] });

  /* ---------- Supabase row mapping ---------- */
  const num = (v) => (v === null || v === undefined ? v : Number(v));
  const fromPayment = (r) => ({ id: r.id, key: r.key, apt: r.apt, y: r.y, m: r.m, amount: num(r.amount), method: r.method || '', date: r.paid_on, note: r.note || '', ref: r.ref || undefined, src: r.src, txKey: r.tx_key || undefined });
  const toPayment = (p) => ({ key: p.key, apt: p.apt, y: p.y, m: p.m, amount: p.amount, method: p.method, paid_on: p.date || null, note: p.note, ref: p.ref || null, src: p.src, tx_key: p.txKey || null });
  const fromResident = (r) => ({ id: r.id, key: r.key, apt: r.apt, first: r.first_name || '', last: r.last_name || '', first2: r.first2 || '', last2: r.last2 || '', phone1: r.phone1 || '', phone2: r.phone2 || '', role: r.role || '', status: r.status || '', entryMonth: r.entry_month, entryYear: r.entry_year, exitMonth: r.exit_month, exitYear: r.exit_year, account: r.account || '' });
  const fromTenantRow = (r) => ({ apt: r.apt, key: r.key, first: r.first_name || '', last: r.last_name || '', first2: r.first2 || '', last2: r.last2 || '', phone1: r.phone1 || '', phone2: r.phone2 || '', role: r.role || '' });

  async function fetchAll(table, building) { // Supabase returns at most 1000 rows per request
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client().from(table).select('*').eq('building_id', building).order({ apartments: 'apt', meta: 'name', snapshot: 'building_id' }[table] || 'id', { ascending: true }).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

  /* ---------- stores ---------- */
  function supabaseStore(B) {
    const c = client();
    const ok = ({ error, data }) => { if (error) throw new Error(error.message); return data; };
    return {
      async load() {
        const [apts, res, own, tar, pay, meta] = await Promise.all(['apartments', 'residents', 'owners', 'tariffs', 'payments', 'meta'].map((t) => fetchAll(t, B)));
        const m = Object.fromEntries(meta.map((r) => [r.name, r.value]));
        return {
          apartments: apts.map((a) => ({ apt: a.apt, floor: a.floor || '', rooms: a.rooms, sqm: a.sqm })),
          residents: res.map(fromResident),
          owners: own.map((o) => ({ apt: o.apt, first: o.first_name || '', last: o.last_name || '', phone: o.phone || '', account: o.account || '', note: o.note || '' })),
          tariffs: tar.map((t) => ({ year: t.year, month: t.month, apt: t.apt, amount: num(t.amount), note: t.note || '' })),
          payments: pay.map(fromPayment), expenses: [],
          bankSeen: m.bankSeen || {}, refSeen: m.refSeen || {}, aliases: m.aliases || {}, ignored: m.ignored || {},
          settings: Object.assign({ title: 'ועד הבית', showNames: false, showDebt: true }, m.settings || {}),
        };
      },
      async addPayments(rows) {
        const out = [];
        for (let i = 0; i < rows.length; i += 200) out.push(...ok(await c.from('payments').insert(rows.slice(i, i + 200).map((r) => ({ ...toPayment(r), building_id: B }))).select()));
        return out.sort((a, b) => a.id - b.id).map(fromPayment);
      },
      async exportAll() { // every table of this building, as stored (the format scripts/restore-backup.js reads)
        const tables = {};
        for (const t of ['apartments', 'residents', 'owners', 'tariffs', 'payments', 'expenses', 'meta', 'snapshot']) tables[t] = await fetchAll(t, B);
        tables.members = ok(await c.from('members').select('*').eq('building_id', B).order('id'));
        const b = ok(await c.from('buildings').select('*').eq('id', B).maybeSingle());
        return { building: { id: B, name: b ? b.name : String(B) }, tables };
      },
      async deletePayment(id) { ok(await c.from('payments').delete().eq('id', id).eq('building_id', B)); },
      async updateResident(r) {
        ok(await c.from('residents').update({ first_name: r.first, last_name: r.last, first2: r.first2, last2: r.last2, phone1: r.phone1, phone2: r.phone2, account: r.account, status: r.status }).eq('id', r.id).eq('building_id', B));
      },
      async saveMeta(name, value) { ok(await c.from('meta').upsert({ building_id: B, name, value }, { onConflict: 'building_id,name' })); },
      async saveSnapshot(data) { ok(await c.from('snapshot').upsert({ building_id: B, data, updated_at: new Date().toISOString() }, { onConflict: 'building_id' })); },
      // what this person may see of the board: everything for tenants and managers, only their own apartments for apartment owners
      async getBoard() { return ok(await c.rpc('my_snapshot', { b: B })); },
      async getAptPayments(apt, year) {
        const { data, error } = await c.rpc('apt_payments', { b: B, a: apt, yr: year });
        if (error) throw new Error(error.message);
        return data.map((r) => ({ y: r.y, m: r.m, amount: num(r.amount), method: r.method || '', date: r.paid_on }));
      },
      async getAptTenants() { return ok(await c.rpc('apt_tenants', { b: B })).map(fromTenantRow); },
      async listMembers() { return ok(await c.from('members').select('*').eq('building_id', B).order('email').order('role').order('apt')); },
      async listPeople() { // RLS decides what is visible: the super user sees every building, a manager only theirs
        const members = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await c.from('members').select('*').order('email').range(from, from + 999);
          if (error) throw new Error(error.message);
          members.push(...data);
          if (data.length < 1000) break;
        }
        return { members, managers: await this.listManagers() };
      },
      async addMember(m) { return ok(await c.from('members').insert({ building_id: B, email: m.email, role: m.role, apt: m.apt, name: m.name }).select().single()); },
      async updateMember(id, patch) { return ok(await c.from('members').update(patch).eq('id', id).eq('building_id', B).select().single()); },
      async deleteMember(id) { ok(await c.from('members').delete().eq('id', id).eq('building_id', B)); },
      async listManagers() {
        const [m, mb] = [ok(await c.from('managers').select('email').order('email')), ok(await c.from('manager_buildings').select('email, building_id'))];
        return m.map((x) => ({ email: x.email, buildings: mb.filter((y) => y.email === x.email).map((y) => y.building_id) }));
      },
      async addManager(e) { ok(await c.from('managers').insert({ email: e })); return { email: e, buildings: [] }; },
      async removeManager(e) { ok(await c.from('managers').delete().eq('email', e)); },
      async addManagerBuilding(e, id) { ok(await c.from('manager_buildings').insert({ email: e, building_id: id })); },
      async removeManagerBuilding(e, id) { ok(await c.from('manager_buildings').delete().eq('email', e).eq('building_id', id)); },
      async createBuilding(name) { return ok(await c.rpc('create_building', { nm: name })); },
      async renameBuilding(id, name) { ok(await c.from('buildings').update({ name }).eq('id', id)); },
    };
  }

  function demoStore(B, me) {
    let db = null; let snap = null; let nextId = 100000;
    let members = [
      { id: 1, email: 'committee@demo.com', role: 'committee', apt: null, name: 'חבר ועד' },
      { id: 2, email: 'tenant@demo.com', role: 'tenant', apt: 8, name: 'דייר' },
      { id: 3, email: 'owner@demo.com', role: 'apt_owner', apt: 16, name: 'בעל דירה' },
    ];
    let managers = [{ email: 'manager@demo.com', buildings: [1] }];
    let buildings = [{ id: 1, name: 'בניין לדוגמה' }];
    const ownedBy = (d) => new Set((me && me.building ? me.building.ownerApts : []));
    return {
      async load() { if (!db) db = await (await fetch('demo-db.json')).json(); return db; },
      async addPayments(rows) { return rows.map((r) => ({ ...r, id: nextId++ })); },
      async exportAll() { const d = await this.load(); return { building: { id: 1, name: 'demo' }, tables: { apartments: d.apartments, residents: d.residents, owners: d.owners, tariffs: d.tariffs, payments: d.payments, expenses: d.expenses || [], meta: [], members }, demo: true }; },
      async deletePayment() {}, async updateResident() {}, async saveMeta() {},
      async saveSnapshot(d) { snap = d; },
      async getBoard() {
        const s = snap || window.VaadLib.snapshot.snapshot(await this.load());
        if (me.building.seesBoard) return s;
        const own = ownedBy();
        if (!own.size) return null;
        return { ...s, grids: Object.fromEntries(Object.entries(s.grids).map(([y, rows]) => [y, rows.filter((r) => own.has(r.apt))])) };
      },
      async getAptPayments(apt, year) {
        const d = await this.load();
        const live = new Set(d.residents.filter((r) => r.apt === apt && r.status !== 'עזב').map((r) => r.key));
        return d.payments.filter((p) => p.apt === apt && p.y === year && live.has(p.key)).map((p) => ({ y: p.y, m: p.m, amount: p.amount, method: p.method || '', date: p.date })).sort((a, b) => a.m - b.m);
      },
      async getAptTenants() {
        const d = await this.load(); const own = ownedBy();
        return d.residents.filter((r) => own.has(r.apt) && r.status !== 'עזב').map((r) => ({ apt: r.apt, key: r.key, first: r.first, last: r.last, first2: r.first2, last2: r.last2, phone1: r.phone1, phone2: r.phone2, role: r.role }));
      },
      async listMembers() { return members; },
      async listPeople() { return { members: members.map((m) => ({ ...m, building_id: 1 })), managers }; },
      async addMember(m) { const row = { ...m, id: nextId++ }; members = members.concat(row); return row; },
      async updateMember(id, patch) { members = members.map((x) => (x.id === id ? { ...x, ...patch } : x)); return members.find((x) => x.id === id); },
      async deleteMember(id) { members = members.filter((x) => x.id !== id); },
      async listManagers() { return managers; },
      async addManager(e) { managers = managers.concat({ email: e, buildings: [] }); return { email: e, buildings: [] }; },
      async removeManager(e) { managers = managers.filter((x) => x.email !== e); },
      async addManagerBuilding(e, id) { managers = managers.map((x) => (x.email === e ? { ...x, buildings: [...x.buildings, id] } : x)); },
      async removeManagerBuilding(e, id) { managers = managers.map((x) => (x.email === e ? { ...x, buildings: x.buildings.filter((b) => b !== id) } : x)); },
      async createBuilding(name) { const id = Math.max(...buildings.map((b) => b.id)) + 1; buildings = buildings.concat({ id, name }); return id; },
      async renameBuilding(id, name) { buildings = buildings.map((b) => (b.id === id ? { ...b, name } : b)); },
    };
  }

  const store = (building, me) => (demo ? demoStore(building, me) : supabaseStore(building));
  return { demo, keep, client, whoami, buildMe, mountSwitcher, choose, signIn, signOut, go, store, perms, ROLE_LABEL };
})();
