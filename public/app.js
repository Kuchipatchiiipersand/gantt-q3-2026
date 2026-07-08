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
  at_risk:     { label: 'At Risk',     cls: 's-at-risk' },
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
  { id: 'active', statuses: ['active','blocked','at_risk'], dropStatus: 'active', label: 'In Progress', color: '#3B82F6' },
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
  buildMobileBarPicker();
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

// ── Multi-select filters ──────────────────────────────────────────────────
let filterProjects = [];
let filterDevs     = [];

function toggleMultiDropdown(type) {
  const wrap = document.getElementById(`ms-${type}-wrap`);
  const opening = !wrap.classList.contains('ms-open');
  document.querySelectorAll('.multi-select-wrap').forEach(w => w.classList.remove('ms-open'));
  if (opening) wrap.classList.add('ms-open');
}

function toggleMultiFilter(type, value) {
  const arr = type === 'project' ? filterProjects : filterDevs;
  const idx = arr.indexOf(value);
  if (idx === -1) arr.push(value); else arr.splice(idx, 1);
  updateMultiBtn(type);
  updateFilterBadges();
  renderActiveView();
}

function updateMultiBtn(type) {
  const arr  = type === 'project' ? filterProjects : filterDevs;
  const ph   = type === 'project' ? 'All Projects' : 'All Developers';
  const btn  = document.getElementById(`ms-${type}-btn`);
  if (!btn) return;
  btn.textContent = arr.length === 0 ? `${ph} ▾` : arr.length === 1 ? `${arr[0]} ▾` : `${arr.length} selected ▾`;
  btn.classList.toggle('ms-active', arr.length > 0);
}

function rebuildProjectMultiSelect() {
  const drop = document.getElementById('ms-project-drop');
  if (!drop) return;
  drop.innerHTML = allTeams.map(t => `
    <label class="ms-item">
      <input type="checkbox" onchange="toggleMultiFilter('project','${t.name.replace(/'/g,"\\'")}')" ${filterProjects.includes(t.name) ? 'checked' : ''}>
      <span class="ms-dot" style="background:${t.color}"></span>${t.name}
    </label>`).join('');
}

function rebuildDevMultiSelect() {
  const drop = document.getElementById('ms-dev-drop');
  if (!drop) return;
  const names = [...new Set(allDevelopers.map(d => d.name))].sort();
  drop.innerHTML = names.map(n => `
    <label class="ms-item">
      <input type="checkbox" onchange="toggleMultiFilter('dev','${n.replace(/'/g,"\\'")}')" ${filterDevs.includes(n) ? 'checked' : ''}>
      ${n}
    </label>`).join('');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.multi-select-wrap')) {
    document.querySelectorAll('.multi-select-wrap').forEach(w => w.classList.remove('ms-open'));
  }
});

function updateFilterBadges() {
  const stat = document.getElementById('filter-status').value;
  document.getElementById('ms-project-wrap')?.classList.toggle('filter-active', filterProjects.length > 0);
  document.getElementById('ms-dev-wrap')?.classList.toggle('filter-active', filterDevs.length > 0);
  document.getElementById('filter-status').closest('.select-wrap').classList.toggle('filter-active', !!stat);
  const activeCount = (filterProjects.length > 0 ? 1 : 0) + (filterDevs.length > 0 ? 1 : 0) + (stat ? 1 : 0);
  const clearBtn = document.getElementById('btn-clear-filters');
  if (clearBtn) clearBtn.style.display = activeCount > 0 ? 'flex' : 'none';
  const mBtn = document.getElementById('mobile-filter-btn');
  if (mBtn) {
    mBtn.classList.toggle('filter-active', activeCount > 0);
    const badge = document.getElementById('mobile-filter-badge');
    if (badge) badge.textContent = activeCount > 0 ? activeCount : '';
  }
}

