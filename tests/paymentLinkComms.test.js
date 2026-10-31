// Application payment-link email (applications.payment-link.email.requested.v1).
// Calls the REAL processPaymentLinkEmail with in-memory model fakes and a stub mailer.
// Run: node --test tests/paymentLinkComms.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const { installFakeModel } = await import("./helpers/fakeModel.js");

const Template = (await import("../model/template.model.js")).default;
const OutboundCommunication = (await import("../model/outboundCommunication.model.js")).default;
const svc = await import("../services/paymentLinkComms.service.js");
const { handlePaymentLinkEmailRequested, ROUTING_KEY } = await import(
  "../rabbitMQ/listeners/paymentLinkComms.listener.js"
);

const TENANT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const TENANT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-10-31T10:00:00Z");
const URL_OK = "https://checkout.stripe.com/c/pay/cs_test_abc#fid";

function event(overrides = {}, envelope = {}) {
  return {
    eventId: "evt-1",
    eventType: ROUTING_KEY,
    tenantId: TENANT_A,
    ...envelope,
    data: {
      applicationId: "app-1",
      linkVersion: 2,
      dedupeKey: `link:${TENANT_A}:app-1:v2:email:1`,
      recipient: { email: "applicant@example.com", name: "Mary O'Brien" },
      checkoutUrl: URL_OK,
      expiresAt: "2026-11-01T09:00:00Z",
      amount: 29900,
      currency: "eur",
      paymentOption: "FULL",
      templateCode: "APPLICATION_PAYMENT_LINK",
      ...overrides,
    },
  };
}

function seed({ templates = [], outbound = [] } = {}) {
  const t = installFakeModel(Template, { docs: templates });
  const o = installFakeModel(OutboundCommunication, {
    docs: outbound,
    unique: [["tenantId", "idempotencyKey"]],
  });
  const sent = [];
  let fail = null;
  svc.setPaymentLinkMailer(async (msg) => {
    if (fail) throw fail;
    sent.push(msg);
    return { messageId: `ses-${sent.length}` };
  });
  return {
    sent,
    outbound: o,
    templates: t,
    failWith(err) {
      fail = err;
    },
    restore() {
      t.restore();
      o.restore();
      svc.setPaymentLinkMailer(null);
    },
  };
}

const run = (payload) => svc.processPaymentLinkEmail(payload, { now: NOW });

test("listener routing key matches the design contract", () => {
  assert.equal(ROUTING_KEY, "applications.payment-link.email.requested.v1");
});

