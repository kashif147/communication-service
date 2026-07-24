# Three send paths, one shared merge/template layer

1. **On-demand letter** (`controllers/letter.controller.js` → `POST /api/letters/generate`) —
   caller supplies `memberId` + `templateId`; pulls member data from profile/subscription/account
   services (`services/memberData.service.js`, deliberately paranoid: validates ObjectId shape,
   validates outbound URLs against an allowlist to block SSRF), merges into the OneDrive `.docx`
   template (`services/mailMerge.service.js`, docxtemplater/pizzip), uploads the result to Azure
   Blob (`services/azureBlob.service.js`), returns a time-limited SAS download URL.

2. **Bulk email campaigns** (`services/campaignEngine.service.js`) — `Campaign` +
   `CampaignRecipient` documents. `expandRecipientsForCampaign` resolves `audienceProfileIds` to
   profiles (batched via `services/profileBatch.service.js`, which round-robins several candidate
   profile-service base URLs — see `profileServiceBatchUrls()` — since the platform doesn't share
   Mongo across services), filtering out anyone without `preferences.emailConsent === true`.
   `runCampaignSend` then processes recipients in DB-persisted batches (so a crash mid-send is
   resumable — it just re-queries for `pending`/`queued`/`failed-under-retry-limit` rows), applying
   `services/personalization.service.js`'s `{{placeholder}}` templating and sending via
   `services/ses.service.js` (raw MIME when there are attachments, SESv2 Simple content otherwise).
   Delivery/bounce/complaint status flows back asynchronously through the SNS webhook (see the
   SES/SNS webhook topic) and updates `CampaignRecipient.status` + `Campaign.stats`.

3. **Event-triggered comms** (`rabbitMQ/listeners/*` → `services/{gapLetterComms,
   undergraduateGraduationComms, eventRegistrationComms}.service.js`) — other services publish a
   "please send X" event; the listener here resolves a template, mail-merges member data using the
   bookmark system (see the bookmark-merge topic), converts to PDF when the channel is a letter,
   uploads/stores it, and optionally emails it. All idempotency here is **application-level**, via
   a `dedupeKey`/`sourceKey`/`idempotencyKey` derived from the event payload and checked against
   `GeneratedLetter.sourceKey` / `OutboundCommunication` unique index `(tenantId, idempotencyKey)`
   before doing any work. Treat RabbitMQ redelivery of the same event as an expected case to guard
   against, not an edge case to skip.

`model/outboundCommunication.model.js` is the audit trail of what was attempted per
channel/profile regardless of which of these three paths triggered it —
`controllers/correspondence.controller.js` reads it back for the frontend's "correspondence" tab.
