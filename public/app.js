const API = '';

// ── Config / Settings ─────────────────────────────────────────────────────
const MONTH_PALETTE = [
  { header: '#60A5FA', bg: 'rgba(239,246,255,.6)', alt: 'rgba(219,234,254,.35)', picker: 'rgba(239,246,255,.7)' },
  { header: '#A78BFA', bg: 'rgba(245,243,255,.6)', alt: 'rgba(237,233,254,.35)', picker: 'rgba(245,243,255,.7)' },
  { header: '#34D399', bg: 'rgba(240,253,244,.6)', alt: 'rgba(220,252,231,.35)', picker: 'rgba(240,253,244,.7)' },
];

const CFG_KEY = 'gantt-config';
const DEFAULT_CFG = {
  title:     'Q3 2026 Roadmap',
  subtitle:  'Jul – Sep 2026 · Paynet · PGW · Settlement · Portals · Integrations · DevSecOps',
  startDate: '2026-07-01',
  endDate:   '2026-09-30',
};
let cfg = { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') };

let WEEKS  = [];
let MONTHS = [];
let NW     = 0;

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function computeWeeks() {
  WEEKS = []; MONTHS = [];
  const start = parseDate(cfg.startDate);
  const end   = parseDate(cfg.endDate);
  const monthMap = new Map();
  let cur = new Date(start), wi = 0;

  while (cur <= end) {
    const wEnd = new Date(cur);
    wEnd.setDate(wEnd.getDate() + 6);
    if (wEnd > end) wEnd.setTime(end.getTime());

    const mKey   = `${cur.getFullYear()}-${cur.getMonth()}`;
    const mShort = cur.toLocaleString('en', { month: 'short' });
    const mFull  = cur.toLocaleString('en', { month: 'long', year: 'numeric' }).toUpperCase();
    const eShort = wEnd.toLocaleString('en', { month: 'short' });

    WEEKS.push(mShort === eShort
      ? `${mShort} ${cur.getDate()}–${wEnd.getDate()}`
      : `${mShort} ${cur.getDate()}–${eShort} ${wEnd.getDate()}`);

    if (!monthMap.has(mKey)) {
      monthMap.set(mKey, { label: mFull, short: mShort, from: wi, to: wi });
    } else {
      monthMap.get(mKey).to = wi;
    }
    cur.setDate(cur.getDate() + 7);
    wi++;
  }

  MONTHS = [...monthMap.values()];
  NW = WEEKS.length;
  document.documentElement.style.setProperty('--nw', NW);
}

function weekMonthIdx(i) {
  return MONTHS.findIndex(m => i >= m.from && i <= m.to);
}

function currentWeekIndex() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseDate(cfg.startDate);
  const diffMs = today - start;
  if (diffMs < 0) return -1;
  const wi = Math.floor(diffMs / (7 * 24 * 3600 * 1000));
  return wi < NW ? wi : -1;
}

const STATUS_META = {
  active:      { label: 'Active',      cls: 's-active' },
  done:        { label: 'Done',        cls: 's-done' },
  blocked:     { label: 'Blocked',     cls: 's-blocked' },
  pending:     { label: 'Pending',     cls: 's-pending' },
  unscheduled: { label: 'Backlog',     cls: 's-unscheduled' },
};

const PRIORITY_META = {
  high:   { label: 'High',   cls: 'p-high'   },
  medium: { label: 'Medium', cls: 'p-medium' },
  low:    { label: 'Low',    cls: 'p-low'    },
};

const KANBAN_COLS = [
  { id: 'todo',   statuses: ['unscheduled','pending'], dropStatus: 'pending',  label: 'Backlog',      color: '#94A3B8' },
  { id: 'active', statuses: ['active','blocked'],      dropStatus: 'active',   label: 'In Progress',  color: '#3B82F6' },
  { id: 'done',   statuses: ['done'],                  dropStatus: 'done',     label: 'Done',         color: '#22C55E' },
];

// ── RAG: auto-computed health status ─────────────────────────────────────
function computeRAG(task) {
  if (task.status === 'done' || task.status === 'unscheduled' || task.status === 'pending') return null;
  const bs = parseInt(task.bar_start), be = parseInt(task.bar_end);
  if (bs < 0 || be < 0) return null;
  const todayWk  = currentWeekIndex();
  if (task.status === 'blocked') return 'critical';
  if (be < todayWk) return 'critical';                      // overdue
  if (be - todayWk <= 2) return 'at_risk';                  // ending soon
  // behind on progress vs elapsed time
  const elapsed  = Math.max(0, todayWk - bs);
  const total    = be - bs + 1;
  const expected = total > 0 ? (elapsed / total) * 100 : 0;
  const actual   = parseInt(task.progress) || 0;
  if (expected > 55 && actual < 25) return 'at_risk';
  return 'on_track';
}

const RAG_META = {
  on_track: { label: 'On Track', dot: 'rag-on_track' },
  at_risk:  { label: 'At Risk',  dot: 'rag-at_risk' },
  critical: { label: 'Critical', dot: 'rag-critical' },
};

let currentView = 'gantt';

let allTasks      = [];
let allTeams      = [];
let allDevelopers = [];
let deleteTargetId = null;

// ── Settings ──────────────────────────────────────────────────────────────
function applyConfigToDOM() {
  document.getElementById('app-title').textContent    = cfg.title;
  document.getElementById('app-subtitle').textContent = cfg.subtitle;
  document.title = cfg.title;
}

function openSettings() {
  document.getElementById('cfg-title').value    = cfg.title;
  document.getElementById('cfg-subtitle').value = cfg.subtitle;
  document.getElementById('cfg-start').value    = cfg.startDate;
  document.getElementById('cfg-end').value      = cfg.endDate;
  document.getElementById('settings-modal').classList.add('open');
}
function closeSettings()         { document.getElementById('settings-modal').classList.remove('open'); }
function closeSettingsOutside(e) { if (e.target === document.getElementById('settings-modal')) closeSettings(); }

function saveSettings() {
  const title     = document.getElementById('cfg-title').value.trim();
  const subtitle  = document.getElementById('cfg-subtitle').value.trim();
  const startDate = document.getElementById('cfg-start').value;
  const endDate   = document.getElementById('cfg-end').value;
  if (!title || !startDate || !endDate) { alert('Title and both dates are required.'); return; }
  if (startDate >= endDate) { alert('End date must be after start date.'); return; }
  cfg = { title, subtitle, startDate, endDate };
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  applyConfigToDOM();
  computeWeeks();
  buildMonthHeaders();
  buildWeekHeaders();
  buildBarPicker();
  resetBarPicker();
  renderGantt();
  closeSettings();
}

// ── Toast ─────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, undoFn = null) {
  clearTimeout(toastTimer);
  document.getElementById('toast-msg').textContent = msg;
  const undoBtn = document.getElementById('toast-undo');
  if (undoFn) {
    undoBtn.style.display = 'inline-block';
    undoBtn.onclick = () => { clearTimeout(toastTimer); hideToast(); undoFn(); };
  } else {
    undoBtn.style.display = 'none';
  }
  document.getElementById('toast').classList.add('visible');
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  document.getElementById('toast').classList.remove('visible');
}

