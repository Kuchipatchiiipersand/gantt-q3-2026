const API = '';   // same origin

const WEEKS = [
  'Jul 1–6','Jul 7–13','Jul 14–20','Jul 21–27','Jul 28–31',
  'Aug 4–10','Aug 11–17','Aug 18–24','Aug 25–31',
  'Sep 1–7','Sep 8–14','Sep 15–21','Sep 22–30'
];
const NW = WEEKS.length;

const STATUS_META = {
  active:      { label: 'Active',       cls: 's-active' },
  done:        { label: '✅ Done',      cls: 's-done' },
  blocked:     { label: '🔴 Blocked',   cls: 's-blocked' },
  pending:     { label: '⏳ Pending',   cls: 's-pending' },
  unscheduled: { label: 'Unscheduled',  cls: 's-unscheduled' },
};

let allTasks = [];
let allTeams = [];
let deleteTargetId = null;

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot() {
  buildWeekHeaders();
  await Promise.all([loadTeams(), loadTasks()]);
  populateTeamSelects();
  buildBarPicker();
  renderGantt();
}

function buildWeekHeaders() {
  const el = document.getElementById('week-headers');
  WEEKS.forEach(w => {
    const d = document.createElement('div');
    d.className = 'gh-week';
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

function populateTeamSelects() {
  const filterSel = document.getElementById('filter-team');
  const formSel   = document.getElementById('f-team');
  allTeams.forEach(t => {
    filterSel.innerHTML += `<option value="${t.name}">${t.name} (${t.owner})</option>`;
    formSel.innerHTML   += `<option value="${t.name}" data-owner="${t.owner}" data-color="${t.color}">${t.name} (${t.owner})</option>`;
  });
}

function updateOwner() {
  const sel = document.getElementById('f-team');
  const opt = sel.selectedOptions[0];
  if (opt && opt.dataset.owner) document.getElementById('f-owner').value = opt.dataset.owner;
}

// ── Render ────────────────────────────────────────────────────────────────
function renderGantt() {
  const search   = document.getElementById('search').value.toLowerCase();
  const teamFilt = document.getElementById('filter-team').value;
  const statFilt = document.getElementById('filter-status').value;
  const hideUnsc = document.getElementById('hide-unscheduled').checked;

  const filtered = allTasks.filter(t => {
    if (search && !t.initiative.toLowerCase().includes(search) && !t.team.toLowerCase().includes(search)) return false;
    if (teamFilt && t.team !== teamFilt) return false;
    if (statFilt && t.status !== statFilt) return false;
    if (hideUnsc && t.status === 'unscheduled') return false;
    return true;
  });

  // Group by team
  const byTeam = {};
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
    const color    = teamMeta ? teamMeta.color : '#455A64';

    // Team group header
    const gh = document.createElement('div');
    gh.className = 'team-group-header';
    gh.style.background = color;
    gh.textContent = `${teamName.toUpperCase()}  •  ${teamMeta?.owner || ''}`;
    body.appendChild(gh);

    tasks.forEach(task => {
      body.appendChild(buildTaskRow(task, color));
      totalRows++;
    });
  });

  if (totalRows === 0) {
    body.innerHTML = `<div class="empty-state"><h3>No initiatives found</h3><p>Try adjusting your filters or <button class="btn-add" style="display:inline;padding:4px 10px" onclick="openModal()">add a new one</button></p></div>`;
  }
}

function buildTaskRow(task, teamColor) {
  const row = document.createElement('div');
  row.className = 'task-row';

  // Team cell
  const ct = document.createElement('div');
  ct.className = 'cell-team';
  ct.textContent = task.owner || task.team;
  ct.title = task.team;
  row.appendChild(ct);

  // Initiative cell
  const ci = document.createElement('div');
  ci.className = 'cell-init';
  ci.innerHTML = `<span title="${task.outcome || task.initiative}">${task.initiative}</span>
    <div class="row-actions">
      <button class="btn-edit" title="Edit" onclick="openModal(${task.id})">✎</button>
      <button class="btn-del" title="Delete" onclick="openDelete(${task.id}, '${task.initiative.replace(/'/g,"\\'")}')">🗑</button>
    </div>`;
  row.appendChild(ci);

  // Status cell
  const cs = document.createElement('div');
  cs.className = 'cell-status';
  const sm = STATUS_META[task.status] || STATUS_META.active;
  const chip = document.createElement('span');
  chip.className = `status-chip ${sm.cls}`;
  chip.textContent = sm.label;
  chip.title = task.target || '';
  cs.appendChild(chip);
  row.appendChild(cs);

  // Bar area
  const cb = document.createElement('div');
  cb.className = 'cell-bars';

  // Week backgrounds
  WEEKS.forEach((_, wi) => {
    const bg = document.createElement('div');
    bg.className = `week-bg${wi % 2 === 1 ? ' alt' : ''}`;
    bg.style.left = `${wi * 72}px`;
    bg.style.width = '72px';
    cb.appendChild(bg);
  });
  cb.style.width = `${NW * 72}px`;

  const bs = parseInt(task.bar_start);
  const be = parseInt(task.bar_end);

  if (bs >= 0 && be >= 0 && be >= bs) {
    const bar = document.createElement('div');
    bar.className = 'bar' + (task.is_blocked && task.status !== 'done' ? ' striped' : '');
    bar.style.left   = `${bs * 72 + 3}px`;
    bar.style.width  = `${(be - bs + 1) * 72 - 6}px`;
    bar.style.background = task.bar_color || teamColor;
    bar.title = `${task.initiative}\n${task.target || ''}${task.dependencies ? '\nDeps: ' + task.dependencies : ''}`;
    bar.textContent = task.status === 'done' ? '✓' : '';
    bar.onclick = () => openModal(task.id);
    cb.appendChild(bar);
  } else if (task.status !== 'done') {
    const lbl = document.createElement('div');
    lbl.className = 'no-bar-label';
    lbl.textContent = task.status === 'unscheduled' ? '— unscheduled —' : task.target || '—';
    cb.appendChild(lbl);
  }

  row.appendChild(cb);
  return row;
}

// ── Add / Edit Modal ───────────────────────────────────────────────────────
function openModal(id = null) {
  const modal  = document.getElementById('modal');
  const form   = document.getElementById('task-form');
  const title  = document.getElementById('modal-title');

  form.reset();
  document.getElementById('task-id').value = '';
  resetBarPicker();

  if (id) {
    const t = allTasks.find(x => x.id === id);
    if (!t) return;
    title.textContent = 'Edit Initiative';
    document.getElementById('task-id').value      = t.id;
    document.getElementById('f-team').value        = t.team;
    document.getElementById('f-owner').value       = t.owner;
    document.getElementById('f-initiative').value  = t.initiative;
    document.getElementById('f-outcome').value     = t.outcome || '';
    document.getElementById('f-target').value      = t.target || '';
    document.getElementById('f-status').value      = t.status;
    document.getElementById('f-metric').value      = t.metric || '';
    document.getElementById('f-dependencies').value= t.dependencies || '';
    document.getElementById('f-bar-start').value   = t.bar_start;
    document.getElementById('f-bar-end').value     = t.bar_end;
    document.getElementById('f-bar-color').value   = t.bar_color || '#1565C0';
    setBarPickerRange(parseInt(t.bar_start), parseInt(t.bar_end));
  } else {
    title.textContent = 'Add Initiative';
  }

  modal.classList.add('open');
}

function closeModal()              { document.getElementById('modal').classList.remove('open'); }
function closeModalOutside(e)      { if (e.target === document.getElementById('modal')) closeModal(); }

async function saveTask(e) {
  e.preventDefault();
  const id = document.getElementById('task-id').value;
  const body = {
    team:         document.getElementById('f-team').value,
    owner:        document.getElementById('f-owner').value,
    initiative:   document.getElementById('f-initiative').value,
    outcome:      document.getElementById('f-outcome').value,
    target:       document.getElementById('f-target').value,
    status:       document.getElementById('f-status').value,
    metric:       document.getElementById('f-metric').value,
    dependencies: document.getElementById('f-dependencies').value,
    bar_start:    parseInt(document.getElementById('f-bar-start').value) || -1,
    bar_end:      parseInt(document.getElementById('f-bar-end').value)   || -1,
    bar_color:    document.getElementById('f-bar-color').value,
    is_blocked:   document.getElementById('f-status').value === 'blocked' ? 1 : 0,
  };

  const url    = id ? `${API}/api/tasks/${id}` : `${API}/api/tasks`;
  const method = id ? 'PUT' : 'POST';
  await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  closeModal();
  await loadTasks();
  renderGantt();
}

// ── Delete ─────────────────────────────────────────────────────────────────
function openDelete(id, name) {
  deleteTargetId = id;
  document.getElementById('delete-msg').textContent = `Delete "${name}"? This cannot be undone.`;
  document.getElementById('delete-modal').classList.add('open');
}
function closeDelete()             { document.getElementById('delete-modal').classList.remove('open'); deleteTargetId = null; }
function closeDeleteOutside(e)     { if (e.target === document.getElementById('delete-modal')) closeDelete(); }

async function confirmDelete() {
  if (!deleteTargetId) return;
  await fetch(`${API}/api/tasks/${deleteTargetId}`, { method: 'DELETE' });
  closeDelete();
  await loadTasks();
  renderGantt();
}

// ── Bar Picker ─────────────────────────────────────────────────────────────
let bpDragging = false, bpStart = -1, bpEnd = -1;

function buildBarPicker() {
  const picker = document.getElementById('bar-picker');
  const labels = document.getElementById('bar-labels');
  WEEKS.forEach((w, wi) => {
    const cell = document.createElement('div');
    cell.className = 'bp-week';
    cell.dataset.idx = wi;

    cell.addEventListener('mousedown', () => { bpDragging = true; bpStart = bpEnd = wi; updateBP(); });
    cell.addEventListener('mouseenter', () => { if (bpDragging) { bpEnd = wi; updateBP(); } });

    picker.appendChild(cell);

    const lbl = document.createElement('span');
    lbl.textContent = w.split('–')[0].trim();
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
}

// ── Init ──────────────────────────────────────────────────────────────────
boot();
