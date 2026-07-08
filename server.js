const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// ── DB: Postgres (Render) or local SQLite fallback ─────────────────────────
let db;

if (process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  db = {
    async query(text, params) { return pool.query(text, params); },
    async all(text, params)   { const r = await pool.query(text, params); return r.rows; },
    async get(text, params)   { const r = await pool.query(text, params); return r.rows[0]; },
    async run(text, params)   { return pool.query(text, params); },
  };
  console.log('Using PostgreSQL');
} else {
  const { DatabaseSync } = require('node:sqlite');
  const sqlite = new DatabaseSync(path.join(__dirname, 'gantt.db'));
  db = {
    async query(text, params) { return sqlite.prepare(adaptSQL(text)).run(...(params||[])); },
    async all(text, params)   { return sqlite.prepare(adaptSQL(text)).all(...(params||[])); },
    async get(text, params)   { return sqlite.prepare(adaptSQL(text)).get(...(params||[])); },
    async run(text, params)   { return sqlite.prepare(adaptSQL(text)).run(...(params||[])); },
    exec(text) { sqlite.exec(text); }
  };
  console.log('Using SQLite');
}

function adaptSQL(sql) {
  return sql.replace(/\$\d+/g, () => '?');
}

// ── Schema ─────────────────────────────────────────────────────────────────
async function initSchema() {
  if (process.env.DATABASE_URL) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id    SERIAL PRIMARY KEY,
        name  TEXT UNIQUE NOT NULL,
        owner TEXT NOT NULL,
        color TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS developers (
        id      SERIAL PRIMARY KEY,
        name    TEXT NOT NULL,
        project TEXT NOT NULL,
        UNIQUE(name, project)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id            SERIAL PRIMARY KEY,
        team          TEXT NOT NULL,
        owner         TEXT NOT NULL DEFAULT '',
        initiative    TEXT NOT NULL,
        outcome       TEXT DEFAULT '',
        target        TEXT DEFAULT '',
        metric        TEXT DEFAULT '',
        dependencies  TEXT DEFAULT '',
        status        TEXT DEFAULT 'active',
        priority      TEXT DEFAULT 'medium',
        bar_start     INTEGER DEFAULT -1,
        bar_end       INTEGER DEFAULT -1,
        bar_color     TEXT DEFAULT '#4F46E5',
        is_blocked    INTEGER DEFAULT 0,
        sort_order    INTEGER DEFAULT 0,
        progress      INTEGER DEFAULT 0,
        is_milestone  INTEGER DEFAULT 0,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await db.run("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority     TEXT    DEFAULT 'medium'").catch(() => {});
    await db.run("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress     INTEGER DEFAULT 0").catch(() => {});
    await db.run("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_milestone INTEGER DEFAULT 0").catch(() => {});
    await db.run("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS jira_key     TEXT").catch(() => {});
    await db.run("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_date  INTEGER DEFAULT -1").catch(() => {});
    await db.query("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)").catch(() => {});
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT UNIQUE NOT NULL,
        owner TEXT NOT NULL,
        color TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS developers (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        name    TEXT NOT NULL,
        project TEXT NOT NULL,
        UNIQUE(name, project)
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
        priority      TEXT DEFAULT 'medium',
        bar_start     INTEGER DEFAULT -1,
        bar_end       INTEGER DEFAULT -1,
        bar_color     TEXT DEFAULT '#4F46E5',
        is_blocked    INTEGER DEFAULT 0,
        sort_order    INTEGER DEFAULT 0,
        progress      INTEGER DEFAULT 0,
        is_milestone  INTEGER DEFAULT 0,
        created_at    TEXT DEFAULT (datetime('now')),
        updated_at    TEXT DEFAULT (datetime('now'))
      );
    `);
    try { db.exec("ALTER TABLE tasks ADD COLUMN priority     TEXT    DEFAULT 'medium'"); } catch(_) {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN progress     INTEGER DEFAULT 0");        } catch(_) {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN is_milestone INTEGER DEFAULT 0");        } catch(_) {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN jira_key     TEXT");                     } catch(_) {}
    try { db.exec("ALTER TABLE tasks ADD COLUMN target_date  INTEGER DEFAULT -1");        } catch(_) {}
    try { db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)"); } catch(_) {}
  }
}

// ── Seed ───────────────────────────────────────────────────────────────────
async function seed() {
  const row = await db.get('SELECT COUNT(*) AS c FROM tasks');
  const count = parseInt(row.c || row.count || 0);
  if (count > 0) {
    await seedDevelopers();
    return;
  }

  const teams = [
    ['Paynet','Chris','#1565C0'], ['PGW','Sean','#2E7D32'],
    ['Settlement','Ho','#E65100'], ['Portals','Jeff','#6A1B9A'],
    ['Integrations','Ronald','#00695C'], ['DevSecOps','Mohan','#B71C1C'],
  ];
  for (const [name,owner,color] of teams) {
    await db.run(
      'INSERT INTO teams (name,owner,color) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING',
      [name,owner,color]
    );
  }

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

  for (const t of tasks) {
    await db.run(
      `INSERT INTO tasks (team,owner,initiative,outcome,target,metric,dependencies,status,bar_start,bar_end,bar_color,is_blocked,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      t
    );
  }
  console.log(`Seeded ${tasks.length} tasks.`);
  await seedDevelopers();
}

