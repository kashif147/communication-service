// HTTP logging hardening: pino-http and the request logger (middlewares/logger.mw.js) emit
// allow-listed metadata only - never headers (Authorization, Bearer token, cookies), request body
// values, query values or token values - and guarded-route responses are unchanged.
// Drives the REAL app.js over HTTP; only the policy decision (user-service) and the BookmarkField
// model are stubbed. Captures every pino line at the logger's destination stream.
// Run: node --test tests/httpLogging.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const pino = (await import("pino")).default;
const { installFakeModel } = await import("./helpers/fakeModel.js");

const logger = (await import("../config/logger.js")).default;
const app = (await import("../app.js")).default;
const policy = (await import("../middlewares/policy.middleware.js")).default;
const BookmarkField = (await import("../model/bookmarkField.model.js")).default;
const { requestLogEntry } = await import("../middlewares/logger.mw.js");

const TENANT = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER = "6ab8f345e23ad3e2c9be4e4e";
const B64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const JWT = `${B64({ alg: "HS256", typ: "JWT" })}.${B64({ sub: USER, email: "jwt.person@example.org" })}.SECRETSIGNATURE0123456789`;
const COOKIE = "connect.sid=SECRET-COOKIE-VALUE-0123";
const QUERY = "search=query.person%40example.org&token=QUERY-SECRET-TOKEN-999";
const BODY = {
  subject: "Secret subject line",
  recipients: ["body.person@example.org"],
  dateOfBirth: "1900-01-01",
  memberId: "MEMBER-SECRET-ID-777",
  accessToken: "BODY-SECRET-TOKEN-555",
};
const SENSITIVE = [
  JWT,
  ...JWT.split("."),
  JWT.slice(0, 20),
  "SECRET-COOKIE-VALUE",
  "query.person",
  "QUERY-SECRET-TOKEN-999",
  "Secret subject line",
  "body.person@example.org",
  "1900-01-01",
  "MEMBER-SECRET-ID-777",
  "BODY-SECRET-TOKEN-555",
  "header.person@example.org",
  "SECRET-ROLE-CODE",
  "secretresource:secretaction",
  "Mozilla/5.0 SECRET-AGENT",
];

// --- capture every line written by the service logger (and its pino-http children) ----------
const stream = logger[pino.symbols.streamSym];
const originalWrite = stream.write.bind(stream);
let captured = [];
stream.write = (chunk, ...rest) => {
  captured.push(String(chunk));
  return true;
};
test.after(() => {
  stream.write = originalWrite;
});

// --- real app on an ephemeral port ------------------------------------------------------------
let server;
let base;
test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

const gatewayHeaders = (extra = {}) => ({
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-user-id": USER,
  "x-tenant-id": TENANT,
  "x-user-roles": JSON.stringify(["SECRET-ROLE-CODE"]),
  "x-user-permissions": JSON.stringify(["secretresource:secretaction"]),
  "x-user-email": "header.person@example.org",
  "x-correlation-id": "corr-http-1",
  authorization: `Bearer ${JWT}`,
  cookie: COOKIE,
  "user-agent": "Mozilla/5.0 SECRET-AGENT",
  ...extra,
});
const permit = () => ({
  success: true,
  decision: "PERMIT",
  reason: "PERMISSION_GRANTED",
  policyVersion: "1.0.0",
  user: { id: USER, tenantId: TENANT, userType: "CRM", email: "result.person@example.org", roles: ["SECRET-ROLE-CODE"], permissions: ["secretresource:secretaction"] },
});
const deny = () => ({ success: false, decision: "DENY", reason: "INSUFFICIENT_PERMISSIONS", error: "Insufficient permissions", requiredPermissions: ["communication:read"] });

async function call(method, path, { headers = {}, body, decision } = {}) {
  policy.policyClient.clearCache();
  policy.policyClient.evaluateWithHeaders = async () => decision();
  captured = [];
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  await new Promise((r) => setTimeout(r, 50)); // finish/close handlers
  return { status: res.status, body: text, logs: captured.join("") };
}
const rows = (logs) =>
  logs
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const assertClean = (logs) => {
  for (const v of SENSITIVE) assert.ok(!logs.includes(v), `log contains sensitive value ${v.slice(0, 8)}...`);
  assert.doesNotMatch(logs, /authorization|"cookie"|user-agent|"headers"|"query"|"body"|remoteAddress/i);
  assert.doesNotMatch(logs, /eyJ/);
};

