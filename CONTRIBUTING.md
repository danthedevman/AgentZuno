# Contributing to AgentZuno

Start with the [getting started guide](docs/getting-started.md) and the [roles and features guide](docs/roles-and-features.md). The latter explains what Admins, Agents, Users, and Read Only users can do. Follow [AGENTS.md](AGENTS.md) when changing code or documentation.

Keep pull requests focused on one problem. Explain the resulting behavior, include reproduction steps for fixes, and describe how you verified the change. Screenshots help reviewers assess visual changes on desktop and mobile.

AI-assisted contributions are welcome. Review the generated code, understand its behavior, and test it before submitting. Never include real credentials, customer records, or private conversation content in issues or test fixtures.

Run formatting, the production build, and relevant behavioral tests. Changes to persisted data must work with both MongoDB and PostgreSQL; skipped database tests do not verify compatibility. See [testing](docs/testing.md) for browser checks. Use fictional records when demonstrating access or permission problems.

Report suspected vulnerabilities through the process in [SECURITY.md](SECURITY.md), rather than posting exploit details in a public issue.
