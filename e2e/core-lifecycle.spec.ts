import { expect, test } from "@playwright/test";
import fs from "node:fs";
import {
  apiClearAll,
  fixturePath,
  readFixture,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await apiClearAll(request);
});

test("core application lifecycle through UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Know what’s missing/i })).toBeVisible();
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "New application" }).first().click();
  await page.getByLabel("Application name").fill("Lifecycle Scholarship QA");
  await page.getByLabel("Organization").fill("Future Engineers Foundation");
  await page.getByLabel("Application type").selectOption("scholarship");
  await page.getByLabel("Deadline (optional)").fill("2026-10-15");
  await page.getByRole("button", { name: "Continue" }).click();

  const requirementsText = fs.readFileSync(
    fixturePath("requirements/scholarship-requirements.txt"),
    "utf8",
  );
  await page.getByLabel("Requirements text").fill(requirementsText);
  await page.getByRole("button", { name: "Extract requirements" }).click();
  await expect(page.getByText(/Source evidence/i).first()).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).first().click();
  await page.getByRole("button", { name: "Continue to documents" }).click();

  await page
    .locator("#docs")
    .setInputFiles(fixturePath("initial_bad_packet/Jordan_Lee_Resume.pdf"));
  await expect(page.getByText(/Uploaded/i)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue to analysis" }).click();
  await page.getByRole("button", { name: "Analyze packet" }).click();
  await expect(page.getByRole("heading", { name: "Readiness report ready" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Open application" }).click();

  await expect(page.getByText(/Not ready|Needs attention|Nearly ready/i).first()).toBeVisible();
  await page.getByRole("tab", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete document" }).click();

  await page.getByRole("link", { name: "Printable report" }).click();
  await page.getByRole("button", { name: "Export JSON" }).click();
  await page.getByRole("link", { name: "Back to application" }).click();

  await page.getByRole("button", { name: "Delete application" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("requirements formats include evidence", async ({ page, request }) => {
  const files = [
    "scholarship-requirements.txt",
    "future_engineers_requirements.md",
    "future_engineers_requirements.pdf",
    "future_engineers_requirements.docx",
  ];

  for (const file of files) {
    await apiClearAll(request);
    await page.goto("/applications/new");
    await page.getByLabel("Application name").fill(`Req format ${file}`);
    await page.getByLabel("Organization").fill("Future Engineers Foundation");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("tab", { name: "Upload file" }).click();
    await page.locator("#requirements-file").setInputFiles(fixturePath("requirements", file));
    await page.getByRole("button", { name: "Extract requirements" }).click();
    await expect(page.getByText(/Source evidence/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/Resume|Essay|Transcript|Recommendation/i).first()).toBeVisible();
    await expect(page.getByText(/Required|Optional/i).first()).toBeVisible();
  }
});
