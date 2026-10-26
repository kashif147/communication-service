// Phase A / A1 — communication-service sends the audit row's tenant only via the trusted internal
// headers that audit-service now requires (x-internal-request + x-tenant-id), and never posts a row
// without a tenant. Native node:test (ESM). Run: node --test tests/auditClient.a1.test.js
await import("./helpers/testEnv.js");
process.env.AUDIT_SERVICE_URL = "http://audit.test.invalid/api";
process.env.SERVICE_AUDIT_SECRET = "test-only-audit-secret";

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const axios = (await import("axios")).default;
const { logCampaignAudit } = await import("../services/auditClient.service.js");

const T = "68cbf7806080b4621d469d34";
let calls = [];
axios.post = async (url, body, cfg) => { calls.push({ url, body, headers: cfg.headers }); return { status: 201 }; };

test("posts with x-internal-request and the trusted tenant header; body tenant equals header", async () => {
  calls = [];
  await logCampaignAudit({ tenantId: T, action: "CAMPAIGN_SENT", resourceId: "c1" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, "http://audit.test.invalid/internal/audit-logs");
  assert.strictEqual(calls[0].headers["x-internal-request"], "true");
  assert.strictEqual(calls[0].headers["x-tenant-id"], T);
  assert.strictEqual(calls[0].body.tenantId, T);
});

test("no trusted tenant -> nothing is posted", async () => {
  for (const t of [undefined, null, "", "   "]) {
    calls = [];
    await logCampaignAudit({ tenantId: t, action: "CAMPAIGN_SENT" });
    assert.strictEqual(calls.length, 0, String(t));
  }
});
