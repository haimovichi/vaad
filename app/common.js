// Shared by login / admin / tenant pages: session, role lookup, data access.
// Demo mode (?demo=owner|admin|tenant) runs fully in memory from a local demo-db.json (never deployed).
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

  /* ---------- who is logged in ---------- */
  // A person can belong to several buildings with a different role in each; the chosen one is remembered.
  const chosenKey = 'vaad-building';
  const getChosen = () => { try { return Number(localStorage.getItem(chosenKey)) || null; } catch (e) { return null; } };
  const choose = (id) => { try { localStorage.setItem(chosenKey, String(id)); } catch (e) {} };
  async function whoami() {
    if (demo) {
      const b = { id: 1, name: 'בניין לדוגמה', role: demo, apt: demo === 'tenant' ? 8 : null };
      return { email: `${demo}@demo`, name: 'דמו', memberships: [b], building: b, role: demo, apt: b.apt };
    }
    const { data: { session } } = await client().auth.getSession();
    if (!session) return null;
    const email = session.user.email.toLowerCase();
    const { data, error } = await client().from('members').select('building_id, role, apt, name, buildings(name)').eq('email', email);
    if (error) throw new Error(error.message);
    const memberships = (data || []).map((r) => ({ id: r.building_id, name: (r.buildings && r.buildings.name) || `בניין ${r.building_id}`, role: r.role, apt: r.apt, memberName: r.name }));
    const picked = memberships.find((m) => m.id === getChosen()) || (memberships.length === 1 ? memberships[0] : null);
    return { email, memberships, building: picked, role: picked ? picked.role : null, apt: picked ? picked.apt : null, name: picked ? picked.memberName || '' : '' };
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

  /* ---------- Supabase row mapping ---------- */
  const num = (v) => (v === null || v === undefined ? v : Number(v));
  const fromPayment = (r) => ({ id: r.id, key: r.key, apt: r.apt, y: r.y, m: r.m, amount: num(r.amount), method: r.method || '', date: r.paid_on, note: r.note || '', ref: r.ref || undefined, src: r.src, txKey: r.tx_key || undefined });
  const toPayment = (p) => ({ key: p.key, apt: p.apt, y: p.y, m: p.m, amount: p.amount, method: p.method, paid_on: p.date || null, note: p.note, ref: p.ref || null, src: p.src, tx_key: p.txKey || null });
  const fromResident = (r) => ({ id: r.id, key: r.key, apt: r.apt, first: r.first_name || '', last: r.last_name || '', first2: r.first2 || '', last2: r.last2 || '', phone1: r.phone1 || '', phone2: r.phone2 || '', role: r.role || '', status: r.status || '', entryMonth: r.entry_month, entryYear: r.entry_year, exitMonth: r.exit_month, exitYear: r.exit_year, account: r.account || '' });

  async function fetchAll(table, building) { // Supabase returns at most 1000 rows per request
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client().from(table).select('*').eq('building_id', building).order(table === 'apartments' ? 'apt' : table === 'meta' ? 'name' : 'id', { ascending: true }).range(from, from + 999);
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
      async deletePayment(id) { ok(await c.from('payments').delete().eq('id', id).eq('building_id', B)); },
      async updateResident(r) {
        ok(await c.from('residents').update({ first_name: r.first, last_name: r.last, first2: r.first2, last2: r.last2, phone1: r.phone1, phone2: r.phone2, account: r.account, status: r.status }).eq('id', r.id).eq('building_id', B));
      },
      async saveMeta(name, value) { ok(await c.from('meta').upsert({ building_id: B, name, value }, { onConflict: 'building_id,name' })); },
      async saveSnapshot(data) { ok(await c.from('snapshot').upsert({ building_id: B, data, updated_at: new Date().toISOString() }, { onConflict: 'building_id' })); },
      async getSnapshot() { const d = ok(await c.from('snapshot').select('data').eq('building_id', B).maybeSingle()); return d ? d.data : null; },
      async listMembers() { return ok(await c.from('members').select('*').eq('building_id', B).order('role').order('apt')); },
      async saveMember(m) { ok(await c.from('members').upsert({ ...m, building_id: B }, { onConflict: 'building_id,email' })); return m; },
      async deleteMember(email) { ok(await c.from('members').delete().eq('email', email).eq('building_id', B)); },
    };
  }

  function demoStore() {
    let db = null; let snap = null; let nextId = 100000;
    let members = [{ email: 'owner@demo', role: 'owner', apt: null, name: 'בעל הבית' }, { email: 'admin@demo', role: 'admin', apt: null, name: 'מנהל נוסף' }, { email: 'tenant@demo', role: 'tenant', apt: 8, name: 'דייר' }];
    return {
      async load() { if (!db) db = await (await fetch('demo-db.json')).json(); return db; },
      async addPayments(rows) { return rows.map((r) => ({ ...r, id: nextId++ })); },
      async deletePayment() {}, async updateResident() {}, async saveMeta() {},
      async saveSnapshot(d) { snap = d; },
      async getSnapshot() { if (snap) return snap; const d = await this.load(); return window.VaadLib.snapshot.snapshot(d); },
      async listMembers() { return members; },
      async saveMember(m) { members = members.filter((x) => x.email !== m.email).concat(m); return m; },
      async deleteMember(e) { members = members.filter((x) => x.email !== e); },
    };
  }

  const store = (building) => (demo ? demoStore() : supabaseStore(building));
  return { demo, keep, client, whoami, mountSwitcher, choose, signIn, signOut, go, store };
})();
