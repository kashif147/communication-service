// Phase A / A14 - system bookmark fields (shared by every tenant) are write-frozen: create / update /
// delete of a system row answers 423 GLOBAL_DATA_FROZEN for every caller, SU of any tenant included,
// before any write. Tenant-owned rows keep their normal behaviour; reads are unchanged.
// REAL bookmark controller handlers with the in-memory BookmarkField fake (no DB).
// Run: node --test tests/bookmarkFreeze.a14.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const { installFakeModel, mkRes } = await import("./helpers/fakeModel.js");

const BookmarkField = (await import("../model/bookmarkField.model.js")).default;
const ctrl = await import("../controllers/bookmark.controller.js");
const { isGlobalDataFrozen } = await import("../middlewares/globalDataFreeze.js");

const A = "68cbf7806080b4621d469d34";
const B = "6acd6119b28a863c61361ae0";
const D = "6ad4e0c941376f7df605fd57";
const SYS = "500000000000000000000001";
const LEGACY = "500000000000000000000003";
const A_ROW = "a00000000000000000000001";

delete process.env.GLOBAL_DATA_WRITES;

function seed() {
  return installFakeModel(BookmarkField, {
    unique: [["tenantId", "key"]],
    docs: [
      { _id: SYS, key: "surname", label: "Surname", path: "profile.personalInfo.surname", dataType: "string", tenantId: null, scope: "system" },
      { _id: LEGACY, key: "title", label: "Title", path: "profile.personalInfo.title", dataType: "string" },
      { _id: A_ROW, key: "knownAs", label: "Known as", path: "profile.personalInfo.knownAs", dataType: "string", tenantId: A, scope: "tenant" },
    ],
  });
}

const req = (tenantId, role, extra = {}) => ({
  userId: `u-${role}`,
  tenantId,
  user: { id: `u-${role}`, tenantId, roles: [{ code: role }] },
  headers: { "x-internal-request": "true" },
  params: {},
  body: {},
  query: {},
  ...extra,
});

async function call(handler, r) {
  const res = mkRes();
  let err;
  await handler(r, res, (e) => (err = e));
  if (err) {
    res.statusCode = err.status || 500;
    res.body = { message: err.message, code: err.code };
  }
  return res;
}

const snapshot = (m) => JSON.stringify(m.store.map((d) => ({ ...d })).sort((x, y) => String(x._id).localeCompare(String(y._id))));

test("system rows: create / update / delete -> 423 GLOBAL_DATA_FROZEN for SU and ASU of every tenant; nothing written", async () => {
  assert.equal(isGlobalDataFrozen(), true);
  const m = seed();
  try {
    const before = snapshot(m);
    for (const tenant of [A, B, D]) {
      for (const role of ["SU", "ASU"]) {
        const results = [
          await call(ctrl.createBookmarkField, req(tenant, role, { body: { key: "newSys", label: "x", path: "profile.x", scope: "system" } })),
          await call(ctrl.updateBookmarkField, req(tenant, role, { params: { id: SYS }, body: { label: "Family name" } })),
          await call(ctrl.updateBookmarkField, req(tenant, role, { params: { id: LEGACY }, body: { label: "T" } })),
          await call(ctrl.deleteBookmarkField, req(tenant, role, { params: { id: SYS } })),
          await call(ctrl.deleteBookmarkField, req(tenant, role, { params: { id: LEGACY } })),
        ];
        for (const r of results) {
          assert.equal(r.statusCode, 423, `${tenant} ${role}`);
          assert.equal(r.body.code, "GLOBAL_DATA_FROZEN");
          assert.equal(r.body.message, "Shared metadata is temporarily read-only during tenant migration");
        }
      }
    }
    assert.equal(snapshot(m), before, "no system row created, changed or deleted");
  } finally {
    m.restore();
  }
});

test("tenant-owned rows on the same endpoints keep normal behaviour (create / update / delete)", async () => {
  const m = seed();
  try {
    const created = await call(ctrl.createBookmarkField, req(A, "ASU", { body: { key: "mine", label: "x", path: "profile.x", tenantId: B } }));
    assert.equal(created.statusCode, 201);
    assert.equal(m.store.find((d) => d.key === "mine").tenantId, A);
    const up = await call(ctrl.updateBookmarkField, req(A, "ASU", { params: { id: A_ROW }, body: { label: "Alias" } }));
    assert.equal(up.statusCode, 200);
    assert.equal(m.store.find((d) => d._id === A_ROW).label, "Alias");
    const otherTenant = await call(ctrl.updateBookmarkField, req(B, "SU", { params: { id: A_ROW }, body: { label: "x" } }));
    assert.equal(otherTenant.statusCode, 404, "another tenant's row stays invisible (not 423)");
    const del = await call(ctrl.deleteBookmarkField, req(A, "ASU", { params: { id: A_ROW } }));
    assert.equal(del.statusCode, 200);
  } finally {
    m.restore();
  }
});

test("reads are unchanged: system rows are still served", async () => {
  const m = seed();
  try {
    const res = await call(ctrl.getBookmarkFields, req(B, "ASU"));
    assert.equal(res.statusCode ?? 200, 200);
    const text = JSON.stringify(res.body ?? res.payload ?? res);
    assert.match(text, /surname/);
  } finally {
    m.restore();
  }
});

test("only GLOBAL_DATA_WRITES=open (exact) reopens; nothing on the request does", async () => {
  const m = seed();
  try {
    for (const v of ["", "OPEN", "true", "1", " open"]) {
      process.env.GLOBAL_DATA_WRITES = v;
      const r = await call(ctrl.updateBookmarkField, { ...req(A, "SU", { params: { id: SYS }, body: { label: "x", globalDataWrites: "open" } }), headers: { "x-global-data-writes": "open", "x-internal-request": "true" } });
      assert.equal(r.statusCode, 423, `value ${JSON.stringify(v)}`);
    }
    process.env.GLOBAL_DATA_WRITES = "open";
    const opened = await call(ctrl.updateBookmarkField, req(A, "SU", { params: { id: SYS }, body: { label: "Family name" } }));
    assert.equal(opened.statusCode, 200);
  } finally {
    delete process.env.GLOBAL_DATA_WRITES;
    m.restore();
  }
});
