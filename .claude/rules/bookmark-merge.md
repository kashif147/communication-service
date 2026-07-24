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