// ── Filters ───────────────────────────────────────────────────────────────
function updateFilterBadges() {
  const proj = document.getElementById('filter-project').value;
  const dev  = document.getElementById('filter-dev').value;
  const stat = document.getElementById('filter-status').value;
  document.getElementById('filter-project').closest('.select-wrap').classList.toggle('filter-active', !!proj);
  document.getElementById('filter-dev').closest('.select-wrap').classList.toggle('filter-active', !!dev);
  document.getElementById('filter-status').closest('.select-wrap').classList.toggle('filter-active', !!stat);
  const clearBtn = document.getElementById('btn-clear-filters');
  if (clearBtn) clearBtn.style.display = (proj || dev || stat) ? 'flex' : 'none';
}

function clearFilters() {
  document.getElementById('filter-project').value = '';
  document.getElementById('filter-dev').value     = '';
  document.getElementById('filter-status').value  = '';
  document.getElementById('search').value         = '';
  updateFilterBadges();
  renderActiveView();
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      hideToast();
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (document.querySelector('.modal-overlay.open')) return;
    switch (e.key) {
      case 'n': case 'N': e.preventDefault(); openModal(); break;
      case 'g': case 'G': e.preventDefault(); switchView('gantt'); break;
      case 'k': case 'K': e.preventDefault(); switchView('kanban'); break;
      case 'd': case 'D': e.preventDefault(); switchView('dashboard'); break;
      case '/': e.preventDefault(); document.getElementById('search').focus(); break;
    }
  });
}

// ── Sidebar toggle ────────────────────────────────────────────────────────
const SIDEBAR_KEY = 'gantt-sidebar-collapsed';

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const isNowCollapsed = !sidebar.classList.contains('collapsed');
  sidebar.classList.toggle('collapsed', isNowCollapsed);
  localStorage.setItem(SIDEBAR_KEY, isNowCollapsed ? '1' : '0');
}

