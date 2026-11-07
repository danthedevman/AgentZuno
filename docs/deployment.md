# Deployment and operations

This guide is for Admins configuring the installation or its connections. Agents and Users use the published features their permissions allow; Read Only users inspect permitted records without changing configuration. See [roles and everyday features](roles-and-features.md) for practical steps and access rules.

The bundled Compose configuration is a development starting point. Review it before exposing the application publicly or using sensitive organizational data.

## Production configuration

- Serve the web application through HTTPS. Set `APP_ORIGIN` to its public HTTPS origin; cookies automatically become Secure. `COOKIE_SECURE=true` also explicitly requires secure cookies. Configure HSTS at the HTTPS ingress.
- Generate a private `CREDENTIAL_ENCRYPTION_KEY` and give the same value to the API and worker. Store it outside source control and retain a protected backup.
- Restrict access to the API and infrastructure. The API and MongoDB, Redis, Qdrant, and Ollama host ports bind to loopback by default. Web reaches the API over the internal Docker network. Use authentication and network isolation appropriate to your deployment, including on shared hosts and container networks.
- Pin and update container versions, review dependencies, and set resource limits suitable for your traffic.
- Persist and back up the selected MongoDB or PostgreSQL database, Redis, and any vector storage you use. Redis uses AOF and no eviction; the selected application database remains authoritative.
- Configure SMTP in Settings for emailed invitations, or copy and share invitation links without SMTP. Configure connectors through their dedicated pages; do not add provider secrets to Git remotes, source files, or screenshots.

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

## Choose a host

AgentZuno needs an always-running API and worker, an application database, a persistent Redis-compatible queue, and its Qdrant/Ollama knowledge services. Keep the browser-facing web application and API on one public HTTPS origin. A static host alone cannot run the authenticated application.

| Hosting option                                                                                                           | Deployment approach                                                                        | What you manage                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| [Render](https://render.com/docs/blueprint-spec)                                                                         | Included `render.yaml` creates the web, private API, worker, queue, and knowledge services | Atlas connection, plans, backups, domains, and operations; see [Deploy on Render](render.md)          |
| [AWS EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)                                             | Existing Docker Compose stack on a Linux VM                                                | Server, HTTPS, persistent storage, backups, and upgrades; see [Deploy on AWS](aws.md)                 |
| [DigitalOcean Droplet](https://docs.digitalocean.com/products/droplets/getting-started/quickstart/) or another Linux VPS | Existing Docker Compose stack behind an HTTPS proxy                                        | VM/network maintenance and recovery; adapt the EC2 guide's Docker and HTTPS steps                     |
| [Railway](https://railway.com/guides/docker-compose)                                                                     | Map each container to a service with private networking and persistent volumes             | Provider-specific variables, storage, and startup settings; no Railway template is included           |
| [Fly.io](https://fly.io/docs/reference/configuration/)                                                                   | Configure separate application processes/services and durable volumes                      | Fly-specific networking, storage, database, and deployment configuration; no Fly template is included |

A VM keeps the existing Compose topology together. A managed container platform can reduce host maintenance but requires per-service networking, secrets, storage, and cost planning. These are architectural options, not claims that each provider has been live-tested. Compare the complete deployment cost, including databases, disks, backups, traffic, and AI usage. Use [capacity testing](capacity.md) before sizing for a company.

## Deploy on Render

Follow the dedicated [Render deployment guide](render.md) for the included Blueprint, Atlas setup, PostgreSQL alternatives, domains, connector callbacks, and troubleshooting.

## Deploy on AWS

Follow [Deploy on AWS](aws.md) for the EC2/Compose path and the additional infrastructure needed for ECS/Fargate. The repository does not include an automated AWS template.

## Publish the website on GitHub Pages

The included [GitHub Actions](https://docs.github.com/en/actions) workflow builds the Vite site and publishes the `dist` folder. GitHub Pages serves the static website; the API, database, worker, live chat, and authenticated workspace need a separate application host.

1. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Commit and push `.github/workflows/deploy-pages.yml` and your website changes to `main`.
3. Open **Actions → Deploy website to GitHub Pages** and wait for the deployment to succeed. You can also run it manually.
4. Under **Settings → Pages**, enter your custom domain, check DNS again, and enable **Enforce HTTPS** once GitHub provisions its certificate.

For local verification, run `npm run build` followed by `npm start`. Do not deploy the source `index.html` directly: it references JSX that browsers cannot compile. The workflow deploys the built files automatically; you do not need to commit `dist`. The build generates a separate noindex `404.html` for client routes; GitHub Pages still returns HTTP 404 for paths without a generated page. Public Docs routes have their own generated HTML.

See the [Vite GitHub Pages deployment guide](https://vite.dev/guide/static-deploy.html#github-pages) and [GitHub custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

The Pages build reads its base path from GitHub Pages configuration, so assets and router links work under `/agentzuno/` or at a custom-domain root. It disables session and homepage API calls for the static marketing site. Local and Docker builds retain their normal API behavior. To reproduce a repository-path build locally, run `VITE_BASE_PATH=/agentzuno/ VITE_STATIC_SITE=true npm run build`. Changing the Pages custom domain requires a new deployment to rebuild the base path.

## Prerendered public pages and SEO

`npm run build` renders `/docs` and every registered public guide to static HTML. With `VITE_STATIC_SITE=true`, it also renders the marketing homepage using Solid’s server renderer. Public content is available before JavaScript runs; the browser then replaces it with the interactive Solid app. Animations still start as sections enter view. Prerendering uses public copy and documentation only, with a guest session; it never requests account, workspace, or provider data.

Set `PUBLIC_SITE_URL` at build time to the public site’s canonical HTTPS URL, including a repository path if applicable. It defaults to `https://agentzuno.com/`. Compose passes `PUBLIC_SITE_URL` from `.env` as a web build argument; rebuild the web image after changing it. Set the matching Docker build argument on other hosts. The Pages workflow reads the URL and path from Pages configuration. Rebuild after changing the domain. The build generates page titles/descriptions, canonical links, social preview metadata, application structured data, `robots.txt`, and a sitemap containing only public routes. Authenticated routes use a separate noindex app shell; robots rules supplement authentication and do not protect private data. Nginx serves that shell for application routes.

Submit the generated sitemap in [Google Search Console](https://search.google.com/search-console/about) and inspect the deployed pages after DNS and HTTPS work. Prerendering improves content availability; it does not guarantee indexing, rankings, or a performance score. See [Google’s JavaScript SEO guide](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

## Local account recovery

An operator with shell access to the API server can reset a local password account without SMTP:

```sh
docker compose exec api npm run recover-account
```

For local Node development, run `npm --prefix api run recover-account` from the repository root with the same installation configuration as the API. The interactive command asks for the email, confirmation, and a new password twice. Password entry is hidden; passwords are never accepted as flags or printed. The reset revokes all sessions for that account, including impersonation sessions, and records a credential-free audit event. It does not create accounts, change permissions, or reset identity-only accounts. Recover identity accounts through their configured identity provider. Keep server access restricted; this command has the authority of the database operator.

Email verification and public email reset links remain unavailable. SMTP currently serves invitations and notifications; configuring it does not enable a public recovery endpoint.