// --- pino-http ------------------------------------------------------------------------------------
test("pino-http: 'request completed' carries no headers, query or token values; safe fields only", async () => {
  const r = await call("GET", `/api/bookmarks/fields?${QUERY}`, { headers: gatewayHeaders(), decision: deny });
  assertClean(r.logs);
  const done = rows(r.logs).find((x) => x.msg === "request completed");
  assert.ok(done, "pino-http completion line present");
  assert.deepEqual(Object.keys(done.req).sort(), ["method", "path"]);
  assert.deepEqual(done.req, { method: "GET", path: "/api/bookmarks/fields" });
  assert.deepEqual(done.res, { statusCode: 403 });
  assert.equal(done.route, "/api/bookmarks/fields");
  assert.equal(done.correlationId, "corr-http-1");
  assert.equal(typeof done.responseTime, "number");
});

test("pino-http: PERMIT request logs internal userId / tenantId / userType after authorization", async (t) => {
  const fake = installFakeModel(BookmarkField, { docs: [] });
  t.after(() => fake.restore());
  const r = await call("GET", `/api/bookmarks/fields?${QUERY}`, { headers: gatewayHeaders(), decision: permit });
  assert.equal(r.status, 200);
  assertClean(r.logs);
  assert.doesNotMatch(r.logs, /result\.person@example\.org/);
  const done = rows(r.logs).find((x) => x.msg === "request completed");
  assert.equal(done.userId, USER);
  assert.equal(done.tenantId, TENANT);
  assert.equal(done.userType, "CRM");
  assert.equal(done.res.statusCode, 200);
});

// --- request logger (logger.mw.js) -----------------------------------------------------------------
test("request logger: POST body values and query values are never logged; safe metadata remains", async () => {
  const r = await call("POST", `/api/campaigns/draft/preview?${QUERY}`, { headers: gatewayHeaders(), body: BODY, decision: deny });
  assertClean(r.logs);
  const entry = rows(r.logs).find((x) => x.msg === "HTTP request");
  assert.ok(entry, "request log line present");
  assert.equal(entry.method, "POST");
  assert.equal(entry.route, "/api/campaigns/draft/preview");
  assert.equal(entry.status, 403);
  assert.equal(typeof entry.durationMs, "number");
  assert.equal(entry.correlationId, "corr-http-1");
  assert.ok(entry.requestId, "request id present");
  for (const k of Object.keys(entry)) {
    assert.ok(
      ["level", "time", "pid", "hostname", "msg", "method", "route", "status", "durationMs", "correlationId", "requestId", "userId", "tenantId", "userType", "outcome", "reqId"].includes(k),
      `unexpected field ${k}`,
    );
  }
});

test("request logger: unmatched path keeps plain segments and redacts the rest; no query", async () => {
  const r = await call("GET", `/api/nothing-here/${encodeURIComponent("probe.person@example.org")}?${QUERY}`, { decision: deny });
  assertClean(r.logs);
  assert.doesNotMatch(r.logs, /probe\.person/);
  const entry = rows(r.logs).find((x) => x.msg === "HTTP request");
  assert.equal(entry.route, "/api/nothing-here/:redacted");
  assert.equal(entry.status, 404);
});

test("request logger: requestLogEntry keeps only identifier-shaped ids", () => {
  const entry = requestLogEntry(
    { method: "GET", originalUrl: "/api/x?y=1", correlationId: "has spaces!", id: "req-1", userId: "a@b.c", tenantId: TENANT },
    { headersSent: true, statusCode: 200, writableFinished: true },
    3,
  );
  assert.deepEqual(entry, { method: "GET", route: "/api/x", status: 200, durationMs: 3, requestId: "req-1", tenantId: TENANT });
});

// --- guarded-route behaviour is unchanged (these responses also hold for the previous code) ---------
test("behaviour: DENY 403 body unchanged", async () => {
  const r = await call("GET", "/api/bookmarks/fields", { headers: gatewayHeaders(), decision: deny });
  assert.equal(r.status, 403);
  assert.deepEqual(JSON.parse(r.body), {
    success: false,
    error: "Insufficient permissions",
    reason: "INSUFFICIENT_PERMISSIONS",
    code: "PERMISSION_DENIED",
    resource: "communication",
    action: "read",
    requiredPermissions: ["communication:read"],
  });
});

test("behaviour: missing identity 401 body unchanged", async () => {
  const r = await call("GET", "/api/bookmarks/fields", { decision: deny });
  assert.equal(r.status, 401);
  assert.deepEqual(JSON.parse(r.body), { success: false, error: "Authentication required", code: "UNAUTHORIZED", status: 401 });
});

test("behaviour: PERMIT reaches the controller with the trusted tenant", async (t) => {
  const fake = installFakeModel(BookmarkField, { docs: [] });
  t.after(() => fake.restore());
  const r = await call("GET", "/api/bookmarks/fields", { headers: gatewayHeaders(), decision: permit });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).status, "success");
});

test("behaviour: /health is not logged by either logger", async () => {
  const r = await call("GET", "/health", { decision: deny });
  assert.equal(r.status, 200);
  assert.equal(rows(r.logs).filter((x) => x.msg === "HTTP request" || x.msg === "request completed").length, 0);
});
