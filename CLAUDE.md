# HomeManager

Household manager: meals (with 3 Claude agents), budget, calendar/chores, linked accounts.

## Stack
- `backend/`: Python 3.14, FastAPI, Pydantic v2, SQLAlchemy 2 (sync, `Mapped[]` style), psycopg 3, PostgreSQL.
  Tables created with `Base.metadata.create_all` on startup (no Alembic yet).
- `frontend/`: Vite + React + TypeScript (strict), Tailwind v4, shadcn/ui, React Router. Vite proxies `/api` to `localhost:8000`.
- LLM: Anthropic Python SDK, model `claude-sonnet-5-5`, `ANTHROPIC_API_KEY` from env.
  `LLM_FAKE=1` makes agents return canned output (used by E2E only; unit tests inject a fake client).

## Layout
```
backend/app/main.py        app + router includes
backend/app/db.py          engine, SessionLocal, Base, get_db
backend/app/auth.py        hashing, JWT cookie, get_current_user, /api/auth
backend/app/<feature>.py   one module per feature: models + schemas + router (accounts, agents, meals, budget, calendar)
backend/tests/             pytest; conftest.py provides db, client, auth helpers
frontend/src/pages/        one file per page
frontend/src/lib/api.ts    fetch wrapper (credentials: "include", throws on !ok)
frontend/src/components/ui shadcn components (add via `npx shadcn@latest add <name>`)
frontend/e2e/              Playwright specs
```

## Conventions
- Auth: httpOnly `SameSite=Lax` cookie `session` holding a JWT (HS256, `JWT_SECRET` env). Login by username.
  Passwords hashed with argon2 (pwdlib). Passwords are never returned or displayed. The UI shows them masked.
- All routes under `/api`. Every non-auth route depends on `get_current_user`. Users only see their own rows
  or rows shared through an **accepted** link (`accounts.linked_user_ids(db, user)`).
- Money: `Numeric(12, 2)` / `Decimal`. Months are `"YYYY-MM"` strings. Dates are ISO `date`.
- Keep pure logic (summaries, recurrence, month grids) in plain functions and unit-test them directly.
- UI: monthly views as floating cards (shadcn `Card`, soft shadow, rounded-2xl) on the shared app shell.
  Use the design tokens in `frontend/src/index.css`. Don't hardcode colors.

## Commands
- Backend: `cd backend && .venv/bin/pytest -q` (local test DB: `postgresql+psycopg:///homemanager_test`, override with `TEST_DATABASE_URL`)
- Backend dev: `cd backend && .venv/bin/uvicorn app.main:app --reload`
- Frontend: `cd frontend && npm test` (vitest), `npm run build`, `npm run e2e` (Playwright, starts both servers)

## Workflow (every component)
TDD on its own branch `feat/<name>`: write failing tests, implement, all green locally
(`pytest`, `npm test`, `npm run build`, relevant e2e). Then open the PR with `gh pr create`, wait for
`gh pr checks --watch`, and squash-merge with `gh pr merge --squash --delete-branch`.
If main moved, rebase onto `origin/main`, re-run tests, and push with `--force-with-lease`.
