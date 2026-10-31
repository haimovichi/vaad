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
    return { email, isSuper, isManager, canCreate: isSuper || isManager || memberships.some((m) => m.roles.includes('committee')), memberships, building: picked };
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
    const me = await c.from('users').select('id').eq('email', email).maybeSingle();
    if (me.error) throw new Error(me.error.message);
    const [mem, sup, mgr, mb, blds] = await Promise.all([
      me.data ? c.from('members').select('building_id, role, apt').eq('user_id', me.data.id) : Promise.resolve({ data: [], error: null }),
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
  // Address picker: city and street come from Israel's official street list (data.gov.il); only a listed city and street are accepted.
  // get() returns "street number city" once all three are valid, else null.
  let apSeq = 0;
  function addressPicker(el, onchange) {
    const RES = '9ad3862c-8391-4b2f-84a4-2d4c68625f4b'; const API = 'https://data.gov.il/api/3/action/datastore_search';
    const id = 'ap' + (++apSeq); const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const st = 'direction:rtl;text-align:right;width:auto;margin:0';
    el.innerHTML = `<input class="c" list="${id}c" placeholder="עיר" autocomplete="off" style="${st};width:140px"><input class="s" list="${id}s" placeholder="רחוב" autocomplete="off" disabled style="${st};width:170px"><input class="n" type="number" min="1" placeholder="מספר" disabled style="${st};width:80px"><datalist id="${id}c"></datalist><datalist id="${id}s"></datalist><span class="mute msg" style="font-size:13px"></span>`;
    const q = (s) => el.querySelector(s); let cities = []; let streets = []; let forCity = '';
    const say = (t) => { q('.msg').textContent = t; };
    const fetchRows = async (filters, limit) => {
      const r = await fetch(`${API}?resource_id=${RES}&limit=${limit}&fields=${encodeURIComponent('שם_ישוב,שם_רחוב,סמל_רחוב')}&filters=${encodeURIComponent(JSON.stringify(filters))}`);
      const j = await r.json(); if (!j.success) throw new Error('lookup failed'); return j.result.records;
    };
    const fill = (dl, list) => { dl.innerHTML = list.map((x) => `<option value="${x.replace(/"/g, '&quot;')}">`).join(''); };
    const get = () => { const c = norm(q('.c').value); const s = norm(q('.s').value); const n = Math.floor(+q('.n').value); return cities.includes(c) && forCity === c && streets.includes(s) && n > 0 ? `${s} ${n} ${c}` : null; };
    const changed = () => onchange && onchange(get());
    (async () => { try { say('טוען ערים…'); cities = [...new Set((await fetchRows({ 'סמל_רחוב': 9000 }, 5000)).map((r) => norm(r['שם_ישוב'])))].sort(); fill(q('datalist'), cities); say(''); } catch (e) { say('לא ניתן לטעון את רשימת הערים. בדקו חיבור ונסו שוב.'); } })();
    q('.c').oninput = async () => {
      const c = norm(q('.c').value); q('.s').value = ''; q('.n').value = ''; streets = []; forCity = '';
      q('.s').disabled = q('.n').disabled = true; changed();
      if (!cities.includes(c)) return;
      try { say('טוען רחובות…'); const rows = await fetchRows({ 'שם_ישוב': c }, 20000); streets = [...new Set(rows.filter((r) => r['סמל_רחוב'] !== 9000).map((r) => norm(r['שם_רחוב'])))].sort(); forCity = c; fill(el.querySelectorAll('datalist')[1], streets); q('.s').disabled = q('.n').disabled = false; say(''); }
      catch (e) { say('לא ניתן לטעון את רשימת הרחובות.'); }
      changed();
    };
    q('.s').oninput = changed; q('.n').oninput = changed;
    return { get, reset() { q('.c').value = q('.s').value = q('.n').value = ''; q('.s').disabled = q('.n').disabled = true; changed(); } };
  }
  const signIn = async (email) => {
    const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html' } });
    if (error) throw error;
  };
  const signOut = async () => { if (!demo) await client().auth.signOut(); location.href = 'index.html' + keep; };
  const go = (page) => { location.href = page + keep; };
  const perms = (me) => ({ canCreate: !!me.canCreate, manage: !!(me.building && me.building.manage), isSuper: !!me.isSuper, isManager: !!me.isManager, grantable: me.building ? me.building.grantable : [] });

  /* ---------- Supabase row mapping ---------- */
  const num = (v) => (v === null || v === undefined ? v : Number(v));
  const fromPayment = (r) => ({ id: r.id, key: r.key, apt: r.apt, y: r.y, m: r.m, amount: num(r.amount), method: r.method || '', date: r.paid_on, note: r.note || '', ref: r.ref || undefined, src: r.src, txKey: r.tx_key || undefined });
  const toPayment = (p) => ({ key: p.key, apt: p.apt, y: p.y, m: p.m, amount: p.amount, method: p.method, paid_on: p.date || null, note: p.note, ref: p.ref || null, src: p.src, tx_key: p.txKey || null });
  // People live in the users table; tenancies and owners point at them. The app keeps its flat shape (first, last, phone1...).
  const fullName = (u) => [u && u.first_name, u && u.last_name].filter(Boolean).join(' ');
  const fromResident = (r, users) => {
    const a = users.get(r.user_id) || {}; const b = users.get(r.user2_id) || {};
    return { id: r.id, key: r.key, apt: r.apt, userId: r.user_id || null, user2Id: r.user2_id || null, first: a.first_name || '', last: a.last_name || '', first2: b.first_name || '', last2: b.last_name || '', phone1: a.phone || '', phone2: b.phone || '', role: r.role || '', status: r.status || '', entryMonth: r.entry_month, entryYear: r.entry_year, exitMonth: r.exit_month, exitYear: r.exit_year, account: a.bank_account || '' };
  };
  const userOut = (u) => ({ id: u.id, email: u.email || '', first: u.first_name || '', last: u.last_name || '', phone: u.phone || '', account: u.bank_account || '' });
  const USER_COLS = { first: 'first_name', last: 'last_name', email: 'email', phone: 'phone', account: 'bank_account' };
  const fromTenantRow = (r) => ({ apt: r.apt, key: r.key, first: r.first_name || '', last: r.last_name || '', first2: r.first2 || '', last2: r.last2 || '', phone1: r.phone1 || '', phone2: r.phone2 || '', role: r.role || '' });

  async function fetchUsers() { // every user this login may read (RLS decides), 1000 per request
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client().from('users').select('*').order('id').range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }

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
    let users = new Map();   // id -> users row, as last read
    const refreshUsers = async () => { users = new Map((await fetchUsers()).map((u) => [u.id, u])); };
    const memberOut = (m) => { const u = users.get(m.user_id); return { id: m.id, building_id: m.building_id, user_id: m.user_id, email: u ? u.email : null, role: m.role, apt: m.apt, name: fullName(u) }; };
    const setName = async (uid, name) => { // only the super user may; for anyone else the database refuses and this is ignored
      const [first, ...rest] = String(name || '').trim().split(/\s+/);
      if (!first) return;
      await c.from('users').update({ first_name: first, last_name: rest.join(' ') || null }).eq('id', uid).select();
    };
    const denied = () => new Error('רק מנהל העל יכול לערוך פרטי אנשים');
    return {
      async load() {
        const [[apts, res, own, tar, pay, meta]] = await Promise.all([Promise.all(['apartments', 'residents', 'owners', 'tariffs', 'payments', 'meta'].map((t) => fetchAll(t, B))), refreshUsers()]);
        const m = Object.fromEntries(meta.map((r) => [r.name, r.value]));
        return {
          apartments: apts.map((a) => ({ apt: a.apt, floor: a.floor || '', rooms: a.rooms, sqm: a.sqm })),
          residents: res.map((r) => fromResident(r, users)),
          owners: own.map((o) => { const u = users.get(o.user_id) || {}; return { apt: o.apt, userId: o.user_id || null, first: u.first_name || '', last: u.last_name || '', phone: u.phone || '', account: u.bank_account || '', note: o.note || '' }; }),
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
        const ids = new Set(); // the people this building refers to (users belong to no building)
        for (const r of tables.residents) { ids.add(r.user_id); ids.add(r.user2_id); }
        for (const o of tables.owners) ids.add(o.user_id);
        for (const m of tables.members) ids.add(m.user_id);
        const want = [...ids].filter(Boolean); tables.users = [];
        for (let i = 0; i < want.length; i += 100) tables.users.push(...ok(await c.from('users').select('*').in('id', want.slice(i, i + 100))));
        tables.users.sort((a, b) => a.id - b.id);
        const b = ok(await c.from('buildings').select('*').eq('id', B).maybeSingle());
        return { building: { id: B, name: b ? b.name : String(B) }, tables };
      },
      async deletePayment(id) { ok(await c.from('payments').delete().eq('id', id).eq('building_id', B)); },
      async updateResident(r) { // status: the building's staff; a person's details: the super user (RLS enforces it)
        ok(await c.from('residents').update({ status: r.status }).eq('id', r.id).eq('building_id', B));
        const save = async (uid, f) => {
          const old = (uid && users.get(uid)) || null;
          if (!old) {
            if (!Object.values(f).some(Boolean)) return null;
            const { data, error } = await c.from('users').insert(f).select().single();
            if (error) throw denied();
            users.set(data.id, data); return data.id;
          }
          if (Object.keys(f).every((k) => (old[k] || '') === (f[k] || ''))) return uid;
          const { data, error } = await c.from('users').update(f).eq('id', uid).select();
          if (error || !data.length) throw denied();
          users.set(uid, data[0]); return uid;
        };
        const a = await save(r.userId || null, { first_name: r.first || null, last_name: r.last || null, phone: r.phone1 || null, bank_account: r.account || null });
        const b = await save(r.user2Id || null, { first_name: r.first2 || null, last_name: r.last2 || null, phone: r.phone2 || null });
        if (a !== (r.userId || null) || b !== (r.user2Id || null)) ok(await c.from('residents').update({ user_id: a, user2_id: b }).eq('id', r.id).eq('building_id', B));
        r.userId = a; r.user2Id = b;
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
      async listMembers() {
        const [rows] = await Promise.all([c.from('members').select('*').eq('building_id', B).order('id').then(ok), refreshUsers()]);
        return rows.map(memberOut).sort((x, y) => String(x.email || x.name).localeCompare(String(y.email || y.name)) || x.role.localeCompare(y.role) || (x.apt || 0) - (y.apt || 0));
      },
      async listPeople() { // RLS decides what is visible: the super user sees every building, a manager only theirs
        const members = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await c.from('members').select('*').order('id').range(from, from + 999);
          if (error) throw new Error(error.message);
          members.push(...data);
          if (data.length < 1000) break;
        }
        await refreshUsers();
        return { members: members.map(memberOut), managers: await this.listManagers(), users: [...users.values()].map(userOut) };
      },
      async addUser(u) { // the super user adds a person (with or without an email)
        const row = {}; for (const [k, col] of Object.entries(USER_COLS)) row[col] = String(u[k] || '').trim() || null;
        if (row.email) row.email = row.email.toLowerCase();
        const { data, error } = await c.from('users').insert(row).select().single();
        if (error) throw error.code === '23505' ? new Error('כתובת האימייל כבר קיימת') : denied();
        users.set(data.id, data); return userOut(data);
      },
      async updateUser(id, patch) {
        const row = {}; for (const [k, col] of Object.entries(USER_COLS)) if (k in patch) row[col] = String(patch[k] || '').trim() || null;
        if (row.email) row.email = row.email.toLowerCase();
        const { data, error } = await c.from('users').update(row).eq('id', id).select();
        if (error) throw error.code === '23505' ? new Error('כתובת האימייל כבר קיימת') : error;
        if (!data.length) throw denied();
        users.set(data[0].id, data[0]); return userOut(data[0]);
      },
      async addMember(m) {
        const uid = ok(await c.rpc('user_for_email', { e: m.email }));
        if (m.name) await setName(uid, m.name);
        const row = ok(await c.from('members').insert({ building_id: B, user_id: uid, role: m.role, apt: m.apt }).select().single());
        await refreshUsers();
        return memberOut(row);
      },
      async updateMember(id, patch) {
        const row = ok(await c.from('members').select('*').eq('id', id).eq('building_id', B).single());
        await refreshUsers();
        const u = users.get(row.user_id);
        if ('name' in patch && String(patch.name || '') !== fullName(u)) {
          const [first, ...rest] = String(patch.name || '').trim().split(/\s+/);
          const { data, error } = await c.from('users').update({ first_name: first || null, last_name: rest.join(' ') || null }).eq('id', row.user_id).select();
          if (error || !data.length) throw denied();
        }
        const out = 'apt' in patch ? ok(await c.from('members').update({ apt: patch.apt }).eq('id', id).eq('building_id', B).select().single()) : row;
        await refreshUsers();
        return memberOut(out);
      },
      async deleteMember(id) { ok(await c.from('members').delete().eq('id', id).eq('building_id', B)); },
      async listManagers() {
        const [m, mb] = [ok(await c.from('managers').select('email').order('email')), ok(await c.from('manager_buildings').select('email, building_id'))];
        return m.map((x) => ({ email: x.email, buildings: mb.filter((y) => y.email === x.email).map((y) => y.building_id) }));
      },
      async addManager(e) { ok(await c.from('managers').insert({ email: e })); await c.from('users').upsert({ email: e }, { onConflict: 'email', ignoreDuplicates: true }); return { email: e, buildings: [] }; },
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
      { id: 1, user_id: 1, email: 'committee@demo.com', role: 'committee', apt: null, name: 'חבר ועד' },
      { id: 2, user_id: 2, email: 'tenant@demo.com', role: 'tenant', apt: 8, name: 'דייר' },
      { id: 3, user_id: 3, email: 'owner@demo.com', role: 'apt_owner', apt: 16, name: 'בעל דירה' },
    ];
    let managers = [{ email: 'manager@demo.com', buildings: [1] }];
    let users = [{ id: 1, email: 'committee@demo.com', first: 'חבר', last: 'ועד', phone: '050-1111111', account: '' }, { id: 2, email: 'tenant@demo.com', first: 'דייר', last: '', phone: '', account: '' }, { id: 3, email: 'owner@demo.com', first: 'בעל', last: 'דירה', phone: '', account: '' }, { id: 4, email: '', first: 'דייר', last: 'בלי אימייל', phone: '052-2222222', account: '12345' }];
    const uOf = (id) => users.find((u) => u.id === id);
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
      async listPeople() { return { members: members.map((m) => ({ ...m, building_id: 1 })), managers, users }; },
      async addUser(u) { const row = { id: nextId++, email: u.email || '', first: u.first || '', last: u.last || '', phone: u.phone || '', account: u.account || '' }; users = users.concat(row); return row; },
      async updateUser(id, patch) { users = users.map((x) => (x.id === id ? { ...x, ...patch } : x)); return uOf(id); },
      async addMember(m) { let u = users.find((x) => x.email === m.email); if (!u) { u = { id: nextId++, email: m.email, first: '', last: '', phone: '', account: '' }; users = users.concat(u); } const row = { ...m, id: nextId++, user_id: u.id }; members = members.concat(row); return row; },
      async updateMember(id, patch) { members = members.map((x) => (x.id === id ? { ...x, ...patch } : x)); return members.find((x) => x.id === id); },
      async deleteMember(id) { members = members.filter((x) => x.id !== id); },
      async listManagers() { return managers; },
      async addManager(e) { managers = managers.concat({ email: e, buildings: [] }); return { email: e, buildings: [] }; },
      async removeManager(e) { managers = managers.filter((x) => x.email !== e); },
      async addManagerBuilding(e, id) { managers = managers.map((x) => (x.email === e ? { ...x, buildings: [...x.buildings, id] } : x)); },
      async removeManagerBuilding(e, id) { managers = managers.map((x) => (x.email === e ? { ...x, buildings: x.buildings.filter((b) => b !== id) } : x)); },
      async renameBuilding(id, name) { buildings = buildings.map((b) => (b.id === id ? { ...b, name } : b)); },
      async createBuilding(name) { const id = Math.max(...buildings.map((b) => b.id)) + 1; buildings = buildings.concat({ id, name }); return id; },
    };
  }

  const store = (building, me) => (demo ? demoStore(building, me) : supabaseStore(building));
  return { demo, keep, client, whoami, addressPicker, buildMe, mountSwitcher, choose, signIn, signOut, go, store, perms, ROLE_LABEL };
})();
