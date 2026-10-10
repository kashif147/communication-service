// Phase 2B Stream 3C — tenant-scoped SES delivery lookups (H-24, C4).
// Calls the REAL handleSesEventRecord with in-memory model fakes.
// Run: node --test tests/sesEventHandler.tenant.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const { installFakeModel } = await import("./helpers/fakeModel.js");

const CampaignRecipient = (await import("../model/campaignRecipient.model.js")).default;
const Campaign = (await import("../model/campaign.model.js")).default;
const { handleSesEventRecord } = await import("../services/sesEventHandler.service.js");

const TENANT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const CAMP_A = "a000000000000000000000c1";
const CAMP_B = "b000000000000000000000c1";

function seed() {
  const campaigns = installFakeModel(Campaign, {
    docs: [
      { _id: CAMP_A, tenantId: TENANT_A, stats: { delivered: 0, bounced: 0, complaints: 0 } },
      { _id: CAMP_B, tenantId: TENANT_B, stats: { delivered: 0, bounced: 0, complaints: 0 } },
    ],
  });
  const recipients = installFakeModel(CampaignRecipient, {
    docs: [
      { _id: "a000000000000000000000r1", campaignId: CAMP_A, tenantId: TENANT_A, memberId: "m1", status: "sent", sesMessageId: "msg-a" },
      { _id: "b000000000000000000000r1", campaignId: CAMP_B, tenantId: TENANT_B, memberId: "m1", status: "sent", sesMessageId: "msg-b" },
      // Rogue/corrupt row in tenant B pointing at tenant A's campaign id.
      { _id: "b000000000000000000000r2", campaignId: CAMP_A, tenantId: TENANT_B, memberId: "m2", status: "sent", sesMessageId: null },
      // Same sesMessageId present in two tenants (ambiguous).
      { _id: "a000000000000000000000r3", campaignId: CAMP_A, tenantId: TENANT_A, memberId: "m3", status: "sent", sesMessageId: "msg-dup" },
      { _id: "b000000000000000000000r3", campaignId: CAMP_B, tenantId: TENANT_B, memberId: "m3", status: "sent", sesMessageId: "msg-dup" },
    ],
  });
  return {
    campaigns,
    recipients,
    rec: (id) => recipients.store.find((d) => d._id === id),
    camp: (id) => campaigns.store.find((d) => d._id === id),
    restore() {
      campaigns.restore();
      recipients.restore();
    },
  };
}

const ev = (eventType, messageId, tags) => ({ eventType, mail: { messageId, tags } });

test("S1 delivery by sesMessageId updates only the tenant A recipient + tenant A campaign, tenant-scoped", async () => {
  const s = seed();
  try {
    await handleSesEventRecord(ev("Delivery", "msg-a"));
    assert.equal(s.rec("a000000000000000000000r1").status, "delivered");
    assert.equal(s.rec("b000000000000000000000r1").status, "sent");
    assert.equal(s.camp(CAMP_A).stats.delivered, 1);
    assert.equal(s.camp(CAMP_B).stats.delivered, 0);
    for (const c of [...s.recipients.calls, ...s.campaigns.calls].filter((c) => c.op === "updateOne")) {
      assert.equal(c.filter.tenantId, TENANT_A, `update without tenant: ${JSON.stringify(c.filter)}`);
    }
  } finally {
    s.restore();
  }
});

test("S2 ambiguous sesMessageId present in two tenants -> nothing updated", async () => {
  const s = seed();
  try {
    await handleSesEventRecord(ev("Bounce", "msg-dup"));
    assert.equal(s.rec("a000000000000000000000r3").status, "sent");
    assert.equal(s.rec("b000000000000000000000r3").status, "sent");
  } finally {
    s.restore();
  }
});

test("S3 tag fallback resolves tenant from the campaign record: a tenant-B row under tenant A's campaign is never updated", async () => {
  const s = seed();
  try {
    await handleSesEventRecord(ev("Complaint", "unknown-msg", { campaignId: [CAMP_A], memberId: ["m2"] }));
    assert.equal(s.rec("b000000000000000000000r2").status, "sent");
    assert.equal(s.camp(CAMP_A).stats.complaints, 0);
    const lookups = s.recipients.calls.filter((c) => c.op === "findOne" && c.filter.campaignId);
    for (const c of lookups) assert.equal(c.filter.tenantId, TENANT_A);
  } finally {
    s.restore();
  }
});

test("S4 tag fallback within the right tenant still works", async () => {
  const s = seed();
  try {
    await handleSesEventRecord(ev("Delivery", "unknown-msg", { campaignId: [CAMP_A], memberId: ["m1"], tenantId: [TENANT_A] }));
    assert.equal(s.rec("a000000000000000000000r1").status, "delivered");
    assert.equal(s.camp(CAMP_A).stats.delivered, 1);
  } finally {
    s.restore();
  }
});

test("S5 tenantId tag disagreeing with the matched record -> ignored", async () => {
  const s = seed();
  try {
    await handleSesEventRecord(ev("Bounce", "msg-a", { tenantId: [TENANT_B] }));
    assert.equal(s.rec("a000000000000000000000r1").status, "sent");
  } finally {
    s.restore();
  }
});

test("S6 malformed campaignId tag is ignored (no cast error, no update)", async () => {
  const s = seed();
  try {
    await handleSesEventRecord(ev("Bounce", "unknown-msg", { campaignId: ["{$ne:1}"], memberId: ["m1"] }));
    assert.equal(s.rec("a000000000000000000000r1").status, "sent");
  } finally {
    s.restore();
  }
});
