import type {
  DocumentFactExtractor,
  ExtractedFact,
} from "../../providers/interfaces.js";
import { excerpt } from "../../utils/text.js";

export class RegexDocumentFactExtractor implements DocumentFactExtractor {
  extract(text: string): ExtractedFact[] {
    const facts: ExtractedFact[] = [];

    const emails = text.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    );
    for (const email of new Set(emails || [])) {
      facts.push({
        factType: "email",
        value: email,
        evidence: excerpt(email, 120),
        confidence: 0.95,
      });
    }

    const phones = text.match(
      /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g,
    );
    for (const phone of new Set(phones || [])) {
      facts.push({
        factType: "phone",
        value: phone,
        evidence: phone,
        confidence: 0.8,
      });
    }

    const gpas = text.match(/\bGPA[:\s]+([0-4](?:\.\d{1,2})?)\b/gi);
    for (const gpa of gpas || []) {
      const value = gpa.replace(/GPA[:\s]+/i, "");
      facts.push({
        factType: "gpa",
        value,
        evidence: gpa,
        confidence: 0.85,
      });
    }

    const schools = text.match(
      /\b([A-Z][A-Za-z.& ]+(?:University|College|Institute|High School))\b/g,
    );
    for (const school of new Set(schools || []).values()) {
      facts.push({
        factType: "school",
        value: school.trim(),
        evidence: school.trim(),
        confidence: 0.7,
      });
    }

    const majors = text.match(
      /\b(?:Major|Program)[:\s]+([A-Za-z &/]+)/gi,
    );
    for (const major of majors || []) {
      facts.push({
        factType: "major",
        value: major.replace(/^(?:Major|Program)[:\s]+/i, "").trim(),
        evidence: major,
        confidence: 0.65,
      });
    }

    const grads = text.match(
      /\b(?:Expected Graduation|Graduation Date|Graduates?)[:\s]+([A-Za-z]+ \d{4}|\d{1,2}\/\d{4}|\d{4})\b/gi,
    );
    for (const grad of grads || []) {
      facts.push({
        factType: "expected_graduation_date",
        value: grad.replace(/^[^:]+:\s*/i, "").trim(),
        evidence: grad,
        confidence: 0.7,
      });
    }

    const nameLine = text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)+$/.test(l));
    if (nameLine) {
      facts.push({
        factType: "full_legal_name",
        value: nameLine,
        evidence: nameLine,
        confidence: 0.55,
      });
    }

    if (
      /\b(sincerely|respectfully|best regards)\b[\s\S]{0,80}\n\s*[A-Z][a-z]+/i.test(
        text,
      ) ||
      /\b(signed|signature)\b/i.test(text)
    ) {
      facts.push({
        factType: "signature_text",
        value: "text-signature-detected",
        evidence: "Signature-related text found in document",
        confidence: 0.5,
      });
    }

    const orgs = text.match(
      /\b(?:addressed to|Dear)\s+([A-Z][A-Za-z0-9 &'-]{2,60})/g,
    );
    for (const org of orgs || []) {
      facts.push({
        factType: "organization_reference",
        value: org.replace(/^(?:addressed to|Dear)\s+/i, "").trim(),
        evidence: org,
        confidence: 0.6,
      });
    }

    // Explicit enrollment evidence only — never infer from school/graduation alone.
    const negativeEnrollment = text.match(
      /\b(?:not\s+currently\s+enrolled|no\s+longer\s+enrolled|is\s+not\s+enrolled)\b/i,
    );
    if (negativeEnrollment) {
      facts.push({
        factType: "enrollment",
        value: "currently_enrolled=false",
        evidence: negativeEnrollment[0]!,
        confidence: 0.9,
      });
    } else {
      const positiveEnrollment = text.match(
        /\b(?:currently\s+enrolled|enrollment\s+verification|enrolled\s+full[- ]time|enrolled\s+at\b|student\s+is\s+currently\s+enrolled)\b/i,
      );
      if (positiveEnrollment) {
        facts.push({
          factType: "enrollment",
          value: "currently_enrolled=true",
          evidence: positiveEnrollment[0]!,
          confidence: 0.85,
        });
      }
    }

    return facts;
  }
}
