// P5 portal object-authorization remediation — security proof matrix.
// Run: node --test tests/portalAuthz.p5.test.js
//
// Drives the REAL routers over HTTP. The PDP (user-service /policy/evaluate) is
// MOCKED by a local HTTP server, so the real @membership/policy-middleware runs
// end to end (gateway headers -> PDP -> req.user) and the PDP can actually DENY
// (AUTH_BYPASS_ENABLED is NOT used here: it permits everything). Mock rule:
// PERMIT iff the caller's permissions include communication:* or
// communication:<action>; the verified user (id/tenant/userType) is echoed from
// the gateway identity headers, as the real PDP returns it. Models are in-memory
// fakes; no DB, no Azure, no SES, no live calls.
import http from "node:http";

const pdpCalls = [];
const pdp = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const h = req.headers;
    let perms = [];
    try {
      perms = JSON.parse(h["x-user-permissions"] || "[]");
    } catch {
      perms = [];
    }
    const { resource, action } = body;
    pdpCalls.push({ resource, action, userType: h["x-user-type"] ?? null });
    const permit =
      req.url === "/policy/evaluate" &&
      (perms.includes(`${resource}:*`) || perms.includes(`${resource}:${action}`));
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        permit
          ? {
              success: true,
              decision: "PERMIT",
              user: {
                id: h["x-user-id"],
                tenantId: h["x-tenant-id"],
                userType: h["x-user-type"] ?? null,
                roles: [],
                permissions: perms,
              },
            }
          : { success: true, decision: "DENY", reason: "INSUFFICIENT_PERMISSIONS" }
      )
    );
  });
});
await new Promise((r) => pdp.listen(0, "127.0.0.1", r));
process.env.POLICY_SERVICE_URL = `http://127.0.0.1:${pdp.address().port}`;
delete process.env.AUTH_BYPASS_ENABLED;
process.env.PROCESS_CAMPAIGN_SECRET = "test-process-secret-not-real";
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const fs = await import("node:fs");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const express = (await import("express")).default;
const mongoose = (await import("mongoose")).default;
mongoose.set("bufferCommands", false); // anything un-faked fails fast, never hangs
const { installFakeModel } = await import("./helpers/fakeModel.js");

const GeneratedLetter = (await import("../model/generatedLetter.model.js")).default;
const OutboundCommunication = (await import("../model/outboundCommunication.model.js")).default;
const Campaign = (await import("../model/campaign.model.js")).default;
const Template = (await import("../model/template.model.js")).default;
const responseMiddleware = (await import("../middlewares/response.mw.js")).default;
const errorHandler = (await import("../middlewares/errorHandler.js")).default;
const { requireCrmUser } = await import("../middlewares/requireCrmUser.js");
const templateRoutes = (await import("../routes/template.routes.js")).default;
const campaignRoutes = (await import("../routes/campaign.routes.js")).default;
const letterRoutes = (await import("../routes/letter.routes.js")).default;
const correspondenceRoutes = (await import("../routes/correspondence.routes.js")).default;
const bookmarkRoutes = (await import("../routes/bookmark.routes.js")).default;

const TENANT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_C = "cccccccccccccccccccccccc";
const PROFILE_A = "a0000000000000000000000a"; // portal member A (tenant A)
const PROFILE_B = "a0000000000000000000000b"; // member B (same tenant A)
const PROFILE_C = "c0000000000000000000000c"; // member C (tenant C)
const LETTER_A = "a000000000000000000000a1";
const LETTER_B = "a000000000000000000000b1";
const LETTER_C = "c000000000000000000000c1";
const OBJ = "a000000000000000000000ff"; // any well-formed id for :id routes

