// App-only Microsoft Graph authentication for document storage (OneDrive templates) uses the
// dedicated document-storage application only: GRAPH_DOCUMENT_CLIENT_ID / _TENANT_ID /
// _CLIENT_SECRET, never the old shared GRAPH_* variables (no fallback). Client credentials with
// https://graph.microsoft.com/.default and the in-memory token cache are unchanged. No token
// fragment, credential or raw Microsoft error detail is ever logged or returned, and
// GET /api/templates/test-graph-token answers { tokenAcquired } only.
// Microsoft is simulated by replacing axios.post; every logger line is captured.
// Run: node --test tests/graphDocumentAuth.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const pino = (await import("pino")).default;
const axios = (await import("axios")).default;
const logger = (await import("../config/logger.js")).default;
const graphAuth = await import("../services/graphAuth.service.js");
const { testGraphToken } = await import("../controllers/template.controller.js");

const NEW = {
  GRAPH_DOCUMENT_CLIENT_ID: "11111111-aaaa-4bbb-8ccc-000000000001",
  GRAPH_DOCUMENT_TENANT_ID: "22222222-aaaa-4bbb-8ccc-000000000002",
  GRAPH_DOCUMENT_CLIENT_SECRET: "NEW-DOCUMENT-SECRET-VALUE-0123456789",
};
const OLD = {
  GRAPH_CLIENT_ID: "33333333-aaaa-4bbb-8ccc-000000000003",
  GRAPH_TENANT_ID: "44444444-aaaa-4bbb-8ccc-000000000004",
  GRAPH_CLIENT_SECRET: "OLD-SHARED-SECRET-VALUE-9876543210",
};
const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6InRlc3QifQ.GRAPH-ACCESS-TOKEN-BODY.SIGNATURE-PART";
const RAW = "AADSTS7000215: Invalid client secret provided. Trace ID: RAW-TRACE-0001 Correlation ID: RAW-CORR-0002";

// ---- capture every logger line ----
const stream = logger[pino.symbols.streamSym];
const originalWrite = stream.write.bind(stream);
let logs = [];
stream.write = (chunk, ...rest) => {
  logs.push(String(chunk));
  return true;
};
test.after(() => {
  stream.write = originalWrite;
});

// ---- simulated Microsoft ----
const originalPost = axios.post;
let posts = [];
function microsoft(reply) {
  posts = [];
  axios.post = async (url, body, opts) => {
    posts.push({ url, body: String(body), opts });
    if (reply instanceof Error) throw reply;
    if (reply.status >= 400) {
      throw Object.assign(new Error(`Request failed with status code ${reply.status}`), {
        response: { status: reply.status, statusText: "Bad", data: reply.data },
        config: { data: String(body) },
      });
    }
    return { status: 200, data: reply.data };
  };
}
test.after(() => {
  axios.post = originalPost;
});
const ok = () => microsoft({ status: 200, data: { token_type: "Bearer", expires_in: 3599, access_token: TOKEN } });
const msError = (status, error, codes) =>
  microsoft({ status, data: { error, error_description: RAW, error_codes: codes, trace_id: "RAW-TRACE-0001", correlation_id: "RAW-CORR-0002" } });

function setEnv(vars) {
  for (const k of [...Object.keys(NEW), ...Object.keys(OLD)]) delete process.env[k];
  Object.assign(process.env, vars);
}
function reset(vars = NEW) {
  setEnv(vars);
  graphAuth._resetGraphTokenCacheForTests();
  logs = [];
  ok();
}
const allLogs = () => logs.join("");
const SENSITIVE = [
  TOKEN,
  ...TOKEN.split("."),
  TOKEN.slice(0, 20),
  NEW.GRAPH_DOCUMENT_CLIENT_SECRET,
  OLD.GRAPH_CLIENT_SECRET,
  NEW.GRAPH_DOCUMENT_CLIENT_ID.slice(0, 8),
  "AADSTS",
  "Invalid client secret",
  "RAW-TRACE-0001",
  "RAW-CORR-0002",
  "tokenPrefix",
  "tokenLength",
];
function assertNoLeak(text, where) {
  for (const s of SENSITIVE) assert.ok(!text.includes(s), `${where} must not contain ${JSON.stringify(s)}`);
}

test("token request uses the dedicated document app: client_credentials, Graph /.default, its own tenant", async () => {
  reset();
  const token = await graphAuth.getGraphToken();
  assert.equal(token, TOKEN);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, `https://login.microsoftonline.com/${NEW.GRAPH_DOCUMENT_TENANT_ID}/oauth2/v2.0/token`);
  const form = new URLSearchParams(posts[0].body);
  assert.equal(form.get("grant_type"), "client_credentials");
  assert.equal(form.get("scope"), "https://graph.microsoft.com/.default");
  assert.equal(form.get("client_id"), NEW.GRAPH_DOCUMENT_CLIENT_ID);
  assert.equal(form.get("client_secret"), NEW.GRAPH_DOCUMENT_CLIENT_SECRET);
  assert.deepEqual([...form.keys()].sort(), ["client_id", "client_secret", "grant_type", "scope"]);
});

