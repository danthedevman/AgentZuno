# Deployment and operations

The bundled Compose configuration is a development starting point. Review it before exposing the application publicly or using sensitive organizational data.

## Production configuration

- Serve the web application through HTTPS. Set `APP_ORIGIN` to its public HTTPS origin and `COOKIE_SECURE=true`.
- Generate a private `CREDENTIAL_ENCRYPTION_KEY` and give the same value to the API and worker. Store it outside source control and retain a protected backup.
- Restrict access to the API and infrastructure. The sample API port binds publicly; MongoDB, Redis, Qdrant, and Ollama host ports bind to loopback. Use authentication and network isolation appropriate to your deployment, including on shared hosts and container networks.
- Pin and update container versions, review dependencies, and set resource limits suitable for your traffic.
- Persist and back up MongoDB, Redis, and any vector storage you use. Redis uses AOF and no eviction; MongoDB remains authoritative.
- Configure SMTP in Settings for invitations. Configure connectors through their dedicated pages; do not add provider secrets to Git remotes, source files, or screenshots.

Custom workspace domains require DNS verification and HTTPS provisioning at your edge. `CUSTOM_DOMAIN_TARGET` advertises the expected CNAME destination; the app does not provision certificates for you.

## Running services

```sh
docker compose ps
docker compose logs --tail 100 api worker web
docker compose up --build -d --force-recreate --wait api worker web
```

The API health endpoint is `/health` on its service port. Web and worker have their own container health checks. Logs and audit records serve different purposes: application logs help diagnose services; workspace Audit reports track governed actions and record mutations.

## Recovery and backups

`docker compose down` keeps named volumes. `docker compose down -v` removes persisted volumes and is destructive.

Back up MongoDB using tools appropriate to your deployment, retain the credential encryption key securely, and test restoration in an isolated environment. Restoring MongoDB without the matching key does not restore access to encrypted secrets. Do not publish database exports, tokens, uploads, or personal workspace records.

Workers recover scheduled work from durable records and use leases and retries. External actions may have uncertain outcomes after outages; inspect run state rather than blindly repeating them. Audit logs remain editable by a sufficiently privileged database operator and do not provide cryptographic tamper resistance.

## Before a public release

Run dependency, code, container, and secret scans; review authorization and integration behavior; enable GitHub CodeQL, Dependabot, secret scanning, and push protection where available. A clean automated scan or passing tests does not establish production security. See [security and limits](security.md).
