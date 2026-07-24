# Cross-service calls — HTTP only, no shared DB

Everything reaches other services over HTTP, forwarding gateway/auth context rather than minting
new credentials (see the `cross-service-auth` and `no-cross-db-mongo` skills for the
platform-wide convention). This is additionally hook-enforced when working from the full
projectShell checkout — `.claude/hooks/enforce-hard-rules.mjs` (root-level) blocks
`mongoose.createConnection(...)` and the literal header `x-api-key` under `backend/`; that hook
doesn't exist in a standalone clone of this repo alone, so the rule itself (HTTP + forwarded
headers, never a direct DB connection or a shared API key) is what to follow regardless of which
checkout you're in.

Notable integration points:
- `services/profileBatch.service.js`, `services/memberData.service.js` → profile/subscription/
  account services (`PROFILE_SERVICE_URL`, `SUBSCRIPTION_SERVICE_URL`, `ACCOUNT_SERVICE_URL`).
- `services/tenant.service.client.js` → tenant lookups for bookmark merge context.
- `services/auditClient.service.js` → `POST {AUDIT_SERVICE_URL}/internal/audit-logs` with a
  shared `x-service-secret` (`SERVICE_AUDIT_SECRET`), the same internal ingestion endpoint
  documented in `audit-service`'s CLAUDE.md. It's fire-and-forget — failures are logged, never
  thrown. Don't make a request path depend on this call succeeding.
- `services/onedrive.service.js`, `services/graphAuth.service.js` → Microsoft Graph, using an
  app-only client-credentials token (`GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`,
  cached in-memory ~50-55 min) against a shared admin mailbox/site
  (`ONEDRIVE_USER_EMAIL`/`SHAREPOINT_SITE_ID`/`GRAPH_DRIVE_ID`) — templates are not per-user
  files.
