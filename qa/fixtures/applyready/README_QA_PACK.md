# ApplyReady QA Fixture Pack

All names, organizations, addresses, schools, phone numbers, emails, and application materials in this pack are fictional.

## Purpose

Use these files to verify ApplyReady's requirement extraction, parsing, matching, validation, issue detection, readiness calculation, privacy behavior, vault workflow, and error handling.

## Recommended sequence

1. Create a new application named **Future Engineers Scholarship QA**.
2. Import one requirements source from `requirements/`.
3. Confirm or edit extracted requirements.
4. Set the applicant profile to:
   - Full name: Jordan Lee
   - Email: jordan.lee@example.com
   - Phone: (555) 014-0268
   - School: Redwood Community College
   - Expected graduation: May 2027
   - Major: Computer Science
   - GPA: 3.62
   - Target organization: Future Engineers Foundation
5. Upload everything in `initial_bad_packet/`.
6. Analyze and verify that the packet is **Not ready**.
7. Verify the six expected issues:
   - Transcript missing
   - Essay over 500 words
   - Essay references another scholarship
   - Recommendation addressed elsewhere
   - Resume email inconsistency
   - Final packet filename incorrect
8. Replace the bad files with files from `corrected_packet/`.
9. Reanalyze and confirm the packet can become **Ready to submit**.
10. Upload edge cases one at a time and verify graceful errors or uncertainty language.

## Important

- Do not add corrupt or intentionally invalid files to production demo flows.
- Do not claim OCR support when testing `low_text_scan_like.pdf`.
- The exact expected outcome for every file is in `expected-results.json`.
