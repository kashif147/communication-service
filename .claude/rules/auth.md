# Auth — no local `ensureAuthenticated`

Unlike some sibling services, this one has no standalone auth middleware. Identity extraction
*and* permission checks both happen inside `defaultPolicyMiddleware.requirePermission(resource,
action)` from `@membership/policy-middleware` (`middlewares/policy.middleware.js`,
`POLICY_SERVICE_URL`), applied per-route in each `routes/*.routes.js` file. That call reads
gateway headers (`x-user-id`, `x-tenant-id`, `x-user-roles`, ...) or a JWT, checks the permission,
and sets `req.user`/`req.userId`/`req.tenantId` as a side effect for the controller to use.

Practical consequence: any route **not** wrapped in `requirePermission(...)` gets no identity at
all — `req.userId`/`req.tenantId` will be `undefined` there. Routes deliberately left unwrapped
because they authenticate a different way or don't need identity: `POST
/api/campaigns/system/process-due`, `GET /api/campaigns/unsubscribe`, the SNS webhook (see the
SES/SNS webhook topic), `correspondence.routes.js`'s two `/internal/letters/*` routes, and
`letter.routes.js`'s `POST /api/letters/internal/generate`. The internal routes use
`middlewares/internalCaller.js`: a request with `x-internal-request` and **no** user identity
(the DEV gateway strips client-supplied `x-internal-request`) is an internal caller scoped to its
`x-tenant-id` header (body/query tenantId ignored, missing header = 400). A request carrying user
identity (gateway headers or a bearer token) gets nothing from the internal flag:
`/internal/letters/*` runs `requirePermission("communication","read")` + `tenantContextWarn` and
then requires a CRM user (or a trusted own-profile match, which no identity source provides yet,
so portal members get 404); `/letters/internal/generate` rejects user sessions with 403.
`generateLetterInternal` is the system-triggered twin of `generateLetter` (`/api/letters/generate`)
— used by events-service's certificate auto-issuance — and accepts an optional
`deliver: {email, toAddress}` to email the PDF. The destination is always the member's on-record
email for that tenant (`services/letterRecipient.service.js`, via profile-service batch +
`pickEmail`); a caller `toAddress` is used only if it is one of that member's own emails. Delivery
is idempotent via `OutboundCommunication` (`certificate-issuance:<registrationId>`, an existing
`sent` record is never re-sent). When
adding a new route, decide up front whether it needs `requirePermission` — there is no fallback
that sets identity for free.

**Staff-only gate (P5).** A portal member's token can carry `communication:*`, so the permission
alone does not separate staff from members. Every `requirePermission` route in the five routers
(campaigns, templates, bookmark fields, `/letters/generate`, `/letters/profile/:id`,
`/correspondence/profile/:id`) is CRM-only via `middlewares/requireCrmUser.js` (403 `CRM_ONLY` for
PORTAL, missing or unknown `userType`, read from the PDP-verified `req.user` only). It must sit
**after** `requirePermission` — `requirePermission(...) -> tenantContextWarn -> requireCrmUser ->
handler` — because `req.user` does not exist before the PDP call. The portal app does not call
any of these routes; if a portal self-service letter view is ever added, it needs a trusted
own-profile binding (see `getTrustedOwnProfileId`) rather than relaxing this gate. A new
staff-facing route gets the same three-middleware chain (`tests/portalAuthz.p5.test.js` M2 counts
them).

When working from the full `projectShell` checkout, a new route under `routes/*.routes.js` with no
`requirePermission(...)` in its middleware chain is mechanically blocked by
`.claude/hooks/enforce-hard-rules.mjs` (root-level `PreToolUse` hook), unless its path matches
`internal/`, `system/`, `unsubscribe`, or a webhook/SNS pattern — matching the exceptions above. A
route that's genuinely meant to be identity-free but doesn't fit one of those path shapes will need
either a path adjustment or a documented hook exception, not a workaround.
