import crypto from "crypto";
import https from "https";

/**
 * Amazon SNS HTTP(S) message signature verification (Phase 2B Stream 3C,
 * audit H-24/T-11/C4). Node crypto + a plain HTTPS GET; no extra dependency.
 *
 * Spec: https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *  - SignatureVersion "1" => RSA-SHA1, "2" => RSA-SHA256.
 *  - SigningCertURL must be https on an SNS host (sns.<region>.amazonaws.com[.cn]).
 *  - String to sign = "Key\nValue\n" for a fixed, ordered key list per Type.
 */

export const SNS_HOST_RE = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

const NOTIFICATION_KEYS = ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"];
const CONFIRMATION_KEYS = ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
const ALGORITHMS = { 1: "RSA-SHA1", 2: "RSA-SHA256" };

const MAX_CERT_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5000;

/** https URL on an SNS host, default port, no credentials. */
export function isValidSnsHostUrl(value) {
  let u;
  try {
    u = new URL(String(value));
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    (u.port === "" || u.port === "443") &&
    SNS_HOST_RE.test(u.hostname.toLowerCase())
  );
}

export function isValidSigningCertUrl(value) {
  if (!isValidSnsHostUrl(value)) return false;
  return new URL(String(value)).pathname.toLowerCase().endsWith(".pem");
}

/** Canonical string to sign, or null for an unsupported Type / missing field. */
export function buildStringToSign(msg) {
  let keys;
  if (msg.Type === "Notification") keys = NOTIFICATION_KEYS;
  else if (msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation") keys = CONFIRMATION_KEYS;
  else return null;

  let out = "";
  for (const k of keys) {
    const v = msg[k];
    if (v === undefined || v === null) {
      if (k === "Subject") continue; // only optional field
      return null;
    }
    if (typeof v !== "string") return null;
    out += `${k}\n${v}\n`;
  }
  return out;
}

/** Minimal HTTPS GET: no redirects, bounded size and time. */
export function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let size = 0;
      const chunks = [];
      res.on("data", (c) => {
        size += c.length;
        if (size > MAX_CERT_BYTES) {
          req.destroy(new Error("response too large"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/**
 * Certificate fetcher with an in-memory cache (per URL, TTL, bounded size)
 * and in-flight de-duplication. Refuses any URL that is not a valid SNS
 * signing-cert URL before any network access.
 */
export function createCertificateFetcher({
  httpsGet = httpsGetText,
  ttlMs = 24 * 60 * 60 * 1000,
  maxEntries = 50,
} = {}) {
  const cache = new Map();
  const inflight = new Map();

  return async function getCertificate(url) {
    if (!isValidSigningCertUrl(url)) throw new Error("invalid SigningCertURL");
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) return hit.pem;
    if (inflight.has(url)) return inflight.get(url);

    const p = (async () => {
      const pem = await httpsGet(url);
      crypto.createPublicKey(pem); // throws if not a usable cert/key
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(url, { pem, at: Date.now() });
      return pem;
    })();
    inflight.set(url, p);
    try {
      return await p;
    } finally {
      inflight.delete(url);
    }
  };
}

export const defaultCertificateFetcher = createCertificateFetcher();

/**
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function verifySnsMessage(msg, { getCertificate = defaultCertificateFetcher } = {}) {
  if (!msg || typeof msg !== "object") return { ok: false, reason: "not_an_object" };
  const alg = ALGORITHMS[String(msg.SignatureVersion)];
  if (!alg) return { ok: false, reason: "unsupported_signature_version" };
  if (typeof msg.Signature !== "string" || !msg.Signature) return { ok: false, reason: "missing_signature" };
  if (!isValidSigningCertUrl(msg.SigningCertURL)) return { ok: false, reason: "invalid_signing_cert_url" };
  const stringToSign = buildStringToSign(msg);
  if (stringToSign === null) return { ok: false, reason: "invalid_message_shape" };

  let pem;
  try {
    pem = await getCertificate(msg.SigningCertURL);
  } catch {
    return { ok: false, reason: "certificate_unavailable" };
  }

  try {
    const ok = crypto
      .createVerify(alg)
      .update(stringToSign, "utf8")
      .verify(pem, msg.Signature, "base64");
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
}

/** Comma-separated TopicArn allowlist; empty => nothing allowed (fail closed). */
export function allowedTopicArns(env = process.env) {
  return String(env.SES_SNS_ALLOWED_TOPIC_ARNS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