function clearFilters() {
  filterProjects = []; filterDevs = [];
  updateMultiBtn('project'); updateMultiBtn('dev');
  rebuildProjectMultiSelect(); rebuildDevMultiSelect();
  document.getElementById('filter-status').value = '';
  document.getElementById('search').value        = '';
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

// ── Jira Integration ──────────────────────────────────────────────────────
let jiraDomain = '';

async function loadJiraConfig() {
  try {
    const res  = await fetch('/api/settings');
    const data = await res.json();
    jiraDomain = data.jira_domain || '';
    const configured = !!(data.jira_domain && data.jira_email && data.jira_token_set);
    const btn = document.getElementById('btn-jira');
    if (btn) btn.classList.toggle('jira-configured', configured);
    const domainEl = document.getElementById('jira-domain');
    if (domainEl) {
      domainEl.value = data.jira_domain || '';
      document.getElementById('jira-email').value = data.jira_email || '';
      document.getElementById('jira-jql').value   = data.jira_jql   || '';
    }
  } catch(_) {}
}

function openJiraModal() {
  document.getElementById('jira-modal').classList.add('open');
  document.getElementById('jira-sync-status').style.display = 'none';
  loadJiraConfig();
}

function closeJiraModal() {
  document.getElementById('jira-modal').classList.remove('open');
}

function closeJiraOutside(e) {
  if (e.target.id === 'jira-modal') closeJiraModal();
}

async function saveJiraConfig() {
  const domain = document.getElementById('jira-domain').value.trim();
  const email  = document.getElementById('jira-email').value.trim();
  const token  = document.getElementById('jira-token').value.trim();
  const jql    = document.getElementById('jira-jql').value.trim();
  if (!domain || !email) { showToast('Domain and email are required.'); return; }
  const body = { jira_domain: domain, jira_email: email, jira_jql: jql };
  if (token) body.jira_token = token;
  const res = await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (res.ok) {
    document.getElementById('jira-token').value = '';
    showToast('Jira config saved.');
    await loadJiraConfig();
  } else {
    showToast('Failed to save config.');
  }
}

async function syncFromJira() {
  const btn    = document.getElementById('jira-sync-btn');
  const status = document.getElementById('jira-sync-status');
  btn.disabled = true;
  status.style.display = 'block';
  status.className     = 'jira-sync-status jira-syncing';
  status.textContent   = 'Connecting to Jira…';

  try {
    const res  = await fetch('/api/jira/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate: cfg.startDate, endDate: cfg.endDate })
    });
    const data = await res.json();
    if (!res.ok) {
      status.className   = 'jira-sync-status jira-error';
      status.textContent = `Error: ${data.error}`;
    } else {
      status.className   = 'jira-sync-status jira-success';
      status.textContent = `✓ ${data.created} created, ${data.updated} updated (${data.total} total issues imported)`;
      await Promise.all([loadTeams(), loadTasks()]);
      populateProjectSelects();
      renderActiveView();
    }
  } catch(e) {
    status.className   = 'jira-sync-status jira-error';
    status.textContent = `Network error: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
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
  buildMobileBarPicker();
  updateFilterBadges();
  loadJiraConfig();
  // Default to Kanban on mobile — Gantt requires horizontal scroll and is hard to use
  if (window.innerWidth <= 768) {
    switchView('kanban');
  } else {
    renderGantt();
  }
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
    document.getElementById('dev-project').innerHTML += `<option value="${t.name}">${t.name}</option>`;
  });
  rebuildProjectMultiSelect();
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
  rebuildDevMultiSelect();
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
  document.body.className = `view-${view}`;
  ['gantt','kanban','dashboard'].forEach(v => {
    document.getElementById(`view-${v}`).style.display = v === view ? (v === 'gantt' ? 'block' : 'flex') : 'none';
    document.getElementById(`vbtn-${v}`).classList.toggle('active', v === view);
    const mb = document.getElementById(`mnav-${v}`);
    if (mb) mb.classList.toggle('active', v === view);
  });
  const legend = document.getElementById('header-legend');
  if (legend) legend.style.display = view === 'gantt' ? 'flex' : 'none';
  renderActiveView();
}

// ── Kanban ────────────────────────────────────────────────────────────────
function renderKanban() {
  const board    = document.getElementById('kanban-board');
  const search   = document.getElementById('search').value.toLowerCase();
  const statFilt = document.getElementById('filter-status').value;

  const tasks = allTasks.filter(t => {
    if (search && !t.initiative.toLowerCase().includes(search) && !(t.owner||'').toLowerCase().includes(search)) return false;
    if (filterProjects.length && !filterProjects.includes(t.team))  return false;
    if (filterDevs.length     && !filterDevs.includes(t.owner))     return false;
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
      <span class="kanban-col-count" style="background:${col.color}">${colTasks.length}</span>
      <button class="kanban-add-btn" title="Add" onclick="openModal(null,'${col.dropStatus}')">+</button>`;
    colEl.appendChild(header);

    const cards = document.createElement('div');
    cards.className = 'kanban-cards';
    if (colTasks.length === 0) {
      cards.innerHTML = `<div class="kanban-empty">
        <div class="kanban-empty-icon">${col.id === 'done' ? '✓' : col.id === 'active' ? '⚡' : '📋'}</div>
        <span>No items here</span>
        <button class="kanban-empty-btn" onclick="openModal(null,'${col.dropStatus}')">+ Add item</button>
      </div>`;
    } else {
      colTasks.forEach(t => cards.appendChild(buildKanbanCard(t)));
    }
    colEl.appendChild(cards);
    board.appendChild(colEl);
  });
}

