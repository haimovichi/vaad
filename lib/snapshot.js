// Tenant-facing snapshot: only allow-listed fields (apartment, tag, status per month, optional name/debt).
const { grid, nowMi, fromMi, START } = require('./calc');

function snapshot(db, now = nowMi()) {
  const cur = fromMi(now);
  const years = [];
  for (let y = fromMi(START).y; y <= cur.y; y++) years.push(y);
  const s = db.settings;
  const data = {
    title: s.title, updated: new Date().toISOString().slice(0, 10), now: cur, years,
    showDebt: !!s.showDebt, showNames: !!s.showNames, grids: {},
  };
  for (const y of years) {
    const rows = grid(db, y, now);
    const count = {}; rows.forEach((r) => { count[r.apt] = (count[r.apt] || 0) + 1; });
    data.grids[y] = rows.map((g) => ({
      apt: g.apt,
      name: s.showNames ? g.last : undefined,
      tag: count[g.apt] > 1 ? (g.left ? 'דייר קודם' : 'דייר נוכחי') : undefined,
      debt: s.showDebt ? g.debt : undefined,
      months: g.months.map((c) => c.status),
    }));
  }
  return data;
}

module.exports = { snapshot };
