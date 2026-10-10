// Phase 2B Stream 3C — internal letter routes (H-03/H-04, T-10, C1/C2/C7).
// Drives the REAL letter + correspondence routers over HTTP with in-memory
// model fakes (no DB). User identity is simulated with gateway headers and the
// policy-middleware's own AUTH_BYPASS_ENABLED path (PERMIT with req.user built
// from those headers) so no PDP is needed; the code under test is ours.
// Run: node --test tests/internalLetters.tenant.test.js
await import("./helpers/testEnv.js");
process.env.AUTH_BYPASS_ENABLED = "true";

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const express = (await import("express")).default;
const { installFakeModel } = await import("./helpers/fakeModel.js");

const GeneratedLetter = (await import("../model/generatedLetter.model.js")).default;
const Template = (await import("../model/template.model.js")).default;
const OutboundCommunication = (await import("../model/outboundCommunication.model.js")).default;
const letterRoutes = (await import("../routes/letter.routes.js")).default;
const correspondenceRoutes = (await import("../routes/correspondence.routes.js")).default;
const responseMiddleware = (await import("../middlewares/response.mw.js")).default;
const errorHandler = (await import("../middlewares/errorHandler.js")).default;
const letterCtrl = await import("../controllers/letter.controller.js");

const TENANT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const LETTER_A = "a00000000000000000000001";
const LETTER_B = "b00000000000000000000001";
const PROFILE_A = "a0000000000000000000000f";
const PROFILE_B = "b0000000000000000000000f";
const TEMPLATE_A = "a000000000000000000000aa";
const TEMPLATE_B = "b000000000000000000000bb";

const letters = installFakeModel(GeneratedLetter, {
  docs: [
    { _id: LETTER_A, tenantId: TENANT_A, profileId: PROFILE_A, memberId: PROFILE_A, fileName: "a.pdf", blobPath: `${TENANT_A}/${PROFILE_A}/a.pdf`, contentType: "pdf" },
    { _id: LETTER_B, tenantId: TENANT_B, profileId: PROFILE_B, memberId: PROFILE_B, fileName: "b.pdf", blobPath: `${TENANT_B}/${PROFILE_B}/b.pdf`, contentType: "pdf" },
  ],
});
installFakeModel(Template, {
  docs: [
    { _id: TEMPLATE_A, tenantId: TENANT_A, fileId: "file-a" },
    { _id: TEMPLATE_B, tenantId: TENANT_B, fileId: "file-b" },
  ],
});
const outbound = installFakeModel(OutboundCommunication, { unique: [["tenantId", "idempotencyKey"]] });

// Profiles "on record" per tenant, as profile-service's batch endpoint would return them.
const PROFILES = {
  [TENANT_A]: { [PROFILE_A]: { _id: PROFILE_A, contactInfo: { preferredEmail: "member.a@example.org", personalEmail: "a.personal@example.org" } } },
  [TENANT_B]: { [PROFILE_B]: { _id: PROFILE_B, contactInfo: { preferredEmail: "member.b@example.org" } } },
};
const sesCalls = [];
const profileCalls = [];
if (letterCtrl.letterDeps) {
  Object.assign(letterCtrl.letterDeps, {
    getOneDriveFile: async () => Buffer.from("docx"),
    collectMemberData: async () => ({}),
    mergeTemplate: () => Buffer.from("merged"),
    convertDocxToPdf: async () => Buffer.from("%PDF"),
    uploadLetter: async () => {},
    generateDownloadUrl: (p) => `https://blob.invalid/${p}`,
    sendSesMessage: async (opts) => {
      sesCalls.push(opts);
      return { MessageId: `ses-${sesCalls.length}` };
    },
    fetchProfilesBatch: async ({ profileIds, tenantId }) => {
      profileCalls.push({ profileIds, tenantId });
      return profileIds.map((id) => PROFILES[tenantId]?.[id]).filter(Boolean);
    },
  });
}

const app = express();
app.use(express.json());
app.use(responseMiddleware);
app.use("/api/letters", letterRoutes);
app.use("/api", correspondenceRoutes);
app.use(errorHandler);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