test("old shared GRAPH_* variables are ignored even when both sets are present", async () => {
  reset({ ...NEW, ...OLD });
  await graphAuth.getGraphToken();
  const sent = posts[0].url + posts[0].body;
  for (const v of Object.values(OLD)) assert.ok(!sent.includes(v), "old value must not be used");
});

for (const missing of Object.keys(NEW)) {
  test(`no fallback: ${missing} missing -> fails closed even with the old GRAPH_* set, Microsoft not contacted`, async () => {
    const vars = { ...NEW, ...OLD };
    delete vars[missing];
    reset(vars);
    await assert.rejects(graphAuth.getGraphToken(), (e) => e.message.includes(missing));
    assert.equal(posts.length, 0);
  });
}

test("only the old GRAPH_* variables configured -> fails closed (no fallback)", async () => {
  reset(OLD);
  await assert.rejects(graphAuth.getGraphToken());
  assert.equal(posts.length, 0);
});

test("token caching unchanged: a second call within the cache window reuses the token", async () => {
  reset();
  await graphAuth.getGraphToken();
  await graphAuth.getGraphToken();
  assert.equal(posts.length, 1);
  graphAuth._resetGraphTokenCacheForTests();
  await graphAuth.getGraphToken();
  assert.equal(posts.length, 2);
});

test("success logs contain no token fragment, length, credential or client-id prefix", async () => {
  reset();
  assert.equal(await graphAuth.getGraphToken(), TOKEN);
  assert.equal(posts.length, 1);
  assertNoLeak(allLogs(), "logs");
});

test("Microsoft error: only status / structured error / numeric codes logged; thrown error carries no response data", async () => {
  reset();
  msError(401, "invalid_client", [7000215]);
  let err;
  try {
    await graphAuth.getGraphToken();
  } catch (e) {
    err = e;
  }
  assert.ok(err, "must throw");
  const logText = allLogs();
  assertNoLeak(logText, "logs");
  assert.ok(logText.includes("401") && logText.includes("invalid_client") && logText.includes("7000215"), "safe fields are logged");
  assert.equal(err.originalError, undefined);
  assert.equal(err.details?.responseData, undefined);
  assertNoLeak(JSON.stringify({ message: err.message, details: err.details }), "thrown error");
  assert.ok(!JSON.stringify(err.details ?? {}).includes("error_description"));
});

test("network failure: no request config (which carries the credential) is logged or attached", async () => {
  reset();
  microsoft(Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT", config: { data: `client_secret=${NEW.GRAPH_DOCUMENT_CLIENT_SECRET}` } }));
  let err;
  try {
    await graphAuth.getGraphToken();
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assertNoLeak(allLogs(), "logs");
  assert.equal(err.originalError, undefined);
  assertNoLeak(JSON.stringify({ message: err.message, details: err.details }), "thrown error");
});

test("200 without access_token -> fails without logging the response body", async () => {
  reset();
  microsoft({ status: 200, data: { token_type: "Bearer", error_description: RAW } });
  await assert.rejects(graphAuth.getGraphToken());
  assertNoLeak(allLogs(), "logs");
});

// ---- GET /api/templates/test-graph-token ----
function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (s) => ((res.statusCode = s), res);
  res.json = (b) => ((res.body = b), res);
  res.success = (data, message = "Success") => res.status(200).json({ status: "success", message, data });
  res.fail = (message = "Bad request", status = 400, details = {}) => res.status(status).json({ status: "fail", message, details });
  return res;
}
const req = { userId: "u1", tenantId: "t1" };

test("test-graph-token: success returns { tokenAcquired: true } only", async () => {
  reset();
  const res = fakeRes();
  await testGraphToken(req, res, (e) => assert.fail(e));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { tokenAcquired: true });
  assertNoLeak(JSON.stringify(res.body), "response");
});

test("test-graph-token: failure returns { tokenAcquired: false } only, no Microsoft text", async () => {
  reset();
  msError(401, "invalid_client", [7000215]);
  const res = fakeRes();
  await testGraphToken(req, res, (e) => assert.fail(e));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body.details, { tokenAcquired: false });
  assertNoLeak(JSON.stringify(res.body), "response");
  assert.ok(!JSON.stringify(res.body).includes("invalid_client"));
});

test("test-graph-token: missing configuration returns { tokenAcquired: false } and names no variable values", async () => {
  reset({});
  const res = fakeRes();
  await testGraphToken(req, res, (e) => assert.fail(e));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body.details, { tokenAcquired: false });
});

test("test-graph-token: still requires an authenticated caller", async () => {
  reset();
  const res = fakeRes();
  await testGraphToken({}, res, (e) => assert.fail(e));
  assert.equal(res.statusCode, 401);
  assert.equal(posts.length, 0);
});

test("config/graph.js keeps getGraphClient and no longer exports credential configuration", async () => {
  const graphConfigModule = await import("../config/graph.js");
  assert.equal(typeof graphConfigModule.getGraphClient, "function");
  assert.equal(graphConfigModule.graphConfig, undefined);
});
