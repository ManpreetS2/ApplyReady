import { expect, test, type Page } from "@playwright/test";

async function collectPageErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return { pageErrors, consoleErrors };
}

async function applyFixesUntilReady(page: Page) {
  for (let i = 0; i < 8; i += 1) {
    const ready = page.getByText(/Ready to submit/i).first();
    if (await ready.isVisible().catch(() => false)) {
      return;
    }
    const fix = page.getByRole("button", { name: "Apply suggested fix" });
    await expect(fix).toBeVisible();
    if (await fix.isDisabled()) {
      await page.waitForTimeout(500);
      continue;
    }
    const response = page.waitForResponse(
      (r) =>
        (r.url().includes("/api/demo/") &&
          (r.url().includes("/fix") || r.url().includes("/advance"))) &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await fix.click();
    await response;
  }
  await expect(page.getByText(/Ready to submit/i).first()).toBeVisible({
    timeout: 30_000,
  });
}

async function startAndCompleteDemo(page: Page) {
  await page.getByRole("button", { name: "Start guided demo" }).click();
  await expect(page.getByRole("button", { name: "Apply suggested fix" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/Not ready|Initial packet review/i).first()).toBeVisible();
  await applyFixesUntilReady(page);
}

test.describe("public demo portfolio mode", () => {
  test("landing banner, guided demo, evidence, report, reset", async ({ page }) => {
    const errors = await collectPageErrors(page);
    await page.goto("/");
    await expect(
      page.getByText(
        /Public portfolio demo — all names and documents are fictional\. Real uploads are disabled\./i,
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Try the guided demo/i })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Dashboard" }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "Document Vault" }),
    ).toHaveCount(0);

    await page.getByRole("link", { name: /Try the guided demo/i }).click();
    await expect(page).toHaveURL(/\/demo/);
    await startAndCompleteDemo(page);

    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page).toHaveURL(/\/applications\//);
    await expect(page.getByRole("button", { name: "Reanalyze" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete application" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Requirements" })).toBeVisible();

    await page.getByRole("link", { name: "Printable report" }).click();
    await expect(page.getByRole("button", { name: /Print \/ Save as PDF/i })).toBeVisible();

    await page.goto("/demo");
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
    await page.getByRole("button", { name: "Reset demo" }).click();
    await expect(page.getByText(/Initial packet review/i)).toBeVisible();

    expect(errors.pageErrors, errors.pageErrors.join("\n")).toEqual([]);
    expect(
      errors.consoleErrors.filter(
        (e) => !/favicon|Download the React DevTools|fonts\.googleapis/i.test(e),
      ),
      errors.consoleErrors.join("\n"),
    ).toEqual([]);
  });

  test("unsupported routes redirect away from restricted areas", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/demo/);
    await page.goto("/vault");
    await expect(page).toHaveURL(/\/demo/);
    await page.goto("/applications/new");
    await expect(page).toHaveURL(/\/demo/);
    await page.goto("/this-route-does-not-exist");
    await expect(page).toHaveURL(/\/demo/);
  });

  test("mobile viewport shows banner and guided demo", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText(/Public portfolio demo/i)).toBeVisible();
    await page.getByRole("link", { name: /Try the guided demo/i }).click();
    await expect(page.getByRole("button", { name: "Start guided demo" })).toBeVisible();
  });

  test("keyboard navigation reaches guided demo CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Try the guided demo/i })).toBeVisible();
    await page.getByRole("link", { name: /Try the guided demo/i }).focus();
    await expect(page.getByRole("link", { name: /Try the guided demo/i })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/demo/);
  });

  test("two browser contexts stay isolated through completion", async ({
    browser,
    baseURL,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto(`${baseURL}/demo`);
    await pageB.goto(`${baseURL}/demo`);

    const startA = pageA.waitForResponse(
      (r) => r.url().includes("/api/demo/start") && r.request().method() === "POST",
    );
    await pageA.getByRole("button", { name: "Start guided demo" }).click();
    const bodyA = await (await startA).json();

    const startB = pageB.waitForResponse(
      (r) => r.url().includes("/api/demo/start") && r.request().method() === "POST",
    );
    await pageB.getByRole("button", { name: "Start guided demo" }).click();
    const bodyB = await (await startB).json();

    expect(bodyA.application.id).not.toBe(bodyB.application.id);

    await pageA.getByRole("button", { name: "Apply suggested fix" }).click();
    await expect(pageA.getByText(/Add unofficial transcript/i)).toBeVisible();
    await expect(pageB.getByText(/Initial packet review/i)).toBeVisible();

    await applyFixesUntilReady(pageA);
    await applyFixesUntilReady(pageB);

    await contextA.close();
    await contextB.close();
  });
});