const internal = (tenantId) => ({ "x-internal-request": "true", ...(tenantId ? { "x-tenant-id": tenantId } : {}) });
const gatewayUser = (tenantId, userType, extra = {}) => ({
  "x-jwt-verified": "true",
  "x-auth-source": "gateway",
  "x-user-id": `user-${userType}-${tenantId.slice(0, 1)}`,
  "x-tenant-id": tenantId,
  "x-user-type": userType,
  "x-user-roles": "[]",
  "x-user-permissions": "[]",
  ...extra,
});

async function get(path, headers) {
  const r = await fetch(base + path, { headers });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(path, headers, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ---------------- GET /api/internal/letters/:id ----------------
test("L1 internal caller tenant A reads its own letter", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}`, internal(TENANT_A));
  assert.equal(r.status, 200);
  assert.equal(r.body.data.letter._id, LETTER_A);
});

test("L2 internal caller tenant A cannot read tenant B's letter", async () => {
  const r = await get(`/api/internal/letters/${LETTER_B}`, internal(TENANT_A));
  assert.equal(r.body?.data?.letter, undefined);
  assert.equal(r.body?.data ?? null, null);
});

test("L3 internal caller: query tenantId cannot widen scope to tenant B", async () => {
  const r = await get(`/api/internal/letters/${LETTER_B}?tenantId=${TENANT_B}`, internal(TENANT_A));
  assert.equal(r.body?.data ?? null, null);
});

test("L4 internal caller without x-tenant-id is rejected (no fallback tenant)", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}`, internal(null));
  assert.equal(r.status, 400);
});

test("L5 no internal header and no identity -> 403", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}`, {});
  assert.equal(r.status, 403);
});

test("L6 portal member (gateway identity) + x-internal-request cannot read a tenant letter (no ownership) -> 404", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}`, { ...gatewayUser(TENANT_A, "PORTAL"), "x-internal-request": "true" });
  assert.equal(r.status, 404);
  assert.equal(r.body?.data?.letter, undefined);
});

test("L7 portal member content download is denied -> 404", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}/content`, { ...gatewayUser(TENANT_A, "PORTAL"), "x-internal-request": "true" });
  assert.equal(r.status, 404);
  assert.equal(r.body?.data?.dataBase64, undefined);
});

test("L8 CRM user tenant A (permission granted) reads tenant A letter", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}`, gatewayUser(TENANT_A, "CRM"));
  assert.equal(r.status, 200);
  assert.equal(r.body.data.letter._id, LETTER_A);
});

test("L9 CRM user tenant A cannot read tenant B letter even with internal header + x-tenant-id B smuggled", async () => {
  // gateway identity wins: x-tenant-id here is the gateway-pinned user tenant (A);
  // a second spoofed tenant cannot be expressed, and the internal flag grants nothing.
  const r = await get(`/api/internal/letters/${LETTER_B}?tenantId=${TENANT_B}`, {
    ...gatewayUser(TENANT_A, "CRM"),
    "x-internal-request": "true",
  });
  assert.equal(r.status, 404);
});

test("L10 content route: no internal header and no identity -> 403", async () => {
  const r = await get(`/api/internal/letters/${LETTER_A}/content`, {});
  assert.equal(r.status, 403);
});

test("L11 internal letter queries always carry the tenant filter", async () => {
  const lookups = letters.calls.filter((c) => c.op === "findOne");
  assert.ok(lookups.length > 0);
  for (const c of lookups) assert.ok(c.filter.tenantId, `unscoped GeneratedLetter.findOne: ${JSON.stringify(c.filter)}`);
});

// ---------------- POST /api/letters/internal/generate ----------------
test("G1 user identity (gateway) + x-internal-request on internal generate -> 403, nothing generated", async () => {
  const before = letters.store.length;
  const r = await post("/api/letters/internal/generate", { ...gatewayUser(TENANT_A, "PORTAL"), "x-internal-request": "true" }, {
    memberId: PROFILE_A,
    templateId: TEMPLATE_A,
    deliver: { email: true, toAddress: "attacker@evil.test" },
  });
  assert.equal(r.status, 403);
  assert.equal(letters.store.length, before);
  assert.equal(sesCalls.length, 0);
});

test("G2 bearer token + x-internal-request on internal generate -> 403", async () => {
  const r = await post("/api/letters/internal/generate", { authorization: "Bearer x.y.z", ...internal(TENANT_A) }, {
    memberId: PROFILE_A,
    templateId: TEMPLATE_A,
  });
  assert.equal(r.status, 403);
  assert.equal(sesCalls.length, 0);
});

