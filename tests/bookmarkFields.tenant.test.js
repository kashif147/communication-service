// Phase 2B Stream 3C — BookmarkField tenancy (H-23, C3).
// Calls the REAL bookmark controller handlers / merge service with an
// in-memory BookmarkField fake (no DB).
// Run: node --test tests/bookmarkFields.tenant.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const { installFakeModel, mkRes } = await import("./helpers/fakeModel.js");

const BookmarkField = (await import("../model/bookmarkField.model.js")).default;
const ctrl = await import("../controllers/bookmark.controller.js");
const merge = await import("../services/bookmarkMerge.service.js");

const TENANT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SYS_FORENAME = "500000000000000000000001";
const SYS_SURNAME = "500000000000000000000002";
const LEGACY_TITLE = "500000000000000000000003";
const A_FORENAME = "a00000000000000000000001";
const B_ONLY = "b00000000000000000000001";

function seed() {
  return installFakeModel(BookmarkField, {
    unique: [["tenantId", "key"]],
    docs: [
      { _id: SYS_FORENAME, key: "forename", label: "Forename", path: "profile.personalInfo.forename", dataType: "string", tenantId: null, scope: "system" },
      { _id: SYS_SURNAME, key: "surname", label: "Surname", path: "profile.personalInfo.surname", dataType: "string", tenantId: null, scope: "system" },
      // Pre-migration legacy row: no tenantId / scope at all -> treated as system.
      { _id: LEGACY_TITLE, key: "title", label: "Title", path: "profile.personalInfo.title", dataType: "string" },
      { _id: A_FORENAME, key: "forename", label: "Forename (A)", path: "profile.personalInfo.knownAs", dataType: "string", tenantId: TENANT_A, scope: "tenant" },
      { _id: B_ONLY, key: "bSecret", label: "B only", path: "profile.membershipNumber", dataType: "string", tenantId: TENANT_B, scope: "tenant" },
    ],
  });
}

const userReq = (tenantId, extra = {}) => ({
  userId: `u-${tenantId.slice(0, 1)}`,
  tenantId,
  user: { id: `u-${tenantId.slice(0, 1)}`, tenantId, roles: [{ code: "ASU" }] },
  params: {},
  body: {},
  query: {},
  ...extra,
});
const suReq = (tenantId, extra = {}) =>
  userReq(tenantId, { user: { id: "su", tenantId, roles: [{ code: "SU" }] }, ...extra });

async function call(handler, req) {
  const res = mkRes();
  let err;
  await handler(req, res, (e) => (err = e));
  if (err) {
    res.statusCode = err.status || (err.code === 11000 ? 409 : 500);
    res.body = { message: err.message };
  }
  return res;
}

const PROFILE = {
  personalInfo: { forename: "Ann", surname: "Byrne", title: "Ms", knownAs: "Annie" },
  membershipNumber: "M-1",
};

// ---------------- read / merge precedence ----------------
test("B1 tenant A sees system rows + its own rows; its row overrides the system row by key", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.getBookmarkFields, userReq(TENANT_A));
    assert.equal(res.statusCode, 200);
    const byKey = Object.fromEntries(res.body.data.fields.map((f) => [f.key, f]));
    assert.equal(byKey.forename.path, "profile.personalInfo.knownAs");
    assert.ok(byKey.surname && byKey.title, "system + legacy rows visible");
    assert.equal(byKey.bSecret, undefined, "tenant B row not visible to A");
    assert.equal(res.body.data.fields.filter((f) => f.key === "forename").length, 1);
  } finally {
    m.restore();
  }
});

test("B2 tenant B sees system rows + its own rows, never tenant A's override", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.getBookmarkFields, userReq(TENANT_B));
    const byKey = Object.fromEntries(res.body.data.fields.map((f) => [f.key, f]));
    assert.equal(byKey.forename.path, "profile.personalInfo.forename");
    assert.ok(byKey.bSecret);
  } finally {
    m.restore();
  }
});

