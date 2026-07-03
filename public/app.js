const API = '';

const WEEKS = [
  'Jul 1–6','Jul 7–13','Jul 14–20','Jul 21–27','Jul 28–31',
  'Aug 4–10','Aug 11–17','Aug 18–24','Aug 25–31',
  'Sep 1–7','Sep 8–14','Sep 15–21','Sep 22–30'
];
const NW = WEEKS.length;

const MONTHS = [
  { cls: 'jul', from: 0, to: 4  },
  { cls: 'aug', from: 5, to: 8  },
  { cls: 'sep', from: 9, to: 12 },
];

function weekMonth(i) {
  return MONTHS.find(m => i >= m.from && i <= m.to)?.cls ?? 'jul';
}

const STATUS_META = {
  active:      { label: 'Active',      cls: 's-active' },
  done:        { label: 'Done',        cls: 's-done' },
  blocked:     { label: 'Blocked',     cls: 's-blocked' },
  pending:     { label: 'Pending',     cls: 's-pending' },
  unscheduled: { label: 'Unscheduled', cls: 's-unscheduled' },
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

async function loadTasks() {
  const res = await fetch(`${API}/api/tasks`);
  allTasks = await res.json();
}

async function loadTeams() {
  const res = await fetch(`${API}/api/teams`);
  allTeams = await res.json();
}

async function loadDevelopers() {
  const res = await fetch(`${API}/api/developers`);
  allDevelopers = await res.json();
}

function populateProjectSelects() {
  const filterSel  = document.getElementById('filter-project');
  const formSel    = document.getElementById('f-team');
  const devProjSel = document.getElementById('dev-project');

  allTeams.forEach(t => {
    filterSel.innerHTML  += `<option value="${t.name}">${t.name}</option>`;
    formSel.innerHTML    += `<option value="${t.name}" data-color="${t.color}">${t.name}</option>`;
    devProjSel.innerHTML += `<option value="${t.name}">${t.name}</option>`;
  });
}

// Called when the project dropdown changes in the task form
function onProjectChange() {
  const sel   = document.getElementById('f-team');
  const opt   = sel.selectedOptions[0];
  if (opt && opt.dataset.color) {
    document.getElementById('f-bar-color').value = opt.dataset.color;
  }
  rebuildOwnerDropdown(sel.value, '');
}

function rebuildOwnerDropdown(projectName, currentOwner) {
  const sel  = document.getElementById('f-owner');
  const devs = projectName
    ? allDevelopers.filter(d => d.project === projectName)
    : allDevelopers;

  sel.innerHTML = '<option value="">Select developer...</option>';

  // If the current owner is not in the developer list, add it as a legacy option
  if (currentOwner && currentOwner !== '' && !devs.find(d => d.name === currentOwner)) {
    sel.innerHTML += `<option value="${currentOwner}">${currentOwner}</option>`;
  }

  devs.forEach(d => {
    sel.innerHTML += `<option value="${d.name}">${d.name}</option>`;
  });

  sel.value = currentOwner || '';
}

// ── Render ────────────────────────────────────────────────────────────────
function renderGantt() {
  const search   = document.getElementById('search').value.toLowerCase();
  const projFilt = document.getElementById('filter-project').value;
  const statFilt = document.getElementById('filter-status').value;
  const hideUnsc = document.getElementById('hide-unscheduled').checked;

  const filtered = allTasks.filter(t => {
    if (search && !t.initiative.toLowerCase().includes(search) &&
        !t.team.toLowerCase().includes(search) &&
        !t.owner.toLowerCase().includes(search)) return false;
    if (projFilt && t.team !== projFilt) return false;
    if (statFilt && t.status !== statFilt) return false;
    if (hideUnsc && t.status === 'unscheduled') return false;
    return true;
  });

  const byTeam    = {};
  const teamOrder = allTeams.map(t => t.name);
  teamOrder.forEach(name => { byTeam[name] = []; });
  filtered.forEach(t => { if (byTeam[t.team]) byTeam[t.team].push(t); });

  const body = document.getElementById('gantt-body');
  body.innerHTML = '';

  let totalRows = 0;
  teamOrder.forEach(teamName => {
    const tasks = byTeam[teamName];
    if (!tasks || tasks.length === 0) return;

    const teamMeta = allTeams.find(t => t.name === teamName);
    const color    = teamMeta ? teamMeta.color : '#64748B';

    const gh = document.createElement('div');
    gh.className = 'team-group-header';
    gh.style.borderLeft = `4px solid ${color}`;
    gh.innerHTML = `
      <div class="tgh-dot" style="background:${color}"></div>
      <span class="tgh-name">${teamName}</span>
      <span class="tgh-owner">${teamMeta?.owner || ''}</span>
      <span class="tgh-count">${tasks.length}</span>`;
    body.appendChild(gh);

    tasks.forEach(task => {
      body.appendChild(buildTaskRow(task, color));
      totalRows++;
    });
  });

  if (totalRows === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <h3>No initiatives found</h3>
        <p>Try adjusting your filters or add a new initiative.</p>
      </div>`;
  }

  const statsEl = document.getElementById('toolbar-stats');
  if (statsEl) {
    const blocked = filtered.filter(t => t.status === 'blocked').length;
    statsEl.textContent = `${totalRows} initiatives${blocked ? ` · ${blocked} blocked` : ''}`;
  }
}

function buildTaskRow(task, teamColor) {
  const row = document.createElement('div');
  row.className = 'task-row';

  // Developer / owner cell
  const ct = document.createElement('div');
  ct.className = 'cell-team';
  ct.textContent = task.owner || '—';
  ct.title = task.team;
  row.appendChild(ct);

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

  const bs = parseInt(task.bar_start);
  const be = parseInt(task.bar_end);

  if (bs >= 0 && be >= 0 && be >= bs) {
    const bar = document.createElement('div');
    const isBlocked = task.is_blocked && task.status !== 'done';
    bar.className   = 'bar' + (isBlocked ? ' striped' : '') + (task.status === 'done' ? ' done-bar' : '');
    bar.style.left       = `${bs * 70 + 4}px`;
    bar.style.width      = `${(be - bs + 1) * 70 - 8}px`;
    bar.style.background = task.bar_color || teamColor;
    bar.title       = [task.initiative, task.target, task.dependencies].filter(Boolean).join('\n');
    bar.textContent = task.status === 'done' ? '✓' : '';
    bar.onclick     = () => openModal(task.id);
    cb.appendChild(bar);
  } else if (task.status !== 'done') {
    const lbl = document.createElement('div');
    lbl.className   = 'no-bar-label';
    lbl.textContent = task.status === 'unscheduled' ? '— unscheduled —' : (task.target || '—');
    cb.appendChild(lbl);
  }

  row.appendChild(cb);
  return row;
}

// ── Add / Edit Modal ───────────────────────────────────────────────────────
function openModal(id = null) {
  const modal = document.getElementById('modal');
  const form  = document.getElementById('task-form');

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
    document.getElementById('modal-sub').textContent       = 'Fill in the details for this initiative.';
    document.getElementById('form-submit-btn').textContent = 'Save Initiative';
  }

  modal.classList.add('open');
}

function closeModal()         { document.getElementById('modal').classList.remove('open'); }
function closeModalOutside(e) { if (e.target === document.getElementById('modal')) closeModal(); }

async function saveTask(e) {
  e.preventDefault();
  const id   = document.getElementById('task-id').value;
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

  const url    = id ? `${API}/api/tasks/${id}` : `${API}/api/tasks`;
  const method = id ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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

// ── Manage Modal (Projects + Developers) ──────────────────────────────────
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
// Keep old alias so existing code that calls openDevModal still works
function openDevModal() { openManageModal('developers'); }

function closeDevModal()          { document.getElementById('dev-modal').classList.remove('open'); }
function closeDevModalOutside(e)  { if (e.target === document.getElementById('dev-modal')) closeDevModal(); }

function switchTab(tab) {
  ['projects','developers'].forEach(t => {
    document.getElementById(`tab-btn-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
  });
}

