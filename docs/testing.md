# How to Test This Application

This project has a backend API, a React frontend dashboard, and supporting infrastructure such as PostgreSQL and Redis. The quickest way to validate the app is to run the project locally, start the services, and use the workspace scripts that are already configured.

## Prerequisites

- Node.js 20 or newer
- npm
- Docker + Docker Compose
- A terminal with access to the project root

## 1) Install dependencies

From the project root:

```bash
npm install
```

This installs the workspace packages defined in the root `package.json`.

## 2) Configure local environment files

Copy the example environment files before starting the app:

```bash
cp packages/backend/.env.example packages/backend/.env
cp packages/frontend/.env.example packages/frontend/.env
```

If needed, also copy the root or agent-client example files if you are testing the client component as well.

For local development, the defaults in the example files point to:

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:5173`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## 3) Start required infrastructure

Start the local database and Redis containers:

```bash
docker compose -f docker-compose.dev.yml up -d
```

This brings up the services required by the backend and WebSocket signaling flow.

## 4) Run database migrations and seed data

From the project root or inside the backend package:

```bash
npm run --workspace packages/backend migrate
npm run --workspace packages/backend seed:dev
```

The seed script adds development accounts such as:

- `admin@agentwatch.local` / `Admin123!`
- `manager@agentwatch.local` / `Manager123!`
- `support@agentwatch.local` / `Support123!`
- `agent@agentwatch.local` / `Agent123!`

## 5) Start the application

Start the backend in one terminal:

```bash
npm run --workspace packages/backend dev
```

Start the frontend in another terminal:

```bash
npm run --workspace packages/frontend dev
```

Then open:

```text
http://localhost:5173
```

## 6) Run the automated tests

The repository already defines backend test scripts, and the root `npm test` command delegates to the backend tests.

### Run the full backend test suite

```bash
npm test
```

Equivalent explicit command:

```bash
npm run --workspace packages/backend test
```

### Run a focused suite

```bash
npm run --workspace packages/backend test:auth
npm run --workspace packages/backend test:authz
npm run --workspace packages/backend test:security
```

### Run frontend validation checks

```bash
npm run --workspace packages/frontend type-check
npm run --workspace packages/frontend lint
```

### Run backend linting

```bash
npm run --workspace packages/backend lint
```

### Run a full build check

```bash
npm run build
```

This builds both the backend and frontend packages together.

## 7) Manual verification checklist

After starting the app, verify the following behaviors:

- The frontend loads without compile errors at `http://localhost:5173`
- The backend is responding on `http://localhost:4000`
- A user can sign in using a seeded demo account
- The dashboard displays data correctly after login
- Monitoring and access controls follow the expected role-based permissions
- Audit logs and session events are written without critical errors

## 8) Troubleshooting

### The backend will not connect to Postgres or Redis

Make sure Docker is running and the dev containers were started successfully:

```bash
docker compose -f docker-compose.dev.yml ps
```

### The app loads but login fails

Check that:

- the backend `.env` file exists
- the database has been migrated
- the demo users were seeded
- the backend is running on port 4000

### Frontend is blank or API calls fail

Check that:

- `packages/frontend/.env` contains the correct `VITE_API_URL`
- the backend is running and CORS is configured correctly
- the frontend dev server is listening on port 5173

### Test command hangs or fails

Run the suite again with a single worker to reduce concurrency issues:

```bash
npm run --workspace packages/backend test -- --runInBand
```

## Notes

- The current repository test coverage is primarily backend-focused.
- The backend test suite is the one currently wired into the root `npm test` script.
- Frontend validation is handled through TypeScript and ESLint rather than a dedicated Jest suite.

This project is designed for local validation before deployment, and the commands above are the supported workflow for development and QA checks.
