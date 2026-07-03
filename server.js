const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const cors = require('cors');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.NODE_ENV === 'production'
  ? '/data/gantt.db'
  : path.join(__dirname, 'gantt.db');
const db = new DatabaseSync(DB_PATH);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT UNIQUE NOT NULL,
    owner TEXT NOT NULL,
    color TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    team          TEXT NOT NULL,
    owner         TEXT NOT NULL DEFAULT '',
    initiative    TEXT NOT NULL,
    outcome       TEXT DEFAULT '',
    target        TEXT DEFAULT '',
    metric        TEXT DEFAULT '',
    dependencies  TEXT DEFAULT '',
    status        TEXT DEFAULT 'active',
    bar_start     INTEGER DEFAULT -1,
    bar_end       INTEGER DEFAULT -1,
    bar_color     TEXT DEFAULT '#1565C0',
    is_blocked    INTEGER DEFAULT 0,
    sort_order    INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  );
`);

// ── Seed ───────────────────────────────────────────────────────────────────
const countRow = db.prepare('SELECT COUNT(*) AS c FROM tasks').get();
if (countRow.c === 0) {
  const teams = [
    ['Paynet','Chris','#1565C0'], ['PGW','Sean','#2E7D32'],
    ['Settlement','Ho','#E65100'], ['Portals','Jeff','#6A1B9A'],
    ['Integrations','Ronald','#00695C'], ['DevSecOps','Mohan','#B71C1C'],
  ];
  const iTeam = db.prepare('INSERT OR IGNORE INTO teams (name,owner,color) VALUES (?,?,?)');
  for (const t of teams) iTeam.run(...t);

  const iTask = db.prepare(`
    INSERT INTO tasks (team,owner,initiative,outcome,target,metric,dependencies,status,bar_start,bar_end,bar_color,is_blocked,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const tasks = [
    ['Paynet','Chris','MyDebit TR31','Enable secure MyDebit key exchange via TR31 key-block standard','Jul 2026','TR31 implementation passes scheme compliance review','Hard deadline per card scheme requirement','active',0,4,'#1565C0',0,1],
    ['Paynet','Chris','MyDebit Tokenization','Enable cardholders and merchants to transact using tokenized MyDebit credentials','Jul 2026','% of MyDebit transactions routed via token; scheme mandate compliance confirmed','','active',0,4,'#1565C0',0,2],
    ['Paynet','Chris','MyDebit Reversal & Refund (MLFF)','Enable MLFF merchants to reverse and issue multiple partial refunds on MyDebit transactions','Sep 2026','Reversal/refund success rate','Depends on RMiT completing first','active',9,12,'#1E88E5',1,3],
    ['Paynet','Chris','DNQR POS & DNREV','Enable POS merchants accepting DuitNow QR to reverse and refund in real time','Sep 2026','Average reversal/refund turnaround time','Depends on RMiT completing first','active',9,12,'#1E88E5',1,4],

    ['PGW','Sean','BUG: MyDebit CNP Deployment (~1w)','Restore reliable MyDebit CNP checkout','Jul 2026 (~1 week)','MyDebit CNP transaction failure rate','','blocked',0,0,'#C62828',1,1],
    ['PGW','Sean','IPG Core Bug Bundle x4 (~2w)','Restore accurate transaction status reporting and fix FPX/CIMB-UPP issues','Jul 2026 (~2w bundle)','Status-mismatch incident rate','HIGH severity — sequence first','blocked',0,1,'#C62828',1,2],
    ['PGW','Sean','Tokenization PGW API (~2w)','Enable PGW to process tokenized transactions via dedicated token service','Jul 2026 (~2 weeks)','% of PGW transactions using tokens','Runs alongside Paynet MyDebit Tokenization','active',0,1,'#2E7D32',0,3],
    ['PGW','Justin','Payment Link (Dynamic/Static)','Give merchants a shareable payment link with configurable amount rules','Not yet scheduled','Payment links created/paid; AMPCELL POS adoption','Reassigned to Justin — AMPCELL POS focus','unscheduled',-1,-1,'#2E7D32',0,4],
    ['PGW','Ronald','AliPay Plus','Enable merchants to accept AliPay+ wallet payments online','Queued','AliPay+ transaction volume post go-live','Check Ronald capacity','unscheduled',-1,-1,'#2E7D32',0,5],

    ['Settlement','Ho','C-Settlement — CIMB','Enable automatic ingestion of CIMB settlement C-files','Target 15 Jul 2026','% of CIMB settlement files auto-imported','','active',0,2,'#E65100',0,1],
    ['Settlement','Ho','C-Settlement — BSN','Enable automatic ingestion of BSN settlement C-files','Target 15 Jul 2026','% of BSN settlement files auto-imported','','active',0,2,'#E65100',0,2],
    ['Settlement','Ho','Payout Due Date — Settlement Type','Enable the system to classify settlement type automatically','Target 15 Jul 2026','Settlement-type classification accuracy','Foundational — blocks Merchant Auto PayOut','active',0,2,'#E65100',0,3],
    ['Settlement','Ho','Payout Due Date — PCF Computation','Ensure PCF is computed correctly as part of the payout due date engine','Target 15 Jul 2026','PCF computation accuracy','Sequenced alongside Settlement Type Calculation','active',0,2,'#E65100',0,4],
    ['Settlement','Ho','Payout Due Date — QA Fields (CIMB)','Define and validate the QA fields needed to verify CIMB settlement data','Target 15 Jul 2026','QA field coverage defined; discrepancy catch rate','BLOCKED — QA field details still pending','blocked',0,2,'#C62828',1,5],
    ['Settlement','Ho','Merchant Auto PayOut — Ambank','Enable automated merchant payouts via Ambank','Target 15 Jul 2026','Payout turnaround time; % of payouts automated','Blocked until Settlement Type Calculation is complete','blocked',2,2,'#C62828',1,6],

    ['Portals','Jeff','PayOut Scheduler','Enable automated scheduling of merchant payouts','Done','% of payouts triggered by scheduler vs manual','','done',0,0,'#388E3C',0,1],
    ['Portals','Jeff','Terminal Config Validation','Enable validation of terminal-level rate configuration','Blocked — 50% done','% of terminals with validated config','Blocked until scheme_id/channel/psp_id cleanup','blocked',-1,-1,'#C62828',1,2],
    ['Portals','Jeff','Clean Data (scheme_id / channel / psp_id)','Enable accurate scheme/channel/psp classification across transaction data','Pending','% of records with valid values','System redesign discussion needed with Y-MI','pending',-1,-1,'#757575',0,3],
    ['Portals','Jeff','PCF Fee','Enable accurate PCF fee computation','Blocked — pending Y-MI input','PCF billing accuracy','Upstream fee plan unknown; blocks Settlement PCF Computation','blocked',-1,-1,'#757575',1,4],
    ['Portals','Jeff','MSF Fee','Enable improved MSF computation','Blocked — pending Y-MI input','MSF billing accuracy / error rate','Scoped as enhancement','blocked',-1,-1,'#757575',1,5],
    ['Portals','Jeff','Dashboard via Apache Superset','Enable self-serve dashboards via Apache Superset','Not yet scheduled','Number of dashboards in active use','Scope to confirm with Y-MI','unscheduled',-1,-1,'#757575',0,6],

    ['Integrations','Ronald','CIMB UPP Phase 2 — Terminal','Enable terminal-level integration with CIMB UPP phase 2','Not yet scheduled','Terminals live on CIMB UPP phase 2','Check Ronald capacity across BSN + AliPay Plus','unscheduled',-1,-1,'#00695C',0,1],

    ['DevSecOps','Mohan','PCI-DSS: Fix WAF & Pass Presenting','Enable the platform to pass WAF and PCI-DSS presenting requirements','10-Jul','PCI-DSS certification status (pass/fail)','Compliance-critical','active',1,1,'#B71C1C',0,1],
    ['DevSecOps','Mohan','DB Works — Upgrade / Compress / Encrypt','Enable database infrastructure upgrade, compression, and encryption','15-Jul','DB storage cost reduction; encryption coverage %','Upgrade+compress done; encryption pending','active',0,2,'#B71C1C',0,2],
    ['DevSecOps','Mohan','RMiT Compliance','Enable compliance with BNM RMiT framework for DNQR due diligence','Not yet scheduled','RMiT compliance assessment outcome','Gates the Sep 2026 DNQR items','unscheduled',-1,-1,'#757575',0,3],
    ['DevSecOps','Mohan','DB Works — Read-Only DR Instance','Enable a read-only DB instance and DR server for disaster-recovery','Sep 2026 (delayed)','Successful DR drill completion','Delayed from original schedule','active',9,12,'#B71C1C',1,4],
  ];
  for (const t of tasks) iTask.run(...t);
  console.log('Database seeded with', tasks.length, 'tasks.');
}

