# Deployment and operations

This guide is for Admins configuring the installation or its connections. Agents and Users use the published features their permissions allow; Read Only users inspect permitted records without changing configuration. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

The bundled Compose configuration is a development starting point. Review it before exposing the application publicly or using sensitive organizational data.

## Production configuration

- Serve the web application through HTTPS. Set `APP_ORIGIN` to its public HTTPS origin and `COOKIE_SECURE=true`.
- Generate a private `CREDENTIAL_ENCRYPTION_KEY` and give the same value to the API and worker. Store it outside source control and retain a protected backup.
- Restrict access to the API and infrastructure. The sample API port binds publicly; MongoDB, Redis, Qdrant, and Ollama host ports bind to loopback. Use authentication and network isolation appropriate to your deployment, including on shared hosts and container networks.
- Pin and update container versions, review dependencies, and set resource limits suitable for your traffic.
- Persist and back up the selected MongoDB or PostgreSQL database, Redis, and any vector storage you use. Redis uses AOF and no eviction; the selected application database remains authoritative.
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

Back up the selected database and installation configuration using the [database guide](databases.md), retain the credential encryption key securely, and test restoration in an isolated environment. Restoring MongoDB without the matching key does not restore access to encrypted secrets. Do not publish database exports, tokens, uploads, or personal workspace records.

Workers recover scheduled work from durable records and use leases and retries. External actions may have uncertain outcomes after outages; inspect run state rather than blindly repeating them. Audit logs remain editable by a sufficiently privileged database operator and do not provide cryptographic tamper resistance.

## Before a public release

Run dependency, code, container, and secret scans; review authorization and integration behavior; enable GitHub CodeQL, Dependabot, secret scanning, and push protection where available. A clean automated scan or passing tests does not establish production security. See [security and limits](security.md).

## Deploy on Render

The root `render.yaml` Blueprint deploys the existing containers as six paid Render services: an Nginx web service, private Express API, background worker, persistent Key Value queue, private Qdrant, and private Ollama. MongoDB is supplied separately through Atlas. Docker Compose remains available for local and self-hosted installations.

1. Create a MongoDB Atlas deployment in the closest available region to your Render services. Create a database user scoped to the `agentzuno` database. Allow only the API and worker's Render outbound IP ranges in Atlas Network Access; avoid allowing the entire internet. Use its TLS connection string with `/agentzuno` as the database name.
2. Push this repository to your Git provider. In Render, select **New → Blueprint**, connect the repository, and select `render.yaml`. Review the paid resources and region before deploying. The default region is Oregon; change all service regions together before first deployment if needed.
3. Enter `MONGODB_URI` when prompted for the API. The worker references that value automatically. Render generates a single credential encryption key on the API and shares it with the worker. Back up that key securely; never replace it casually or encrypted saved credentials will become unreadable.
4. Wait for deployment and the Ollama logs to confirm `nomic-embed-text` was downloaded. Its persistent disk keeps the model across deploys. Knowledge indexing may retry while the model is first downloading.
5. Open the web service's HTTPS URL, register, and complete or skip setup. Configure AI providers, SMTP, and connector credentials in the app. Ollama supplies embeddings, not chat responses.

The public web service proxies `/api/` to the private API, keeping browser requests and cookies on the same origin. API and worker obtain internal service addresses from Render references. Redis external access is blocked, eviction is disabled, and journal/snapshot persistence is enabled. Qdrant and Ollama have persistent disks and no public web endpoints. Atlas stores application records and uploaded binaries.

If you add a custom domain, configure it on the Render web service and set the API's `APP_ORIGIN` to the exact HTTPS origin. The worker inherits it. Configure any additional workspace portal domains at the edge as described above. Do not assume the app's domain setting provisions Render domains automatically.

The Blueprint uses paid Standard API, worker, vector and embedding services and a Starter web proxy. These are starting allocations, not a verified capacity guarantee for 500–1,000 employees. Load-test simultaneous chats, workflows and ingestion before rollout. Render bills services, persistent disks and applicable workspace/network usage separately; Atlas and AI usage add costs. Disk-backed services are single-instance and redeployments can interrupt them. Use Atlas backups, export/back up Qdrant as appropriate, and test recovery. This topology does not provide full high availability.

Validate the Blueprint with Render's dashboard or `render blueprints validate render.yaml` before deployment. For troubleshooting, check the web `/health` endpoint, API logs, worker heartbeat with `node src/workerHealth.js` in the worker shell, queue depth and failed jobs. A successful web health check confirms the proxy is serving, not the health of every downstream service. Container image tags track upstream updates; review and pin tested digests for your production release.

## Publish the website on GitHub Pages

The included [GitHub Actions](https://docs.github.com/en/actions) workflow builds the Vite site and publishes the `dist` folder. GitHub Pages serves the static website; the API, database, worker, live chat, and authenticated workspace need a separate application host.

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Commit and push `.github/workflows/deploy-pages.yml` and your website changes to `main`.
3. Open **Actions → Deploy website to GitHub Pages** and wait for the deployment to succeed. You can also run it manually.
4. Under **Settings → Pages**, enter your custom domain, check DNS again, and enable **Enforce HTTPS** once GitHub provisions its certificate.

For local verification, run `npm run build` followed by `npm start`. Do not deploy the source `index.html` directly: it references JSX that browsers cannot compile. The workflow deploys the built files automatically; you do not need to commit `dist`. The included `404.html` allows the client router to display direct links, although GitHub Pages still returns an HTTP 404 for those paths.

See the [Vite GitHub Pages deployment guide](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
