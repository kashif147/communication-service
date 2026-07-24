# Deployment — ignore the Azure docs

Three GitHub workflows exist:

- **`deploy.yml`** — the live one: rsync + SSH to the VM, `docker compose build/up`, triggered on
  push to `gateway`. Same pattern as every other service in this platform.
- **`azure-deploy.yml`** and **`main_communicationserviceshell.yml`** — stale. They deploy to an
  Azure Web App on push to `main` and are not how this service is actually deployed anymore.

`AZURE_DEPLOYMENT.md` documents that old Azure App Service path — don't follow it for current
deployment questions. Trust `deploy.yml` and `docker-compose.yml` instead.
