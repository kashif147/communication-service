// Phase 2B Stream 3C — SNS signature + TopicArn verification (H-24, T-11, C4).
// Uses a locally generated self-signed cert/key (openssl; falls back to a raw
// RSA key pair if openssl is unavailable) and calls the REAL webhook handler.
// Run: node --test tests/snsWebhook.signature.test.js
await import("./helpers/testEnv.js");

const test = (await import("node:test")).default;
const assert = (await import("node:assert")).default;
const crypto = await import("node:crypto");
const fs = await import("node:fs");
const os = await import("node:os");
const path = await import("node:path");
const { execFileSync } = await import("node:child_process");
const { mkRes } = await import("./helpers/fakeModel.js");

const ctrl = await import("../controllers/snsWebhook.controller.js");
const sig = await import("../services/snsSignature.service.js").catch(() => ({}));

const TOPIC_OK = "arn:aws:sns:eu-west-1:123456789012:ses-events";
const TOPIC_OTHER = "arn:aws:sns:eu-west-1:999999999999:someone-else";
const CERT_URL = "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-test.pem";
process.env.SES_SNS_ALLOWED_TOPIC_ARNS = `${TOPIC_OK}, arn:aws:sns:eu-west-1:123456789012:another`;

// ---- local signing material ----
let privateKeyPem;
let certPem;
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sns-cert-"));
  const key = path.join(dir, "key.pem");
  const crt = path.join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "1", "-subj", "/CN=sns.amazonaws.com"], { stdio: "ignore" });
  privateKeyPem = fs.readFileSync(key, "utf8");
  certPem = fs.readFileSync(crt, "utf8");
} catch {
  const kp = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  privateKeyPem = kp.privateKey.export({ type: "pkcs8", format: "pem" });
  certPem = kp.publicKey.export({ type: "spki", format: "pem" });
}
const otherKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

// Canonical string per the AWS SNS docs (written independently of the service code).
function canonical(m) {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys.filter((k) => m[k] !== undefined).map((k) => `${k}\n${m[k]}\n`).join("");
}
function signed(m, { version = "1", key = privateKeyPem } = {}) {
  const alg = version === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const msg = { ...m, SignatureVersion: version, SigningCertURL: m.SigningCertURL || CERT_URL };
  msg.Signature = crypto.createSign(alg).update(canonical(msg), "utf8").sign(key, "base64");
  return msg;
}
const notification = (over = {}) => ({
  Type: "Notification",
  MessageId: crypto.randomUUID(),
  TopicArn: TOPIC_OK,
  Subject: "Amazon SES Email Event Notification",
  Message: JSON.stringify({ eventType: "Delivery", mail: { messageId: "msg-1" } }),
  Timestamp: new Date().toISOString(),
  ...over,
});
const confirmation = (over = {}) => ({
  Type: "SubscriptionConfirmation",
  MessageId: crypto.randomUUID(),
  Token: "tok",
  TopicArn: TOPIC_OK,
  Message: "You have chosen to subscribe",
  SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=tok",
  Timestamp: new Date().toISOString(),
  ...over,
});

// ---- dependency fakes (no network) ----
const handled = [];
const confirmed = [];
let certFetches = 0;
if (ctrl.snsWebhookDeps) {
  ctrl.snsWebhookDeps.handleSesEventRecord = async (ev) => handled.push(ev);
  ctrl.snsWebhookDeps.confirmSubscription = async (url) => confirmed.push(url);
  ctrl.snsWebhookDeps.getCertificate = async () => {
    certFetches += 1;
    return certPem;
  };
}

async function deliver(msg) {
  const res = mkRes();
  await ctrl.handleSesSnsWebhook({ body: Buffer.from(JSON.stringify(msg)), headers: {} }, res);
  return res;
}

test("N1 unsigned notification -> 403 and no processing", async () => {
  const n = handled.length;
  const res = await deliver(notification());
  assert.equal(res.statusCode, 403);
  assert.equal(handled.length, n);
});

test("N2 valid SignatureVersion 1 (SHA1) notification from an allowlisted topic is processed", async () => {
  const n = handled.length;
  const res = await deliver(signed(notification()));
  assert.equal(res.statusCode, 200);
  assert.equal(handled.length, n + 1);
});

