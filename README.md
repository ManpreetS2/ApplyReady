# ApplyReady

**Know what’s missing before you press submit.**

Applicants still lose opportunities to incomplete packets: a missing transcript, an essay over the word limit, a recommendation addressed to the wrong organization, or a filename that breaks the required pattern.

**ApplyReady** extracts evidence-backed requirements, checks local documents with deterministic matching and validation, and explains what remains before submit — without sending files to hosted AI or analytics services.

**Proof:** the guided Future Engineers Scholarship demo progresses from **Not ready** to **Ready to submit** using the same pipelines as real packets.

**Privacy:** documents remain on your machine. SQLite stores metadata locally; uploads stay in a local directory.

**Limitations:** no OCR (image-only scans need a searchable PDF); rule-based matches may require confirmation; signature checks are text-only.

> ApplyReady does not provide legal, immigration, financial, or professional compliance advice.

![ApplyReady landing page](docs/screenshots/landing-page.png)

## Why this project matters

Application readiness is an evidence problem, not a chatbot problem. The hard parts are boring on purpose: safe local file handling, SSRF-resistant URL fetching, requirement extraction with source sentences, honest uncertainty states, consistency conflicts that never silently overwrite confirmed profile values, and a readiness score that cannot claim “ready” while blocking issues remain. ApplyReady is a portfolio-scale full-stack system that keeps those constraints visible instead of hiding them behind a generic AI summary.

## Feature highlights

- Evidence-backed requirement extraction from public URLs, PDF/DOCX/TXT/Markdown, or pasted text
- Document classification, fact extraction, matching, validation, and consistency checks
- Readiness scoring with blocking issues, warnings, and confirmation states
- Document vault for reusable local materials
- Printable readiness report + JSON export
- Guided demo that exercises the real pipelines end-to-end
- Local-first privacy model with destructive-action confirmations

![Dashboard](docs/screenshots/dashboard.png)

![Not ready analysis](docs/screenshots/not-ready-analysis.png)

![Ready to submit](docs/screenshots/ready-to-submit.png)

## Guided demo

Open **Guided Demo** and start **Future Engineers Scholarship**. The packet begins **Not ready** (missing transcript, essay over limit, organization mismatches, email inconsistency, incorrect packet filename). Apply suggested fixes until it reaches **Ready to submit**.

If a recorded walkthrough is present:

[Guided demo video](docs/demo/applyready-guided-demo.webm)

## Architecture

See [docs/architecture.md](docs/architecture.md) for the Mermaid diagram and runtime boundaries.

```
packages/
  shared/   # Zod schemas + shared types
  server/   # Express API, SQLite, document/requirement pipelines
  client/   # React + Vite + Tailwind UI
qa/fixtures/applyready/  # Fictional QA fixture pack
```

Production mode: Express serves the compiled client from one process.

## Screenshots

| View | File |
|------|------|
| Landing | `docs/screenshots/landing-page.png` |
| Dashboard | `docs/screenshots/dashboard.png` |
| Requirement evidence | `docs/screenshots/requirement-evidence.png` |
| Not ready analysis | `docs/screenshots/not-ready-analysis.png` |
| Issue evidence | `docs/screenshots/issue-evidence.png` |
| Ready to submit | `docs/screenshots/ready-to-submit.png` |
| Document vault | `docs/screenshots/document-vault.png` |
| Printable report | `docs/screenshots/printable-report.png` |
| Mobile dashboard | `docs/screenshots/mobile-dashboard.png` |

## Supported document formats

- Requirements: public webpage URL, PDF, DOCX, TXT, Markdown, pasted text
- Application documents: PDF, DOCX, TXT, Markdown

Not supported in this version:

- OCR / image-only scan reading (image-only PDFs are detected and reported)
- Password-protected documents
- Macro/script execution
- Cloud syncing or hosted AI providers

## Requirements extraction

ApplyReady uses a deterministic pipeline:

- `RequirementSourceReader`
- `RequirementExtractor`
- `RequirementNormalizer`
- `RequirementDeduplicator`

