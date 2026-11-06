# Getting started

Install AgentZuno, create your workspace, and try your first employee request. You do not need to install the workflow SDK to use the app.

## Docker

Install [Docker with Compose](https://docs.docker.com/get-started/get-docker/), then clone the repository and create your configuration:

```sh
git clone https://github.com/danthedevman/AgentZuno.git
cd AgentZuno
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put the generated value in `CREDENTIAL_ENCRYPTION_KEY` in `.env`. Keep the key private and backed up; the API and worker use it to decrypt saved credentials. Do not commit `.env`.

Start the app:

```sh
docker compose up --build -d
```

The first start downloads the container images and local embedding model. Open [localhost:3000](http://localhost:3000) when the services are ready.

## Set up your workspace

1. In **Choose Your Database**, select bundled MongoDB or PostgreSQL, or enter your own connection.
2. Retrieve the setup token with `docker compose exec api cat /app/installation/setup.token`, enter it, and choose **Connect and Continue**.
3. Register your first account and follow the workspace setup wizard. You can skip steps and return to Settings later.
4. Connect and enable an AI provider in **Settings** before starting an AI conversation. Configure channel connections, email, and identity settings only when your team needs them.

The database choice applies to the installation. See [Database Setup](databases.md) for connection and recovery details, or [Deployment & Hosting](deployment.md) before exposing the app publicly.

## Try your first request

As an Admin, publish a [workflow](workflows.md) and add any groups it needs. Open **Chat**, describe the request, and submit the offered form. Review its status in the request panel or **Dashboard → My Requests**.

For a ready-made example, open **Settings → Demo Data**, choose Tech, Media, or Retail, and load the fictional records. Demo workflows route internally without sending external notifications. Remove tagged demo data from the same Settings section when finished.

## If setup does not work

- **Database connection fails:** check the selected connection and [Database Setup](databases.md).
- **AI does not respond:** configure an enabled provider in Settings.
- **You need a local development environment:** follow [Local Development](local-development.md).
- **You are upgrading an installation:** follow [Backups & Upgrades](recovery.md).