test("B3 merge: tenant row wins over system row for A; B gets the system value", async () => {
  const m = seed();
  try {
    const mapA = await merge.buildBookmarkMergeMap({ profile: PROFILE, tenantId: TENANT_A, tenant: { name: "A" } });
    const mapB = await merge.buildBookmarkMergeMap({ profile: PROFILE, tenantId: TENANT_B, tenant: { name: "B" } });
    assert.equal(mapA.forename, "Annie");
    assert.equal(mapB.forename, "Ann");
    assert.equal(mapA.bSecret, undefined);
    assert.equal(mapB.bSecret, "M-1");
  } finally {
    m.restore();
  }
});

test("B4 merge output for a tenant with no own rows equals the old global-merge output (single-tenant parity)", async () => {
  // Old behaviour: every row was global. With only system/legacy rows, the
  // tenant-aware merge must produce exactly the same map.
  const m = installFakeModel(BookmarkField, {
    docs: [
      { key: "forename", path: "profile.personalInfo.forename", dataType: "string" },
      { key: "surname", path: "profile.personalInfo.surname", dataType: "string", tenantId: null, scope: "system" },
      { key: "membershipNumber", path: "profile.membershipNumber", dataType: "string" },
    ],
  });
  try {
    const map = await merge.buildBookmarkMergeMap({ profile: PROFILE, tenantId: TENANT_A, tenant: { name: "A" } });
    assert.deepEqual(map, { forename: "Ann", surname: "Byrne", membershipNumber: "M-1", fullName: "Ann Byrne" });
  } finally {
    m.restore();
  }
});

test("B5 merge without a tenant is rejected (no unscoped read)", async () => {
  const m = seed();
  try {
    await assert.rejects(() => merge.buildBookmarkMergeMap({ profile: PROFILE, tenant: { name: "x" } }));
  } finally {
    m.restore();
  }
});

// ---------------- writes: cross-tenant denial ----------------
test("B6 tenant A (non-SU) cannot update tenant B's row -> 404, row unchanged", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.updateBookmarkField, userReq(TENANT_A, { params: { id: B_ONLY }, body: { path: "profile.hacked" } }));
    assert.equal(res.statusCode, 404);
    assert.equal(m.store.find((d) => d._id === B_ONLY).path, "profile.membershipNumber");
  } finally {
    m.restore();
  }
});

test("B7 tenant A (non-SU) cannot delete tenant B's row -> 404, row kept", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.deleteBookmarkField, userReq(TENANT_A, { params: { id: B_ONLY } }));
    assert.equal(res.statusCode, 404);
    assert.ok(m.store.find((d) => d._id === B_ONLY));
  } finally {
    m.restore();
  }
});

test("B8 tenant admin (non-SU) cannot edit or delete a system row -> 403", async () => {
  const m = seed();
  try {
    const up = await call(ctrl.updateBookmarkField, userReq(TENANT_A, { params: { id: SYS_SURNAME }, body: { path: "profile.x" } }));
    assert.equal(up.statusCode, 403);
    const del = await call(ctrl.deleteBookmarkField, userReq(TENANT_A, { params: { id: LEGACY_TITLE } }));
    assert.equal(del.statusCode, 403);
    assert.equal(m.store.find((d) => d._id === SYS_SURNAME).path, "profile.personalInfo.surname");
    assert.ok(m.store.find((d) => d._id === LEGACY_TITLE));
  } finally {
    m.restore();
  }
});