function initSidebar() {
  if (localStorage.getItem(SIDEBAR_KEY) !== '0') {
    document.getElementById('sidebar').classList.add('collapsed');
  }

  // Floating tooltip for collapsed-sidebar nav items
  const tip = document.createElement('div');
  tip.className = 'sidebar-tip';
  tip.id = 'sidebar-tip';
  document.body.appendChild(tip);

  document.querySelectorAll('.nav-item[data-tooltip]').forEach(item => {
    item.addEventListener('mouseenter', () => {
      if (!document.getElementById('sidebar').classList.contains('collapsed')) return;
      const rect = item.getBoundingClientRect();
      tip.textContent = item.dataset.tooltip;
      tip.style.top  = (rect.top + rect.height / 2) + 'px';
      tip.style.left = (rect.right + 10) + 'px';
      tip.classList.add('visible');
    });
    item.addEventListener('mouseleave', () => tip.classList.remove('visible'));
  });

  // Hide tooltip immediately when a nav item is clicked
  document.getElementById('sidebar').addEventListener('click', () => {
    tip.classList.remove('visible');
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot() {
  computeWeeks();
  buildMonthHeaders();
  buildWeekHeaders();
  applyConfigToDOM();
  initSidebar();
  initKeyboardShortcuts();
  await Promise.all([loadTeams(), loadTasks(), loadDevelopers()]);
  populateProjectSelects();
  buildBarPicker();
  updateFilterBadges();
  renderGantt();
}

function buildMonthHeaders() {
  const row = document.getElementById('gh-months-row');
  while (row.children.length > 1) row.removeChild(row.lastChild);
  MONTHS.forEach((m, i) => {
    const div = document.createElement('div');
    div.className = 'gh-month';
    div.style.flex = String(m.to - m.from + 1);
    div.style.color = MONTH_PALETTE[i % 3].header;
    div.textContent = m.label;
    row.appendChild(div);
  });
}

function buildWeekHeaders() {
  const todayWk = currentWeekIndex();
  const el = document.getElementById('week-headers');
  el.innerHTML = '';
  WEEKS.forEach((w, i) => {
    const mi = weekMonthIdx(i);
    const d = document.createElement('div');
    d.className = `gh-week${i === todayWk ? ' today' : ''}`;
    if (i !== todayWk) d.style.color = MONTH_PALETTE[(mi >= 0 ? mi : 0) % 3].header;
    d.textContent = w;
    el.appendChild(d);
  });
}

async function loadTasks()      { const r = await fetch(`${API}/api/tasks?_=${Date.now()}`);      allTasks      = await r.json(); }
async function loadTeams()      { const r = await fetch(`${API}/api/teams`);      allTeams      = await r.json(); }
async function loadDevelopers() { const r = await fetch(`${API}/api/developers`); allDevelopers = await r.json(); }

function populateProjectSelects() {
  allTeams.forEach(t => {
    document.getElementById('filter-project').innerHTML += `<option value="${t.name}">${t.name}</option>`;
    document.getElementById('dev-project').innerHTML    += `<option value="${t.name}">${t.name}</option>`;
  });
  rebuildFormProjectSelect();
  rebuildDevFilter();
}

function rebuildFormProjectSelect() {
  const sel = document.getElementById('f-team');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select project...</option>';
  allTeams.forEach(t => {
    sel.innerHTML += `<option value="${t.name}" data-color="${t.color}">${t.name}</option>`;
  });
  sel.innerHTML += `<option value="__new__" style="color:#4F46E5;font-weight:600">＋ New project...</option>`;
  if (cur && cur !== '__new__') sel.value = cur;
}

function rebuildDevFilter() {
  const sel = document.getElementById('filter-dev');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Developers</option>';
  const names = [...new Set(allDevelopers.map(d => d.name))].sort();
  names.forEach(n => { sel.innerHTML += `<option value="${n}">${n}</option>`; });
  if (cur) sel.value = cur;
}

function onProjectChange() {
  const sel = document.getElementById('f-team');
  if (sel.value === '__new__') {
    sel.value = '';
    openManageModal('projects');
    return;
  }
  const opt = sel.selectedOptions[0];
  if (opt?.dataset.color) document.getElementById('f-bar-color').value = opt.dataset.color;
  rebuildOwnerDropdown(sel.value, document.getElementById('f-owner').value);
}

// Shows ALL developers grouped by project using <optgroup>
function rebuildOwnerDropdown(selectedProject, currentOwner) {
  const sel = document.getElementById('f-owner');
  let html = '<option value="">Select developer...</option>';

  const allDevNames = allDevelopers.map(d => d.name);
  if (currentOwner && !allDevNames.includes(currentOwner)) {
    html += `<option value="${currentOwner}">${currentOwner}</option>`;
  }

  allTeams.forEach(t => {
    const devs = allDevelopers.filter(d => d.project === t.name);
    if (!devs.length) return;
    const highlight = selectedProject && t.name === selectedProject ? ' ★' : '';
    html += `<optgroup label="${t.name}${highlight}">`;
    devs.forEach(d => { html += `<option value="${d.name}">${d.name}</option>`; });
    html += `</optgroup>`;
  });

  sel.innerHTML = html;
  sel.value = currentOwner || '';
}

// ── View Switching ────────────────────────────────────────────────────────
function renderActiveView() {
  if (currentView === 'gantt')     renderGantt();
  else if (currentView === 'kanban')    renderKanban();
  else if (currentView === 'dashboard') renderDashboard();
}

function switchView(view) {
  currentView = view;
  ['gantt','kanban','dashboard'].forEach(v => {
    document.getElementById(`view-${v}`).style.display   = v === view ? (v === 'gantt' ? 'block' : 'flex') : 'none';
    document.getElementById(`vbtn-${v}`).classList.toggle('active', v === view);
  });
  // Legend only relevant on Gantt
  const legend = document.getElementById('header-legend');
  if (legend) legend.style.display = view === 'gantt' ? 'flex' : 'none';
  renderActiveView();
}

// ── Kanban ────────────────────────────────────────────────────────────────
function renderKanban() {
  const board    = document.getElementById('kanban-board');
  const search   = document.getElementById('search').value.toLowerCase();
  const projFilt = document.getElementById('filter-project').value;
  const devFilt  = document.getElementById('filter-dev').value;
  const statFilt = document.getElementById('filter-status').value;

  const tasks = allTasks.filter(t => {
    if (search && !t.initiative.toLowerCase().includes(search) && !(t.owner||'').toLowerCase().includes(search)) return false;
    if (projFilt && t.team !== projFilt) return false;
    if (devFilt  && t.owner !== devFilt) return false;
    if (statFilt && t.status !== statFilt) return false;
    return true;
  });

  board.innerHTML = '';
  KANBAN_COLS.forEach(col => {
    const colTasks = tasks.filter(t => col.statuses.includes(t.status));
    const colEl = document.createElement('div');
    colEl.className = 'kanban-col';
    colEl.dataset.col = col.id;

    colEl.addEventListener('dragover',  e => { e.preventDefault(); colEl.classList.add('drag-over'); });
    colEl.addEventListener('dragleave', ()  => colEl.classList.remove('drag-over'));
    colEl.addEventListener('drop', async e => {
      e.preventDefault();
      colEl.classList.remove('drag-over');
      const taskId = parseInt(e.dataTransfer.getData('taskId'));
      const task   = allTasks.find(t => t.id === taskId);
      if (!task || col.statuses.includes(task.status)) return;
      const payload = { ...task, status: col.dropStatus, is_blocked: col.dropStatus === 'blocked' ? 1 : 0 };
      await fetch(`${API}/api/tasks/${taskId}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      await loadTasks();
      renderKanban();
    });

    const header = document.createElement('div');
    header.className = 'kanban-col-header';
    header.innerHTML = `
      <span class="kanban-col-dot" style="background:${col.color}"></span>
      <span class="kanban-col-label">${col.label}</span>
      <span class="tgh-count">${colTasks.length}</span>
      <button class="kanban-add-btn" title="Add" onclick="openModal(null,'${col.dropStatus}')">+</button>`;
    colEl.appendChild(header);

    const cards = document.createElement('div');
    cards.className = 'kanban-cards';
    colTasks.forEach(t => cards.appendChild(buildKanbanCard(t)));
    colEl.appendChild(cards);
    board.appendChild(colEl);
  });
}

function buildKanbanCard(task) {
  const card  = document.createElement('div');
  card.draggable  = true;
  card.dataset.id = task.id;

  card.addEventListener('dragstart', e => { e.dataTransfer.setData('taskId', task.id); card.classList.add('dragging'); });
  card.addEventListener('dragend',   () => card.classList.remove('dragging'));

  const team     = allTeams.find(t => t.name === task.team);
  const color    = team?.color || '#64748B';
  const pm       = PRIORITY_META[task.priority || 'medium'];
  const rag      = computeRAG(task);
  const ragMeta  = rag ? RAG_META[rag] : null;
  const progress = parseInt(task.progress) || 0;
  const safeName = task.initiative.replace(/'/g, "\\'");
  const isBlocked = task.status === 'blocked';

  card.className = 'kanban-card' + (isBlocked ? ' is-blocked-card' : '');

  card.innerHTML = `
    <div class="kcard-top">
      <div style="display:flex;align-items:center;gap:5px">
        ${ragMeta ? `<span class="rag-dot ${ragMeta.dot}" title="${ragMeta.label}"></span>` : ''}
        <span class="priority-badge ${pm.cls}">${pm.label}</span>
        ${isBlocked ? `<span style="font-size:9px;color:#BE123C;font-weight:700">● Blocked</span>` : ''}
      </div>
      <div class="kcard-actions">
        <button class="btn-edit" onclick="openModal(${task.id})" title="Edit">✎</button>
        <button class="btn-del"  onclick="openDelete(${task.id},'${safeName}')" title="Delete">✕</button>
      </div>
    </div>
    <div class="kcard-title">${task.initiative}</div>
    <div class="kcard-footer">
      <span class="kcard-project" style="border-left:3px solid ${color};padding-left:6px">${task.team}</span>
      ${task.owner ? `<span class="kcard-owner"><span class="cell-assignee-avatar" style="background:${color};width:18px;height:18px;font-size:9px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700">${task.owner[0].toUpperCase()}</span> ${task.owner}</span>` : ''}
    </div>
    ${progress > 0 ? `<div class="kcard-progress"><div class="kcard-progress-fill" style="width:${progress}%"></div></div>` : ''}`;

  return card;
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function renderDashboard() {
  const body = document.getElementById('dashboard-body');

  const byStatus = s => allTasks.filter(t => t.status === s).length;
  const todayWk   = currentWeekIndex();
  const atRisk    = allTasks.filter(t => computeRAG(t) === 'at_risk');
  const overdue   = allTasks.filter(t => {
    const be = parseInt(t.bar_end);
    return t.status !== 'done' && be >= 0 && be < todayWk;
  });

  const stats = [
    { label: 'In Progress', value: byStatus('active'),  color: '#3B82F6' },
    { label: 'Blocked',     value: byStatus('blocked'), color: '#F43F5E' },
    { label: 'At Risk',     value: atRisk.length,       color: '#F59E0B' },
    { label: 'Done',        value: byStatus('done'),    color: '#22C55E' },
    { label: 'Overdue',     value: overdue.length,      color: '#EF4444' },
  ];

  let html = `<div class="dash-stats">${stats.map(s => `
    <div class="dash-stat-card" style="border-top:3px solid ${s.color}">
      <div class="dash-stat-value" style="color:${s.color}">${s.value}</div>
      <div class="dash-stat-label">${s.label}</div>
    </div>`).join('')}</div>`;

  // Per-project progress (using average task progress)
  html += `<div class="dash-section"><div class="dash-section-title">Projects Overview</div><div class="dash-projects">`;
  allTeams.forEach(team => {
    const tasks       = allTasks.filter(t => t.team === team.name);
    if (!tasks.length) return;
    const doneCount   = tasks.filter(t => t.status === 'done').length;
    const activeCount = tasks.filter(t => t.status === 'active').length;
    const blkCount    = tasks.filter(t => t.status === 'blocked').length;
    const atRiskCount = tasks.filter(t => computeRAG(t) === 'at_risk').length;
    // avg progress: done tasks = 100%, others use their progress field
    const avgPct = Math.round(tasks.reduce((sum, t) => sum + (t.status === 'done' ? 100 : (parseInt(t.progress) || 0)), 0) / tasks.length);
    html += `<div class="dash-project-row">
      <div class="dash-proj-name"><span class="tgh-dot" style="background:${team.color}"></span>${team.name}</div>
      <div class="dash-proj-bar"><div class="dash-proj-fill" style="width:${avgPct}%;background:${team.color}"></div></div>
      <div class="dash-proj-pct">${avgPct}%</div>
      <div class="dash-proj-pills">
        ${activeCount  ? `<span class="dash-pill dp-active">${activeCount} active</span>` : ''}
        ${blkCount     ? `<span class="dash-pill dp-blocked">${blkCount} blocked</span>` : ''}
        ${atRiskCount  ? `<span class="dash-pill" style="background:#FFFBEB;color:#B45309;border:1px solid #FDE68A">${atRiskCount} at risk</span>` : ''}
        <span class="dash-pill dp-total">${tasks.length} total</span>
      </div>
    </div>`;
  });
  html += `</div></div>`;

  // At Risk items
  if (atRisk.length) {
    html += `<div class="dash-section"><div class="dash-section-title" style="color:#B45309">🟡 At Risk (${atRisk.length})</div><div class="dash-list">`;
    atRisk.forEach(t => {
      const c  = allTeams.find(x => x.name === t.team)?.color || '#64748B';
      const be = parseInt(t.bar_end);
      const weeksLeft = be >= 0 ? be - todayWk : null;
      html += `<div class="dash-list-item">
        <span class="rag-dot rag-at_risk"></span>
        <span class="dash-item-name">${t.initiative}</span>
        <span class="dash-item-meta">${t.team}${weeksLeft !== null ? ` · ${weeksLeft} wks left` : ''}</span>
        <button class="btn-edit" onclick="openModal(${t.id})" title="Edit">✎</button>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Overdue items
  if (overdue.length) {
    html += `<div class="dash-section"><div class="dash-section-title dash-title-blocked">⚠ Overdue (${overdue.length})</div><div class="dash-list">`;
    overdue.forEach(t => {
      const c = allTeams.find(x => x.name === t.team)?.color || '#64748B';
      const weeksLate = todayWk - parseInt(t.bar_end);
      html += `<div class="dash-list-item">
        <span class="rag-dot rag-critical"></span>
        <span class="dash-item-name">${t.initiative}</span>
        <span class="dash-item-meta" style="color:#BE123C">${t.team} · ${weeksLate} wks late</span>
        <button class="btn-edit" onclick="openModal(${t.id})" title="Edit">✎</button>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Blocked items
  const blocked = allTasks.filter(t => t.status === 'blocked');
  if (blocked.length) {
    html += `<div class="dash-section"><div class="dash-section-title dash-title-blocked">🔴 Blocked (${blocked.length})</div><div class="dash-list">`;
    blocked.forEach(t => {
      const c = allTeams.find(x => x.name === t.team)?.color || '#64748B';
      html += `<div class="dash-list-item">
        <span class="tgh-dot" style="background:${c}"></span>
        <span class="dash-item-name">${t.initiative}</span>
        <span class="dash-item-meta">${t.team}${t.owner ? ' · ' + t.owner : ''}</span>
        <button class="btn-edit" onclick="openModal(${t.id})" title="Edit">✎</button>
      </div>`;
    });
    html += `</div></div>`;
  }

  body.innerHTML = html;
}

// ── Render Gantt ──────────────────────────────────────────────────────────
function renderGantt() {
  const search   = document.getElementById('search').value.toLowerCase();
  const projFilt = document.getElementById('filter-project').value;
  const devFilt  = document.getElementById('filter-dev').value;
  const statFilt = document.getElementById('filter-status').value;

  const filtered = allTasks.filter(t => {
    if (search && !t.initiative.toLowerCase().includes(search) &&
        !t.team.toLowerCase().includes(search) &&
        !(t.owner || '').toLowerCase().includes(search)) return false;
    if (projFilt && t.team !== projFilt) return false;
    if (devFilt  && t.owner !== devFilt) return false;
    if (statFilt && t.status !== statFilt) return false;
    return true;
  });

  // Split: scheduled vs backlog (no timeline)
  const scheduled = filtered.filter(t => parseInt(t.bar_start) >= 0 && parseInt(t.bar_end) >= 0);
  const backlog   = filtered.filter(t => parseInt(t.bar_start) < 0 || parseInt(t.bar_end) < 0);

  // Group scheduled by project → developer
  const byTeam = {};
  allTeams.forEach(t => { byTeam[t.name] = {}; });
  scheduled.forEach(t => {
    if (!byTeam[t.team]) byTeam[t.team] = {};
    const dev = t.owner || '(unassigned)';
    if (!byTeam[t.team][dev]) byTeam[t.team][dev] = [];
    byTeam[t.team][dev].push(t);
  });

  const body = document.getElementById('gantt-body');
  body.innerHTML = '';
  let totalRows = 0;
  const todayWk = currentWeekIndex();

  allTeams.forEach(team => {
    const teamName  = team.name;
    const tasks     = scheduled.filter(t => t.team === teamName);
    const color     = team.color || '#64748B';
    if (!tasks.length) return;

    // Project group header
    const gh = document.createElement('div');
    gh.className = 'team-group-header';
    gh.style.borderLeft = `4px solid ${color}`;
    gh.innerHTML = `
      <div class="tgh-dot" style="background:${color}"></div>
      <span class="tgh-name">${teamName}</span>
      <span class="tgh-count">${tasks.length}</span>`;
    body.appendChild(gh);

    tasks.forEach(task => {
      body.appendChild(buildTaskRow(task, color, todayWk));
      totalRows++;
    });
  });

  // ── Backlog section ──
  if (backlog.length) {
    // Group backlog by project → developer too
    const backlogByTeam = {};
    allTeams.forEach(t => { backlogByTeam[t.name] = {}; });
    backlog.forEach(t => {
      if (!backlogByTeam[t.team]) backlogByTeam[t.team] = {};
      const dev = t.owner || '(unassigned)';
      if (!backlogByTeam[t.team][dev]) backlogByTeam[t.team][dev] = [];
      backlogByTeam[t.team][dev].push(t);
    });

    const bh = document.createElement('div');
    bh.className = 'backlog-header';
    bh.innerHTML = `<span class="backlog-icon">📋</span> Backlog <span class="tgh-count">${backlog.length}</span>`;
    body.appendChild(bh);

    allTeams.forEach(team => {
      const teamName = team.name;
      const tasks    = backlog.filter(t => t.team === teamName);
      const color    = team.color || '#64748B';
      if (!tasks.length) return;

      const pbh = document.createElement('div');
      pbh.className = 'team-group-header';
      pbh.style.borderLeft = `4px solid ${color}`;
      pbh.innerHTML = `
        <div class="tgh-dot" style="background:${color}"></div>
        <span class="tgh-name">${teamName}</span>
        <span class="tgh-count">${tasks.length}</span>`;
      body.appendChild(pbh);

      tasks.forEach(task => {
        body.appendChild(buildTaskRow(task, color, todayWk));
        totalRows++;
      });
    });
  }

  if (allTeams.length === 0) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🚀</div>
      <h3>Welcome! Let's set up your roadmap.</h3>
      <p>You need a project and at least one developer before adding initiatives.</p>
      <div class="empty-state-steps">
        <div class="empty-step"><span class="empty-step-num">1</span>Create a Project</div>
        <div class="empty-step"><span class="empty-step-num">2</span>Add Developers</div>
        <div class="empty-step"><span class="empty-step-num">3</span>Add Initiatives</div>
      </div>
      <button class="btn-primary" onclick="openManageModal('projects')" style="margin-top:20px">
        Get Started →
      </button>
    </div>`;
  } else if (totalRows === 0 && backlog.length === 0) {
    const hasFilters = document.getElementById('search').value
      || document.getElementById('filter-project').value
      || document.getElementById('filter-dev').value
      || document.getElementById('filter-status').value;
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <h3>${hasFilters ? 'No results match your filters' : 'No initiatives yet'}</h3>
      <p>${hasFilters ? 'Try adjusting or clearing your filters.' : 'Add your first initiative to get started.'}</p>
      ${hasFilters
        ? `<button class="btn-primary" onclick="clearFilters()" style="margin-top:16px">Clear filters</button>`
        : `<button class="btn-primary" onclick="openModal()" style="margin-top:16px">Add Initiative</button>`}
    </div>`;
  }

  const statsEl = document.getElementById('toolbar-stats');
  if (statsEl) {
    const blocked = filtered.filter(t => t.status === 'blocked').length;
    const overdueCount = filtered.filter(t => { const be=parseInt(t.bar_end); return t.status!=='done'&&be>=0&&be<currentWeekIndex(); }).length;
    statsEl.innerHTML = `${filtered.length} total${blocked ? ` &nbsp;·&nbsp; <span style="color:#EF4444">${blocked} blocked</span>` : ''}${overdueCount ? ` &nbsp;·&nbsp; <span style="color:#EF4444">${overdueCount} overdue</span>` : ''}`;
  }
}

function buildTaskRow(task, teamColor, todayWk = -1) {
  const row = document.createElement('div');
  row.className = 'task-row';

  // Assignee cell
  const ca = document.createElement('div');
  ca.className = 'cell-assignee';
  if (task.owner) {
    ca.innerHTML = `<span class="cell-assignee-avatar" style="background:${teamColor}">${task.owner[0].toUpperCase()}</span>${task.owner}`;
  } else {
    ca.textContent = '—';
  }
  ca.title = task.owner || '';
  row.appendChild(ca);

  // Initiative cell — with RAG dot
  const rag      = computeRAG(task);
  const ragMeta  = rag ? RAG_META[rag] : null;
  const ci = document.createElement('div');
  ci.className = 'cell-init';
  const safeTitle = (task.outcome || task.initiative).replace(/"/g, '&quot;');
  const safeName  = task.initiative.replace(/'/g, "\\'");
  ci.innerHTML = `
    ${ragMeta ? `<span class="rag-dot ${ragMeta.dot}" title="${ragMeta.label}" style="flex-shrink:0"></span>` : ''}
    ${task.is_milestone ? '<span title="Milestone" style="font-size:11px;flex-shrink:0">◆</span>' : ''}
    <span class="cell-init-text" title="${safeTitle}">${task.initiative}</span>
    <div class="row-actions">
      <button class="btn-edit" title="Edit" onclick="openModal(${task.id})">✎</button>
      <button class="btn-del"  title="Delete" onclick="openDelete(${task.id}, '${safeName}')">✕</button>
    </div>`;
  row.appendChild(ci);

  // Status cell
  const cs = document.createElement('div');
  cs.className = 'cell-status';
  const sm = STATUS_META[task.status] || STATUS_META.active;
  const progress = parseInt(task.progress) || 0;
  cs.innerHTML = `<div style="display:flex;flex-direction:column;gap:3px;width:100%">
    <span class="status-chip ${sm.cls}" title="${task.target || ''}">
      <span class="chip-dot"></span>${sm.label}
    </span>
    ${progress > 0 ? `<div style="height:3px;background:var(--border);border-radius:99px;overflow:hidden;margin:0 2px">
      <div style="height:100%;width:${progress}%;background:${task.bar_color||teamColor};border-radius:99px;transition:width .3s"></div>
    </div>` : ''}
  </div>`;
  row.appendChild(cs);

  // Bar area
  const cb = document.createElement('div');
  cb.className = 'cell-bars';
  cb.style.width = `${NW * 70}px`;

  WEEKS.forEach((_, wi) => {
    const mi      = weekMonthIdx(wi);
    const palette = MONTH_PALETTE[(mi >= 0 ? mi : 0) % 3];
    const local   = wi - (mi >= 0 ? MONTHS[mi].from : 0);
    const bg = document.createElement('div');
    bg.className = 'week-bg';
    bg.style.background = local % 2 === 1 ? palette.alt : palette.bg;
    bg.style.left  = `${wi * 70}px`;
    bg.style.width = '70px';
    cb.appendChild(bg);
    if (wi > 0) {
      const div = document.createElement('div');
      div.className = 'week-divider';
      div.style.left = `${wi * 70}px`;
      cb.appendChild(div);
    }
  });

  const bs = parseInt(task.bar_start), be = parseInt(task.bar_end);
  const barColor = task.bar_color || teamColor;

  if (task.is_milestone && bs >= 0) {
    // ◆ Milestone diamond
    const diamond = document.createElement('div');
    diamond.className = 'milestone-diamond';
    diamond.style.left = `${bs * 70 + 31}px`;
    diamond.style.background = barColor;
    diamond.title = task.initiative;
    diamond.onclick = () => openModal(task.id);
    cb.appendChild(diamond);
    const mlabel = document.createElement('div');
    mlabel.className = 'milestone-label';
    mlabel.style.left = `${bs * 70 + 40}px`;
    mlabel.textContent = task.initiative.length > 12 ? task.initiative.slice(0, 11) + '…' : task.initiative;
    cb.appendChild(mlabel);
  } else if (bs >= 0 && be >= 0 && be >= bs) {
    const bar = document.createElement('div');
    bar.className = 'bar'
      + (task.is_blocked && task.status !== 'done' ? ' striped' : '')
      + (task.status === 'done' ? ' done-bar' : '');
    bar.style.left       = `${bs * 70 + 4}px`;
    bar.style.width      = `${(be - bs + 1) * 70 - 8}px`;
    bar.style.background = barColor;
    bar.title            = [task.initiative, task.target, task.dependencies].filter(Boolean).join('\n');
    bar.onclick          = () => openModal(task.id);

    // Progress strip inside bar
    if (progress > 0 && task.status !== 'done') {
      const strip = document.createElement('div');
      strip.className = 'bar-progress-strip';
      strip.style.width = `${progress}%`;
      bar.appendChild(strip);
    }

    // Bar label: ✓ for done, "+Nw" for overdue
    if (task.status === 'done') {
      bar.insertAdjacentText('afterbegin', '✓ ');
    } else if (todayWk >= 0 && be < todayWk) {
      bar.insertAdjacentText('afterbegin', `+${todayWk - be}w `);
    } else if (progress > 0) {
      bar.insertAdjacentText('afterbegin', `${progress}% `);
    }

    cb.appendChild(bar);

    // Overdue extension from bar end → today line
    if (todayWk >= 0 && be < todayWk && task.status !== 'done') {
      const barRight = (be + 1) * 70 - 4;
      const todayPos = todayWk * 70 + 35;
      if (todayPos > barRight) {
        const ext = document.createElement('div');
        ext.className = 'overdue-ext';
        ext.style.left  = `${barRight}px`;
        ext.style.width = `${todayPos - barRight}px`;
        cb.appendChild(ext);
      }
    }
  } else {
    const lbl = document.createElement('div');
    lbl.className   = 'no-bar-label';
    lbl.textContent = task.target || '—';
    cb.appendChild(lbl);
  }

  if (todayWk >= 0) {
    const tl = document.createElement('div');
    tl.className = 'today-line';
    tl.style.left = `${todayWk * 70 + 34}px`;
    cb.appendChild(tl);
  }

  row.appendChild(cb);
  return row;
}

// ── Add / Edit Modal ───────────────────────────────────────────────────────
function openModal(id = null, defaultStatus = null) {
  const form = document.getElementById('task-form');
  form.reset();
  document.getElementById('task-id').value = '';
  resetBarPicker();
  rebuildOwnerDropdown('', '');

  if (id) {
    const t = allTasks.find(x => x.id === id);
    if (!t) return;
    document.getElementById('modal-title').textContent     = 'Edit Initiative';
    document.getElementById('modal-sub').textContent       = 'Update the details for this initiative.';
    document.getElementById('form-submit-btn').textContent = 'Save Changes';
    document.getElementById('task-id').value       = t.id;
    document.getElementById('f-team').value         = t.team;
    document.getElementById('f-initiative').value   = t.initiative;
    document.getElementById('f-outcome').value      = t.outcome || '';
    document.getElementById('f-target').value       = t.target  || '';
    document.getElementById('f-status').value       = t.status;
    document.getElementById('f-metric').value       = t.metric  || '';
    document.getElementById('f-dependencies').value = t.dependencies || '';
    document.getElementById('f-bar-start').value    = t.bar_start;
    document.getElementById('f-bar-end').value      = t.bar_end;
    document.getElementById('f-bar-color').value    = t.bar_color || '#4F46E5';
    document.getElementById('f-priority').value     = t.priority  || 'medium';
    const prog = parseInt(t.progress) || 0;
    document.getElementById('f-progress').value     = prog;
    document.getElementById('f-progress-label').textContent = prog + '%';
    document.getElementById('f-milestone').checked  = !!parseInt(t.is_milestone);
    rebuildOwnerDropdown(t.team, t.owner);
    setBarPickerRange(parseInt(t.bar_start), parseInt(t.bar_end));
  } else {
    document.getElementById('modal-title').textContent     = 'Add Initiative';
    document.getElementById('modal-sub').textContent       = 'Fill in the details. Leave timeline empty to add to Backlog.';
    document.getElementById('form-submit-btn').textContent = 'Save Initiative';
    document.getElementById('f-status').value        = defaultStatus || 'unscheduled';
    document.getElementById('f-progress').value      = 0;
    document.getElementById('f-progress-label').textContent = '0%';
    document.getElementById('f-milestone').checked   = false;
  }
  document.getElementById('modal').classList.add('open');
}

function closeModal()         { document.getElementById('modal').classList.remove('open'); }
function closeModalOutside(e) { if (e.target === document.getElementById('modal')) closeModal(); }

async function saveTask(e) {
  e.preventDefault();
  const id  = document.getElementById('task-id').value;
  const body = {
    team:         document.getElementById('f-team').value,
    owner:        document.getElementById('f-owner').value,
    initiative:   document.getElementById('f-initiative').value,
    outcome:      document.getElementById('f-outcome').value,
    target:       document.getElementById('f-target').value,
    status:       document.getElementById('f-status').value,
    priority:     document.getElementById('f-priority').value,
    metric:       document.getElementById('f-metric').value,
    dependencies: document.getElementById('f-dependencies').value,
    bar_start:    parseInt(document.getElementById('f-bar-start').value),
    bar_end:      parseInt(document.getElementById('f-bar-end').value),
    bar_color:    document.getElementById('f-bar-color').value,
    is_blocked:   document.getElementById('f-status').value === 'blocked' ? 1 : 0,
    progress:     parseInt(document.getElementById('f-progress').value) || 0,
    is_milestone: document.getElementById('f-milestone').checked ? 1 : 0,
  };
  const btn = document.getElementById('form-submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const url = id ? `${API}/api/tasks/${id}` : `${API}/api/tasks`;
  await fetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  btn.disabled = false;
  closeModal();
  await loadTasks();
  renderGantt();
  if (currentView === 'kanban')    renderKanban();
  if (currentView === 'dashboard') renderDashboard();
}

// ── Delete ─────────────────────────────────────────────────────────────────
function openDelete(id, name) {
  deleteTargetId = id;
  document.getElementById('delete-msg').textContent = `"${name}"`;
  document.getElementById('delete-modal').classList.add('open');
}
function closeDelete()          { document.getElementById('delete-modal').classList.remove('open'); deleteTargetId = null; }
function closeDeleteOutside(e)  { if (e.target === document.getElementById('delete-modal')) closeDelete(); }
async function confirmDelete() {
  if (!deleteTargetId) return;
  const deleted = allTasks.find(t => t.id === deleteTargetId);
  await fetch(`${API}/api/tasks/${deleteTargetId}`, { method: 'DELETE' });
  closeDelete();
  await loadTasks();
  renderGantt();
  if (currentView === 'kanban')    renderKanban();
  if (currentView === 'dashboard') renderDashboard();
  if (deleted) {
    showToast(`"${deleted.initiative}" deleted`, async () => {
      const { id: _id, created_at, updated_at, ...body } = deleted;
      await fetch(`${API}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await loadTasks();
      renderGantt();
      if (currentView === 'kanban')    renderKanban();
      if (currentView === 'dashboard') renderDashboard();
    });
  }
}

// ── Manage Modal ───────────────────────────────────────────────────────────
const PROJECT_COLORS = [
  '#1565C0','#2E7D32','#E65100','#6A1B9A','#00695C','#B71C1C',
  '#0277BD','#388E3C','#F57C00','#7B1FA2','#00796B','#AD1457',
];
let selectedProjColor = PROJECT_COLORS[0];

function openManageModal(tab = 'projects') {
  buildColorSwatches();
  renderProjectList();
  renderDevList();
  switchTab(tab);
  document.getElementById('dev-modal').classList.add('open');
}
function closeDevModal()         { document.getElementById('dev-modal').classList.remove('open'); cancelProjectEdit(); cancelDevEdit(); }
function closeDevModalOutside(e) { if (e.target === document.getElementById('dev-modal')) closeDevModal(); }
function switchTab(tab) {
  ['projects','developers'].forEach(t => {
    document.getElementById(`tab-btn-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
}

// Color swatches
function buildColorSwatches() {
  const wrap = document.getElementById('proj-color-swatches');
  if (wrap.dataset.built) return;
  wrap.dataset.built = '1';
  PROJECT_COLORS.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    s.style.background = c;
    s.dataset.color = c;
    s.onclick = () => {
      wrap.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      selectedProjColor = c;
    };
    wrap.appendChild(s);
  });
}

function selectColorSwatch(color) {
  const wrap = document.getElementById('proj-color-swatches');
  wrap.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('selected', s.dataset.color === color);
  });
  selectedProjColor = color;
}

// ── Projects CRUD ──────────────────────────────────────────────────────────
function renderProjectList() {
  const el = document.getElementById('proj-list');
  el.innerHTML = allTeams.length
    ? allTeams.map(t => `
      <div class="dev-list-item">
        <span class="dev-avatar" style="background:${t.color}">${t.name[0]}</span>
        <div style="flex:1">
          <div class="dev-name">${t.name}</div>
        </div>
        <button class="btn-icon btn-edit-sm" title="Edit" onclick="editProject(${t.id})">✎</button>
        <button class="btn-del-sm" title="Delete" onclick="deleteProject(${t.id}, '${t.name.replace(/'/g,"\\'")}')">✕</button>
      </div>`).join('')
    : '<div class="dev-list-empty">No projects yet.</div>';
}

function projEnterKey(e) { if (e.key === 'Enter') { e.preventDefault(); submitProject(); } }

function editProject(id) {
  const t = allTeams.find(x => x.id === id);
  if (!t) return;
  document.getElementById('proj-editing-id').value = id;
  document.getElementById('proj-name').value        = t.name;
  selectColorSwatch(t.color);
  document.getElementById('proj-form-title').textContent  = 'Edit Project';
  document.getElementById('proj-submit-btn').textContent  = 'Update';
  document.getElementById('proj-cancel-edit').style.display = 'block';
  document.getElementById('proj-add-error').style.display   = 'none';
  document.getElementById('proj-name').focus();
}

function cancelProjectEdit() {
  document.getElementById('proj-editing-id').value           = '';
  document.getElementById('proj-name').value                  = '';
  document.getElementById('proj-form-title').textContent      = 'Add Project';
  document.getElementById('proj-submit-btn').textContent      = 'Add';
  document.getElementById('proj-cancel-edit').style.display   = 'none';
  document.getElementById('proj-add-error').style.display     = 'none';
  selectColorSwatch(PROJECT_COLORS[0]);
}

async function submitProject() {
  const editingId = document.getElementById('proj-editing-id').value;
  const name   = document.getElementById('proj-name').value.trim();
  const errEl  = document.getElementById('proj-add-error');
  errEl.style.display = 'none';
  if (!name) { showProjError('Please enter a project name.'); return; }

  const url    = editingId ? `${API}/api/teams/${editingId}` : `${API}/api/teams`;
  const method = editingId ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color: selectedProjColor }) });
  const data   = await res.json();
  if (!res.ok) { showProjError(data.error || 'Failed.'); return; }

  if (editingId) {
    const idx = allTeams.findIndex(t => t.id === parseInt(editingId));
    if (idx >= 0) allTeams[idx] = data;
    // Update dropdown options
    rebuildAllProjectDropdowns();
  } else {
    allTeams.push(data);
    appendProjectToSelects(data);
  }

  cancelProjectEdit();
  renderProjectList();
  renderGantt();
}

async function deleteProject(id, name) {
  const errEl = document.getElementById('proj-add-error');
  errEl.style.display = 'none';
  const res  = await fetch(`${API}/api/teams/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { showProjError(data.error); return; }
  allTeams = allTeams.filter(t => t.id !== id);
  rebuildAllProjectDropdowns();
  renderProjectList();
  renderGantt();
}

function showProjError(msg) {
  const el = document.getElementById('proj-add-error');
  el.textContent = msg; el.style.display = 'block';
}

function appendProjectToSelects(team) {
  document.getElementById('filter-project').innerHTML += `<option value="${team.name}">${team.name}</option>`;
  document.getElementById('dev-project').innerHTML    += `<option value="${team.name}">${team.name}</option>`;
  rebuildFormProjectSelect();
}

function rebuildAllProjectDropdowns() {
  const filterSel = document.getElementById('filter-project');
  const curFilter = filterSel.value;
  filterSel.innerHTML = '<option value="">All Projects</option>';
  allTeams.forEach(t => { filterSel.innerHTML += `<option value="${t.name}">${t.name}</option>`; });
  filterSel.value = curFilter;

  const devSel = document.getElementById('dev-project');
  const curDev = devSel.value;
  devSel.innerHTML = '<option value="">Select project...</option>';
  allTeams.forEach(t => { devSel.innerHTML += `<option value="${t.name}">${t.name}</option>`; });
  devSel.value = curDev;

  rebuildFormProjectSelect();
}

// ── Developers CRUD ────────────────────────────────────────────────────────
function renderDevList() {
  const el = document.getElementById('dev-list');
  if (!allDevelopers.length) { el.innerHTML = '<div class="dev-list-empty">No developers yet.</div>'; return; }

  const grouped = {};
  allTeams.forEach(t => { grouped[t.name] = []; });
  allDevelopers.forEach(d => { (grouped[d.project] = grouped[d.project] || []).push(d); });

  let html = '';
  allTeams.forEach(t => {
    const devs = grouped[t.name] || [];
    if (!devs.length) return;
    html += `<div class="dev-list-group">
      <div class="dev-list-group-header">
        <span class="dev-group-dot" style="background:${t.color}"></span>
        ${t.name} <span class="tgh-count">${devs.length}</span>
      </div>`;
    devs.forEach(d => {
      html += `<div class="dev-list-item">
        <span class="dev-avatar">${d.name[0].toUpperCase()}</span>
        <span class="dev-name">${d.name}</span>
        <button class="btn-icon btn-edit-sm" title="Edit" onclick="editDeveloper(${d.id})">✎</button>
        <button class="btn-del-sm" title="Remove" onclick="deleteDeveloper(${d.id})">✕</button>
      </div>`;
    });
    html += '</div>';
  });
  el.innerHTML = html || '<div class="dev-list-empty">No developers yet.</div>';
}

function devEnterKey(e) { if (e.key === 'Enter') { e.preventDefault(); submitDeveloper(); } }

function editDeveloper(id) {
  const d = allDevelopers.find(x => x.id === id);
  if (!d) return;
  document.getElementById('dev-editing-id').value      = id;
  document.getElementById('dev-name').value             = d.name;
  document.getElementById('dev-project').value          = d.project;
  document.getElementById('dev-form-title').textContent = 'Edit Developer';
  document.getElementById('dev-submit-btn').textContent = 'Update';
  document.getElementById('dev-cancel-edit').style.display = 'block';
  document.getElementById('dev-add-error').style.display   = 'none';
  document.getElementById('dev-name').focus();
}

function cancelDevEdit() {
  document.getElementById('dev-editing-id').value           = '';
  document.getElementById('dev-name').value                  = '';
  document.getElementById('dev-project').value               = '';
  document.getElementById('dev-form-title').textContent      = 'Add Developer';
  document.getElementById('dev-submit-btn').textContent      = 'Add';
  document.getElementById('dev-cancel-edit').style.display   = 'none';
  document.getElementById('dev-add-error').style.display     = 'none';
}

async function submitDeveloper() {
  const editingId = document.getElementById('dev-editing-id').value;
  const name      = document.getElementById('dev-name').value.trim();
  const project   = document.getElementById('dev-project').value;
  const errEl     = document.getElementById('dev-add-error');
  errEl.style.display = 'none';
  if (!name)    { showDevError('Please enter a name.'); return; }
  if (!project) { showDevError('Please select a project.'); return; }

  const url    = editingId ? `${API}/api/developers/${editingId}` : `${API}/api/developers`;
  const method = editingId ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project }) });
  const data   = await res.json();
  if (!res.ok) { showDevError(data.error || 'Failed.'); return; }

  if (editingId) {
    const idx = allDevelopers.findIndex(d => d.id === parseInt(editingId));
    if (idx >= 0) allDevelopers[idx] = data;
  } else {
    allDevelopers.push(data);
  }
  allDevelopers.sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));

  cancelDevEdit();
  renderDevList();
  rebuildDevFilter();
}

async function deleteDeveloper(id) {
  await fetch(`${API}/api/developers/${id}`, { method: 'DELETE' });
  allDevelopers = allDevelopers.filter(d => d.id !== id);
  renderDevList();
  rebuildDevFilter();
}

function showDevError(msg) {
  const el = document.getElementById('dev-add-error');
  el.textContent = msg; el.style.display = 'block';
}

// ── Workload Modal ─────────────────────────────────────────────────────────
function openWorkloadModal() {
  const todayWk = currentWeekIndex();
  const label   = todayWk >= 0 ? `Current week: ${WEEKS[todayWk]}` : 'Outside Q3 2026 range';
  document.getElementById('workload-week-label').textContent = label;
  renderWorkload(todayWk);
  document.getElementById('workload-modal').classList.add('open');
}
function closeWorkloadModal()         { document.getElementById('workload-modal').classList.remove('open'); }
function closeWorkloadOutside(e)      { if (e.target === document.getElementById('workload-modal')) closeWorkloadModal(); }

function renderWorkload(todayWk) {
  const body = document.getElementById('workload-body');

  // Collect all unique developer names + their project
  const devMap = {}; // name → project
  allDevelopers.forEach(d => { devMap[d.name] = d.project; });
  // Also include owners from tasks not in dev list
  allTasks.forEach(t => { if (t.owner && !devMap[t.owner]) devMap[t.owner] = t.team; });

  // Order: follow allTeams order, then allDevelopers order within team
  const ordered = [];
  allTeams.forEach(team => {
    const teamDevs = allDevelopers.filter(d => d.project === team.name);
    teamDevs.forEach(d => { if (!ordered.find(x => x.name === d.name && x.project === d.project)) ordered.push({ name: d.name, project: d.project }); });
    // Unlisted owners for this team
    [...new Set(allTasks.filter(t => t.team === team.name && t.owner && !teamDevs.find(d => d.name === t.owner)).map(t => t.owner))]
      .forEach(n => ordered.push({ name: n, project: team.name }));
  });

  if (!ordered.length) {
    body.innerHTML = '<div class="dev-list-empty" style="padding:40px">No developers found. Add developers via ⚙ Manage.</div>';
    return;
  }

  body.innerHTML = ordered.map(({ name, project }) => {
    const color     = allTeams.find(t => t.name === project)?.color || '#64748B';
    const myTasks   = allTasks.filter(t => t.owner === name);
    const active    = myTasks.filter(t => {
      const bs = parseInt(t.bar_start), be = parseInt(t.bar_end);
      return bs >= 0 && be >= 0 && bs <= todayWk && todayWk <= be && t.status !== 'done';
    });
    const upcoming  = myTasks.filter(t => {
      const bs = parseInt(t.bar_start);
      return bs > todayWk && t.status !== 'done';
    });
    const backlogT  = myTasks.filter(t => parseInt(t.bar_start) < 0 || parseInt(t.bar_end) < 0);
    const done      = myTasks.filter(t => t.status === 'done');

    const taskChip = (t, cls) => `<div class="wl-task ${cls}">
      <span class="wl-dot"></span>
      <span class="wl-name">${t.initiative}</span>
      ${t.bar_start >= 0 ? `<span class="wl-range">${WEEKS[t.bar_start].split('–')[0]}–${WEEKS[t.bar_end]}</span>` : ''}
    </div>`;

    return `<div class="wl-card">
      <div class="wl-card-header">
        <div class="dev-avatar" style="background:${color}">${name[0].toUpperCase()}</div>
        <div>
          <div class="wl-dev-name">${name}</div>
          <div class="wl-dev-project">${project}</div>
        </div>
        <div class="wl-summary">
          ${active.length   ? `<span class="wl-badge wl-active">${active.length} active</span>`  : ''}
          ${upcoming.length ? `<span class="wl-badge wl-upcoming">${upcoming.length} upcoming</span>` : ''}
          ${backlogT.length ? `<span class="wl-badge wl-backlog">${backlogT.length} backlog</span>` : ''}
          ${done.length     ? `<span class="wl-badge wl-done">${done.length} done</span>` : ''}
        </div>
      </div>
      ${active.length   ? `<div class="wl-section"><div class="wl-section-title">🔵 Active now</div>${active.map(t => taskChip(t,'wl-t-active')).join('')}</div>` : ''}
      ${upcoming.length ? `<div class="wl-section"><div class="wl-section-title">📅 Upcoming</div>${upcoming.map(t => taskChip(t,'wl-t-upcoming')).join('')}</div>` : ''}
      ${backlogT.length ? `<div class="wl-section"><div class="wl-section-title">📋 Backlog</div>${backlogT.map(t => taskChip(t,'wl-t-backlog')).join('')}</div>` : ''}
      ${!active.length && !upcoming.length && !backlogT.length ? `<div class="wl-idle">No open tasks</div>` : ''}
    </div>`;
  }).join('');
}

// ── Bar Picker ─────────────────────────────────────────────────────────────
let bpDragging = false, bpStart = -1, bpEnd = -1, _bpMouseUpAdded = false;

function buildBarPicker() {
  const picker      = document.getElementById('bar-picker');
  const labels      = document.getElementById('bar-labels');
  const monthLabels = document.getElementById('bar-month-labels');

  picker.innerHTML = '';
  labels.innerHTML = '';
  monthLabels.innerHTML = '';

  MONTHS.forEach((m, mi) => {
    const el = document.createElement('div');
    el.className = 'bar-month-label';
    el.style.flex = String(m.to - m.from + 1);
    el.textContent = m.short;
    monthLabels.appendChild(el);
  });

  WEEKS.forEach((w, wi) => {
    const mi = weekMonthIdx(wi);
    const palette = MONTH_PALETTE[(mi >= 0 ? mi : 0) % 3];
    const cell = document.createElement('div');
    cell.className = 'bp-week';
    cell.dataset.idx = wi;
    cell.style.background = palette.picker;
    cell.addEventListener('mousedown', ev => { ev.preventDefault(); bpDragging = true; bpStart = bpEnd = wi; updateBP(); });
    cell.addEventListener('mouseenter', () => { if (bpDragging) { bpEnd = wi; updateBP(); } });
    picker.appendChild(cell);
    const lbl = document.createElement('span');
    lbl.textContent = wi + 1;
    labels.appendChild(lbl);
  });

  if (!_bpMouseUpAdded) {
    document.addEventListener('mouseup', () => { bpDragging = false; });
    _bpMouseUpAdded = true;
  }
}

function updateBP() {
  const lo = Math.min(bpStart, bpEnd), hi = Math.max(bpStart, bpEnd);
  document.querySelectorAll('.bp-week').forEach((c, i) => c.classList.toggle('selected', i >= lo && i <= hi));
  document.getElementById('f-bar-start').value = lo;
  document.getElementById('f-bar-end').value   = hi;
  const sel = document.getElementById('bp-selection');
  if (sel) sel.textContent = `${WEEKS[lo].split('–')[0].trim()} – ${WEEKS[hi]}`;
  // Auto-promote status from Backlog → Active when a bar is drawn
  const statusSel = document.getElementById('f-status');
  if (statusSel && statusSel.value === 'unscheduled') statusSel.value = 'active';
}

function clearTimeline() {
  resetBarPicker();
  const statusSel = document.getElementById('f-status');
  if (statusSel && statusSel.value !== 'done') statusSel.value = 'unscheduled';
}

function setBarPickerRange(s, e) {
  if (s < 0 || e < 0) return;
  bpStart = s; bpEnd = e; updateBP();
}

function resetBarPicker() {
  bpStart = -1; bpEnd = -1;
  document.querySelectorAll('.bp-week').forEach(c => c.classList.remove('selected'));
  document.getElementById('f-bar-start').value = -1;
  document.getElementById('f-bar-end').value   = -1;
  const sel = document.getElementById('bp-selection');
  if (sel) sel.textContent = 'No range selected — will go to Backlog';
}

boot();