const letters = installFakeModel(GeneratedLetter, {
  docs: [
    { _id: LETTER_A, tenantId: TENANT_A, profileId: PROFILE_A, memberId: PROFILE_A, fileName: "a.pdf", blobPath: "a/a.pdf", contentType: "pdf" },
    { _id: LETTER_B, tenantId: TENANT_A, profileId: PROFILE_B, memberId: PROFILE_B, fileName: "b.pdf", blobPath: "a/b.pdf", contentType: "pdf" },
    { _id: LETTER_C, tenantId: TENANT_C, profileId: PROFILE_C, memberId: PROFILE_C, fileName: "c.pdf", blobPath: "c/c.pdf", contentType: "pdf" },
  ],
});
const outbound = installFakeModel(OutboundCommunication, {
  docs: [
    { _id: "a000000000000000000000e1", tenantId: TENANT_A, profileId: PROFILE_A, channel: "email" },
    { _id: "a000000000000000000000e2", tenantId: TENANT_A, profileId: PROFILE_B, channel: "email" },
    { _id: "c000000000000000000000e3", tenantId: TENANT_C, profileId: PROFILE_C, channel: "email" },
  ],
});
const campaigns = installFakeModel(Campaign, {
  docs: [
    { _id: "a000000000000000000000c1", tenantId: TENANT_A, name: "A" },
    { _id: "c000000000000000000000c2", tenantId: TENANT_C, name: "C" },
  ],
});
const templates = installFakeModel(Template, {
  docs: [
    { _id: "a000000000000000000000d1", tenantId: TENANT_A, name: "TA" },
    { _id: "c000000000000000000000d2", tenantId: TENANT_C, name: "TC" },
  ],
});

const app = express();
app.use(express.json());
app.use(responseMiddleware);
app.use("/api/templates", templateRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/letters", letterRoutes);
app.use("/api", correspondenceRoutes);
app.use("/api/bookmarks", bookmarkRoutes);
app.use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  server.close();
  pdp.close();
});

// Distinct user id per identity shape (the PDP decision cache key includes the
// full identity, but distinct ids keep every scenario independent anyway).
let seq = 0;
function identity({ tenantId = TENANT_A, userType, perms = ["communication:*"], extra = {} } = {}) {
  seq += 1;
  const h = {
    "x-jwt-verified": "true",
    "x-auth-source": "gateway",
    "x-user-id": `u${String(seq).padStart(5, "0")}`,
    "x-tenant-id": tenantId,
    "x-user-roles": "[]",
    "x-user-permissions": JSON.stringify(perms),
    ...extra,
  };
  if (userType !== undefined) h["x-user-type"] = userType;
  return h;
}
const portalA = (o = {}) => identity({ userType: "PORTAL", ...o });
const crmA = (o = {}) => identity({ userType: "CRM", ...o });

async function call(method, p, headers = {}, body) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await fetch(base + p, init);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, body: json };
}

// Every administrative route: [method, path, body]. 25 = every route that
// carries requirePermission in the five routers.
const ADMIN_ROUTES = [
  ["POST", "/api/campaigns/draft/preview", { subject: "s", bodyHtml: "x", profileId: PROFILE_B }],
  ["POST", "/api/campaigns/draft/test-email", { subject: "s", bodyHtml: "x", profileId: PROFILE_B }],
  ["POST", "/api/campaigns", { name: "n", audienceProfileIds: [PROFILE_B, PROFILE_C] }],
  ["GET", "/api/campaigns"],
  ["GET", `/api/campaigns/${OBJ}/recipients`],
  ["POST", `/api/campaigns/${OBJ}/preview`, { profileId: PROFILE_B }],
  ["POST", `/api/campaigns/${OBJ}/test-email`, { profileId: PROFILE_B }],
  ["POST", `/api/campaigns/${OBJ}/send`, {}],
  ["PATCH", `/api/campaigns/${OBJ}/cancel`, {}],
  ["GET", `/api/campaigns/${OBJ}`],
  ["POST", "/api/templates/upload", {}],
  ["GET", "/api/templates"],
  ["POST", "/api/templates/email", { name: "t" }],
  ["GET", "/api/templates/test-graph-token"],
  ["GET", `/api/templates/${OBJ}`],
  ["PUT", `/api/templates/${OBJ}`, { name: "t2" }],
  ["DELETE", `/api/templates/${OBJ}`],
  ["POST", `/api/templates/${OBJ}/extract-placeholders`, {}],
  ["GET", "/api/bookmarks/fields"],
  ["POST", "/api/bookmarks/fields", { key: "k", label: "l" }],
  ["PUT", `/api/bookmarks/fields/${OBJ}`, { label: "l" }],
  ["DELETE", `/api/bookmarks/fields/${OBJ}`],
  ["POST", "/api/letters/generate", { templateId: OBJ, memberId: PROFILE_B }],
  ["GET", `/api/letters/profile/${PROFILE_B}`],
  ["GET", `/api/correspondence/profile/${PROFILE_B}`],
];

