# Quick Deployment Setup Guide

## Files Created

1. **`deploy.cmd`** - Azure Kudu deployment script
2. **`web.config`** - IIS/Node.js configuration for Azure
3. **`.github/workflows/azure-deploy.yml`** - GitHub Actions workflow
4. **`AZURE_DEPLOYMENT.md`** - Detailed deployment guide

## Quick Start

### 1. Create Azure App Service

```bash
# Via Azure CLI (optional)
az webapp create \
  --resource-group <your-rg> \
  --plan <your-plan> \
  --name communicationServiceShell \
  --runtime "NODE:20-lts"
```

Or create via Azure Portal:
- **Web App** → Node.js 20 LTS → Name: `communicationServiceShell`

### 2. Set GitHub Secrets

Go to: **GitHub Repository → Settings → Secrets and variables → Actions**

Add:
- `AZURE_CLIENT_ID` - From Azure AD App Registration
- `AZURE_TENANT_ID` - From Azure AD Overview
- `AZURE_SUBSCRIPTION_ID` - From Azure Subscriptions

### 3. Configure Azure App Settings

In Azure Portal → **App Service → Configuration → Application settings**, add:

```bash
NODE_ENV=staging
MONGODB_URI=your-mongodb-connection-string
RABBIT_URL=your-rabbitmq-url
GRAPH_CLIENT_ID=your-graph-client-id
GRAPH_CLIENT_SECRET=your-graph-client-secret
GRAPH_TENANT_ID=your-graph-tenant-id
AZURE_STORAGE_CONNECTION_STRING=your-storage-connection-string
AZURE_STORAGE_CONTAINER_NAME=your-container-name
PROFILE_SERVICE_URL=https://profileserviceShell.azurewebsites.net
SUBSCRIPTION_SERVICE_URL=https://subscriptionserviceShell.azurewebsites.net
ACCOUNT_SERVICE_URL=https://accountsserviceShell.azurewebsites.net
ALLOWED_ORIGINS=https://your-frontend.azurewebsites.net
```

### 4. Deploy

**Automatic:** Push to `main` branch

**Manual:** GitHub → Actions → Run workflow

### 5. Verify

```bash
curl https://communicationServiceShell.azurewebsites.net/health
```

## Repository Structure

If your repository is a **monorepo** (all services in one repo):
- Move `.github/workflows/azure-deploy.yml` to root `.github/workflows/`
- Update workflow paths if needed

If each service is a **separate repository**:
- Keep workflow in `communication-service/.github/workflows/`
- Current setup should work as-is

## Next Steps

See `AZURE_DEPLOYMENT.md` for:
- Detailed troubleshooting
- Security best practices
- Monitoring setup
- Rollback procedures

