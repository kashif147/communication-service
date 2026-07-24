# SES delivery feedback loop

`app.js` mounts `POST /api/webhooks/ses-sns` with `express.raw()` — it must stay raw, since it's
an SNS push, not JSON from a trusted client — *before* the global `express.json()` body parser,
and before any auth middleware. This endpoint is unauthenticated by design (SNS calls it
directly) and matches purely on message shape; don't add `requirePermission` to it.

`controllers/snsWebhook.controller.js` unwraps the SNS envelope and hands each SES event to
`services/sesEventHandler.service.js`, which matches it back to a `CampaignRecipient` by
`sesMessageId` (falling back to `campaignId`+`memberId` email tags) and updates delivery/bounce/
complaint status idempotently — guarded by `status: { $nin: [...] }` in the update filter, not by
dedup keys.