const isCrmOnly = (r) => r.status === 403 && r.body?.code === "CRM_ONLY";
const isPdpDeny = (r) => r.status === 403 && r.body?.code === "PERMISSION_DENIED";

// ---------------- portal member: every admin route denied ----------------
test("P1 portal member holding communication:* is denied every administrative route (403 CRM_ONLY)", async () => {
  assert.equal(ADMIN_ROUTES.length, 25);
  for (const [m, p, b] of ADMIN_ROUTES) {
    const r = await call(m, p, portalA(), b);
    assert.ok(isCrmOnly(r), `${m} ${p}: expected 403 CRM_ONLY, got ${r.status} ${r.body?.code}`);
    assert.equal(r.body?.data, undefined, `${m} ${p}: no data on denial`);
  }
});

test("P2 portal member holding the exact per-action permission is still denied", async () => {
  const perAction = { GET: "read", POST: "create", PUT: "write", PATCH: "write", DELETE: "delete" };
  for (const [m, p, b] of ADMIN_ROUTES) {
    const perms = ["communication:read", "communication:create", "communication:write", "communication:delete"];
    const r = await call(m, p, portalA({ perms }), b);
    assert.ok(isCrmOnly(r), `${m} ${p} (${perAction[m]}): got ${r.status} ${r.body?.code}`);
  }
});

test("P3 missing or unknown userType fails closed (403 CRM_ONLY)", async () => {
  for (const userType of [undefined, "", "MEMBER", "portal-admin", "SYSTEM"]) {
    for (const [m, p, b] of ADMIN_ROUTES) {
      const r = await call(m, p, identity({ userType }), b);
      assert.ok(isCrmOnly(r), `${String(userType)} ${m} ${p}: got ${r.status} ${r.body?.code}`);
    }
  }
});

test("P4 portal member + x-internal-request gains nothing on admin routes", async () => {
  for (const [m, p, b] of ADMIN_ROUTES) {
    const r = await call(m, p, portalA({ extra: { "x-internal-request": "true" } }), b);
    assert.ok(isCrmOnly(r), `${m} ${p}: got ${r.status} ${r.body?.code}`);
  }
});

test("P5 portal member without the permission is denied by the PDP (never reaches the gate)", async () => {
  for (const [m, p, b] of ADMIN_ROUTES) {
    const r = await call(m, p, portalA({ perms: [] }), b);
    assert.ok(isPdpDeny(r), `${m} ${p}: got ${r.status} ${r.body?.code}`);
  }
});

// ---------------- CRM staff ----------------
test("C1 CRM staff WITHOUT the communication permission is denied every route (PDP 403)", async () => {
  for (const [m, p, b] of ADMIN_ROUTES) {
    const r = await call(m, p, crmA({ perms: [] }), b);
    assert.ok(isPdpDeny(r), `${m} ${p}: got ${r.status} ${r.body?.code}`);
  }
});

test("C2 CRM staff WITH the permission passes the gate on lists (200, tenant-scoped)", async () => {
  campaigns.calls.length = 0;
  templates.calls.length = 0;
  const c = await call("GET", "/api/campaigns", crmA());
  assert.equal(c.status, 200);
  assert.deepEqual(c.body.data.campaigns.map((x) => x.tenantId), [TENANT_A]);
  assert.equal(campaigns.calls.at(-1).filter.tenantId, TENANT_A);

  const t = await call("GET", "/api/templates", crmA());
  assert.equal(t.status, 200);
  assert.deepEqual(t.body.data.templates.map((x) => x.tenantId), [TENANT_A]);

  const other = await call("GET", "/api/campaigns/c000000000000000000000c2", crmA());
  assert.notEqual(other.body?.data?.campaign?.tenantId, TENANT_C, "CRM A cannot read tenant C's campaign");
});