test("N3 valid SignatureVersion 2 (SHA256) notification is processed", async () => {
  const n = handled.length;
  const res = await deliver(signed(notification(), { version: "2" }));
  assert.equal(res.statusCode, 200);
  assert.equal(handled.length, n + 1);
});

test("N4 tampered Message after signing -> 403, not processed", async () => {
  const n = handled.length;
  const msg = signed(notification());
  msg.Message = JSON.stringify({ eventType: "Bounce", mail: { messageId: "victim" } });
  const res = await deliver(msg);
  assert.equal(res.statusCode, 403);
  assert.equal(handled.length, n);
});

test("N5 signed by a different key -> 403", async () => {
  const res = await deliver(signed(notification(), { key: otherKey }));
  assert.equal(res.statusCode, 403);
});

test("N6 validly signed but topic not allowlisted -> 403, not processed", async () => {
  const n = handled.length;
  const res = await deliver(signed(notification({ TopicArn: TOPIC_OTHER })));
  assert.equal(res.statusCode, 403);
  assert.equal(handled.length, n);
});

test("N7 SigningCertURL not https / not an SNS host -> 403 without fetching", async () => {
  const before = certFetches;
  for (const url of [
    "http://sns.eu-west-1.amazonaws.com/cert.pem",
    "https://sns.eu-west-1.amazonaws.com.evil.test/cert.pem",
    "https://evil.test/sns.eu-west-1.amazonaws.com/cert.pem",
    "https://user@sns.eu-west-1.amazonaws.com/cert.pem",
  ]) {
    const res = await deliver(signed(notification({ SigningCertURL: url })));
    assert.equal(res.statusCode, 403, url);
  }
  assert.equal(certFetches, before);
});

test("N8 unsupported SignatureVersion -> 403", async () => {
  const msg = signed(notification());
  msg.SignatureVersion = "3";
  const res = await deliver(msg);
  assert.equal(res.statusCode, 403);
});

test("N9 SubscriptionConfirmation for an allowlisted topic is confirmed", async () => {
  const n = confirmed.length;
  const msg = signed(confirmation());
  const res = await deliver(msg);
  assert.equal(res.statusCode, 200);
  assert.equal(confirmed.length, n + 1);
  assert.equal(confirmed.at(-1), msg.SubscribeURL);
});

test("N10 SubscriptionConfirmation for a non-allowlisted topic is NOT confirmed (403)", async () => {
  const n = confirmed.length;
  const res = await deliver(signed(confirmation({ TopicArn: TOPIC_OTHER })));
  assert.equal(res.statusCode, 403);
  assert.equal(confirmed.length, n);
});

test("N11 unsigned SubscriptionConfirmation -> 403, not confirmed", async () => {
  const n = confirmed.length;
  const res = await deliver(confirmation());
  assert.equal(res.statusCode, 403);
  assert.equal(confirmed.length, n);
});

test("N12 confirmation with a SubscribeURL off the SNS host is not followed", async () => {
  const n = confirmed.length;
  const res = await deliver(signed(confirmation({ SubscribeURL: "https://evil.test/confirm" })));
  assert.equal(res.statusCode, 403);
  assert.equal(confirmed.length, n);
});

test("N13 allowlist unset -> fail closed (403)", async () => {
  const saved = process.env.SES_SNS_ALLOWED_TOPIC_ARNS;
  delete process.env.SES_SNS_ALLOWED_TOPIC_ARNS;
  try {
    const res = await deliver(signed(notification()));
    assert.equal(res.statusCode, 403);
  } finally {
    process.env.SES_SNS_ALLOWED_TOPIC_ARNS = saved;
  }
});

test("N14 certificate fetcher validates the URL and caches certs", async () => {
  assert.equal(typeof sig.createCertificateFetcher, "function");
  let gets = 0;
  const fetchCert = sig.createCertificateFetcher({
    httpsGet: async () => {
      gets += 1;
      return certPem;
    },
  });
  assert.equal(await fetchCert(CERT_URL), certPem);
  assert.equal(await fetchCert(CERT_URL), certPem);
  assert.equal(gets, 1, "second fetch served from cache");
  await assert.rejects(() => fetchCert("https://evil.test/x.pem"));
  assert.equal(gets, 1);
  assert.equal(sig.isValidSnsHostUrl("https://sns.cn-north-1.amazonaws.com.cn/x.pem"), true);
  assert.equal(sig.isValidSnsHostUrl("https://sns.us-east-1.amazonaws.com:8443/x.pem"), false);
});
