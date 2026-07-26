# AI Coding Agent Rules

## Core Rules

- Make minimal changes.
- Never refactor unrelated code.
- Preserve existing architecture.
- Reuse utilities before adding helpers.
- Do not introduce dependencies unless requested.
- Ask before changing more than 5 source files.
- Prefer existing patterns.
- Do not rename files without a clear reason.
- Keep commits focused.
- Avoid unnecessary formatting changes.

## Repository-Specific Rules

- Use `client/src/api.js` for new frontend API calls.
- Use route modules under `server/src/routes/` for new endpoints.
- Keep business logic out of `server/src/index.js`.
- Use `storage/storage.js` for reading/writing data and downloads.
- Use `normalize/normalize.js` for cleanup, URL normalization, and dedupe.
- Use `jobLogger()` for long-running backend workflows.
- Keep `data/<year>/` layout compatible with existing export/compare routes.
- Do not delete generated or stored data unless explicitly requested.
- Do not hardcode external service keys.
- Do not assume a database, auth layer, or test suite exists.

## Before Editing

- Read `AGENTS.md`, `ARCHITECTURE.md`, and the relevant file in `MODULES/`.
- Inspect nearby source before patching.
- Check package scripts before running commands.
- Use `rg` for targeted search.

## While Editing

- Keep changes scoped to the requested workflow.
- Preserve response shapes unless the user requests API changes.
- Update docs when behavior or API contracts change.
- Avoid broad style rewrites in JSX/CSS.
- Do not change app source when the task only asks for docs.

## Verification

- Run the smallest relevant command available.
- If no tests exist, say so clearly.
- For frontend changes, at least run `npm run build` when feasible.
- For backend changes, hit `/api/health` or run targeted manual checks when feasible.

