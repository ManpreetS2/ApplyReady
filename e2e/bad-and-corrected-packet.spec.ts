import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  apiAddTextSource,
  apiAnalyze,
  apiClearAll,
  apiConfirmAllRequirements,
  apiCreateApplication,
  apiSetProfile,
  apiUploadDocument,
  fixturePath,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await apiClearAll(request);
});

test("initial bad packet is Not ready with expected issue themes", async ({
  page,
  request,
}) => {
  const app = await apiCreateApplication(request, {
    name: "Future Engineers Scholarship QA",
    organization: "Future Engineers Foundation",
    type: "scholarship",
    deadline: "2026-10-15",
  });
  await apiSetProfile(request, app.id);
  const text = fs.readFileSync(
    fixturePath("requirements/future_engineers_requirements.txt"),
    "utf8",
  );
  const requirements = await apiAddTextSource(request, app.id, text);
  await apiConfirmAllRequirements(request, requirements);

  for (const file of [
    "Jordan_Lee_Resume.pdf",
    "Engineering_Essay_620_Words.docx",
    "Recommendation_Letter_Other_Scholarship.pdf",
    "JordanLeeFinal.pdf",
  ]) {
    const res = await apiUploadDocument(
      request,
      app.id,
      fixturePath("initial_bad_packet", file),
    );
    expect(res.ok()).toBeTruthy();
  }

  const analysis = await apiAnalyze(request, app.id);
  expect(analysis.report.status).toBe("not_ready");
  const blob = JSON.stringify(analysis.issues).toLowerCase();
  expect(blob).toMatch(/transcript|missing/);
  expect(blob).toMatch(/word limit|500|620/);
  expect(blob).toMatch(/organization|bright tomorrow|mismatch/);
  expect(blob).toMatch(/email/);
  expect(blob).toMatch(/filename|combined packet|lastname/);

  await page.goto(`/applications/${app.id}`);
  await expect(page.getByText(/Not ready/i).first()).toBeVisible();
  await page.getByRole("tab", { name: "Issues" }).click();
  await expect(page.getByText(/Missing: Transcript|Word limit|Organization|email|filename|Combined Packet/i).first()).toBeVisible();
});

test("corrected packet can reach Ready to submit after confirmations", async ({
  page,
  request,
}) => {
  const app = await apiCreateApplication(request, {
    name: "Future Engineers Scholarship QA Ready",
    organization: "Future Engineers Foundation",
    type: "scholarship",
    deadline: "2026-10-15",
  });
  await apiSetProfile(request, app.id);
  const text = fs.readFileSync(
    fixturePath("requirements/future_engineers_requirements.txt"),
    "utf8",
  );
  const requirements = await apiAddTextSource(request, app.id, text);
  await apiConfirmAllRequirements(request, requirements);

  for (const file of [
    "Lee_Jordan_Resume.pdf",
    "Lee_Jordan_Essay.docx",
    "Lee_Jordan_Recommendation.pdf",
    "Lee_Jordan_Transcript.pdf",
    "Lee_Jordan_2026.pdf",
  ]) {
    const res = await apiUploadDocument(
      request,
      app.id,
      fixturePath("corrected_packet", file),
    );
    expect(res.ok()).toBeTruthy();
  }

  let analysis = await apiAnalyze(request, app.id);
  const best = new Map<string, { id: string; confidence: number }>();
  for (const match of analysis.matches as Array<{
    id: string;
    requirementId: string;
    confidence: number;
    status: string;
  }>) {
    if (match.status === "does_not_match") continue;
    const cur = best.get(match.requirementId);
    if (!cur || match.confidence > cur.confidence) {
      best.set(match.requirementId, match);
    }
  }
  for (const match of best.values()) {
    const res = await request.patch(`/api/document-matches/${match.id}`, {
      data: { status: "confirmed", userConfirmed: true },
    });
    expect(res.ok()).toBeTruthy();
  }

  const detail = await request.get(`/api/applications/${app.id}`);
  const body = await detail.json();
  for (const conflict of body.conflicts) {
    if (!conflict.resolved) {
      await request.post(`/api/conflicts/${conflict.id}/resolve`, {
        data: { equivalent: true },
      });
    }
  }
  for (const issue of body.issues.filter(
    (i: { status: string; dismissible: boolean }) =>
      i.status === "open" && i.dismissible,
  )) {
    await request.patch(`/api/issues/${issue.id}`, {
      data: { status: "dismissed" },
    });
  }

  analysis = await apiAnalyze(request, app.id);
  expect(analysis.report.status).toBe("ready");

  await page.goto(`/applications/${app.id}`);
  await expect(page.getByText(/Ready to submit/i).first()).toBeVisible();
});
