# Backups, restore drills, and upgrades

The deployment operator manages backups outside the app. The Admin, Agent, User, and Read Only app roles do not grant database or server access. See [roles and features](roles-and-features.md) for their in-app permissions.

## What to preserve

Back up the installation's selected application database, including accounts, memberships, uploaded binaries, workflow source and revisions, approvals, and audit records. Preserve the installation volume containing `database.json` and `installation.key`, plus the credential encryption key supplied to the services. Encrypted connections and provider credentials cannot be recovered without the original keys. Store keys separately from encrypted backups and restrict access to both.

Preserve Redis AOF data and review pending or uncertain workflow deliveries after recovery. Keep Qdrant snapshots alongside the database backup or rebuild vectors from authoritative records using the supported ingestion process. An inconsistent vector snapshot must never bypass current database authorization. Do not assume database restoration also restores external messages, app provisioning, or other actions already delivered to third parties.

## Native database backups

Use the tools appropriate to the installation's selected provider. A bundled MongoDB service does not mean MongoDB is the selected application database; the setup wizard may point to PostgreSQL or a remote database.

[MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/) include [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/) and [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/). For a consistent installation snapshot, stop app writes during a standalone database dump, or use a deployment-specific consistent backup mechanism. Use the appropriate source and destination versions and retain index metadata.

For PostgreSQL, use [pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html) with a custom archive and [pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html). The archive includes the selected database, not cluster-wide roles or every service volume. Managed database backups and point-in-time recovery may be more appropriate for production recovery objectives.

Encrypt backups, record their date and application revision, keep a copy off the application host, and test restoration into a separate environment. Never paste credentials into public issues or commit backup archives or keys.

## Run the bundled restore drill

With the bundled MongoDB and PostgreSQL Compose services running, install root and API dependencies and run:

```sh
node scripts/check-recovery.mjs
```

The script creates randomly named disposable source and destination databases, writes fictional accounts, memberships, requests, audit records, and binary data, then uses native dump/restore tools inside the Compose database containers. It checks restored data, workspace filtering, and current startup/index initialization, then removes only its temporary databases. It uses the bundled database ports and PostgreSQL credentials; it does not read or restore the installation's selected connection.

This is a regression drill, not a backup of your workspace. It does not verify your off-host storage, encryption-key recovery, Redis/Qdrant recovery, external deliveries, or every historical application release. Run a staging restoration with your real backup process before relying on it.

## Upgrade and rollback rehearsal

1. Record the running Git revision or image digest, database engine/version, and key locations. Back up the selected database and installation configuration using your deployment's process.
2. Restore into an isolated staging installation using the matching keys. Keep outbound connectors, email, and background deliveries disabled so replayed records cannot affect live systems.
3. Start the candidate API and worker and verify health, logs, and startup indexes. Run the API suite for both engines and the browser journeys in [testing](testing.md).
4. Check representative accounts in each role, published and draft workflows, approvals, attachments, requests/tasks, and audit history. Check legacy records with absent optional fields as well as new records.
5. Rehearse rollback by restoring the pre-upgrade database and configuration with the previous application image. Do not assume running an older image against already-modified data is safe.
6. Schedule the production rollout only after the staging checks pass. Preserve backups and recovery evidence according to your organization's retention policy.

The current restore drill validates representative legacy-shaped records against current startup code. A successful drill does not establish compatibility with an arbitrary older release. Add a version-specific fixture whenever a persistent schema or migration changes.
