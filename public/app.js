const API = '';

const WEEKS = [
  'Jul 1–6','Jul 7–13','Jul 14–20','Jul 21–27','Jul 28–31',
  'Aug 4–10','Aug 11–17','Aug 18–24','Aug 25–31',
  'Sep 1–7','Sep 8–14','Sep 15–21','Sep 22–30'
];
const NW = WEEKS.length;

const MONTHS = [
  { cls: 'jul', label: 'Jul', from: 0, to: 4  },
  { cls: 'aug', label: 'Aug', from: 5, to: 8  },
  { cls: 'sep', label: 'Sep', from: 9, to: 12 },
];

function weekMonth(i) {
  return MONTHS.find(m => i >= m.from && i <= m.to)?.cls ?? 'jul';
}

// Determine which week index "today" falls in (for workload view)
function currentWeekIndex() {
  const now = new Date();
  const m = now.getMonth() + 1, d = now.getDate(), y = now.getFullYear();
  if (y !== 2026) return 0;
  if (m === 7) { if(d<=6)return 0; if(d<=13)return 1; if(d<=20)return 2; if(d<=27)return 3; return 4; }
  if (m === 8) { if(d<=10)return 5; if(d<=17)return 6; if(d<=24)return 7; return 8; }
  if (m === 9) { if(d<=7)return 9; if(d<=14)return 10; if(d<=21)return 11; return 12; }
  return -1;
}

const STATUS_META = {
  active:      { label: 'Active',      cls: 's-active' },
  done:        { label: 'Done',        cls: 's-done' },
  blocked:     { label: 'Blocked',     cls: 's-blocked' },
  pending:     { label: 'Pending',     cls: 's-pending' },
  unscheduled: { label: 'Backlog',     cls: 's-unscheduled' },
};

let allTasks      = [];
let allTeams      = [];
let allDevelopers = [];
let deleteTargetId = null;

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot() {
  buildWeekHeaders();
  await Promise.all([loadTeams(), loadTasks(), loadDevelopers()]);
  populateProjectSelects();
  buildBarPicker();
  renderGantt();
}

function buildWeekHeaders() {
  const el = document.getElementById('week-headers');
  WEEKS.forEach((w, i) => {
    const d = document.createElement('div');
    d.className = `gh-week ${weekMonth(i)}`;
    d.textContent = w;
    el.appendChild(d);
  });
}

