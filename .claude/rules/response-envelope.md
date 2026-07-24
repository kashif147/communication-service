# Response envelope & errors

`res.success/.created/.fail/.notFoundRecord/...` from `middlewares/response.mw.js` follow the
platform-standard envelope (see `backend/CLAUDE.md` in the full projectShell checkout) — use
these, not raw `res.json()`.

`errors/AppError.js` + `middlewares/validateInput.js` (`validateObjectId`, `validateUrl` — an
SSRF guard with a private-IP blocklist, `sanitizeString`) are the standard way to reject bad
input. Prefer them over ad hoc checks, especially anywhere a Mongo `_id` or an outbound URL is
built from request input.
