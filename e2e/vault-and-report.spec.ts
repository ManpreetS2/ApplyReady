import { expect, test } from "@playwright/test";
import fs from "node:fs";
import {
  apiClearAll,
  apiCreateApplication,
  fixturePath,
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await apiClearAll(request);
});

test("vault upload, attach, replace, and permanent delete", async ({
  page,
  request,
}) => {
  const app = await apiCreateApplication(request, {
    name: "Vault Target App",
    organization: "Future Engineers Foundation",
    type: "scholarship",
  });

  await page.goto("/vault");
  await expect(page.getByRole("heading", { name: "Document vault" })).toBeVisible();
  await page.getByLabel("Vault document category").selectOption("resume");
  await page.getByLabel("Vault document notes").fill("Fictional QA resume");
  await page.getByLabel("Vault document version note").fill("v1");
  await page.getByLabel("Vault file upload").setInputFiles(
    fixturePath("corrected_packet/Lee_Jordan_Resume.pdf"),
  );
  await expect(page.getByText(/Uploaded .* to the vault/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lee_Jordan_Resume.pdf" })).toBeVisible();

  await page.getByRole("button", { name: "Use in application" }).click();
  await page.getByLabel("Application for vault document").selectOption(app.id);
  await page.getByRole("button", { name: "Attach document" }).click();
  await expect(page.getByText(/Attached .* to the selected application/i)).toBeVisible();

  await page.goto(`/applications/${app.id}`);
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(page.getByRole("heading", { name: "Lee_Jordan_Resume.pdf" })).toBeVisible();

  await page.goto("/vault");
  await page.getByLabel(/Replace Lee_Jordan_Resume/i).setInputFiles(
    fixturePath("corrected_packet/Lee_Jordan_Resume.pdf"),
  );
  await expect(page.getByText(/Newer version uploaded/i)).toBeVisible();

  await page.getByRole("button", { name: "Delete permanently" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText(/Deleted /i)).toBeVisible();
});

test("printable report excludes raw dumps and exports PDF", async ({
  page,
  request,
}, testInfo) => {
  const app = await apiCreateApplication(request, {
    name: "Report Scholarship",
    organization: "Future Engineers Foundation",
    type: "scholarship",
    deadline: "2026-10-15",
  });
  const text = fs.readFileSync(
    fixturePath("requirements/scholarship-requirements.txt"),
    "utf8",
  );
  await request.post(`/api/applications/${app.id}/sources/text`, {
    data: { text, sourceName: "official" },
  });
  await request.post(`/api/applications/${app.id}/documents`, {
    multipart: {
      file: {
        name: "Lee_Jordan_Resume.pdf",
        mimeType: "application/pdf",
        buffer: fs.readFileSync(fixturePath("corrected_packet/Lee_Jordan_Resume.pdf")),
      },
    },
  });
  await request.post(`/api/applications/${app.id}/analyze`);

  await page.goto(`/applications/${app.id}/report`);
  await expect(page.getByRole("heading", { name: "Report Scholarship" })).toBeVisible();
  await expect(page.getByText(/Requirements checklist/i)).toBeVisible();
  await expect(page.getByText(/Unresolved issues|Validation results/i).first()).toBeVisible();
  const bodyText = await page.locator("article").innerText();
  expect(bodyText.length).toBeGreaterThan(40);
  expect(bodyText).not.toMatch(/full raw document text dump/i);

  const pdfPath = testInfo.outputPath("report.pdf");
  const pdf = await page.pdf({ path: pdfPath });
  expect(pdf.byteLength).toBeGreaterThan(500);
  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync("tmp/e2e-report.pdf", pdf);
});
