# ApplyReady QA Report

- **Date:** 2026-08-03 (UTC)
- **Branch:** `feat/applyready-mvp`
- **Commit subject:** `chore: harden ApplyReady QA and portfolio presentation`
- **Parent commit:** `3611668863da6b368cc2b63bc5e127445b6d8b7d`
- **Environment:** macOS darwin 25.5.0, Node.js 22.12.0, npm workspaces
- **Browsers:** Playwright Chromium (desktop 1440×900, mobile viewport 390×844)
- **Physical devices:** not tested

## Commands executed

```bash
npm install
npx playwright install chromium
npm run db:init
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm run qa
npm run screenshots
npm run demo:record
```

Production smoke test (isolated temp data/uploads on `127.0.0.1:8799`):

- `GET /api/health` → ok
- Landing → Dashboard → Guided Demo start + one fix → Vault → Privacy
- Console/page errors observed: **none**

## Automated test counts

| Suite | Result |
|-------|--------|
| Unit (`tests/unit`) | 19 passed |
| Integration (`tests/integration`, includes QA fixtures) | 8 passed |
| Full `npm test` | 27 passed |
| Playwright E2E | 14 passed |
| `npm run qa` | typecheck + unit + integration + build + e2e **passed** |
| Production build | **passed** |
| Production smoke test | **passed** |

## E2E scenarios covered

- Core lifecycle: landing, dashboard, create application, paste requirements, confirm, upload, analyze, export JSON, delete document, delete application
- Requirements formats: TXT, Markdown, PDF, DOCX with source evidence visible
- Initial bad packet → Not ready with expected issue themes
- Corrected packet → Ready to submit after legitimate confirmations
- Vault upload / attach / replace / permanent delete
- Printable report content checks + Playwright PDF output to temp
- Keyboard navigation, dialog focus trap + Escape, status text labels
- Refresh resilience (wizard reset without false Ready)
- Dashboard search / type filter / sort across multiple apps
- Edge uploads: duplicate, low-text, corrupt PDF, invalid MIME, empty TXT, path-like sanitize, RTF reject, long filename

## Accessibility checks

- Skip link reachable by keyboard
- Primary nav exposes full accessible names
- Visible focus on interactive controls
- Confirm dialogs: `role="dialog"`, focus trap, Escape dismiss, focus return
- Status communicated with text labels (not color alone)
- Desktop and mobile Chromium viewports exercised for a11y/resilience flows
- Native browser `confirm()` replaced with accessible `ConfirmDialog` for destructive actions

## Fixture outcomes

Fictional pack imported to `qa/fixtures/applyready/` (see `FIXTURES.md`).

| Scenario | Outcome |
|----------|---------|
| Bad packet | `not_ready`; missing transcript, word-limit, organization mismatch, email/profile mismatch, bad combined filename |
| Corrected packet | reaches `ready` after match confirmations + conflict resolution |
| Optional portfolio | extracted as optional |
| Edge cases | graceful reject/warn as documented; no OCR success claims |

## Defects found and fixed

1. Portfolio “may include” treated as required → optional detection expanded
2. Essay/recommendation defaulted to PDF-only → accept PDF+DOCX when format unspecified
3. GPA eligibility treated as missing document → eligibility validation against profile/facts
4. Re-analysis wiped match confirmations and recreated resolved conflicts → preserve confirmations/resolved fields
5. Organization mismatch missed “Bright Tomorrow” → added org hint
6. Path-like filenames rejected instead of sanitized → sanitize `..` / separators; preserve extension when truncating long names
7. Plain-text disguised as PDF accepted → `%PDF` magic-byte check
8. Corrupt PDF surfaced as low-text → `CORRUPT_PDF` error
9. Confirmed profile values could be overwritten by extracted facts → skip non-empty profile fields
10. Resume email vs confirmed profile not surfaced → `EMAIL_PROFILE_MISMATCH`
11. Vault attach missing in UI → attach from vault page and Documents tab
12. Destructive confirms used inaccessible `window.confirm` → accessible `ConfirmDialog`
13. Evidence/filename overflow risk → CSS overflow/break handling

## Generated assets

Screenshots in `docs/screenshots/`:

- landing-page.png
- dashboard.png
- requirement-evidence.png
- not-ready-analysis.png
- issue-evidence.png
- ready-to-submit.png
- document-vault.png
- printable-report.png
- mobile-dashboard.png

Demo video:

- `docs/demo/applyready-guided-demo.webm` (**generated successfully**, ~912 KB)

Architecture:

- `docs/architecture.md`

## Remaining manual / human checks

- Physical iOS/Android device testing
- Visual review of README screenshot rendering on GitHub
- Human review of print layout on a real printer / system print dialog
- Optional public URL fetch against a live public requirements page (SSRF protections covered in unit/integration tests)

## Genuine limitations

- No OCR; image-only scans require searchable conversion
- Rule-based matching may still need user confirmation
- Signature detection is text-only
- New-application wizard state is browser-memory only; refresh returns to step 1 (honest reset, no false Ready)
- Webpage fetching does not execute JavaScript
- Not a substitute for official checklist review
