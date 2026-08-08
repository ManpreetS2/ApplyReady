import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const FIXTURES = path.resolve("qa/fixtures/applyready");

export function fixturePath(...parts: string[]): string {
  return path.join(FIXTURES, ...parts);
}

export function readFixture(...parts: string[]): Buffer {
  return fs.readFileSync(fixturePath(...parts));
}

export const JORDAN_PROFILE = {
  fullLegalName: "Jordan Lee",
  email: "jordan.lee@example.com",
  phone: "(555) 014-0268",
  school: "Redwood Community College",
  expectedGraduationDate: "May 2027",
  major: "Computer Science",
  gpa: "3.62",
  currentlyEnrolled: true,
  targetOrganization: "Future Engineers Foundation",
  userConfirmed: true,
};

export async function apiCreateApplication(
  request: APIRequestContext,
  body: Record<string, unknown>,
) {
  const res = await request.post("/api/applications", { data: body });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).application as { id: string; name: string };
}

export async function apiSetProfile(
  request: APIRequestContext,
  appId: string,
  profile = JORDAN_PROFILE,
) {
  const res = await request.patch(`/api/applications/${appId}/profile`, {
    data: profile,
  });
  expect(res.ok()).toBeTruthy();
}

export async function apiAddTextSource(
  request: APIRequestContext,
  appId: string,
  text: string,
  sourceName = "Official requirements",
) {
  const res = await request.post(`/api/applications/${appId}/sources/text`, {
    data: { text, sourceName },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).requirements as Array<{
    id: string;
    title: string;
    certainty?: "required" | "optional" | "uncertain";
  }>;
}

export async function apiConfirmAllRequirements(
  request: APIRequestContext,
  requirements: Array<{
    id: string;
    certainty?: "required" | "optional" | "uncertain";
  }>,
) {
  for (const req of requirements) {
    const data =
      req.certainty === "uncertain" ? { certainty: "required" as const } : {};
    const res = await request.post(`/api/requirements/${req.id}/confirm`, {
      data,
    });
    expect(res.ok()).toBeTruthy();
  }
}

export async function apiUploadDocument(
  request: APIRequestContext,
  appId: string,
  filePath: string,
  filename?: string,
) {
  const res = await request.post(`/api/applications/${appId}/documents`, {
    multipart: {
      file: {
        name: filename || path.basename(filePath),
        mimeType: mimeFor(filePath),
        buffer: fs.readFileSync(filePath),
      },
    },
  });
  return res;
}

export async function apiAnalyze(request: APIRequestContext, appId: string) {
  const res = await request.post(`/api/applications/${appId}/analyze`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}

export async function apiClearAll(request: APIRequestContext) {
  const res = await request.delete("/api/settings/clear-all");
  expect(res.ok()).toBeTruthy();
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  if (ext === ".rtf") return "application/rtf";
  return "application/octet-stream";
}

export async function waitForReadyBadge(page: Page) {
  await expect(page.getByText(/Ready to submit/i).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function focusVisible(page: Page, selector: string) {
  await page.locator(selector).focus();
  const outline = await page.locator(selector).evaluate((el) => {
    const styles = window.getComputedStyle(el);
    return `${styles.outlineStyle}:${styles.outlineWidth}:${styles.boxShadow}`;
  });
  expect(outline === "none:0px:none" || outline.includes("auto")).toBeFalsy();
}
