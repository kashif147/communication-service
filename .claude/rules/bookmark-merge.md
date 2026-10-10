# Bookmark merge system

`services/bookmarkMerge.service.js`: `BookmarkField` documents define a `key` (the
`{{placeholder}}` name) and a `path` like `profile.model.personalInfo.forename:MMM yyyy` — a
dot-path into a runtime context object, with an optional `:formatPattern` suffix for dates or
`:lines`/`:commaLines` for multi-line address rendering.

`buildBookmarkMergeMap()` assembles the runtime context (`{ profile, subscription, tenant,
system }`), resolves every field, and produces the flat map that both `mailMerge.service.js`
(docx) and `personalization.service.js` (`applyTemplate`, HTML/text) consume.

When adding a new mail-merge field: add a `BookmarkField` row (via
`scripts/create-bookmark-fields.js` or the API) with the right `path`. Don't hardcode new fields
directly into the merge functions — a field that isn't a `BookmarkField` row won't be reusable
across the docx and HTML/text merge paths.

**Tenancy:** rows are either `scope: "system"` (`tenantId: null`, platform-global, readable by
all tenants, writable only by role `SU`) or `scope: "tenant"` (owned by one tenant, writable by
that tenant's permitted users). `services/bookmarkFieldScope.service.js`
`getEffectiveBookmarkFields(tenantId)` returns system + own rows with the tenant row winning per
key; merge, template placeholder validation and `GET /api/bookmarks/fields` all use it. Legacy
rows with no `tenantId`/`scope` read as system rows. Unique index is `{tenantId, key}`;
`scripts/migrate-bookmark-fields-tenant-scope.js` (dry-run by default) marks legacy rows as system,
builds `tenantId_1_key_1`, then drops the old global `key_1`. `scripts/create-bookmark-fields.js`
upserts system rows only.
