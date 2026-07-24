# Commands

```bash
npm run dev              # nodemon, watches everything, .ext js,json
npm start                # plain node start
npm run start:dev        # NODE_ENV=development
npm run start:staging    # NODE_ENV=staging
npm run start:prod       # NODE_ENV=production
```

No test suite, no lint script in `package.json` — don't invent one. `scripts/` contains one-off
maintenance scripts (`create-bookmark-fields.js`, `seed-ugrad-graduation-email-template.js`,
`test-endpoints.js`, `validate-endpoints.js`), run directly with `node scripts/<file>.js`, not via
npm.

Runs on port `4004`. ESM throughout (`"type": "module"`). Node `>=18 <=20.x` is pinned in
`package.json` — check why before bumping past 20.x.

DOCX→PDF conversion (`services/docxPdfConversion.service.js`) shells out to `soffice`
(LibreOffice) via `execFile` — it must be installed on any machine running gap-letter /
undergraduate-graduation comms locally. `LIBREOFFICE_BIN`/`SOFFICE_BIN` env vars override the
binary path if it's not on `PATH`.
