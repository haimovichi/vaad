const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'db.json');

function empty() {
  return {
    apartments: [], residents: [], owners: [], tariffs: [], payments: [], expenses: [],
    bankSeen: {}, refSeen: {}, aliases: {}, ignored: {},
    settings: { title: 'ועד הבית', showNames: false, showDebt: true },
    nextId: 1,
  };
}

function load() {
  if (!fs.existsSync(FILE)) return empty();
  return Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
}

function save(db) {
  fs.mkdirSync(path.join(DATA, 'backups'), { recursive: true });
  if (fs.existsSync(FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(FILE, path.join(DATA, 'backups', `db-${stamp}.json`));
    const old = fs.readdirSync(path.join(DATA, 'backups')).sort().slice(0, -30);
    for (const f of old) fs.unlinkSync(path.join(DATA, 'backups', f));
  }
  fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
}

module.exports = { load, save, empty, FILE };
