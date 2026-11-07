# Testing changes

Use the [roles and features guide](roles-and-features.md) to identify which Admin, Agent, User, and Read Only journeys your change affects. Test API authorization as well as the visible controls.

Install project dependencies with `npm ci` and `npm --prefix api ci`. Run `npm run format:check`, `npm run build`, and `npm run test:ui`. The API suite runs with `npm --prefix api test` and limits concurrent test files to two to bound database connection use; database coverage also requires the MongoDB and PostgreSQL test connections described in the repository's database CI workflow. Do not treat skipped database tests as passing adapter coverage.

## Browser regressions

Install [Playwright](https://playwright.dev/docs/intro)'s Chromium browser with `npx playwright install chromium`. After `npm run build`, run `npm run test:browser`.

The desktop and mobile checks run serially with a ten-minute total budget and a 30-second limit per test. A suite timeout can interrupt a passing test; inspect the report's global errors before treating the last open test as the cause.

The browser suite starts an isolated in-memory API on port 4181 and a web preview on port 4180. These ports must be free. It never reuses a running application server, connects to your database, or calls a live AI provider. Tests use a fictional signed-in workspace seeded through the ordinary Settings demo-data API. Authentication is a test-only cookie fixture in the isolated server, not an application login method.

Desktop and phone checks cover startup routing, article creation with base context, conversation headers, profile layout, and navigation controls. Desktop checks also open a submitted request and a workflow visual. The setup-routing check supplies a setup-required status response; it does not provision a real database. Authentication, persistence, and database isolation still require their API tests.

On failure, inspect `playwright-report/index.html` with `npx playwright show-report`. Screenshots and traces are retained for failed tests. GitHub Actions uploads these artifacts when the browser step fails. Use only fictional test content so artifacts do not expose private information.

Run `npm run test:marketing` for the production marketing build. It builds with `VITE_STATIC_SITE=true` and starts a separate preview on port 4191. Desktop and phone checks cover animation startup after load and refresh, panel switching, article expansion, preserved prerendered headings, and reduced motion. The prerenderer and browser must render the same `PublicApp` component tree so hydration attaches interactive behavior to the visible elements. This suite replaces `dist` with the static build; run `npm run build` afterward to restore the self-hosted build.

For native database restore drills and upgrade rehearsals, see [recovery](recovery.md). For the disposable employee request-list benchmark, see [capacity testing](capacity.md).
