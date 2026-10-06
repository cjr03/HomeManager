# HomeManager

Household manager: meals, budget, calendar and chores. FastAPI + PostgreSQL backend, React + shadcn/ui frontend.

## Setup

Requires Python 3.14, Node 24+ and a local PostgreSQL.

```sh
createdb homemanager && createdb homemanager_test && createdb homemanager_e2e

python3.14 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

cd frontend && npm install && npx playwright install chromium
```

Environment (defaults in parentheses):

- `DATABASE_URL` (`postgresql+psycopg:///homemanager`)
- `TEST_DATABASE_URL` (`postgresql+psycopg:///homemanager_test`), `E2E_DATABASE_URL` (`postgresql+psycopg:///homemanager_e2e`)
- `JWT_SECRET` (signs session cookies; falls back to a hard-coded dev secret when unset, so always set it outside local dev)
- `COOKIE_SECURE=1` marks the session cookie `Secure` (set it when served over HTTPS)
- `ANTHROPIC_API_KEY`; `LLM_FAKE=1` returns canned agent output

## Run

```sh
cd backend && .venv/bin/uvicorn app.main:app --reload   # http://localhost:8000
cd frontend && npm run dev                               # http://localhost:5173 (proxies /api)
```

## Test

```sh
cd backend && .venv/bin/pytest --cov=app   # unit + API integration
cd frontend && npm run lint && npm test     # typecheck + vitest
cd frontend && npm run build
cd frontend && npm run e2e                  # Playwright; starts both servers
```

CI (`.github/workflows/ci.yml`) runs the `backend`, `frontend` and `e2e` jobs on every pull request and push to `main`.