test("C3 CRM staff (per-action permission, not *) passes the gate on every read route", async () => {
  // Gate-pass proof only: the handler may then 4xx/5xx on the un-faked models,
  // but never with the gate's CRM_ONLY or the PDP's denial. Only GET routes are
  // driven: mutating handlers reach OneDrive / profile-service / SES, which this
  // offline suite must never call. test-graph-token is skipped for the same
  // reason (its handler calls Microsoft Graph). The gate for mutating routes is
  // proven by M1 (middleware) + M2 (every route wired) + P1-P5 (denials).
  const perms = ["communication:read"];
  for (const [m, p, b] of ADMIN_ROUTES) {
    if (m !== "GET" || p.endsWith("/test-graph-token")) continue;
    const r = await call(m, p, crmA({ perms }), b);
    assert.ok(!isCrmOnly(r) && !isPdpDeny(r) && r.status !== 401, `${m} ${p}: got ${r.status} ${r.body?.code}`);
  }
});

// ---------------- letter / correspondence object matrix ----------------
for (const [label, prefix, key, fake] of [
  ["letters", "/api/letters/profile", "letters", letters],
  ["correspondence", "/api/correspondence/profile", "correspondence", outbound],
]) {
  test(`O1 ${label}: portal A on OWN profile is denied (portal does not use this route; staff-only)`, async () => {
    const r = await call("GET", `${prefix}/${PROFILE_A}`, portalA());
    assert.ok(isCrmOnly(r), `got ${r.status} ${r.body?.code}`);
    assert.equal(r.body?.data, undefined);
  });
  test(`O2 ${label}: portal A on member B (same tenant) is denied, nothing leaked`, async () => {
    const before = fake.calls.length;
    const r = await call("GET", `${prefix}/${PROFILE_B}`, portalA());
    assert.ok(isCrmOnly(r));
    assert.equal(r.body?.data, undefined);
    assert.equal(fake.calls.length, before, "no query ran for a denied caller");
  });
  test(`O3 ${label}: portal A on member C (other tenant) is denied, nothing leaked`, async () => {
    const r = await call("GET", `${prefix}/${PROFILE_C}`, portalA());
    assert.ok(isCrmOnly(r));
    assert.equal(r.body?.data, undefined);
  });
  test(`O4 ${label}: CRM A lists member B (same tenant) -> 200, tenant-scoped`, async () => {
    const r = await call("GET", `${prefix}/${PROFILE_B}`, crmA());
    assert.equal(r.status, 200);
    const rows = r.body.data[key];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenantId, TENANT_A);
    assert.equal(fake.calls.at(-1).filter.tenantId, TENANT_A);
  });
  test(`O5 ${label}: CRM A on member C (other tenant) -> 200 empty, query pinned to tenant A`, async () => {
    const r = await call("GET", `${prefix}/${PROFILE_C}`, crmA());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data[key], []);
    assert.equal(fake.calls.at(-1).filter.tenantId, TENANT_A);
  });
  test(`O6 ${label}: CRM A with ?tenantId=C cannot widen scope`, async () => {
    const r = await call("GET", `${prefix}/${PROFILE_C}?tenantId=${TENANT_C}`, crmA());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data[key], []);
    assert.equal(fake.calls.at(-1).filter.tenantId, TENANT_A);
  });
}

test("O7 letters/generate: portal A cannot generate a letter for any member (own, B, C)", async () => {
  for (const memberId of [PROFILE_A, PROFILE_B, PROFILE_C]) {
    const r = await call("POST", "/api/letters/generate", portalA(), { templateId: OBJ, memberId });
    assert.ok(isCrmOnly(r), `${memberId}: got ${r.status} ${r.body?.code}`);
  }
});

// ---------------- correctly-protected flows stay unchanged ----------------
test("U1 GET /campaigns/unsubscribe stays identity-free (HMAC token decides, no CRM gate)", async () => {
  const anon = await call("GET", `/api/campaigns/unsubscribe?p=${PROFILE_A}&c=${OBJ}&t=bad`);
  assert.equal(anon.status, 400);
  assert.notEqual(anon.body?.code, "CRM_ONLY");
  const portal = await call("GET", `/api/campaigns/unsubscribe?p=${PROFILE_A}&c=${OBJ}&t=bad`, portalA());
  assert.equal(portal.status, 400);
  assert.notEqual(portal.body?.code, "CRM_ONLY");
});