function buildKanbanCard(task) {
  const card = document.createElement('div');
  card.draggable  = true;
  card.dataset.id = task.id;

  card.addEventListener('dragstart', e => { e.dataTransfer.setData('taskId', task.id); card.classList.add('dragging'); });
  card.addEventListener('dragend',   () => card.classList.remove('dragging'));

  const team       = allTeams.find(t => t.name === task.team);
  const color      = team?.color || '#64748B';
  const pm         = PRIORITY_META[task.priority || 'medium'];
  const rag        = computeRAG(task);
  const ragMeta    = rag ? RAG_META[rag] : null;
  const progress   = parseInt(task.progress) || 0;
  const safeName   = task.initiative.replace(/'/g, "\\'");
  const safeTitle  = task.initiative.replace(/"/g, '&quot;');
  const isBlocked  = task.status === 'blocked';
  const isDone     = task.status === 'done';
  const todayWk    = currentWeekIndex();
  const bs         = parseInt(task.bar_start);
  const be         = parseInt(task.bar_end);
  const isOverdue  = !isDone && be >= 0 && todayWk >= 0 && be < todayWk;
  const isMilestone = !!parseInt(task.is_milestone);

  let cls = 'kanban-card';
  if (isBlocked) cls += ' is-blocked-card';
  if (isDone)    cls += ' is-done-card';
  card.className = cls;

  // Timeline row
  let timelineHtml = '';
  if (bs >= 0 && be >= 0 && WEEKS[bs] && WEEKS[be]) {
    const timeStr = bs === be ? WEEKS[bs] : `${WEEKS[bs]} – ${WEEKS[be]}`;
    timelineHtml = `<span class="kcard-timeline">${isMilestone ? '◆ ' : ''}${timeStr}</span>`;
  } else if (isMilestone) {
    timelineHtml = `<span class="kcard-timeline">◆ Milestone</span>`;
  }

  // Status chips
  const blockedChip = isBlocked ? `<span class="kcard-chip kcard-chip-blocked">Blocked</span>` : '';
  const overdueChip = isOverdue ? `<span class="kcard-chip kcard-chip-overdue">+${todayWk - be}w late</span>` : '';

  // Progress row
  const effectiveProgress = isDone ? 100 : progress;
  const progressHtml = (effectiveProgress > 0)
    ? `<div class="kcard-progress-row">
        <div class="kcard-progress"><div class="kcard-progress-fill" style="width:${effectiveProgress}%"></div></div>
        <span class="kcard-progress-pct" style="${isDone ? 'color:#22C55E' : ''}">${effectiveProgress}%</span>
      </div>`
    : '';

  card.innerHTML = `
    <div class="kcard-top">
      <div class="kcard-top-left">
        ${ragMeta ? `<span class="rag-dot ${ragMeta.dot}" title="${ragMeta.label}"></span>` : ''}
        <span class="priority-badge ${pm.cls}">${pm.label}</span>
        ${blockedChip}${overdueChip}
      </div>
      <div class="kcard-actions">
        <button class="btn-edit" onclick="openModal(${task.id})" title="Edit">✎</button>
        <button class="btn-del"  onclick="openDelete(${task.id},'${safeName}')" title="Delete">✕</button>
      </div>
    </div>
    <div class="kcard-title" title="${safeTitle}">${isDone ? '✓ ' : ''}${task.initiative}</div>
    ${timelineHtml || overdueChip ? `<div class="kcard-meta-row">${timelineHtml}</div>` : ''}
    ${progressHtml}
    <div class="kcard-footer">
      <span class="kcard-project" style="border-left:3px solid ${color};padding-left:6px">${task.team}</span>
      ${task.jira_key ? `<a class="jira-badge" href="${jiraDomain ? `https://${jiraDomain}/browse/${task.jira_key}` : '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${task.jira_key}</a>` : ''}
      ${task.owner ? `<span class="kcard-owner"><span class="cell-assignee-avatar" style="background:${color};width:18px;height:18px;font-size:9px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700">${task.owner[0].toUpperCase()}</span> ${task.owner}</span>` : ''}
    </div>`;

  return card;
}

// ── Dashboard Chart Helpers ───────────────────────────────────────────────

function buildDonutSVG(segments, total) {
  const r = 52, cx = 70, cy = 70;
  const C = 2 * Math.PI * r;
  if (total === 0) {
    return `<svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F1F5F9" stroke-width="14"/>
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="11" fill="#94A3B8">No data</text>
    </svg>`;
  }
  let cumLen = 0, arcs = '';
  segments.filter(s => s.value > 0).forEach(s => {
    const len = (s.value / total) * C;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="14"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-cumLen).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"><title>${s.label}: ${s.value}</title></circle>`;
    cumLen += len;
  });
  return `<svg width="140" height="140" viewBox="0 0 140 140">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#F1F5F9" stroke-width="14"/>
    ${arcs}
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="26" font-weight="800" fill="#0F172A">${total}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#94A3B8">initiatives</text>
  </svg>`;
}

