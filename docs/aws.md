# Deploy on AWS

Admins use this guide to host AgentZuno on AWS. Agents handle permitted support work, Users submit and follow requests, and Read Only reviewers inspect permitted records; these roles do not require AWS console access. See [roles and features](roles-and-features.md).

## Choose an AWS deployment

The most direct path is one Linux EC2 instance running the existing Docker Compose services. It preserves the API/worker separation and the shared installation volume used by the database wizard. A Lightsail **virtual machine** can follow a similar approach. This guide does not provide a Lightsail container-service configuration.

ECS/Fargate is another option, but requires separate task definitions, networking, persistent storage, secrets, and database provisioning. There is no checked-in AWS CloudFormation, Terraform, or ECS deployment template. The steps below use EC2.

## Create the server and network

1. Create a Linux EC2 instance using an Ubuntu LTS x86-64 image. Choose CPU, memory, and encrypted EBS capacity for the database, vector index, embedding model, builds, and expected concurrent work. Start with the [capacity guide](capacity.md); employee count alone does not size the server.
2. Retain storage across planned instance replacement and arrange backups. Understand the EBS volume's delete-on-termination setting before relying on it for records.
3. Give the application a stable public address and point a hostname such as `help.example.com` to it. Use AWS's current public IPv4 and storage pricing when estimating costs.
4. Allow inbound HTTPS on 443 and HTTP on 80 for certificate issuance/redirects. Restrict SSH to your administrative IP, or use an appropriately configured management path. Do not open the application/database/queue/vector/model ports publicly. See [EC2 security group rules](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-rules-reference.html).

A single EC2 host is a starting topology, not high availability. The EC2 instance, its disk, and the host's maintenance remain your responsibility.

## Install Docker and configure AgentZuno

Connect to the instance and install Git, [Docker Engine for Ubuntu](https://docs.docker.com/engine/install/ubuntu/), and the [Docker Compose plugin](https://docs.docker.com/compose/install/linux/). Follow those official instructions for repository setup and permissions.

```sh
git clone https://github.com/danthedevman/agentzuno.git
cd agentzuno
cp .env.example .env
openssl rand -base64 32
```

Put the generated key in `.env` as `CREDENTIAL_ENCRYPTION_KEY`. Keep the key private and backed up; never commit `.env`. Generate a separate strong PostgreSQL password if using the bundled service, replacing the development default. URL-encode reserved password characters if supplying a connection URI.

Set these values, substituting your hostname and secrets:

```dotenv
APP_ORIGIN=https://help.example.com
PUBLIC_SITE_URL=https://help.example.com/
COOKIE_SECURE=true
PORT=127.0.0.1:3000
API_PORT=127.0.0.1:3001
CREDENTIAL_ENCRYPTION_KEY=YOUR_GENERATED_BASE64_KEY
POSTGRES_PASSWORD=YOUR_SEPARATE_DATABASE_PASSWORD
```

The `PORT` and `API_PORT` values bind the published Compose ports to loopback. The public reverse proxy will forward to port 3000. Infrastructure services already bind their published ports to loopback in the bundled Compose configuration. Keep the security group restrictive as a second boundary.

```sh
docker compose config --quiet
docker compose up --build -d
```

The default stack starts MongoDB and PostgreSQL so the installer can choose either. Only the selected adapter stores application records. Do not remove supporting services or change database engines as an assumed migration.

## Enable HTTPS

Install [Caddy](https://caddyserver.com/docs/install) on the host using its official package instructions. Create `/etc/caddy/Caddyfile` with your real hostname:

```caddyfile
help.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Validate the configuration, then reload the installed Caddy service:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The domain must resolve to this host and certificate validation traffic must reach it. Caddy handles the public TLS endpoint; Docker's web service proxies API calls internally. See [Caddy's reverse proxy guide](https://caddyserver.com/docs/quick-starts/reverse-proxy).

## Complete installation

1. Open your HTTPS hostname. On a fresh installation, the database wizard opens before registration.
2. Retrieve the private setup token on the server:

   ```sh
   docker compose exec api cat /app/installation/setup.token
   ```

3. Select MongoDB or PostgreSQL. Use the bundled default or configure an external connection, then register your Admin account. See [database setup](databases.md).
4. Complete or skip the setup wizard. Configure the AI provider and SMTP in Settings; save Slack, Teams, and mailbox credentials under Connectors. These application credentials are encrypted in the selected database.
5. Copy the displayed callback and Events URLs into each provider's configuration. A stable public HTTPS hostname replaces the development tunnel. Slack and Teams user mapping is separate from optional SSO.

## Verify, back up, and upgrade

```sh
docker compose ps
docker compose logs --tail 100 api worker web
docker compose exec worker node src/workerHealth.js
```

Verify login, saving records, generated chat, request submission, task completion, and enabled channel delivery. Test two accounts with different permissions. Database and worker tests do not replace live provider validation.

Back up the selected database and `installation-data` volume, including its encrypted database configuration and installation key. Preserve `CREDENTIAL_ENCRYPTION_KEY` separately. Use database-native backups for reliable application recovery; a disk snapshot taken during writes is not a substitute for a tested restore. See [backups and upgrades](recovery.md).

Before updating, back up, review changes, and test the revision in a separate environment. Deploy the chosen revision with `docker compose up --build -d`. Keep named volumes; `docker compose down -v` deletes them. Monitor disk growth, queue backlog, failed workflow steps, and memory pressure.

## Moving to managed AWS services

For a larger installation, an AWS-specific architecture can use separate API/worker ECS services, an HTTPS load balancer, RDS PostgreSQL or MongoDB Atlas, durable Redis-compatible job storage, and separately hosted Qdrant/Ollama. Keep database and internal services private, use the same encryption key in API/worker, and verify queue persistence/no-eviction compatibility before selecting a managed cache.

Fargate container-local storage is not a replacement for durable application configuration or database storage. Plan explicit persistent mounts or the application's environment-based database setup. See [ECS storage options](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_data_volumes.html). S3 is not currently a drop-in upload backend; uploads remain in the selected database.

This managed topology needs new infrastructure configuration and load/recovery testing; it is not an automated deployment included in this repository. Review the [AWS Pricing Calculator](https://calculator.aws/) for compute, storage, backups, load balancing, network charges, and AI provider usage before provisioning.