async function seedDevelopers() {
  const row = await db.get('SELECT COUNT(*) AS c FROM developers');
  const count = parseInt(row.c || row.count || 0);
  if (count > 0) return;

  const devs = [
    ['Chris',   'Paynet'],
    ['Sean',    'PGW'],
    ['Justin',  'PGW'],
    ['Ronald',  'PGW'],
    ['Ho',      'Settlement'],
    ['Jeff',    'Portals'],
    ['Ronald',  'Integrations'],
    ['Mohan',   'DevSecOps'],
  ];
  for (const [name, project] of devs) {
    try {
      await db.run('INSERT INTO developers (name, project) VALUES ($1, $2)', [name, project]);
    } catch (_) { /* skip duplicate */ }
  }
  console.log(`Seeded ${devs.length} developers.`);
}

app.get('/api/health', (req, res) => {
  res.json({ db: process.env.DATABASE_URL ? 'postgres' : 'sqlite' });
});

// No-cache for all API responses so reloads after mutations always see fresh data
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// ── API: Teams / Projects ──────────────────────────────────────────────────
app.get('/api/teams', async (req, res) => {
  try { res.json(await db.all('SELECT * FROM teams ORDER BY id')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/teams', async (req, res) => {
  try {
    const { name, owner = '', color = '#4F46E5' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const row = await db.get(
      'INSERT INTO teams (name, owner, color) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), owner.trim(), color]
    );
    res.json(row);
  } catch(e) {
    if (e.message?.includes('UNIQUE') || e.message?.includes('unique')) {
      return res.status(409).json({ error: 'A project with that name already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/teams/:id', async (req, res) => {
  try {
    const { name, owner = '', color = '#4F46E5' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const existing = await db.get('SELECT * FROM teams WHERE id=$1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const row = await db.get(
      'UPDATE teams SET name=$1, owner=$2, color=$3 WHERE id=$4 RETURNING *',
      [name.trim(), owner.trim(), color, req.params.id]
    );
    if (existing.name !== name.trim()) {
      await db.run('UPDATE tasks SET team=$1 WHERE team=$2', [name.trim(), existing.name]);
      await db.run('UPDATE developers SET project=$1 WHERE project=$2', [name.trim(), existing.name]);
    }
    res.json(row);
  } catch(e) {
    if (e.message?.includes('UNIQUE') || e.message?.includes('unique'))
      return res.status(409).json({ error: 'A project with that name already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/teams/:id', async (req, res) => {
  try {
    const team = await db.get('SELECT * FROM teams WHERE id=$1', [req.params.id]);
    if (!team) return res.status(404).json({ error: 'Project not found' });
    const used = await db.get('SELECT COUNT(*) AS c FROM tasks WHERE team=$1', [team.name]);
    const count = parseInt(used?.c || used?.count || 0);
    if (count > 0) return res.status(400).json({ error: `Cannot delete — ${count} initiative(s) still assigned to this project` });
    await db.run('DELETE FROM teams WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Developers ────────────────────────────────────────────────────────
app.get('/api/developers', async (req, res) => {
  try { res.json(await db.all('SELECT * FROM developers ORDER BY project, name')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/developers', async (req, res) => {
  try {
    const { name, project } = req.body;
    if (!name || !project) return res.status(400).json({ error: 'name and project required' });
    const row = await db.get(
      'INSERT INTO developers (name, project) VALUES ($1, $2) RETURNING *',
      [name.trim(), project]
    );
    res.json(row);
  } catch(e) {
    if (e.message?.includes('UNIQUE') || e.message?.includes('unique')) {
      return res.status(409).json({ error: 'Developer already exists in this project' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/developers/:id', async (req, res) => {
  try {
    const { name, project } = req.body;
    if (!name || !project) return res.status(400).json({ error: 'name and project required' });
    const row = await db.get(
      'UPDATE developers SET name=$1, project=$2 WHERE id=$3 RETURNING *',
      [name.trim(), project, req.params.id]
    );
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/developers/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM developers WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Tasks ─────────────────────────────────────────────────────────────
app.get('/api/tasks', async (req, res) => {
  try { res.json(await db.all('SELECT * FROM tasks ORDER BY team, sort_order, id')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { team, owner='', initiative, outcome='', target='', metric='',
            dependencies='', status='active', priority='medium', bar_start=-1, bar_end=-1,
            bar_color='#4F46E5', is_blocked=0, progress=0, is_milestone=0, target_date=-1 } = req.body;
    if (!team || !initiative) return res.status(400).json({ error: 'team and initiative required' });
    const max = await db.get('SELECT MAX(sort_order) AS m FROM tasks WHERE team=$1', [team]);
    const sort_order = (parseInt(max?.m) || 0) + 1;
    const row = await db.get(
      `INSERT INTO tasks (team,owner,initiative,outcome,target,metric,dependencies,status,priority,bar_start,bar_end,bar_color,is_blocked,sort_order,progress,is_milestone,target_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [team,owner,initiative,outcome,target,metric,dependencies,status,priority,bar_start,bar_end,bar_color,is_blocked?1:0,sort_order,parseInt(progress)||0,is_milestone?1:0,parseInt(target_date)??-1]
    );
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { team, initiative, owner='', outcome='', target='', metric='', dependencies='',
            status='active', priority='medium', bar_start=-1, bar_end=-1, bar_color='#4F46E5',
            is_blocked=0, progress=0, is_milestone=0, target_date=-1 } = req.body;
    const now = process.env.DATABASE_URL ? 'NOW()' : "datetime('now')";
    const row = await db.get(
      `UPDATE tasks SET team=$1,initiative=$2,owner=$3,outcome=$4,target=$5,metric=$6,dependencies=$7,
       status=$8,priority=$9,bar_start=$10,bar_end=$11,bar_color=$12,is_blocked=$13,
       progress=$14,is_milestone=$15,target_date=$16,updated_at=${now}
       WHERE id=$17 RETURNING *`,
      [team,initiative,owner,outcome,target,metric,dependencies,status,priority,bar_start,bar_end,bar_color,is_blocked?1:0,parseInt(progress)||0,is_milestone?1:0,parseInt(target_date)??-1,req.params.id]
    );
    res.json(row);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM tasks WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Settings ─────────────────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
  try {
    const rows = await db.all('SELECT key, value FROM settings');
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    const out = { ...obj };
    delete out.jira_token;
    out.jira_token_set = !!obj.jira_token;
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body || {})) {
      await db.run(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value=$2',
        [key, String(value)]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── API: Jira Sync ─────────────────────────────────────────────────────────
function mapJiraStatus(s) {
  s = (s || '').toLowerCase();
  if (['done','closed','resolved','cancelled','complete','completed'].some(v => s.includes(v))) return 'done';
  if (['blocked','on hold','impediment','waiting'].some(v => s.includes(v))) return 'blocked';
  if (['in progress','in development','in review','code review','testing','in test'].some(v => s.includes(v))) return 'active';
  if (['backlog','future','icebox'].some(v => s.includes(v))) return 'unscheduled';
  return 'pending';
}

function mapJiraPriority(p) {
  p = (p || '').toLowerCase();
  if (['highest','critical'].includes(p)) return 'critical';
  if (p === 'high') return 'high';
  if (['low','lowest','minor','trivial'].includes(p)) return 'low';
  return 'medium';
}

function dateToWeekIdx(dateStr, startDate, numWeeks) {
  if (!dateStr) return -1;
  const d = new Date(dateStr + 'T00:00:00');
  const s = new Date(startDate + 'T00:00:00');
  const diff = d - s;
  if (diff < 0) return 0;
  const wi = Math.floor(diff / (7 * 24 * 3600 * 1000));
  return Math.min(wi, numWeeks - 1);
}

app.post('/api/jira/sync', async (req, res) => {
  try {
    const { startDate, endDate } = req.body || {};

    const rows = await db.all('SELECT key, value FROM settings');
    const cfg = {};
    for (const r of rows) cfg[r.key] = r.value;
    const { jira_domain, jira_email, jira_token, jira_jql } = cfg;

    if (!jira_domain || !jira_email || !jira_token) {
      return res.status(400).json({ error: 'Jira not configured. Please set domain, email, and API token.' });
    }

    const auth = Buffer.from(`${jira_email}:${jira_token}`).toString('base64');
    const jql  = jira_jql || 'order by updated DESC';
    const effectiveStart = startDate || '2026-07-01';
    const numWeeks = startDate && endDate
      ? Math.ceil((new Date(endDate + 'T00:00:00') - new Date(startDate + 'T00:00:00')) / (7 * 24 * 3600 * 1000)) + 1
      : 13;

    // Paginate through all matching Jira issues
    const allIssues = [];
    let startAt = 0;
    while (true) {
      const url = `https://${jira_domain}/rest/api/3/search` +
        `?jql=${encodeURIComponent(jql)}` +
        `&fields=summary,assignee,status,priority,project,duedate,customfield_10015,issuetype,description` +
        `&maxResults=100&startAt=${startAt}`;
      const jiraRes = await fetch(url, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      if (!jiraRes.ok) {
        const txt = await jiraRes.text();
        return res.status(502).json({ error: `Jira API ${jiraRes.status}: ${txt.slice(0, 300)}` });
      }
      const data = await jiraRes.json();
      allIssues.push(...(data.issues || []));
      if (allIssues.length >= (data.total || 0) || (data.issues || []).length === 0 || startAt > 400) break;
      startAt += 100;
    }

    // Team lookup + auto-create
    const teams = await db.all('SELECT * FROM teams');
    const AUTO_COLORS = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981','#0EA5E9'];
    let colorIdx = teams.length % AUTO_COLORS.length;

    async function getOrCreateTeam(projectName, projectKey) {
      let team = teams.find(t => t.name.toLowerCase() === projectName.toLowerCase());
      if (!team) team = teams.find(t =>
        projectName.toLowerCase().includes(t.name.toLowerCase()) ||
        t.name.toLowerCase().includes(projectName.toLowerCase())
      );
      if (team) return team;
      const color = AUTO_COLORS[colorIdx++ % AUTO_COLORS.length];
      try {
        const created = await db.get(
          'INSERT INTO teams (name, owner, color) VALUES ($1, $2, $3) RETURNING *',
          [projectName, projectKey || '', color]
        );
        if (created) { teams.push(created); return created; }
      } catch (_) {}
      const existing = await db.get('SELECT * FROM teams WHERE name=$1', [projectName]);
      if (existing && !teams.find(t => t.id === existing.id)) teams.push(existing);
      return existing || { name: projectName, color };
    }

    let created = 0, updated = 0;

    for (const issue of allIssues) {
      const f        = issue.fields;
      const jiraKey  = issue.key;
      const status   = mapJiraStatus(f.status?.name);
      const priority = mapJiraPriority(f.priority?.name);
      const owner    = f.assignee?.displayName || '';
      const team     = await getOrCreateTeam(f.project?.name || 'Jira', f.project?.key || '');
      const bar_end  = dateToWeekIdx(f.duedate, effectiveStart, numWeeks);
      const bar_start= dateToWeekIdx(f.customfield_10015, effectiveStart, numWeeks);
      const progress = Math.round(f.progress?.percent || 0);
      const is_blocked = status === 'blocked' ? 1 : 0;

      let outcome = '';
      if (f.description?.content) {
        const para = f.description.content.find(b => b.type === 'paragraph');
        if (para?.content) {
          outcome = para.content.filter(c => c.type === 'text').map(c => c.text).join('').slice(0, 200);
        }
      }

      const existing = await db.get('SELECT id FROM tasks WHERE jira_key=$1', [jiraKey]);
      const now = process.env.DATABASE_URL ? 'NOW()' : "datetime('now')";

      if (existing) {
        await db.run(
          `UPDATE tasks SET initiative=$1, owner=$2, team=$3, status=$4, priority=$5,
           bar_start=$6, bar_end=$7, progress=$8, is_blocked=$9, outcome=$10, updated_at=${now}
           WHERE jira_key=$11`,
          [f.summary, owner, team.name, status, priority, bar_start, bar_end, progress, is_blocked, outcome, jiraKey]
        );
        updated++;
      } else {
        const max = await db.get('SELECT MAX(sort_order) AS m FROM tasks WHERE team=$1', [team.name]);
        const sort_order = (parseInt(max?.m) || 0) + 1;
        await db.run(
          `INSERT INTO tasks (jira_key, team, owner, initiative, outcome, status, priority,
           bar_start, bar_end, bar_color, is_blocked, sort_order, progress)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [jiraKey, team.name, owner, f.summary, outcome, status, priority,
           bar_start, bar_end, team.color, is_blocked, sort_order, progress]
        );
        created++;
      }
    }

    res.json({ created, updated, total: allIssues.length });
  } catch(e) {
    console.error('Jira sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────
initSchema().then(seed).then(() => {
  app.listen(PORT, () => console.log(`Gantt app → http://localhost:${PORT}`));
}).catch(err => { console.error('Startup error:', err); process.exit(1); });
