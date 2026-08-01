# ApplyReady

**Know what’s missing before you press submit.**

ApplyReady is a local-first application readiness platform for scholarships, college applications, and internships. It extracts requirements with source evidence, analyzes your documents on your machine, matches materials to requirements, detects issues, and produces a transparent readiness score.

> ApplyReady does not provide legal, immigration, financial, or professional compliance advice.

## Problem

Application packets fail for avoidable reasons: a missing transcript, an essay over the word limit, a recommendation addressed to the wrong organization, or a filename that does not match the required pattern. Most tools either store documents in the cloud or give vague AI summaries without evidence.

## How ApplyReady works

1. Create an application (name, organization, type, deadline).
2. Add official requirements via public URL, PDF/DOCX/TXT/Markdown upload, or pasted text.
3. Review extracted requirements with evidence, confidence, and editable fields.
4. Upload application documents.
5. Analyze the packet with deterministic matching, validation, and consistency checks.
6. Review the readiness dashboard, resolve issues, and export a printable report.

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

It detects required vs optional language, document types, word/page limits, accepted formats, filename rules, recommendation counts, deadlines, GPA/eligibility cues, and more. Every requirement keeps the original source sentence, nearby context, confidence, and detection rule. Weak evidence is marked for user confirmation — the system does not invent requirements.

## Document matching

Documents are classified and matched with structured evidence from category, filename, title, headings, keywords, organization references, word/page counts, and file type.

Match states:

- Confirmed
- Likely match
- Possible match
- Does not match
- Needs user confirmation

Low-confidence matches are never auto-confirmed. Users can manually assign documents.

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

## Evidence and uncertainty

Honest uncertainty is a core product principle. ApplyReady uses states such as Confirmed, Likely match, Needs user confirmation, Missing, Issue detected, and Unable to determine. Full raw document text is not dumped into the UI; relevant excerpts are shown instead.

## Guided demo

**Future Engineers Scholarship** exercises the real pipelines with intentional defects:

- missing transcript
- essay over 500 words
- essay/recommendation organization mismatch
- outdated email inconsistency
- incorrect packet filename

Follow the guided fixes until the packet reaches **Ready to submit**.

## Privacy

- Documents remain local to your machine
- No files are sent to AI providers
- No analytics, telemetry, or tracking
- SQLite stores metadata and extracted results locally
- Uploaded files live in a local application data directory
- Destructive deletes require confirmation

## Architecture

```
packages/
  shared/   # Zod schemas + shared types
  server/   # Express API, SQLite, document/requirement pipelines
  client/   # React + Vite + Tailwind UI
```

Production mode: Express serves the compiled client from one process.

Provider interfaces exist for a future optional server-side AI provider, but this version is fully deterministic and local.

## Technology stack

- Node.js 20+
- TypeScript (strict)
- npm workspaces
- React 18, Vite, React Router, Tailwind CSS, Lucide React
- Express, better-sqlite3, Zod, Multer
- Cheerio, Mozilla Readability, JSDOM
- pdfjs-dist, PDFKit (fixtures), Mammoth
- Vitest, Supertest

## Local setup

```bash
npm install
npm run db:init
npm run dev
```

- API/UI proxy: client on `http://127.0.0.1:5173`
- API server: `http://127.0.0.1:8787`

Useful scripts:

```bash
npm run dev:server
npm run dev:client
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run build
npm start
npm run db:init
npm run db:seed
npm run db:reset
```

## Database setup

```bash
npm run db:init    # create SQLite schema + local dirs
npm run db:seed    # seed guided demo
npm run db:reset   # wipe DB + uploads
```

Runtime database and uploads are gitignored.

## Testing

Tests are deterministic and offline:

- requirement extraction
- document parsing/classification
- matching and validation
- URL SSRF protections
- guided demo lifecycle
- application API lifecycle

```bash
npm test
```

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
- Not a substitute for official checklist review

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