test("sends one email with formatted amount/expiry and records it as sent under the envelope tenant", async () => {
  const s = seed();
  try {
    const r = await run(event());
    assert.equal(r.status, "sent");
    assert.equal(s.sent.length, 1);
    const m = s.sent[0];
    assert.equal(m.toAddress, "applicant@example.com");
    assert.equal(m.subject, "Complete your membership payment");
    assert.match(m.textBody, /€299\.00/);
    assert.match(m.textBody, /annual membership fee/);
    assert.match(m.textBody, new RegExp(URL_OK.replace(/[.?*+^$()[\]{}|\\/]/g, "\\$&")));
    assert.match(m.textBody, /1 November 2026/);
    assert.match(m.htmlBody, /Mary O&#39;Brien/);
    assert.match(m.htmlBody, /href="https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_abc#fid"/);
    assert.equal(s.outbound.store.length, 1);
    const row = s.outbound.store[0];
    assert.equal(row.tenantId, TENANT_A);
    assert.equal(row.status, "sent");
    assert.equal(row.profileId, "application:app-1");
    assert.equal(row.providerMessageId, "ses-1");
    for (const c of [...s.outbound.calls, ...s.templates.calls]) {
      assert.equal(c.filter.tenantId, TENANT_A, `query without tenant A: ${JSON.stringify(c.filter)}`);
    }
  } finally {
    s.restore();
  }
});

test("FIRST_INSTALMENT is described as three months' fee", async () => {
  const s = seed();
  try {
    await run(event({ paymentOption: "FIRST_INSTALMENT", amount: 7475 }));
    assert.match(s.sent[0].textBody, /first three months' membership fee of €74\.75/);
  } finally {
    s.restore();
  }
});

test("redelivery of the same event does not send twice; a RESEND (new dedupeKey) does", async () => {
  const s = seed();
  try {
    await run(event());
    const dup = await run(event());
    assert.equal(dup.duplicate, true);
    assert.equal(s.sent.length, 1);
    await run(event({ dedupeKey: `link:${TENANT_A}:app-1:v2:email:2` }));
    assert.equal(s.sent.length, 2);
  } finally {
    s.restore();
  }
});

test("tenant comes from the envelope only; data.tenantId is ignored; no envelope tenant -> skipped, nothing sent", async () => {
  const s = seed();
  try {
    await run(event({ tenantId: TENANT_B }));
    assert.equal(s.outbound.store[0].tenantId, TENANT_A);

    const r = await run(event({ dedupeKey: "k2", tenantId: TENANT_A }, { tenantId: undefined }));
    assert.equal(r.reason, "missing_tenant");
    assert.equal(s.sent.length, 1);
    assert.equal(s.outbound.store.length, 1);
  } finally {
    s.restore();
  }
});

test("tenant template overrides defaults; another tenant's template is not used", async () => {
  const s = seed({
    templates: [
      {
        tenantId: TENANT_B,
        name: "Application Payment Link Email",
        category: "applications",
        tempolateType: "Email",
        subject: "B subject",
        htmlBody: "<p>B</p>",
        textBody: "B",
      },
      {
        tenantId: TENANT_A,
        name: "Application Payment Link Email",
        category: "applications",
        tempolateType: "Email",
        subject: "Pay {{amount}}",
        htmlBody: "<p>{{recipientName}} {{checkoutUrl}}</p>",
        textBody: "Hi {{recipientName}}",
      },
    ],
  });
  try {
    await run(event());
    assert.equal(s.sent[0].subject, "Pay €299.00");
    assert.equal(s.sent[0].textBody, "Hi Mary O'Brien");
  } finally {
    s.restore();
  }
});

test("HTML-unsafe recipient name is escaped in the HTML body", async () => {
  const s = seed();
  try {
    await run(event({ recipient: { email: "a@example.com", name: '<img src=x onerror="x">' } }));
    assert.doesNotMatch(s.sent[0].htmlBody, /<img/);
    assert.match(s.sent[0].htmlBody, /&lt;img src=x onerror=&quot;x&quot;&gt;/);
  } finally {
    s.restore();
  }
});

for (const [name, overrides, reason] of [
  ["non-Stripe host", { checkoutUrl: "https://evil.example.com/pay" }, "checkout_url_not_allowed"],
  ["http scheme", { checkoutUrl: "http://checkout.stripe.com/c/pay/x" }, "checkout_url_not_allowed"],
  ["userinfo in URL", { checkoutUrl: "https://checkout.stripe.com@evil.example.com/x" }, "checkout_url_not_allowed"],
  ["javascript URL", { checkoutUrl: "javascript:alert(1)" }, "checkout_url_not_allowed"],
  ["expired link", { expiresAt: "2026-10-31T09:59:00Z" }, "link_expired"],
  ["invalid expiry", { expiresAt: "nope" }, "invalid_expiry"],
  ["no email", { recipient: { name: "X" } }, "no_recipient_email"],
  ["unknown template code", { templateCode: "OTHER" }, "unsupported_template_code"],
]) {
  test(`${name} -> recorded as skipped, nothing sent, not retried`, async () => {
    const s = seed();
    try {
      const r = await run(event(overrides));
      assert.equal(r.status, "skipped");
      assert.equal(r.reason, reason);
      assert.equal(s.sent.length, 0);
      assert.equal(s.outbound.store[0].status, "skipped");
      assert.equal(s.outbound.store[0].error, reason);
      const again = await run(event(overrides));
      assert.equal(again.duplicate, true);
    } finally {
      s.restore();
    }
  });
}

test("missing applicationId/dedupeKey -> no record, nothing sent", async () => {
  const s = seed();
  try {
    assert.equal((await run(event({ dedupeKey: undefined }))).reason, "invalid_payload");
    assert.equal((await run(event({ applicationId: undefined }))).reason, "invalid_payload");
    assert.equal(s.sent.length, 0);
    assert.equal(s.outbound.store.length, 0);
  } finally {
    s.restore();
  }
});

test("SES failure is recorded and rethrown (consumer retries); the retry then sends", async () => {
  const s = seed();
  try {
    s.failWith(new Error("Throttling"));
    await assert.rejects(handlePaymentLinkEmailRequested(event()), /Throttling/);
    assert.equal(s.outbound.store[0].status, "failed");
    s.failWith(null);
    const r = await run(event());
    assert.equal(r.status, "sent");
    assert.equal(s.outbound.store.length, 1);
    assert.equal(s.outbound.store[0].status, "sent");
  } finally {
    s.restore();
  }
});

test("isAllowedCheckoutUrl honours an explicit host allowlist", () => {
  assert.equal(svc.isAllowedCheckoutUrl("https://pay.example.org/x", ["pay.example.org"]), true);
  assert.equal(svc.isAllowedCheckoutUrl("https://checkout.stripe.com/x", ["pay.example.org"]), false);
});