It detects required vs optional language, document types, word/page limits, accepted formats, filename rules, recommendation counts, deadlines, GPA/eligibility cues, enrollment language, and more. Every requirement keeps the original source sentence, nearby context, confidence, and detection rule. Weak evidence is marked for user confirmation — the system does not invent requirements.

## Document matching

Documents are classified and matched with structured evidence from category, filename, title, headings, keywords, organization references, word/page counts, and file type.

Match states:

- Confirmed
- Likely match
- Possible match
- Does not match
- Needs user confirmation

Low-confidence matches are never auto-confirmed. Users can manually assign documents. Re-analysis preserves prior user confirmations.

## Readiness scoring

Scores range from 0–100 using weighted factors:

- required documents present
- match confirmation quality
- blocking issues
- warnings and uncertainty
- consistency conflicts

Status levels:

- Ready to submit
- Nearly ready
- Needs attention
- Not ready
- Unable to determine

A packet cannot be Ready when a required document is missing, a blocking rule fails, a required item lacks a confirmed/high-confidence match, or a critical inconsistency remains unresolved.

## Issue detection

ApplyReady detects missing documents, format problems, content mismatches, duplicates, low-text PDFs, filename errors, organization mismatches, and profile inconsistencies. Issues are labeled as blocking, warning, needs confirmation, or suggestion — and every warning includes evidence.

## Privacy

- Documents remain local to your machine
- No files are sent to AI providers
- No analytics, telemetry, or tracking
- SQLite stores metadata and extracted results locally
- Uploaded files live in a local application data directory
- Destructive deletes require confirmation

## Technology stack

- Node.js 20+
- TypeScript (strict)
- npm workspaces
- React 18, Vite, React Router, Tailwind CSS, Lucide React
- Express, better-sqlite3, Zod, Multer
- Cheerio, Mozilla Readability, JSDOM
- pdfjs-dist, PDFKit (fixtures), Mammoth
- Vitest, Supertest, Playwright

## Local setup

```bash
npm install
npm run db:init
npm run dev
```

- API/UI proxy: client on `http://127.0.0.1:5173`
- API server: `http://127.0.0.1:8787`

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:e2e:headed
npm run build
npm start
npm run qa
npm run screenshots
npm run demo:record
npm run db:init
npm run db:seed
npm run db:reset
```

`npm run qa` runs typecheck, unit tests, integration tests, production build, and Playwright E2E against an isolated temporary database/upload directory.

## Testing summary

- Unit: requirement extraction, document parsing/classification, matching/validation, URL SSRF protections
- Integration: API lifecycle, guided demo, fictional QA fixture pack (bad → ready, edge cases)
- E2E: core lifecycle, requirements formats, bad/corrected packets, vault, report PDF, keyboard accessibility, refresh resilience, dashboard filters, edge uploads

Fictional fixtures live in `qa/fixtures/applyready/` and must not be copied into runtime `uploads/` by default. See `docs/QA_REPORT.md` for the latest verification record.

## Production build

```bash
npm run build
npm start
```

Open `http://127.0.0.1:8787`.

## Known limitations

- OCR is not included; image-only scans need conversion to searchable PDFs
- Rule-based analysis may require user confirmation
- Signature detection is text-only (“ApplyReady could not confirm that a signature is present”)
- Webpage fetching blocks private/local addresses and does not execute JavaScript
- Wizard progress is in-memory in the browser; refreshing the new-application wizard returns to step 1 with an honest reset (no false Ready state)
- Not a substitute for official checklist review
- Physical-device testing is out of scope unless separately performed

## Future improvements

- Optional local/server AI provider behind existing interfaces
- OCR for scanned PDFs
- Richer eligibility condition modeling
- Additional application templates
- Deeper duplicate/near-duplicate detection

## Author

**Manpreet Singh**  
Computer Science Student at De Anza College

Built as a portfolio project exploring document processing, requirement extraction, evidence-grounded validation, local-first privacy, application readiness scoring, and full-stack software engineering.

## License

MIT
