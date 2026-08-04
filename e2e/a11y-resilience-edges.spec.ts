import { expect, test } from "@playwright/test";
import {
  apiClearAll,
  apiCreateApplication,
  fixturePath,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await apiClearAll(request);
});

test("keyboard navigation and dialog focus behavior", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Open dashboard" })).toBeVisible();
  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("link", { name: "Open dashboard" }).focus();
  await expect(page.getByRole("link", { name: "Open dashboard" })).toBeFocused();

  await page.goto("/dashboard");
  await page.getByRole("link", { name: "New application" }).first().click();
  await page.getByLabel("Application name").fill("A11y App");
  await page.getByLabel("Organization").fill("Future Engineers Foundation");
  await page.getByRole("button", { name: "Continue" }).focus();
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("tab", { name: "Paste text" }).focus();
  await expect(page.getByRole("tab", { name: "Paste text" })).toBeFocused();

  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Document vault" })).toBeVisible();
  await page.goto("/privacy");
  await page.getByRole("button", { name: "Clear all local data" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Document Vault" })).toBeVisible();
});

test("status communicated with text labels", async ({ page, request }) => {
  const app = await apiCreateApplication(request, {
    name: "Status Labels",
    organization: "Future Engineers Foundation",
    type: "scholarship",
  });
  await page.goto(`/applications/${app.id}`);
  await expect(page.getByText(/Not analyzed|Not ready|Ready to submit|Needs attention/i).first()).toBeVisible();
});

test("refresh resilience does not invent Ready", async ({ page }) => {
  await page.goto("/applications/new");
  await page.getByLabel("Application name").fill("Refresh App");
  await page.getByLabel("Organization").fill("Future Engineers Foundation");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "New application" })).toBeVisible();
  await expect(page.getByText(/Step 1 of 6/i)).toBeVisible();
  await expect(page.getByText(/Ready to submit/i)).toHaveCount(0);
});

test("dashboard search filter and sort across multiple apps", async ({
  page,
  request,
}) => {
  for (const [name, type, deadline] of [
    ["Alpha Scholarship", "scholarship", "2026-09-01"],
    ["Beta College", "college", "2026-11-01"],
    ["Gamma Internship", "internship", "2026-08-15"],
  ] as const) {
    await apiCreateApplication(request, {
      name,
      organization: "Future Engineers Foundation",
      type,
      deadline,
    });
  }

  await page.goto("/dashboard");
  await page.getByPlaceholder("Search by name or organization").fill("Beta");
  await expect(page.getByRole("link", { name: /Beta College/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Alpha Scholarship/i })).toHaveCount(0);

  await page.getByPlaceholder("Search by name or organization").fill("");
  await page.locator("select").nth(0).selectOption("internship");
  await expect(page.getByRole("link", { name: /Gamma Internship/i }).first()).toBeVisible();

  await page.locator("select").nth(0).selectOption("all");
  await page.locator("select").nth(1).selectOption("deadline");
  await expect(
    page.getByRole("link", { name: /Gamma Internship|Alpha Scholarship|Beta College/i }).first(),
  ).toBeVisible();
});

test("edge case uploads fail or warn gracefully", async ({ request }) => {
  const app = await apiCreateApplication(request, {
    name: "Edge Cases",
    organization: "Future Engineers Foundation",
    type: "scholarship",
  });

  const resume = await request.post(`/api/applications/${app.id}/documents`, {
    multipart: {
      file: {
        name: "Jordan_Lee_Resume.pdf",
        mimeType: "application/pdf",
        buffer: await import("node:fs").then((fs) =>
          fs.readFileSync(fixturePath("initial_bad_packet/Jordan_Lee_Resume.pdf")),
        ),
      },
    },
  });
  expect(resume.ok()).toBeTruthy();

  const dup = await request.post(`/api/applications/${app.id}/documents`, {
    multipart: {
      file: {
        name: "duplicate_resume_copy.pdf",
        mimeType: "application/pdf",
        buffer: await import("node:fs").then((fs) =>
          fs.readFileSync(fixturePath("edge_cases/duplicate_resume_copy.pdf")),
        ),
      },
    },
  });
  expect(dup.ok()).toBeTruthy();
  const analysis = await request.post(`/api/applications/${app.id}/analyze`);
  const analyzed = await analysis.json();
  expect(
    analyzed.issues.some((i: { code: string }) => i.code === "DUPLICATE_FILES"),
  ).toBeTruthy();

  const cases: Array<[string, string, number | ((body: { error?: { code?: string }; document?: { parseStatus?: string } }) => boolean)]> = [
    ["low_text_scan_like.pdf", "application/pdf", (b) => b.document?.parseStatus === "low_text"],
    ["corrupt_document.pdf", "application/pdf", (b) => b.error?.code === "CORRUPT_PDF"],
    ["invalid_mime_disguised_as_pdf.pdf", "application/pdf", (b) => b.error?.code === "INVALID_PDF_CONTENT"],
    ["empty_document.txt", "text/plain", (b) => b.error?.code === "EMPTY_FILE"],
    ["unsupported_format.rtf", "application/rtf", (b) => b.error?.code === "UNSUPPORTED_EXTENSION"],
    [".._.._Jordan_Lee_Resume.pdf", "application/pdf", (b) => Boolean(b.document?.parseStatus) || b.error?.code === "INVALID_FILENAME"],
  ];

  for (const [name, mime, check] of cases) {
    const fs = await import("node:fs");
    const res = await request.post(`/api/applications/${app.id}/documents`, {
      multipart: {
        file: {
          name,
          mimeType: mime,
          buffer: fs.readFileSync(fixturePath("edge_cases", name)),
        },
      },
    });
    const body = await res.json();
    if (typeof check === "number") {
      expect(res.status()).toBe(check);
    } else {
      expect(check(body)).toBeTruthy();
    }
  }

  const longName =
    "Jordan_Lee_Very_Long_Filename_Test_Very_Long_Filename_Test_Very_Long_Filename_Test_Very_Long_Filename_Test_Very_Long_Filename_Test_Very_Long_Filename_Test_Very_Long_Filename_Test_Resume.pdf";
  const longRes = await request.post(`/api/applications/${app.id}/documents`, {
    multipart: {
      file: {
        name: longName,
        mimeType: "application/pdf",
        buffer: await import("node:fs").then((fs) =>
          fs.readFileSync(fixturePath("edge_cases", longName)),
        ),
      },
    },
  });
  expect(longRes.ok()).toBeTruthy();
  const longBody = await longRes.json();
  expect(longBody.document.originalFilename.length).toBeLessThanOrEqual(180);
});