// ── API ────────────────────────────────────────────────────────────────────
app.get('/api/teams', (req, res) => {
  res.json(db.prepare('SELECT * FROM teams ORDER BY id').all());
});

app.get('/api/tasks', (req, res) => {
  res.json(db.prepare('SELECT * FROM tasks ORDER BY team, sort_order, id').all());
});

app.post('/api/tasks', (req, res) => {
  const { team, owner='', initiative, outcome='', target='', metric='',
          dependencies='', status='active', bar_start=-1, bar_end=-1,
          bar_color='#1565C0', is_blocked=0 } = req.body;
  if (!team || !initiative) return res.status(400).json({ error: 'team and initiative required' });
  const max = db.prepare('SELECT MAX(sort_order) AS m FROM tasks WHERE team=?').get(team);
  const sort_order = (max.m || 0) + 1;
  const r = db.prepare(`
    INSERT INTO tasks (team,owner,initiative,outcome,target,metric,dependencies,status,bar_start,bar_end,bar_color,is_blocked,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(team,owner,initiative,outcome,target,metric,dependencies,status,bar_start,bar_end,bar_color,is_blocked?1:0,sort_order);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/tasks/:id', (req, res) => {
  const { initiative, owner='', outcome='', target='', metric='', dependencies='',
          status='active', bar_start=-1, bar_end=-1, bar_color='#1565C0', is_blocked=0 } = req.body;
  db.prepare(`
    UPDATE tasks SET initiative=?,owner=?,outcome=?,target=?,metric=?,dependencies=?,
    status=?,bar_start=?,bar_end=?,bar_color=?,is_blocked=?,updated_at=datetime('now')
    WHERE id=?
  `).run(initiative,owner,outcome,target,metric,dependencies,
         status,bar_start,bar_end,bar_color,is_blocked?1:0,req.params.id);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`✅  Gantt app → http://localhost:${PORT}`));
