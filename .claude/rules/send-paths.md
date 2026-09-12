# Three send paths, one shared merge/template layer

1. **On-demand letter** (`controllers/letter.controller.js` → `POST /api/letters/generate`) —
   caller supplies `memberId` + `templateId`; pulls member data from profile/subscription/account
   services (`services/memberData.service.js`, deliberately paranoid: validates ObjectId shape,
   validates outbound URLs against an allowlist to block SSRF), merges into the OneDrive `.docx`
   template (`services/mailMerge.service.js`, docxtemplater/pizzip), uploads the result to Azure
   Blob (`services/azureBlob.service.js`), returns a time-limited SAS download URL.
   `POST /api/letters/internal/generate` (`generateLetterInternal`) is the system-triggered twin
   for callers with no originating user (events-service's certificate auto-issuance) — see
   `auth.md`. It optionally also emails the generated PDF as an attachment via `sendSesMessage`
   when the caller passes `deliver: {email, toAddress}`, recorded in `OutboundCommunication`
   idempotently by `registrationId`. Both also accept an optional `mergeFields` object — caller-
   supplied placeholders merged on top of `collectMemberData`'s profile/subscription/account
   fields (e.g. events-service passes `EventTitle`/`EventDate`/`CpdCredits`/`AccreditationBody`/
   `CertificationType` for a certificate, since `collectMemberData` has no way to know about the
   calling service's own domain). Both variants convert the merged docx to PDF via
   `services/docxPdfConversion.service.js` (the same LibreOffice/`soffice` step gap/graduation
   letters already use — requires LibreOffice installed, see `dev-commands.md`) before uploading
   — as of this change, `GeneratedLetter.contentType` is `"pdf"` here, not `"docx"`. No frontend
   page currently calls `/api/letters/generate` directly (only events-service does, for
   certificates), so this was a safe global change with no other caller to break.

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