test("G3 internal caller tenant A cannot use tenant B's template", async () => {
  const r = await post("/api/letters/internal/generate", internal(TENANT_A), { memberId: PROFILE_A, templateId: TEMPLATE_B, tenantId: TENANT_B });
  assert.equal(r.body?.data ?? null, null);
  assert.equal(sesCalls.length, 0);
});

test("G4 relay closed: caller-supplied toAddress is never the destination; on-record email is used", async () => {
  const r = await post("/api/letters/internal/generate", internal(TENANT_A), {
    memberId: PROFILE_A,
    templateId: TEMPLATE_A,
    registrationId: "reg-g4",
    deliver: { email: true, toAddress: "attacker@evil.test" },
  });
  assert.equal(r.status, 201);
  assert.equal(sesCalls.length, 1);
  assert.equal(sesCalls[0].toAddress, "member.a@example.org");
  assert.ok(!JSON.stringify(sesCalls).includes("evil.test"));
  assert.deepEqual(profileCalls.at(-1), { profileIds: [PROFILE_A], tenantId: TENANT_A });
});

test("G5 caller toAddress equal to one of the member's on-record emails is honoured (events-service attendee email)", async () => {
  const r = await post("/api/letters/internal/generate", internal(TENANT_A), {
    memberId: PROFILE_A,
    templateId: TEMPLATE_A,
    registrationId: "reg-g5",
    deliver: { email: true, toAddress: "A.Personal@example.org" },
  });
  assert.equal(r.status, 201);
  assert.equal(sesCalls.at(-1).toAddress, "a.personal@example.org");
});

test("G6 member not on record in the header tenant (tenant B member via tenant A) -> no email sent", async () => {
  const n = sesCalls.length;
  const r = await post("/api/letters/internal/generate", internal(TENANT_A), {
    memberId: PROFILE_B,
    templateId: TEMPLATE_A,
    registrationId: "reg-g6",
    deliver: { email: true, toAddress: "member.b@example.org" },
  });
  assert.equal(r.status, 201);
  assert.equal(sesCalls.length, n, "no SES send for a member not in the caller tenant");
  assert.ok(r.body.data.warning);
  assert.ok(!/member\.b@example\.org/.test(r.body.data.warning));
  const row = outbound.store.find((o) => o.idempotencyKey === "certificate-issuance:reg-g6");
  assert.equal(row?.status, "failed");
  assert.equal(row?.tenantId, TENANT_A);
});

test("G7 idempotent: a retried issuance for an already-sent registration does not email twice", async () => {
  const n = sesCalls.length;
  const r = await post("/api/letters/internal/generate", internal(TENANT_A), {
    memberId: PROFILE_A,
    templateId: TEMPLATE_A,
    registrationId: "reg-g4",
    deliver: { email: true },
  });
  assert.equal(r.status, 201);
  assert.equal(sesCalls.length, n);
});

test("G8 the same registrationId in tenant B is independent of tenant A's idempotency record", async () => {
  // Add a tenant-B template-owned call: B's member, B's header.
  const n = sesCalls.length;
  const r = await post("/api/letters/internal/generate", internal(TENANT_B), {
    memberId: PROFILE_B,
    templateId: TEMPLATE_B,
    registrationId: "reg-g4",
    deliver: { email: true },
  });
  assert.equal(r.status, 201);
  assert.equal(sesCalls.length, n + 1);
  assert.equal(sesCalls.at(-1).toAddress, "member.b@example.org");
});

test("G9 events-service payload shape still works (x-internal-request + x-tenant-id, deliver.email + toAddress)", async () => {
  const r = await post("/api/letters/internal/generate", internal(TENANT_A), {
    memberId: PROFILE_A,
    templateId: TEMPLATE_A,
    registrationId: "reg-g9",
    deliver: { email: true, toAddress: "member.a@example.org" },
    mergeFields: { EventTitle: "X" },
  });
  assert.equal(r.status, 201);
  assert.ok(r.body.data.letterId);
  assert.equal(sesCalls.at(-1).toAddress, "member.a@example.org");
  const created = letters.store.find((l) => String(l._id) === String(r.body.data.letterId));
  assert.equal(created.tenantId, TENANT_A);
});