async function loadTasks()      { const r = await fetch(`${API}/api/tasks`);      allTasks      = await r.json(); }
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
      body.appendChild(buildTaskRow(task, color));
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
        body.appendChild(buildTaskRow(task, color));
        totalRows++;
      });
    });
  }

  if (totalRows === 0 && backlog.length === 0) {
    body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <h3>No initiatives found</h3>
      <p>Try adjusting your filters or add a new initiative.</p>
    </div>`;
  }

  const statsEl = document.getElementById('toolbar-stats');
  if (statsEl) {
    const blocked = filtered.filter(t => t.status === 'blocked').length;
    statsEl.textContent = `${filtered.length} total${blocked ? ` · ${blocked} blocked` : ''}`;
  }
}

function buildTaskRow(task, teamColor) {
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

  // Initiative cell
  const ci = document.createElement('div');
  ci.className = 'cell-init';
  const safeTitle = (task.outcome || task.initiative).replace(/"/g, '&quot;');
  const safeName  = task.initiative.replace(/'/g, "\\'");
  ci.innerHTML = `
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
  cs.innerHTML = `<span class="status-chip ${sm.cls}" title="${task.target || ''}">
    <span class="chip-dot"></span>${sm.label}
  </span>`;
  row.appendChild(cs);

  // Bar area
  const cb = document.createElement('div');
  cb.className = 'cell-bars';
  cb.style.width = `${NW * 70}px`;

  WEEKS.forEach((_, wi) => {
    const mth   = weekMonth(wi);
    const local = wi - MONTHS.find(m => m.cls === mth).from;
    const bg = document.createElement('div');
    bg.className = `week-bg ${mth}${local % 2 === 1 ? ' alt' : ''}`;
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
  if (bs >= 0 && be >= 0 && be >= bs) {
    const bar = document.createElement('div');
    bar.className = 'bar'
      + (task.is_blocked && task.status !== 'done' ? ' striped' : '')
      + (task.status === 'done' ? ' done-bar' : '');
    bar.style.left       = `${bs * 70 + 4}px`;
    bar.style.width      = `${(be - bs + 1) * 70 - 8}px`;
    bar.style.background = task.bar_color || teamColor;
    bar.title            = [task.initiative, task.target, task.dependencies].filter(Boolean).join('\n');
    bar.textContent      = task.status === 'done' ? '✓' : '';
    bar.onclick          = () => openModal(task.id);
    cb.appendChild(bar);
  } else {
    const lbl = document.createElement('div');
    lbl.className   = 'no-bar-label';
    lbl.textContent = task.target || '—';
    cb.appendChild(lbl);
  }

  row.appendChild(cb);
  return row;
}

// ── Add / Edit Modal ───────────────────────────────────────────────────────
function openModal(id = null) {
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
    rebuildOwnerDropdown(t.team, t.owner);
    setBarPickerRange(parseInt(t.bar_start), parseInt(t.bar_end));
  } else {
    document.getElementById('modal-title').textContent     = 'Add Initiative';
    document.getElementById('modal-sub').textContent       = 'Fill in the details. Leave timeline empty to add to Backlog.';
    document.getElementById('form-submit-btn').textContent = 'Save Initiative';
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
    metric:       document.getElementById('f-metric').value,
    dependencies: document.getElementById('f-dependencies').value,
    bar_start:    parseInt(document.getElementById('f-bar-start').value),
    bar_end:      parseInt(document.getElementById('f-bar-end').value),
    bar_color:    document.getElementById('f-bar-color').value,
    is_blocked:   document.getElementById('f-status').value === 'blocked' ? 1 : 0,
  };
  const btn = document.getElementById('form-submit-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const url = id ? `${API}/api/tasks/${id}` : `${API}/api/tasks`;
  await fetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  btn.disabled = false;
  closeModal();
  await loadTasks();
  renderGantt();
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
  await fetch(`${API}/api/tasks/${deleteTargetId}`, { method: 'DELETE' });
  closeDelete();
  await loadTasks();
  renderGantt();
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
          ${t.owner ? `<div class="dev-sub">Lead: ${t.owner}</div>` : ''}
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
  document.getElementById('proj-lead').value        = t.owner || '';
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
  document.getElementById('proj-lead').value                  = '';
  document.getElementById('proj-form-title').textContent      = 'Add Project';
  document.getElementById('proj-submit-btn').textContent      = 'Add';
  document.getElementById('proj-cancel-edit').style.display   = 'none';
  document.getElementById('proj-add-error').style.display     = 'none';
  selectColorSwatch(PROJECT_COLORS[0]);
}

async function submitProject() {
  const editingId = document.getElementById('proj-editing-id').value;
  const name   = document.getElementById('proj-name').value.trim();
  const owner  = document.getElementById('proj-lead').value.trim();
  const errEl  = document.getElementById('proj-add-error');
  errEl.style.display = 'none';
  if (!name) { showProjError('Please enter a project name.'); return; }

  const url    = editingId ? `${API}/api/teams/${editingId}` : `${API}/api/teams`;
  const method = editingId ? 'PUT' : 'POST';
  const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, owner, color: selectedProjColor }) });
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
let bpDragging = false, bpStart = -1, bpEnd = -1;

function buildBarPicker() {
  const picker      = document.getElementById('bar-picker');
  const labels      = document.getElementById('bar-labels');
  const monthLabels = document.getElementById('bar-month-labels');

  MONTHS.forEach(m => {
    const el = document.createElement('div');
    el.className = 'bar-month-label';
    el.style.flex = String(m.to - m.from + 1);
    el.textContent = m.label;
    monthLabels.appendChild(el);
  });

  WEEKS.forEach((w, wi) => {
    const cell = document.createElement('div');
    cell.className = 'bp-week';
    cell.dataset.idx = wi;
    const mth = weekMonth(wi);
    cell.style.background = mth === 'jul' ? 'rgba(239,246,255,.7)' : mth === 'aug' ? 'rgba(245,243,255,.7)' : 'rgba(240,253,244,.7)';
    cell.addEventListener('mousedown', ev => { ev.preventDefault(); bpDragging = true; bpStart = bpEnd = wi; updateBP(); });
    cell.addEventListener('mouseenter', () => { if (bpDragging) { bpEnd = wi; updateBP(); } });
    picker.appendChild(cell);
    const lbl = document.createElement('span');
    lbl.textContent = wi + 1;
    labels.appendChild(lbl);
  });

  document.addEventListener('mouseup', () => { bpDragging = false; });
}

function updateBP() {
  const lo = Math.min(bpStart, bpEnd), hi = Math.max(bpStart, bpEnd);
  document.querySelectorAll('.bp-week').forEach((c, i) => c.classList.toggle('selected', i >= lo && i <= hi));
  document.getElementById('f-bar-start').value = lo;
  document.getElementById('f-bar-end').value   = hi;
  const sel = document.getElementById('bp-selection');
  if (sel) sel.textContent = `${WEEKS[lo].split('–')[0].trim()} – ${WEEKS[hi]}`;
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