function buildLoadSVG(tasks, todayWk) {
  if (!NW) return '<div style="color:#94A3B8;font-size:12px;padding:20px;text-align:center">No weeks configured</div>';
  const W = 520, H = 150, padL = 28, padR = 8, padT = 20, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const counts = Array.from({ length: NW }, (_, wi) =>
    tasks.filter(t => {
      const bs = parseInt(t.bar_start), be = parseInt(t.bar_end);
      return bs >= 0 && be >= 0 && wi >= bs && wi <= be;
    }).length
  );
  const maxCount = Math.max(...counts, 1);
  const barW = plotW / NW;

  // Y-axis grid
  const step = Math.max(1, Math.ceil(maxCount / 4));
  let grid = '';
  for (let v = step; v <= maxCount + step - 1; v += step) {
    if (v > maxCount) break;
    const gy = (padT + plotH - (v / maxCount) * plotH).toFixed(1);
    grid += `<line x1="${padL}" y1="${gy}" x2="${padL + plotW}" y2="${gy}" stroke="#E2E8F0" stroke-width="1"/>
    <text x="${padL - 4}" y="${(+gy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#94A3B8">${v}</text>`;
  }

  // Bars
  let bars = '';
  counts.forEach((count, wi) => {
    const x = padL + wi * barW, isToday = wi === todayWk;
    const bh = count > 0 ? Math.max(3, (count / maxCount) * plotH) : 0;
    const y  = padT + plotH - bh;
    const color = isToday ? '#4F46E5' : count > 7 ? '#F43F5E' : count > 4 ? '#F59E0B' : '#3B82F6';
    if (bh > 0) {
      bars += `<rect x="${(x + 1.5).toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${bh.toFixed(1)}" rx="3"
        fill="${color}" opacity="${isToday ? 1 : 0.75}"><title>${WEEKS[wi]}: ${count} task${count !== 1 ? 's' : ''}</title></rect>`;
    } else {
      bars += `<rect x="${(x + 1.5).toFixed(1)}" y="${(padT + plotH - 2).toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="2" rx="1" fill="#E2E8F0"/>`;
    }
  });

  // Month separators + labels
  let months = '';
  MONTHS.forEach((m, i) => {
    if (i > 0) {
      const mx = (padL + m.from * barW).toFixed(1);
      months += `<line x1="${mx}" y1="${padT}" x2="${mx}" y2="${padT + plotH}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="2,2"/>`;
    }
    const lx = (padL + (m.from + m.to + 1) / 2 * barW).toFixed(1);
    months += `<text x="${lx}" y="${H - 4}" text-anchor="middle" font-size="10" font-weight="600" fill="#64748B">${m.short}</text>`;
  });

  // Today marker
  let todayEl = '';
  if (todayWk >= 0 && todayWk < NW) {
    const tx = (padL + todayWk * barW + barW / 2).toFixed(1);
    todayEl = `<line x1="${tx}" y1="${padT - 6}" x2="${tx}" y2="${padT + plotH}" stroke="#4F46E5" stroke-width="1.5" stroke-dasharray="3,2"/>
    <text x="${tx}" y="${padT - 9}" text-anchor="middle" font-size="8" fill="#4F46E5" font-weight="600">Today</text>`;
  }

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#F8FAFC" rx="4"/>
    ${grid}${months}${bars}${todayEl}
  </svg>`;
}

function buildHeatmapHTML(teams, tasks) {
  const rows = teams.map(team => {
    const tt = tasks.filter(t => t.team === team.name);
    if (!tt.length) return null;
    const rags    = tt.map(t => computeRAG(t)).filter(Boolean);
    const worst   = rags.includes('critical') ? 'critical' : rags.includes('at_risk') ? 'at_risk' : rags.length ? 'on_track' : null;
    const done    = tt.filter(t => t.status === 'done').length;
    const active  = tt.filter(t => t.status === 'active').length;
    const blocked = tt.filter(t => t.status === 'blocked').length;
    const avgPct  = Math.round(tt.reduce((s, t) => s + (t.status === 'done' ? 100 : (parseInt(t.progress) || 0)), 0) / tt.length);
    return { name: team.name, color: team.color, worst, avgPct, done, active, blocked };
  }).filter(Boolean);

  const order = { critical: 0, at_risk: 1, on_track: 2 };
  rows.sort((a, b) => (order[a.worst] ?? 3) - (order[b.worst] ?? 3));
  if (!rows.length) return '<div style="color:#94A3B8;font-size:12px;padding:20px">No projects yet</div>';

  return rows.map(r => {
    const ragLabel = r.worst ? RAG_META[r.worst]?.label : '—';
    const ragDot   = r.worst ? `<span class="rag-dot rag-${r.worst}"></span>` : '';
    return `<div class="heatmap-row">
      <div class="heatmap-team"><span class="tgh-dot" style="background:${r.color}"></span><span class="heatmap-name">${r.name}</span></div>
      <div class="heatmap-rag-cell">${ragDot}<span class="heatmap-rag-label">${ragLabel}</span></div>
      <div class="heatmap-bar-wrap"><div class="heatmap-bar-fill" style="width:${r.avgPct}%;background:${r.color}"></div></div>
      <div class="heatmap-pct">${r.avgPct}%</div>
      <div class="heatmap-pills">
        ${r.active  ? `<span class="dash-pill dp-active">${r.active} active</span>` : ''}
        ${r.blocked ? `<span class="dash-pill dp-blocked">${r.blocked} blocked</span>` : ''}
        ${r.done    ? `<span class="dash-pill dp-done">${r.done} done</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function buildScatterSVG(tasks, todayWk) {
  const W = 380, H = 220, padL = 36, padR = 12, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const points = todayWk < 0 ? [] : tasks
    .filter(t => ['active', 'blocked'].includes(t.status))
    .map(t => {
      const bs = parseInt(t.bar_start), be = parseInt(t.bar_end);
      if (bs < 0 || be < 0 || be < bs) return null;
      const elapsed  = Math.max(0, todayWk - bs);
      const expected = Math.min(100, Math.round((elapsed / (be - bs + 1)) * 100));
      const actual   = parseInt(t.progress) || 0;
      return { task: t, expected, actual, rag: computeRAG(t) };
    }).filter(Boolean);

  // Grid lines
  let grid = '';
  [25, 50, 75].forEach(p => {
    const gx = (padL + (p / 100) * plotW).toFixed(1);
    const gy = (padT + plotH - (p / 100) * plotH).toFixed(1);
    grid += `<line x1="${gx}" y1="${padT}" x2="${gx}" y2="${padT + plotH}" stroke="#E2E8F0" stroke-width="1"/>
    <line x1="${padL}" y1="${gy}" x2="${padL + plotW}" y2="${gy}" stroke="#E2E8F0" stroke-width="1"/>
    <text x="${gx}" y="${padT + plotH + 11}" text-anchor="middle" font-size="8" fill="#CBD5E1">${p}%</text>
    <text x="${padL - 4}" y="${(+gy + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#CBD5E1">${p}%</text>`;
  });

  // Shading + diagonal
  const ahead  = `<polygon points="${padL},${padT + plotH} ${padL + plotW},${padT} ${padL},${padT}" fill="#F0FDF4" opacity="0.5"/>`;
  const behind = `<polygon points="${padL},${padT + plotH} ${padL + plotW},${padT + plotH} ${padL + plotW},${padT}" fill="#FEF2F2" opacity="0.4"/>`;
  const diag   = `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT}" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="5,3"/>`;

  // Dots
  const dots = points.map(p => {
    const cx = (padL + (p.expected / 100) * plotW).toFixed(1);
    const cy = (padT + plotH - (p.actual / 100) * plotH).toFixed(1);
    const color = p.rag === 'critical' ? '#F43F5E' : p.rag === 'at_risk' ? '#F59E0B' : '#22C55E';
    const tip   = `${p.task.initiative.replace(/</g, '&lt;')}\nExpected: ${p.expected}% · Actual: ${p.actual}%`;
    return `<circle cx="${cx}" cy="${cy}" r="5.5" fill="${color}" stroke="white" stroke-width="1.5"
      opacity="0.88" style="cursor:pointer" onclick="openModal(${p.task.id})"><title>${tip}</title></circle>`;
  });

  const axes = `
    <text x="${padL - 4}" y="${padT + plotH + 4}" text-anchor="end" font-size="9" fill="#94A3B8">0%</text>
    <text x="${padL + plotW / 2}" y="${H - 1}" text-anchor="middle" font-size="9" fill="#94A3B8" font-weight="600">Expected %</text>
    <text x="${padL - 4}" y="${padT + 4}" text-anchor="end" font-size="9" fill="#94A3B8">100%</text>
    <text font-size="9" fill="#94A3B8" font-weight="600" text-anchor="middle"
      transform="rotate(-90) translate(${-(padT + plotH / 2)} ${padL - 26})">Actual %</text>
    <text x="${padL + plotW - 2}" y="${padT + 10}" text-anchor="end" font-size="8" fill="#94A3B8" font-style="italic">on track ↗</text>`;

  const empty = points.length === 0
    ? `<text x="${padL + plotW / 2}" y="${padT + plotH / 2 + 4}" text-anchor="middle" font-size="11" fill="#94A3B8">${
        todayWk < 0 ? 'Outside roadmap period' : 'No active tasks with timeline'
      }</text>`
    : '';

  return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
    <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#F8FAFC" rx="4"/>
    ${ahead}${behind}${grid}${diag}${dots.join('')}${empty}${axes}
  </svg>`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────
function renderDashboard() {
  const body    = document.getElementById('dashboard-body');
  const todayWk = currentWeekIndex();

  const atRisk  = allTasks.filter(t => computeRAG(t) === 'at_risk');
  const critical = allTasks.filter(t => computeRAG(t) === 'critical');
  const overdue  = allTasks.filter(t => {
    const be = parseInt(t.bar_end);
    return t.status !== 'done' && be >= 0 && todayWk >= 0 && be < todayWk;
  });
  const blocked  = allTasks.filter(t => t.status === 'blocked');

  // Donut: health-based segments
  const onTrack = allTasks.filter(t => computeRAG(t) === 'on_track');
  const doneAll = allTasks.filter(t => t.status === 'done');
  const pending = allTasks.filter(t => t.status === 'pending');
  const backlog = allTasks.filter(t => t.status === 'unscheduled');
  const total   = allTasks.length;

  const donutSegs = [
    { label: 'Done',     value: doneAll.length,  color: '#22C55E' },
    { label: 'On Track', value: onTrack.length,  color: '#3B82F6' },
    { label: 'At Risk',  value: atRisk.length,   color: '#F59E0B' },
    { label: 'Critical', value: critical.length, color: '#F43F5E' },
    { label: 'Pending',  value: pending.length,  color: '#94A3B8' },
    { label: 'Backlog',  value: backlog.length,  color: '#CBD5E1' },
  ];

  const legend = donutSegs.map(s => s.value > 0 ? `
    <div class="dash-legend-item">
      <span class="dash-legend-dot" style="background:${s.color}"></span>
      <span>${s.label}</span>
      <span class="dash-legend-count">${s.value}</span>
    </div>` : '').join('');

  let html = `
  <div class="dash-charts-row" style="grid-template-columns:minmax(220px,1fr) 2fr">
    <div class="dash-chart-card">
      <div class="dash-chart-title">Status Overview</div>
      <div class="dash-chart-sub">Health breakdown across all initiatives</div>
      <div class="dash-donut-wrap">
        ${buildDonutSVG(donutSegs, total)}
        <div class="dash-donut-legend">${legend}</div>
      </div>
    </div>
    <div class="dash-chart-card">
      <div class="dash-chart-title">Weekly Load</div>
      <div class="dash-chart-sub">Initiatives active per week — blue moderate · amber heavy · red overloaded</div>
      ${buildLoadSVG(allTasks, todayWk)}
    </div>
  </div>

  <div class="dash-charts-row">
    <div class="dash-chart-card">
      <div class="dash-chart-title">Team Health</div>
      <div class="dash-chart-sub">Sorted by highest risk first</div>
      <div class="heatmap-rows">${buildHeatmapHTML(allTeams, allTasks)}</div>
    </div>
    <div class="dash-chart-card">
      <div class="dash-chart-title">Progress vs Expected</div>
      <div class="dash-chart-sub">Green zone = ahead · red zone = behind · click any dot to edit</div>
      ${buildScatterSVG(allTasks, todayWk)}
      <div class="scatter-legend">
        <span><span class="rag-dot rag-on_track"></span>On Track</span>
        <span><span class="rag-dot rag-at_risk"></span>At Risk</span>
        <span><span class="rag-dot rag-critical"></span>Critical</span>
      </div>
    </div>
  </div>`;

  if (atRisk.length) {
    html += `<div class="dash-section"><div class="dash-section-title" style="color:#B45309">🟡 At Risk (${atRisk.length})</div><div class="dash-list">`;
    atRisk.forEach(t => {
      const be = parseInt(t.bar_end);
      const wl = (be >= 0 && todayWk >= 0) ? be - todayWk : null;
      html += `<div class="dash-list-item">
        <span class="rag-dot rag-at_risk"></span>
        <span class="dash-item-name">${t.initiative}</span>
        <span class="dash-item-meta">${t.team}${wl !== null ? ` · ${wl} wks left` : ''}</span>
        <button class="btn-edit" onclick="openModal(${t.id})" title="Edit">✎</button>
      </div>`;
    });
    html += `</div></div>`;
  }

  if (overdue.length) {
    html += `<div class="dash-section"><div class="dash-section-title dash-title-blocked">⚠ Overdue (${overdue.length})</div><div class="dash-list">`;
    overdue.forEach(t => {
      const wl = todayWk >= 0 ? todayWk - parseInt(t.bar_end) : 0;
      html += `<div class="dash-list-item">
        <span class="rag-dot rag-critical"></span>
        <span class="dash-item-name">${t.initiative}</span>
        <span class="dash-item-meta" style="color:#BE123C">${t.team} · ${wl} wks late</span>
        <button class="btn-edit" onclick="openModal(${t.id})" title="Edit">✎</button>
      </div>`;
    });
    html += `</div></div>`;
  }

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
  const statFilt = document.getElementById('filter-status').value;

  const filtered = allTasks.filter(t => {
    if (search && !t.initiative.toLowerCase().includes(search) &&
        !t.team.toLowerCase().includes(search) &&
        !(t.owner || '').toLowerCase().includes(search)) return false;
    if (filterProjects.length && !filterProjects.includes(t.team))  return false;
    if (filterDevs.length     && !filterDevs.includes(t.owner))     return false;
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
      || filterProjects.length || filterDevs.length
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
    ca.innerHTML = `<span class="cell-assignee-avatar" style="background:${teamColor}">${task.owner[0].toUpperCase()}</span>${task.owner}`; // ponytail: owner cell kept simple, at-risk shown on bar
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
    ${task.jira_key ? `<a class="jira-badge" href="${jiraDomain ? `https://${jiraDomain}/browse/${task.jira_key}` : '#'}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="flex-shrink:0">${task.jira_key}</a>` : ''}
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
    if (task.status === 'at_risk') {
      bar.classList.add('bar-collision');
      const risk = document.createElement('span');
      risk.className = 'at-risk-label';
      risk.textContent = '⚠ At Risk';
      bar.appendChild(risk);
    }
    bar.title = [task.initiative, task.target, task.dependencies].filter(Boolean).join('\n');
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

  // Target go live flag
  const td = parseInt(task.target_date);
  if (td >= 0 && td < NW) {
    const flag = document.createElement('div');
    const isLate = todayWk >= 0 && td < todayWk && task.status !== 'done';
    flag.className = 'target-flag';
    flag.textContent = '🚩';
    flag.style.left = `${td * 70 + 28}px`;
    flag.title = `Target go live: ${WEEKS[td]}${isLate ? ' ⚠ overdue' : ''}`;
    cb.appendChild(flag);
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
    syncMobilePicker(parseInt(t.bar_start), parseInt(t.bar_end));
    const tdSel = document.getElementById('f-target-date');
    if (tdSel) tdSel.value = parseInt(t.target_date) >= 0 ? parseInt(t.target_date) : -1;
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
    target_date:  parseInt(document.getElementById('f-target-date')?.value ?? '-1'),
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
  document.getElementById('dev-project').innerHTML += `<option value="${team.name}">${team.name}</option>`;
  rebuildProjectMultiSelect();
  rebuildFormProjectSelect();
}

function rebuildAllProjectDropdowns() {
  rebuildProjectMultiSelect();

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
// ── Mobile filter toggle ──────────────────────────────────────────────────
function toggleMobileFilters() {
  document.querySelector('.toolbar').classList.toggle('filters-open');
}

// ── Mobile bar picker (week selects) ─────────────────────────────────────
function buildMobileBarPicker() {
  const startSel = document.getElementById('bp-mobile-start');
  const endSel   = document.getElementById('bp-mobile-end');
  if (!startSel || !endSel) return;
  const base = '<option value="-1">— No date (Backlog) —</option>';
  const opts  = WEEKS.map((w, i) => `<option value="${i}">W${i + 1} · ${w}</option>`).join('');
  startSel.innerHTML = base + opts;
  endSel.innerHTML   = base + opts;
  // Also populate target date select
  const tdSel = document.getElementById('f-target-date');
  if (tdSel) tdSel.innerHTML = '<option value="-1">— No target date —</option>' + opts;
}

function updateMobilePicker() {
  const s = parseInt(document.getElementById('bp-mobile-start').value);
  const e = parseInt(document.getElementById('bp-mobile-end').value);
  if (s >= 0 && e >= 0) {
    const lo = Math.min(s, e), hi = Math.max(s, e);
    document.getElementById('bp-mobile-start').value = lo;
    document.getElementById('bp-mobile-end').value   = hi;
    document.getElementById('f-bar-start').value = lo;
    document.getElementById('f-bar-end').value   = hi;
    const hint = document.getElementById('mobile-bp-hint');
    if (hint) hint.textContent = `${WEEKS[lo]} – ${WEEKS[hi]}`;
    const statusSel = document.getElementById('f-status');
    if (statusSel && statusSel.value === 'unscheduled') statusSel.value = 'active';
  } else {
    document.getElementById('f-bar-start').value = -1;
    document.getElementById('f-bar-end').value   = -1;
    const hint = document.getElementById('mobile-bp-hint');
    if (hint) hint.textContent = 'No range selected — will go to Backlog';
  }
}

function syncMobilePicker(s, e) {
  const startSel = document.getElementById('bp-mobile-start');
  const endSel   = document.getElementById('bp-mobile-end');
  if (startSel) startSel.value = s >= 0 ? s : -1;
  if (endSel)   endSel.value   = e >= 0 ? e : -1;
  if (s >= 0 && e >= 0) {
    const hint = document.getElementById('mobile-bp-hint');
    if (hint) hint.textContent = `${WEEKS[s]} – ${WEEKS[e]}`;
  }
}

let bpDragging = false, bpStart = -1, bpEnd = -1, _bpMouseUpAdded = false, _bpTouchEndAdded = false;

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
    // Touch support
    cell.addEventListener('touchstart', ev => {
      ev.preventDefault();
      bpDragging = true; bpStart = bpEnd = wi; updateBP();
    }, { passive: false });
    cell.addEventListener('touchmove', ev => {
      ev.preventDefault();
      const t = ev.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.dataset.idx !== undefined) { bpEnd = parseInt(el.dataset.idx); updateBP(); }
    }, { passive: false });
    picker.appendChild(cell);
    const lbl = document.createElement('span');
    lbl.textContent = wi + 1;
    labels.appendChild(lbl);
  });

  if (!_bpMouseUpAdded) {
    document.addEventListener('mouseup', () => { bpDragging = false; });
    _bpMouseUpAdded = true;
  }
  if (!_bpTouchEndAdded) {
    document.addEventListener('touchend', () => { bpDragging = false; });
    _bpTouchEndAdded = true;
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
  syncMobilePicker(-1, -1);
  const hint = document.getElementById('mobile-bp-hint');
  if (hint) hint.textContent = 'No range selected — will go to Backlog';
  const tdSel = document.getElementById('f-target-date');
  if (tdSel) tdSel.value = -1;
}

boot();
