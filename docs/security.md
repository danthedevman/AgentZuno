# Security and current limits

Admins manage configuration and published workflows. Agents work on permitted support records, Users submit and follow their requests, and Read Only users inspect permitted records without changing them. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

AgentZuno is an actively developed project. These controls describe implemented behavior and intended boundaries, not a security certification or a substitute for independent review.

## Implemented boundaries

- Authenticated workspace access, server-side role and record checks, and authoritative session impersonation.
- Salted scrypt password hashes, hashed session tokens, HttpOnly/SameSite cookies, and write-origin checks.
- Encrypted provider, connector, identity, and SMTP credentials; shared server/worker encryption configuration.
- Separate Admin and support capabilities, bounded sandbox execution, declared workflow action grants, and approval eligibility checks.
- Intersecting authored knowledge permissions and separate permission checks for retained source imports.
- Sanitized authored article HTML and chat Markdown, scoped binary reads, validated references, and bounded uploads.
- Durable governance records for API activity and database writes, with credentials and private payloads excluded from audit content.

## Limits to account for

- Public deployment requires HTTPS, secure cookies, service hardening, backups, and network restrictions; the default Compose stack does not provide all production protections.
- Email verification and password recovery are not implemented.
- A native Teams bot and ServiceNow/Jira workflow actions are not implemented.
- Authored knowledge uses local Ollama embeddings and a separate Qdrant collection, combined with MongoDB keyword retrieval. Vector matches are candidates only; current publication, generation, workspace and base/topic/article permissions are rechecked. Local index outages fall back to authorized keyword retrieval. The semantic candidate scan is bounded to 2,000 indexed articles per workspace; larger workspaces currently use keyword retrieval until this limit is expanded.
- Background jobs and external workflow actions do not guarantee exactly-once delivery.
- Deleting requests or articles does not erase retained governance/run history, backups, or previously saved conversation messages. Do not treat this action as a complete privacy-erasure mechanism.
- Audit records are not cryptographically tamper-proof against privileged database access.

## Reporting a concern

Keep access tokens, private records, credentials, and exploitable details out of public issues. Arrange a private reporting channel with the maintainer. Rotate exposed credentials; removing them from the latest commit alone is insufficient.

Before distributing or deploying, review dependencies and licenses, scan the complete repository history for secrets, and test cross-workspace access, role changes, identity mapping, uploads, OAuth, and workflow execution. GitHub's security tools help find classes of problems; they do not verify the app's organizational permission model.

## Request limits and input validation

Every API route has an IP-based budget of 3,000 requests per minute. Database setup, identity login, OAuth initiation, domain verification, SMTP testing, and knowledge/attachment reads have tighter route budgets. A blocked request returns HTTP 429 with a retry interval. Limits use process-local memory: they reset when the API restarts and are not shared across replicas. For production replicas, configure a shared rate-limit store or enforce aggregate limits at the trusted ingress. Users behind a shared NAT share IP budgets. Do not enable blanket proxy trust; configure only your trusted ingress before relying on forwarded client addresses.

Binary upload endpoints accept actual parsed Buffers only; JSON objects and arrays cannot impersonate files. File-name headers and knowledge/workflow query references must have the expected scalar types. List sorting resolves only configured columns, and email validation uses bounded checks without ambiguous backtracking.
