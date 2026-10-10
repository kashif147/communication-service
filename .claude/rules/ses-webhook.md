# SES delivery feedback loop

`app.js` mounts `POST /api/webhooks/ses-sns` with `express.raw()` — it must stay raw, since it's
an SNS push, not JSON from a trusted client — *before* the global `express.json()` body parser,
and before any auth middleware. This endpoint has no user auth by design (SNS calls it
directly); don't add `requirePermission` to it. Instead every message must pass AWS SNS
signature verification (`services/snsSignature.service.js`: SignatureVersion 1/SHA1 and
2/SHA256, `SigningCertURL` https on `sns.<region>.amazonaws.com[.cn]`, certs cached in memory)
and come from a TopicArn listed in `SES_SNS_ALLOWED_TOPIC_ARNS` (comma-separated; empty = reject
all). Anything else gets 403 before processing; `SubscriptionConfirmation` is only confirmed
(GET `SubscribeURL`, which must itself be an SNS host) for allowlisted topics. Real SNS delivery
additionally needs a gateway location for this path that does not require a JWT (not in this
repo).

`controllers/snsWebhook.controller.js` unwraps the SNS envelope and hands each SES event to
`services/sesEventHandler.service.js`, which matches it back to exactly one `CampaignRecipient` by
`sesMessageId` (ambiguous matches are ignored), falling back to `campaignId`+`memberId` email tags
with the tenant taken from the `Campaign` record. Every later query/update carries that tenantId,
and a `tenantId` email tag (stamped at send time) must agree with it. Status updates are
idempotent — guarded by `status: { $nin: [...] }` in the update filter, not by dedup keys.
