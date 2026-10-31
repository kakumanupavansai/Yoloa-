# Frontend tests

- `npm test` runs Vitest with at most two workers. This keeps the jsdom route transforms from contending for CPU/memory and causing timer-based async assertions to expire on modest development machines.
- The six existing skips are live PostgreSQL integration cases in `src/__tests__/integration.test.jsx`. They require an explicitly disposable E2E database and a running Django API. They stay skipped during ordinary unit runs so a routine test command cannot accidentally mutate the developer's main database. See the setup comments at the top of that test before enabling it.
- The worker limit does not change per-test timeouts. Keep assertions and cleanup bounded; do not raise global timeouts to conceal pending work.

The current default suite reports 98 passing tests and 6 skipped live integration tests (run 2026-10-31 with `npx vitest run --fileParallelism=false`). The skip count is intentional and does not include failures.
