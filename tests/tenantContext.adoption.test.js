// Phase 1A adoption — communication-service tenant-context guard (WARN MODE).
// Native node:test (ESM).  Run: node --test tests/tenantContext.adoption.test.js
//
// communication-service has NO local authenticate middleware: identity and
// req.tenantId are established inside the shared
// defaultPolicyMiddleware.requirePermission("communication", <action>), and only
// AFTER a PERMIT. The guard is therefore mounted per-route AFTER requirePermission
// and BEFORE the controller: requirePermission(...) -> tenantContextWarn -> handler.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must be set before importing anything that pulls in logging-lib.
process.env.LOG_ROOT =
  process.env.LOG_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "comm-tenantctx-"));
process.env.NODE_ENV = process.env.NODE_ENV || "test";

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;

const policyMw = await import("@membership/policy-middleware");
const { tenantContextMiddleware, resolveTenantContext } = policyMw;
const mw = await import("../middlewares/tenantContext.mw.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const TRUSTED = "68cbf7806080b4621d469d34";
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaa";

// Count guard insertions on their own line.
const guardCount = (rel) =>
  (read(path.join("routes", rel)).match(/^\s*tenantContextWarn,\s*$/gm) || []).length;
// Count requirePermission -> tenantContextWarn -> handler orderings.
const orderedCount = (rel) =>
  (read(path.join("routes", rel)).match(
    /requirePermission\("communication",\s*"\w+"\),\s*\n\s*tenantContextWarn,\s*\n\s*[A-Za-z]/g
  ) || []).length;

function gatewayReq(o = {}) {
  return {
    method: "GET",
    url: "/api/templates",
    originalUrl: "/api/templates",
    headers: {
      "x-jwt-verified": "true",
      "x-auth-source": "gateway",
      "x-user-id": "U1",
      "x-tenant-id": TRUSTED,
      ...(o.headers || {}),
    },
    ctx: o.ctx !== undefined ? o.ctx : { tenantId: TRUSTED, userId: "U1" },
    tenantId: o.tenantId,
    body: o.body,
    query: o.query,
    params: o.params,
  };
}
function mkRes() {
  const r = { statusCode: null, _s: [] };
  r.status = (c) => ((r.statusCode = c), r._s.push(c), r);
  r.json = () => r;
  return r;
}
function run(req) {
  const res = mkRes();
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (s) => (chunks.push(typeof s === "string" ? s : s.toString()), true);
  let n = 0;
  try {
    mw.tenantContextWarn(req, res, () => (n += 1));
  } finally {
    process.stdout.write = orig;
  }
  const rows = chunks
    .join("")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return { req, res, nextCount: n, rows };
}

// ---- static structure ----
test("1 tenantContextWarn exists (exported, callable)", () => {
  assert.equal(typeof mw.tenantContextWarn, "function");
});
test("2 mode is warn; no enforce", () => {
  const src = read(path.join("middlewares", "tenantContext.mw.js"));
  assert.match(src, /tenantContextMiddleware\(\{\s*mode:\s*"warn"\s*\}\)/);
  assert.ok(!/mode:\s*"enforce"/.test(src));
});
test("3 template router: 8 guarded", () => assert.equal(guardCount("template.routes.js"), 8));
test("4 campaign router: 10 guarded", () => assert.equal(guardCount("campaign.routes.js"), 10));
test("5 letter router: 1 guarded", () => assert.equal(guardCount("letter.routes.js"), 1));
test("6 correspondence router: 2 guarded", () => assert.equal(guardCount("correspondence.routes.js"), 2));
test("7 bookmark router: 4 guarded", () => assert.equal(guardCount("bookmark.routes.js"), 4));
test("8 total guarded = 25", () => {
  const total =
    guardCount("template.routes.js") +
    guardCount("campaign.routes.js") +
    guardCount("letter.routes.js") +
    guardCount("correspondence.routes.js") +
    guardCount("bookmark.routes.js");
  assert.equal(total, 25);
});
test("9 guard occurs AFTER requirePermission and BEFORE a handler (every guarded route)", () => {
  for (const [f, n] of [
    ["template.routes.js", 8],
    ["campaign.routes.js", 10],
    ["letter.routes.js", 1],
    ["correspondence.routes.js", 2],
    ["bookmark.routes.js", 4],
  ]) {
    assert.equal(orderedCount(f), n, `${f}: requirePermission->tenantContextWarn->handler count`);
    // and never guarded before requirePermission
    assert.ok(
      !/tenantContextWarn,\s*\n\s*defaultPolicyMiddleware\.requirePermission/.test(read(path.join("routes", f))),
      `${f}: guard must not precede requirePermission`
    );
  }
});
test("10 the 5 route-level exclusions remain unguarded", () => {
  const camp = read(path.join("routes", "campaign.routes.js"));
  assert.match(camp, /router\.get\("\/unsubscribe",\s*getUnsubscribe\);/);
  assert.match(camp, /router\.post\("\/system\/process-due",\s*postProcessDue\);/);
  const letter = read(path.join("routes", "letter.routes.js"));
  assert.match(letter, /router\.post\("\/internal\/generate",\s*generateLetterInternal\);/);
  const corr = read(path.join("routes", "correspondence.routes.js"));
  // the two /internal/letters/* routes have their handler directly, no guard between
  const seg = corr.slice(corr.indexOf('/internal/letters/:letterId"'), corr.indexOf("/letters/profile"));
  assert.ok(!seg.includes("tenantContextWarn"), "internal letters routes must be unguarded");
});
test("11 app.js unchanged: no guard; webhook/health/system-logs still public", () => {
  const app = read("app.js");
  assert.ok(!app.includes("tenantContextWarn"), "app.js must not reference the guard");
  assert.ok(app.includes('"/api/webhooks/ses-sns"'), "SES-SNS webhook still mounted");
  assert.ok(app.includes('app.get("/health"'), "/health still public");
  assert.ok(app.includes("createSystemLogsRouter"), "/api/system-logs still mounted");
});
test("12 policy.middleware.js unchanged (no guard reference)", () => {
  assert.ok(!read(path.join("middlewares", "policy.middleware.js")).includes("tenantContextWarn"));
});
test("13 package files unchanged (shared-dep SHAs still pinned)", () => {
  const pkg = read("package.json");
  assert.match(pkg, /policy-middleware\.git#1d4a3b991c6bb3374e424e220f745b48d41e3ee7/);
  assert.match(pkg, /logging-lib\.git#5fd251bde4ad08ba71cf9844656b5bc126e13b43/);
  assert.match(pkg, /rabbitmq-middleware\.git#db70fb8ae7a6e62f2a96df1f68b41ec4944d5123/);
  assert.ok(!pkg.includes("tenantContextWarn"));
});

// ---- runtime behaviour (WARN, non-blocking) ----
test("14 trusted tenant authoritative; next() called; no status set", () => {
  const { req, nextCount, res } = run(gatewayReq());
  assert.equal(req.tenantId, TRUSTED);
  assert.equal(nextCount, 1);
  assert.equal(res.statusCode, null);
});
test("15 query mismatch cannot replace trusted tenant", () => {
  const { req, nextCount } = run(gatewayReq({ query: { tenantId: OTHER } }));
  assert.equal(req.tenantId, TRUSTED);
  assert.equal(nextCount, 1);
});
test("16 body mismatch cannot replace trusted tenant", () => {
  const { req, nextCount } = run(gatewayReq({ body: { tenantId: OTHER } }));
  assert.equal(req.tenantId, TRUSTED);
  assert.equal(nextCount, 1);
});
test("17 mismatch emits TenantContextMismatch (mode=warn, outcome=ignored, no 403)", () => {
  const { rows, res } = run(gatewayReq({ query: { tenantId: OTHER } }));
  const row = rows.find((r) => r.eventType === "TenantContextMismatch");
  assert.ok(row, "a TenantContextMismatch row is emitted");
  assert.equal(row.mode, "warn");
  assert.equal(row.outcome, "ignored");
  assert.equal(row.trustedTenantId, TRUSTED);
  assert.ok(row.suppliedSources.includes("query"));
  assert.ok(!res._s.includes(403));
});
test("18 matching tenant emits no mismatch", () => {
  const { rows } = run(gatewayReq({ body: { tenantId: TRUSTED } }));
  assert.equal(rows.find((r) => r.eventType === "TenantContextMismatch"), undefined);
});
test("19 WARN only: mismatch is non-blocking (no 403, next called) and mode is warn", () => {
  const { res, nextCount } = run(gatewayReq({ query: { tenantId: OTHER } }));
  assert.ok(!res._s.includes(403));
  assert.equal(res.statusCode, null);
  assert.equal(nextCount, 1);
  const src = read(path.join("middlewares", "tenantContext.mw.js"));
  assert.match(src, /mode:\s*"warn"/);
  assert.ok(!/mode:\s*"enforce"/.test(src));
});
test("20 installed package exposes tenantContextMiddleware + resolveTenantContext", () => {
  assert.equal(typeof tenantContextMiddleware, "function");
  assert.equal(typeof resolveTenantContext, "function");
});
