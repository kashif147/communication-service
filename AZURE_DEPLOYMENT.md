# Azure Deployment Guide for Communication Service

## Overview

This guide explains how to deploy the Communication Service to Azure App Service with automatic GitHub Actions deployment.

## Prerequisites

1. Azure subscription with App Service access
2. GitHub repository with Actions enabled
3. Azure Service Principal credentials

## Step 1: Create Azure App Service

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a new **Web App** (not Function App)
3. Configure:
   - **Name:** `communicationServiceShell` (or your preferred name)
   - **Runtime stack:** Node.js 20 LTS
   - **Operating System:** Linux (recommended) or Windows
   - **Region:** Choose your preferred region
   - **App Service Plan:** Create new or use existing

4. After creation, note:
   - App Service name
   - Resource Group name
   - Subscription ID

## Step 2: Configure GitHub Secrets

Go to your GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

### AZURE_CLIENT_ID
- Get from: Azure Portal → **Azure Active Directory → App registrations**
- Create a new app registration or use existing
- Copy the **Application (client) ID**

### AZURE_TENANT_ID
- Get from: Azure Portal → **Azure Active Directory → Overview**
- Copy the **Tenant ID**

### AZURE_SUBSCRIPTION_ID
- Get from: Azure Portal → **Subscriptions**
- Copy the **Subscription ID**

### Configure App Registration Permissions

1. Go to **Azure Active Directory → App registrations → [Your App]**
2. Go to **API permissions**
3. Add permission → **Azure Service Management**
4. Grant **User.Read** permission
5. Go to **Certificates & secrets**
6. Create a new **Client secret**
7. Copy the secret value (you'll need this for authentication)

## Step 3: Configure Azure App Service Settings

Go to Azure Portal → **App Service → Configuration → Application settings**

Add these environment variables:

```bash
NODE_ENV=staging
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/Communication-Service?retryWrites=true&w=majority
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/Communication-Service?retryWrites=true&w=majority
RABBIT_URL=amqp://guest:guest@rabbitmq-host:5672
GRAPH_CLIENT_ID=your-microsoft-graph-client-id
GRAPH_CLIENT_SECRET=your-microsoft-graph-client-secret
GRAPH_TENANT_ID=your-microsoft-graph-tenant-id
AZURE_STORAGE_CONNECTION_STRING=your-azure-storage-connection-string
AZURE_STORAGE_CONTAINER_NAME=your-container-name
PROFILE_SERVICE_URL=https://profileserviceShell.azurewebsites.net
SUBSCRIPTION_SERVICE_URL=https://subscriptionserviceShell.azurewebsites.net
ACCOUNT_SERVICE_URL=https://accountsserviceShell.azurewebsites.net
ALLOWED_ORIGINS=https://your-frontend.azurewebsites.net,http://localhost:3000
```

⚠️ **Important:**
- Do NOT set `PORT` - Azure auto-assigns it via `process.env.PORT`
- Replace placeholder values with your actual credentials
- Use Azure Key Vault for sensitive values in production

## Step 4: Update GitHub Workflow (if needed)

The workflow file is located at: `.github/workflows/azure-deploy.yml`

If your App Service name differs from `communicationServiceShell`, update:
- Line 1: Workflow name
- Line 77: `--name` parameter
- Line 85: `app-name` parameter

## Step 5: Deploy

### Automatic Deployment

The service will automatically deploy when you push to the `main` branch.

### Manual Deployment

1. Go to GitHub → **Actions** tab
2. Select **Build and deploy Node.js app to Azure Web App - communicationServiceShell**
3. Click **Run workflow**
4. Select branch: `main`
5. Click **Run workflow**

## Step 6: Verify Deployment

### 1. Check Health Endpoint

```bash
curl https://communicationServiceShell.azurewebsites.net/health
```

Expected response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "communication-service",
    "timestamp": "...",
    "port": "...",
    "environment": "staging"
  }
}
```

### 2. Check Service Info

```bash
curl https://communicationServiceShell.azurewebsites.net/
```

### 3. Check Logs

**Via Azure Portal:**
- App Service → **Monitoring → Log stream**

**Via Azure CLI:**
```bash
az webapp log tail --name communicationServiceShell --resource-group <your-rg>
```

Look for:
- `✅ Mongo connected`
- `API listening on port XXXX`
- Any startup errors

## Troubleshooting

### Issue: Deployment fails with authentication error

**Fix:**
1. Verify GitHub secrets are correct
2. Check App Registration has correct permissions
3. Ensure Client Secret hasn't expired

### Issue: App returns 404 or NOT_FOUND

**Fix:**
1. Check `web.config` is deployed (should be in root)
2. Verify `bin/communication-service.js` exists
3. Check MongoDB connection in logs
4. Verify environment variables are set correctly

### Issue: MongoDB connection fails

**Fix:**
1. Verify MongoDB Atlas allows Azure IPs (0.0.0.0/0 for testing)
2. Check connection string is correct
3. Test connection locally with staging credentials

### Issue: OneDrive/Graph API errors

**Fix:**
1. Verify `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_TENANT_ID` are set
2. Check Graph API permissions in Azure AD
3. Ensure service principal has required permissions

### Issue: CORS errors

**Fix:**
Add your frontend domain to `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS=https://your-frontend.azurewebsites.net,http://localhost:3000
```

### Issue: File upload fails

**Fix:**
1. Check `AZURE_STORAGE_CONNECTION_STRING` is set
2. Verify storage container exists
3. Check container permissions

## Testing Locally with Staging Config

```bash
cd communication-service
NODE_ENV=staging npm start
```

Should load `.env.staging` and connect to staging MongoDB/RabbitMQ.

## Manual Deployment (Alternative)

If GitHub Actions isn't working, you can deploy manually:

### Option 1: Azure CLI

```bash
# Login
az login

# Deploy
az webapp deployment source config-zip \
  --resource-group <your-rg> \
  --name communicationServiceShell \
  --src <path-to-zip>
```

### Option 2: VS Code Azure Extension

1. Install "Azure App Service" extension
2. Right-click on service folder
3. Select "Deploy to Web App"

### Option 3: Git Deployment

1. In Azure Portal → App Service → **Deployment Center**
2. Choose **Local Git** or **GitHub**
3. Follow setup wizard

## Monitoring

### Application Insights (Recommended)

1. Create Application Insights resource
2. In App Service → **Application Insights → Enable**
3. Select your Application Insights resource

### Log Analytics

1. Enable **Log stream** in Azure Portal
2. Set up **Diagnostic settings** for advanced logging
3. Configure **Alerts** for errors

## Security Best Practices

1. **Use Azure Key Vault** for sensitive secrets
2. **Enable HTTPS only** in App Service settings
3. **Configure CORS** properly
4. **Use Managed Identity** for Azure resources
5. **Enable Application Insights** for monitoring
6. **Set up alerts** for critical errors
7. **Regular security updates** for dependencies

## Rollback

If deployment causes issues:

1. Go to Azure Portal → App Service → **Deployment Center**
2. Select previous deployment
3. Click **Redeploy**

Or via CLI:
```bash
az webapp deployment source show \
  --resource-group <your-rg> \
  --name communicationServiceShell
```

## Next Steps

1. Set up **staging slot** for testing
2. Configure **auto-scaling** based on load
3. Set up **backup** strategy
4. Configure **custom domain** and SSL
5. Set up **monitoring alerts**