test("B9 tenant A can update and delete its own row", async () => {
  const m = seed();
  try {
    const up = await call(ctrl.updateBookmarkField, userReq(TENANT_A, { params: { id: A_FORENAME }, body: { label: "Known as", tenantId: TENANT_B, scope: "system" } }));
    assert.equal(up.statusCode, 200);
    const row = m.store.find((d) => d._id === A_FORENAME);
    assert.equal(row.label, "Known as");
    assert.equal(row.tenantId, TENANT_A, "body tenantId cannot move the row");
    assert.equal(row.scope, "tenant", "body scope cannot promote the row");
    const del = await call(ctrl.deleteBookmarkField, userReq(TENANT_A, { params: { id: A_FORENAME } }));
    assert.equal(del.statusCode, 200);
    assert.equal(m.store.find((d) => d._id === A_FORENAME), undefined);
  } finally {
    m.restore();
  }
});

test("B10 SU can update a system row", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.updateBookmarkField, suReq(TENANT_A, { params: { id: SYS_SURNAME }, body: { label: "Family name" } }));
    assert.equal(res.statusCode, 200);
    const row = m.store.find((d) => d._id === SYS_SURNAME);
    assert.equal(row.label, "Family name");
    assert.equal(row.tenantId, null);
  } finally {
    m.restore();
  }
});

test("B11 create stamps the trusted tenant (body tenantId ignored); same key allowed in another tenant", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.createBookmarkField, userReq(TENANT_A, { body: { key: "bSecret", label: "x", path: "profile.x", tenantId: TENANT_B } }));
    assert.equal(res.statusCode, 201);
    const rows = m.store.filter((d) => d.key === "bSecret");
    assert.equal(rows.length, 2);
    const mine = rows.find((d) => d.tenantId === TENANT_A);
    assert.ok(mine);
    assert.equal(mine.scope, "tenant");
  } finally {
    m.restore();
  }
});

test("B12 non-SU cannot create a system row -> 403; SU can (tenantId null)", async () => {
  const m = seed();
  try {
    const denied = await call(ctrl.createBookmarkField, userReq(TENANT_A, { body: { key: "newSys", label: "x", path: "profile.x", scope: "system" } }));
    assert.equal(denied.statusCode, 403);
    assert.equal(m.store.find((d) => d.key === "newSys"), undefined);
    const ok = await call(ctrl.createBookmarkField, suReq(TENANT_A, { body: { key: "newSys", label: "x", path: "profile.x", scope: "system" } }));
    assert.equal(ok.statusCode, 201);
    const row = m.store.find((d) => d.key === "newSys");
    assert.equal(row.tenantId, null);
    assert.equal(row.scope, "system");
  } finally {
    m.restore();
  }
});

test("B13 duplicate key within the same tenant -> 409", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.createBookmarkField, userReq(TENANT_A, { body: { key: "forename", label: "x", path: "profile.x" } }));
    assert.equal(res.statusCode, 409);
  } finally {
    m.restore();
  }
});

test("B14 no write path uses an unscoped findById*/findByIdAnd*", async () => {
  const m = seed();
  try {
    await call(ctrl.updateBookmarkField, userReq(TENANT_A, { params: { id: A_FORENAME }, body: { label: "y" } }));
    await call(ctrl.deleteBookmarkField, userReq(TENANT_A, { params: { id: A_FORENAME } }));
    const ops = m.calls.map((c) => c.op);
    for (const bad of ["findById", "findByIdAndUpdate", "findByIdAndDelete"]) assert.ok(!ops.includes(bad), `${bad} used`);
    for (const c of m.calls.filter((c) => ["findOneAndUpdate", "findOneAndDelete"].includes(c.op))) {
      assert.ok("tenantId" in c.filter, `write without tenant filter: ${JSON.stringify(c.filter)}`);
    }
  } finally {
    m.restore();
  }
});

test("B15 model declares the compound {tenantId,key} unique index and no global unique key", async () => {
  const idx = BookmarkField.schema.indexes();
  assert.ok(idx.some(([f, o]) => f.tenantId === 1 && f.key === 1 && o.unique), "tenantId_1_key_1 unique index");
  assert.ok(!BookmarkField.schema.path("key").options.unique, "global unique on key removed");
});
