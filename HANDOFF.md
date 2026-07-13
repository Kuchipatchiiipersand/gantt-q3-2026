# Handoff — gantt-q3-2026

A roadmap / Gantt app: initiatives on a weekly timeline, with Kanban, Dashboard,
and per-developer Workload views. Vanilla JS frontend + Express backend.

## Stack

- **Frontend:** plain HTML/CSS/JS in `public/` — no build step, no framework.
  - `public/index.html` — all markup incl. every modal shell
  - `public/app.js` — all app logic (~2300 lines, one file)
  - `public/style.css` — all styles
  - `public/login.html` — password gate
- **Backend:** `server.js` — Express, serves `public/` + JSON API.
- **DB:** Postgres in prod (`pg`), **SQLite fallback** locally via Node's built-in
  `node:sqlite` when `DATABASE_URL` is unset (writes `gantt.db` in repo root).
- Node **>= 22** required (uses `node:sqlite`).

## Run locally

```bash
npm install
node server.js                 # http://localhost:3000, SQLite, no auth
APP_PASSWORD=test123 node server.js   # with the login gate enabled
```

- **Auth** is disabled entirely unless `APP_PASSWORD` is set (see `server.js` top).
  When set, the login page posts it to `/api/login`; a signed cookie (5h sliding
  window) gates everything else. There is no user table — it's one shared password.
- First run seeds demo teams/developers/tasks (`seed()` in `server.js`), then
  `backfillDates()` runs the date migration (see below).

## Data model — READ THIS (bars are date-anchored)

Timeline bars are stored as **real calendar dates**, not week indices:
`tasks.bar_start_date` / `bar_end_date` / `target_date_date`, and
`subtasks.bar_start_date` / `bar_end_date` (all TEXT `YYYY-MM-DD`, NULL = unscheduled).

The **project window** (start/end months) lives **client-side only** in
`localStorage` (`cfg`, key `gantt-config`), edited via ⚙ Settings.

At render time the client converts each stored date into a **window-relative
week index** (`applyWindow()` in `app.js`), so changing the window in Settings
dynamically re-lays-out every bar. Tasks outside the window drop to Backlog;
partial overlaps clamp to the visible edge. `applyWindow()` runs after
`loadTasks()` and after any Settings change — never hardcode a month on the
render path.

- Legacy integer columns `bar_start`/`bar_end`/`target_date` still exist but are
  **vestigial** on the write path; the client sets them in-memory as the derived
  render indices. `backfillDates()` (server, `BAR_EPOCH = 2026-07-01`) is a
  one-time migration converting old July-anchored indices → dates.
- Helpers: client `dateToWin` / `winToDate` / `winRange` / `applyWindow`;
  server `weekEpochDate` / `backfillDates`.

## API (all under `/api`)

`GET/POST/PUT/DELETE /tasks`, `/subtasks`, `/teams`, `/developers`,
`GET/POST /settings`, `POST /jira/sync` (imports issues; start/duedate → bar dates),
`POST /login`, `POST /logout`, `GET /health`.

## Views (all in `app.js`)

- **Gantt** `renderGantt` — the timeline grid.
- **Kanban** `renderKanban` / `buildKanbanCard` — cards open a read-only detail
  popover (`openDetail`) on click; ✎ opens the full edit modal (`openModal`).
- **Dashboard** `renderDashboard` — donut, Weekly Load (`buildLoadSVG` +
  `showLoadTip` hover tooltip), Team Health heatmap (`buildHeatmapHTML`),
  Progress-vs-Expected scatter. List rows / scatter dots open `openDetail`.
- **Workload** `renderWorkload` (modal) — one card per developer, a chip per
  project they span, and their assigned initiatives **and subtasks** bucketed
  active / upcoming / backlog.

## Deploy

Two targets configured; both build from `main`.

- **Render** (`render.yaml`) — auto-deploys on push to `main`; provisions
  `DATABASE_URL` from a managed Postgres.
- **Fly** (`fly.toml`, app `gantt-q3-2026`, region `sin`, volume `gantt_data`)
  — manual: `fly auth login` then `fly deploy`. No GitHub Action wired up.
- Set `APP_PASSWORD` (and `DATABASE_URL` on Fly) as secrets in each platform.

Workflow used: feature branch → `gh pr create` → `gh pr merge --merge`.

## Recent changes (merged to main)

- **#1** Anchor timeline bars to real dates (the data-model change above).
- **#2** Kanban card detail popover + richer cards (RAG label, outcome, subtask preview).
- **#3** Dashboard Weekly-Load hover tooltip; Team Health grid alignment fix
  (rows use `display:contents` on a shared grid); Workload one-card-per-dev +
  subtask display.

## Known gaps / TODO

- **Fly deploy pending** — code is on `main`; Fly needs an interactive
  `fly auth login` then `fly deploy` (Render should already be live).
- Editing a task whose real range extends outside the current window will clamp
  it to the window edge on save (marked with a `ponytail:` note in `app.js`).
- No automated tests / CI. Verification so far is manual + node pipeline replays.
- Single shared password only; no per-user accounts or audit trail.