// ── Color swatches ─────────────────────────────────────────────────────────
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

// ── Project management ─────────────────────────────────────────────────────
function renderProjectList() {
  const el = document.getElementById('proj-list');
  if (!allTeams.length) {
    el.innerHTML = '<div class="dev-list-empty">No projects yet.</div>';
    return;
  }
  el.innerHTML = allTeams.map(t => `
    <div class="dev-list-item">
      <span class="dev-avatar" style="background:${t.color}">${t.name[0]}</span>
      <div style="flex:1">
        <div class="dev-name">${t.name}</div>
        ${t.owner ? `<div class="dev-sub">Lead: ${t.owner}</div>` : ''}
      </div>
      <button class="btn-del-sm" title="Delete project" onclick="deleteProject(${t.id}, '${t.name.replace(/'/g,"\\'")}')">✕</button>
    </div>`).join('');
}

function projEnterKey(e) { if (e.key === 'Enter') { e.preventDefault(); addProject(); } }

async function addProject() {
  const name  = document.getElementById('proj-name').value.trim();
  const owner = document.getElementById('proj-lead').value.trim();
  const errEl = document.getElementById('proj-add-error');
  errEl.style.display = 'none';

  if (!name) { showProjError('Please enter a project name.'); return; }

  const res  = await fetch(`${API}/api/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, owner, color: selectedProjColor }),
  });
  const data = await res.json();
  if (!res.ok) { showProjError(data.error || 'Could not add project.'); return; }

  allTeams.push(data);
  document.getElementById('proj-name').value = '';
  document.getElementById('proj-lead').value = '';

  // Add to all project dropdowns
  appendProjectToSelects(data);
  renderProjectList();
}

async function deleteProject(id, name) {
  const errEl = document.getElementById('proj-add-error');
  errEl.style.display = 'none';
  const res  = await fetch(`${API}/api/teams/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { showProjError(data.error); return; }
  allTeams = allTeams.filter(t => t.id !== id);
  // Remove from dropdowns
  ['filter-project','f-team','dev-project'].forEach(selId => {
    const opt = document.querySelector(`#${selId} option[value="${name}"]`);
    if (opt) opt.remove();
  });
  renderProjectList();
}

function showProjError(msg) {
  const el = document.getElementById('proj-add-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

function appendProjectToSelects(team) {
  document.getElementById('filter-project').innerHTML += `<option value="${team.name}">${team.name}</option>`;
  document.getElementById('f-team').innerHTML         += `<option value="${team.name}" data-color="${team.color}">${team.name}</option>`;
  document.getElementById('dev-project').innerHTML    += `<option value="${team.name}">${team.name}</option>`;
}

// ── Developer management ───────────────────────────────────────────────────
function devEnterKey(e) { if (e.key === 'Enter') { e.preventDefault(); addDeveloper(); } }

function renderDevList() {
  const el = document.getElementById('dev-list');
  if (!allDevelopers.length) {
    el.innerHTML = '<div class="dev-list-empty">No developers yet. Add one above.</div>';
    return;
  }
  const grouped = {};
  allTeams.forEach(t => { grouped[t.name] = []; });
  allDevelopers.forEach(d => {
    if (!grouped[d.project]) grouped[d.project] = [];
    grouped[d.project].push(d);
  });

  let html = '';
  allTeams.forEach(t => {
    const devs = grouped[t.name] || [];
    if (!devs.length) return;
    html += `<div class="dev-list-group">
      <div class="dev-list-group-header">
        <span class="dev-group-dot" style="background:${t.color}"></span>
        ${t.name}
        <span class="tgh-count">${devs.length}</span>
      </div>`;
    devs.forEach(d => {
      html += `<div class="dev-list-item">
        <span class="dev-avatar">${d.name[0].toUpperCase()}</span>
        <span class="dev-name">${d.name}</span>
        <button class="btn-del-sm" title="Remove" onclick="deleteDeveloper(${d.id})">✕</button>
      </div>`;
    });
    html += '</div>';
  });

  el.innerHTML = html || '<div class="dev-list-empty">No developers yet.</div>';
}

async function addDeveloper() {
  const name    = document.getElementById('dev-name').value.trim();
  const project = document.getElementById('dev-project').value;
  const errEl   = document.getElementById('dev-add-error');
  errEl.style.display = 'none';

  if (!name)    { showDevError('Please enter a developer name.'); return; }
  if (!project) { showDevError('Please select a project.'); return; }

  const res  = await fetch(`${API}/api/developers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, project }),
  });
  const data = await res.json();
  if (!res.ok) { showDevError(data.error || 'Could not add developer.'); return; }

  allDevelopers.push(data);
  allDevelopers.sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name));
  document.getElementById('dev-name').value    = '';
  document.getElementById('dev-project').value = '';
  renderDevList();
}

async function deleteDeveloper(id) {
  await fetch(`${API}/api/developers/${id}`, { method: 'DELETE' });
  allDevelopers = allDevelopers.filter(d => d.id !== id);
  renderDevList();
}

function showDevError(msg) {
  const el = document.getElementById('dev-add-error');
  el.textContent   = msg;
  el.style.display = 'block';
}

// ── Bar Picker ─────────────────────────────────────────────────────────────
let bpDragging = false, bpStart = -1, bpEnd = -1;

function buildBarPicker() {
  const picker      = document.getElementById('bar-picker');
  const labels      = document.getElementById('bar-labels');
  const monthLabels = document.getElementById('bar-month-labels');

  MONTHS.forEach(m => {
    const count = m.to - m.from + 1;
    const el = document.createElement('div');
    el.className = 'bar-month-label';
    el.style.flex = String(count);
    el.textContent = m.cls === 'jul' ? 'Jul' : m.cls === 'aug' ? 'Aug' : 'Sep';
    monthLabels.appendChild(el);
  });

  WEEKS.forEach((w, wi) => {
    const cell = document.createElement('div');
    cell.className = 'bp-week';
    cell.dataset.idx = wi;
    const mth = weekMonth(wi);
    cell.style.background = mth === 'jul'
      ? 'rgba(239,246,255,.7)' : mth === 'aug'
        ? 'rgba(245,243,255,.7)' : 'rgba(240,253,244,.7)';

    cell.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      bpDragging = true; bpStart = bpEnd = wi; updateBP();
    });
    cell.addEventListener('mouseenter', () => { if (bpDragging) { bpEnd = wi; updateBP(); } });
    picker.appendChild(cell);

    const lbl = document.createElement('span');
    lbl.textContent = wi + 1;
    labels.appendChild(lbl);
  });

  document.addEventListener('mouseup', () => { bpDragging = false; });
}

function updateBP() {
  const lo = Math.min(bpStart, bpEnd);
  const hi = Math.max(bpStart, bpEnd);
  document.querySelectorAll('.bp-week').forEach((c, i) => {
    c.classList.toggle('selected', i >= lo && i <= hi);
  });
  document.getElementById('f-bar-start').value = lo;
  document.getElementById('f-bar-end').value   = hi;
  const selEl = document.getElementById('bp-selection');
  if (selEl) selEl.textContent = `${WEEKS[lo].split('–')[0].trim()} – ${WEEKS[hi]}`;
}

function setBarPickerRange(s, e) {
  if (s < 0 || e < 0) return;
  bpStart = s; bpEnd = e;
  updateBP();
}

function resetBarPicker() {
  bpStart = -1; bpEnd = -1;
  document.querySelectorAll('.bp-week').forEach(c => c.classList.remove('selected'));
  document.getElementById('f-bar-start').value = -1;
  document.getElementById('f-bar-end').value   = -1;
  const selEl = document.getElementById('bp-selection');
  if (selEl) selEl.textContent = 'No range selected';
}

// ── Init ──────────────────────────────────────────────────────────────────
boot();
