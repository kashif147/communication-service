// Route order: GET /api/templates/test-graph-token must reach testGraphToken, not the
// parameterised GET /api/templates/:id (getTemplate), which would reject "test-graph-token" as an
// invalid ObjectId (400). An ObjectId-shaped id must still reach getTemplate.
// Drives the REAL app.js over HTTP; only the policy decision (user-service), the Template model
// (in memory) and Microsoft (axios.post for the Graph token) are stubbed.
// Run: node --test tests/templateRoutes.order.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const axios = (await import("axios")).default;
const { installFakeModel } = await import("./helpers/fakeModel.js");

const app = (await import("../app.js")).default;
const policy = (await import("../middlewares/policy.middleware.js")).default;
const Template = (await import("../model/template.model.js")).default;
const graphAuth = await import("../services/graphAuth.service.js");

const TENANT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER = "6ab8f345e23ad3e2c9be4e4e";
const TEMPLATE_ID = "6921fd6424f5afa0776bc4aa";
const TOKEN = "eyJ0eXAiOiJKV1QifQ.ROUTE-TEST-ACCESS-TOKEN.SIG";

Object.assign(process.env, {
  GRAPH_DOCUMENT_CLIENT_ID: "11111111-aaaa-4bbb-8ccc-000000000001",
  GRAPH_DOCUMENT_TENANT_ID: "22222222-aaaa-4bbb-8ccc-000000000002",
  GRAPH_DOCUMENT_CLIENT_SECRET: "ROUTE-TEST-DOCUMENT-SECRET",
});

let graphTokenRequests = 0;
const originalPost = axios.post;
axios.post = async () => {
  graphTokenRequests++;
  return { status: 200, data: { access_token: TOKEN, token_type: "Bearer", expires_in: 3599 } };
};

let server;
let base;
let fake;
test.before(async () => {
  fake = installFakeModel(Template, {
    docs: [{ _id: TEMPLATE_ID, tenantId: TENANT, name: "Route order template", templateType: "Email" }],
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  axios.post = originalPost;
  fake?.restore?.();
  return server && server.close();
});

const permit = () => ({
  success: true,
  decision: "PERMIT",
  reason: "PERMISSION_GRANTED",
  policyVersion: "1.0.0",
  user: { id: USER, tenantId: TENANT, userType: "CRM", roles: ["REO"], permissions: ["communication:read"] },
});
async function get(path) {
  policy.policyClient.clearCache();
  policy.policyClient.evaluateWithHeaders = async () => permit();
  graphAuth._resetGraphTokenCacheForTests();
  graphTokenRequests = 0;
  const res = await fetch(base + path, {
    headers: {
      "x-jwt-verified": "true",
      "x-auth-source": "gateway",
      "x-user-id": USER,
      "x-tenant-id": TENANT,
      "x-user-roles": JSON.stringify(["REO"]),
      "x-user-permissions": JSON.stringify(["communication:read"]),
    },
  });
  return { status: res.status, body: await res.json() };
}

test("GET /api/templates/test-graph-token reaches testGraphToken (not GET /:id)", async () => {
  const r = await get("/api/templates/test-graph-token");
  assert.equal(r.status, 200, `expected testGraphToken, got ${r.status} ${r.body.message ?? ""}`);
  assert.deepEqual(r.body.data, { tokenAcquired: true });
  assert.equal(graphTokenRequests, 1, "testGraphToken requested a Graph token");
  assert.doesNotMatch(JSON.stringify(r.body), /Invalid id|ObjectId|eyJ|ROUTE-TEST/);
});

test("an ObjectId-shaped id still reaches GET /:id (getTemplate)", async () => {
  const r = await get(`/api/templates/${TEMPLATE_ID}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "Template retrieved successfully");
  assert.equal(String(r.body.data.template._id), TEMPLATE_ID);
  assert.equal(graphTokenRequests, 0, "getTemplate for an email template needs no Graph token");
});

test("an unknown ObjectId reaches getTemplate and is not found; a non-ObjectId is still rejected by it", async () => {
  const missing = await get("/api/templates/6921fd6424f5afa0776bc4ff");
  // res.notFoundRecord (middlewares/response.mw.js) answers 200 with data null.
  assert.equal(missing.status, 200);
  assert.equal(missing.body.data, null);
  assert.equal(missing.body.message, "Template not found");
  const invalid = await get("/api/templates/not-an-object-id");
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.message, /Invalid id/);
});
