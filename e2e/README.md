# E2E Auth Smoke

This folder contains lightweight Playwright auth smoke tests.

## Commands

- List tests only (fast CI wiring check):

```bash
npm run test:e2e -- --list
```

- Run smoke suite:

```bash
npm run test:e2e
```

- Run headed for local debugging:

```bash
npm run test:e2e:headed
```

## Environment-Gated Test

`authenticated delete-account attempt smoke (optional env-gated)` is skipped unless:

- `E2E_TEST_EMAIL`
- `E2E_TEST_PASSWORD`

are both set.

Use a dedicated non-production test account for this flow.

## Base URL

By default Playwright targets:

- `http://127.0.0.1:3000`

Override with:

- `PLAYWRIGHT_BASE_URL`