test("U2 POST /campaigns/system/process-due stays secret-guarded (no CRM gate, no PDP)", async () => {
  const before = pdpCalls.length;
  const r = await call("POST", "/api/campaigns/system/process-due", { "x-process-secret": "wrong" }, {});
  assert.equal(r.status, 403);
  assert.equal(r.body?.message, "Forbidden");
  assert.notEqual(r.body?.code, "CRM_ONLY");
  assert.equal(pdpCalls.length, before, "no PDP call for the system route");
});

test("U3 /internal/letters/:id unchanged: internal caller reads own-tenant letter; portal 404; CRM 200", async () => {
  const internal = await call("GET", `/api/internal/letters/${LETTER_A}`, { "x-internal-request": "true", "x-tenant-id": TENANT_A });
  assert.equal(internal.status, 200);
  assert.equal(internal.body.data.letter._id, LETTER_A);
  const cross = await call("GET", `/api/internal/letters/${LETTER_C}`, { "x-internal-request": "true", "x-tenant-id": TENANT_A });
  assert.equal(cross.body?.data ?? null, null);
  const portal = await call("GET", `/api/internal/letters/${LETTER_A}`, portalA());
  assert.equal(portal.status, 404);
  const crm = await call("GET", `/api/internal/letters/${LETTER_A}`, crmA());
  assert.equal(crm.status, 200);
});

test("U4 /letters/internal/generate unchanged: user sessions rejected (403, not the CRM gate)", async () => {
  for (const h of [portalA(), crmA()]) {
    const r = await call("POST", "/api/letters/internal/generate", h, { templateId: OBJ, memberId: PROFILE_A });
    assert.equal(r.status, 403);
    assert.notEqual(r.body?.code, "CRM_ONLY");
  }
});

// ---------------- middleware unit + static coverage ----------------
test("M1 requireCrmUser: CRM (any case) passes; PORTAL / unknown / missing user -> 403 CRM_ONLY", () => {
  const run = (req) => {
    let arg = "unset";
    requireCrmUser(req, {}, (e) => (arg = e));
    return arg;
  };
  assert.equal(run({ user: { userType: "CRM" } }), undefined);
  assert.equal(run({ user: { userType: "crm" } }), undefined);
  for (const req of [{}, { user: null }, { user: {} }, { user: { userType: "PORTAL" } }, { user: { userType: "X" } }]) {
    const e = run(req);
    assert.equal(e?.status, 403);
    assert.equal(e?.code, "CRM_ONLY");
  }
  // header-claimed CRM is ignored: only req.user (PDP-verified) counts
  const e = run({ headers: { "x-user-type": "CRM" }, user: { userType: "PORTAL" } });
  assert.equal(e?.code, "CRM_ONLY");
});

test("M2 every requirePermission route carries requireCrmUser right after tenantContextWarn (25); exclusions untouched", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "routes");
  let gated = 0;
  let permissioned = 0;
  for (const f of ["template", "campaign", "letter", "correspondence", "bookmark"]) {
    const src = fs.readFileSync(path.join(dir, `${f}.routes.js`), "utf8");
    permissioned += (src.match(/defaultPolicyMiddleware\.requirePermission\(/g) || []).length;
    gated += (
      src.match(/requirePermission\("communication",\s*"\w+"\),\s*\n\s*tenantContextWarn,\s*\n\s*requireCrmUser,\s*\n/g) || []
    ).length;
    if (f === "campaign") {
      assert.match(src, /router\.get\("\/unsubscribe",\s*getUnsubscribe\);/);
      assert.match(src, /router\.post\("\/system\/process-due",\s*postProcessDue\);/);
    }
    if (f === "letter") assert.match(src, /router\.post\("\/internal\/generate",\s*generateLetterInternal\);/);
    if (f === "correspondence") {
      const seg = src.slice(src.indexOf('"/internal/letters/:letterId"'), src.indexOf('"/letters/profile'));
      assert.ok(!seg.includes("requireCrmUser"), "internal letter routes keep internalOrUserRead only");
    }
  }
  assert.equal(permissioned, 25);
  assert.equal(gated, 25);
});
