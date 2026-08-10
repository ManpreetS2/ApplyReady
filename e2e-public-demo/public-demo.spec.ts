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

/** Wait until config load + optional session restore finish before any Start/Reset click. */
async function waitForDemoPageReady(page: Page) {
  await expect(page.getByTestId("demo-page")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("demo-page")).not.toHaveAttribute(
    "data-demo-state",
    "restoring",
    { timeout: 60_000 },
  );
  await expect(
    page
      .getByRole("button", { name: "Start guided demo" })
      .or(page.getByRole("button", { name: "Reset demo" })),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * After navigation/reload, session restore may reopen an active demo.
 * Wait for a stable state, then reset so the packet is at step 0.
 */
async function resetDemoToInitialReview(page: Page) {
  await waitForDemoPageReady(page);
  const resetButton = page.getByRole("button", { name: "Reset demo" });
  if (await resetButton.isVisible()) {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/demo/") &&
        r.url().includes("/reset") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await resetButton.click();
    await response;
  } else {
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible({
      timeout: 60_000,
    });
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/demo/") &&
        r.url().includes("/reset") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "Reset demo" }).click();
    await response;
  }
  await expect(page.getByText(/Initial packet review/i)).toBeVisible({
    timeout: 60_000,
  });
}

async function applyFixesUntilReady(page: Page) {
  for (let i = 0; i < 8; i += 1) {
    const ready = page.getByText(/Ready to submit — all required items verified/i);
    if (await ready.isVisible().catch(() => false)) {
      return;
    }
    await applyFixOnce(page);
  }
  await expect(
    page.getByText(/Ready to submit — all required items verified/i),
  ).toBeVisible({
    timeout: 30_000,
  });
}

async function startDemo(page: Page) {
  await waitForDemoPageReady(page);
  await page.getByRole("button", { name: "Start guided demo" }).click();
  await expect(page.getByTestId("demo-review-fix")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Initial packet review/i)).toBeVisible();
}

function isDemoFixPost(url: string) {
  try {
    return /\/api\/demo\/[^/]+\/fix\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

async function applyFixOnce(page: Page) {
  const stepBefore = await page.getByTestId("demo-page").getAttribute("data-demo-step");
  await page.getByTestId("demo-review-fix").click();
  await expect(page.getByTestId("fix-review-dialog")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("demo-page")).toHaveAttribute(
    "data-demo-step",
    stepBefore || "0",
  );
  const apply = page.getByTestId("fix-review-use-suggested");
  await expect(apply).toBeEnabled();
  await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && isDemoFixPost(r.url()),
      { timeout: 60_000 },
    ),
    apply.evaluate((el) => (el as HTMLButtonElement).click()),
  ]);
  await expect(page.getByTestId("fix-review-dialog")).toHaveCount(0);
}

async function advanceToStep(page: Page, targetStep: number) {
  for (let i = 0; i < 8; i += 1) {
    const current = Number(await page.getByTestId("demo-page").getAttribute("data-demo-step"));
    if (current >= targetStep) return;
    await applyFixOnce(page);
  }
  await expect(page.getByTestId("demo-page")).toHaveAttribute(
    "data-demo-step",
    String(targetStep),
    { timeout: 30_000 },
  );
}

async function startAndCompleteDemo(page: Page) {
  await startDemo(page);
  await applyFixesUntilReady(page);
}

test.describe("public demo portfolio mode", () => {
  test("landing banner, guided demo, evidence, report, reset", async ({ page }) => {
    const errors = await collectPageErrors(page);
    await page.goto("/");
    await expect(
      page.getByText(
        /Public portfolio demo — fictional documents and temporary example edits only\. Real uploads are disabled\./i,
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
    await resetDemoToInitialReview(page);

    expect(errors.pageErrors, errors.pageErrors.join("\n")).toEqual([]);
    expect(
      errors.consoleErrors.filter(
        (e) => !/favicon|Download the React DevTools|fonts\.googleapis/i.test(e),
      ),
      errors.consoleErrors.join("\n"),
    ).toEqual([]);
  });

  test("refresh restores in-progress guided demo from session storage", async ({
    page,
  }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByTestId("demo-review-fix")).toBeVisible({ timeout: 60_000 });
    await applyFixOnce(page);
    await expect(page.getByText(/Transcript added/i)).toBeVisible({
      timeout: 60_000,
    });

    await page.reload();
    await waitForDemoPageReady(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-state", "active");
    await expect(page.getByText(/Transcript added/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Start guided demo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
  });

  test("transient restore failure keeps session id and offers retry", async ({
    page,
  }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByTestId("demo-review-fix")).toBeVisible({ timeout: 60_000 });

    const savedId = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(savedId).toBeTruthy();

    let failedOnce = false;
    await page.route(`**/api/applications/${savedId}`, async (route) => {
      if (!failedOnce && route.request().method() === "GET") {
        failedOnce = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "INTERNAL", message: "Temporary failure" },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.reload();
    await expect(page.getByRole("button", { name: "Retry restore" })).toBeVisible({
      timeout: 30_000,
    });
    const retained = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(retained).toBe(savedId);

    await page.getByRole("button", { name: "Retry restore" }).click();
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-state", "active", {
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeVisible();
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
    await waitForDemoPageReady(page);
    await expect(page.getByRole("button", { name: "Start guided demo" })).toBeVisible();
  });

  test("mobile viewports avoid horizontal page scroll", async ({ page }) => {
    for (const size of [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(size);
      await page.goto("/");
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(scrollWidth, `${size.width}x${size.height}`).toBeLessThanOrEqual(1);
      await page.goto("/demo");
      await waitForDemoPageReady(page);
      const demoScroll = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(demoScroll, `demo ${size.width}x${size.height}`).toBeLessThanOrEqual(1);
    }
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
    await waitForDemoPageReady(pageA);
    await waitForDemoPageReady(pageB);

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

    await applyFixOnce(pageA);
    await expect(pageA.getByText(/Transcript added/i)).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByText(/Initial packet review/i)).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Start guided demo" })).toHaveCount(0);

    // UUID isolation: B's session must not become A's application id.
    const idB = await pageB.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(idB).toBe(bodyB.application.id);
    expect(idB).not.toBe(bodyA.application.id);

    await applyFixesUntilReady(pageA);
    await applyFixesUntilReady(pageB);

    await contextA.close();
    await contextB.close();
  });
  test("active demo exposes only Review fix mutation CTA", async ({ page }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByTestId("demo-review-fix")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Next step" })).toHaveCount(0);
    await expect(page.getByTestId("demo-review-fix")).toHaveCount(1);
    await expect(page.getByTestId("demo-next-action")).toContainText(
      /Add fictional transcript/i,
    );

    await applyFixOnce(page);
    await expect(page.getByText(/Transcript added/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1");
    await expect(page.getByTestId("demo-next-action")).toContainText(/Fix essay length/i);
  });

  test("rapid double-click on Use suggested advances only one step", async ({
    page,
  }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByTestId("demo-review-fix")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();

    let fixPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && isDemoFixPost(req.url())) {
        fixPosts += 1;
      }
    });

    const apply = page.getByTestId("fix-review-use-suggested");
    await apply.evaluate((el) => {
      const button = el as HTMLButtonElement;
      button.click();
      button.click();
    });
    await expect(page.getByText(/Transcript added/i)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1");
    await expect(page.getByText(/^Essay corrected$/i)).toHaveCount(0);
    expect(fixPosts).toBe(1);
  });

  test("direct evidence link restores demo session from clean storage", async ({
    browser,
    baseURL,
  }) => {
    const starter = await browser.newContext();
    const startPage = await starter.newPage();
    await startPage.goto(`${baseURL}/demo`);
    await waitForDemoPageReady(startPage);
    const startRes = startPage.waitForResponse(
      (r) => r.url().includes("/api/demo/start") && r.request().method() === "POST",
    );
    await startPage.getByRole("button", { name: "Start guided demo" }).click();
    const body = await (await startRes).json();
    const demoId = body.application.id as string;
    await starter.close();

    const clean = await browser.newContext();
    const page = await clean.newPage();
    await page.goto(`${baseURL}/applications/${demoId}`);
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 60_000 });
    const stored = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(stored).toBe(demoId);

    await page.getByRole("link", { name: "Back to guided demo" }).click();
    await waitForDemoPageReady(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-state", "active");
    await expect(page.getByRole("button", { name: "Start guided demo" })).toHaveCount(0);
    await expect(page.getByTestId("demo-review-fix")).toBeVisible();
    await clean.close();
  });

  test("direct report link restores demo session from clean storage", async ({
    browser,
    baseURL,
  }) => {
    const starter = await browser.newContext();
    const startPage = await starter.newPage();
    await startPage.goto(`${baseURL}/demo`);
    await waitForDemoPageReady(startPage);
    const startRes = startPage.waitForResponse(
      (r) => r.url().includes("/api/demo/start") && r.request().method() === "POST",
    );
    await startPage.getByRole("button", { name: "Start guided demo" }).click();
    const body = await (await startRes).json();
    const demoId = body.application.id as string;
    await starter.close();

    const clean = await browser.newContext();
    const page = await clean.newPage();
    await page.goto(`${baseURL}/applications/${demoId}/report`);
    await expect(page.getByTestId("report-page")).toBeVisible({ timeout: 60_000 });
    const stored = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(stored).toBe(demoId);

    await page.getByRole("link", { name: "Back to guided demo" }).click();
    await waitForDemoPageReady(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-state", "active");
    await expect(page.getByRole("button", { name: "Start guided demo" })).toHaveCount(0);
    await clean.close();
  });

  test("expired evidence and report links offer recovery", async ({ page }) => {
    const fakeId = "00000000-0000-4000-8000-000000000099";
    await page.goto(`/applications/${fakeId}`);
    await expect(page.getByText(/This temporary demo has expired/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("link", { name: /Start a new guided demo/i }),
    ).toBeVisible();

    await page.goto(`/applications/${fakeId}/report`);
    await expect(page.getByTestId("report-recovery")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/This temporary demo has expired/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Start a new guided demo/i }),
    ).toBeVisible();
  });

  test("temporary 500 on evidence load keeps recovery path", async ({ page }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    const startRes = page.waitForResponse(
      (r) => r.url().includes("/api/demo/start") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Start guided demo" }).click();
    const body = await (await startRes).json();
    const demoId = body.application.id as string;

    let failedOnce = false;
    await page.route(`**/api/applications/${demoId}`, async (route) => {
      if (!failedOnce && route.request().method() === "GET") {
        failedOnce = true;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "INTERNAL", message: "Temporary failure" },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`/applications/${demoId}`);
    await expect(page.getByText(/Temporary failure|Request failed|failed/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("link", { name: /Back to guided demo/i })).toBeVisible();
    const retained = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(retained).toBe(demoId);
  });

  test("evidence readiness tab shows server factor breakdown", async ({ page }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByRole("link", { name: "View evidence" })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Readiness Report" }).click();
    await expect(
      page.getByText(/Run analysis to refresh the weighted score breakdown/i),
    ).toHaveCount(0);
    await expect(page.getByText(/Required present:/i)).toBeVisible();
    await expect(page.locator("li").filter({ hasText: /\d+\/\d+/ }).first()).toBeVisible();
  });

  test("mobile evidence and report pages avoid horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    const startRes = page.waitForResponse(
      (r) => r.url().includes("/api/demo/start") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Start guided demo" }).click();
    const body = await (await startRes).json();
    const demoId = body.application.id as string;

    for (const size of [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(size);
      await page.goto(`/applications/${demoId}`);
      await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 60_000 });
      await page.getByRole("tab", { name: "Documents" }).click();
      await page.getByRole("tab", { name: "Issues" }).click();
      await page.getByRole("tab", { name: "Readiness Report" }).click();
      const evidenceScroll = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(evidenceScroll, `evidence ${size.width}x${size.height}`).toBeLessThanOrEqual(1);

      await page.goto(`/applications/${demoId}/report`);
      await expect(page.getByTestId("report-page")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("button", { name: /Print \/ Save as PDF/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Export JSON/i })).toBeVisible();
      const reportScroll = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(reportScroll, `report ${size.width}x${size.height}`).toBeLessThanOrEqual(1);
    }
  });

  test("reset stays disabled-safe while a fix mutation is pending", async ({ page }) => {
    await page.goto("/demo");
    await waitForDemoPageReady(page);
    await page.getByRole("button", { name: "Start guided demo" }).click();
    await expect(page.getByTestId("demo-review-fix")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();

    await page.route("**/api/demo/*/fix", async (route) => {
      if (route.request().method() !== "POST" || !isDemoFixPost(route.request().url())) {
        await route.continue();
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });

    const pending = page.waitForResponse(
      (r) => r.request().method() === "POST" && isDemoFixPost(r.url()),
      { timeout: 60_000 },
    );
    await page.getByTestId("fix-review-use-suggested").click();
    await expect(page.getByRole("button", { name: "Reset demo" })).toBeDisabled();
    await expect(page.getByTestId("fix-review-use-suggested")).toBeDisabled();
    await pending;
    await expect(page.getByText(/Transcript added/i)).toBeVisible({
      timeout: 60_000,
    });
  });

  test("previous step rewinds one deterministic state", async ({ page }) => {
    await page.goto("/demo");
    await startDemo(page);
    const id = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    await advanceToStep(page, 3);
    await expect(page.getByText(/Recommendation corrected/i)).toBeVisible();

    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/demo/") &&
        r.url().includes("/step") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByTestId("demo-previous-step").click();
    await response;

    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "2");
    await expect(page.getByText(/Essay corrected/i)).toBeVisible();
    await expect(page.getByText(/Recommendation corrected/i)).toHaveCount(0);
    await expect(page.getByText(/wrong organization|recommendation/i).first()).toBeVisible();
    const afterId = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(afterId).toBe(id);

    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByText(/Unofficial_Transcript/i)).toBeVisible();
    await page.getByRole("link", { name: "Back to guided demo" }).click();
    await waitForDemoPageReady(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "2");
  });

  test("stepper jump to past step rebuilds exact earlier state", async ({ page }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 5);
    await expect(page.getByText(/Packet filename corrected/i)).toBeVisible();

    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/demo/") &&
        r.url().includes("/step") &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.getByTestId("demo-step-1").click();
    await response;

    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1");
    await expect(page.getByText(/Transcript added/i)).toBeVisible();
    await expect(page.getByText(/Essay corrected/i)).toHaveCount(0);
    await expect(page.getByTestId("demo-step-5")).toHaveAttribute("class", /text-ink-500/);
  });

  test("reapply after rewind stays deterministic without duplicates", async ({ page }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 3);
    await page.getByTestId("demo-previous-step").click();
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "2", {
      timeout: 60_000,
    });
    await applyFixOnce(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "3");
    await applyFixOnce(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "4");
    await expect(page.getByText(/Resume corrected/i)).toBeVisible();

    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Documents" }).click();
    await expect(page.getByText(/Alex_Chen_Resume\.pdf/i)).toHaveCount(1);
    await expect(page.getByText(/Essay_Alex_Chen\.pdf/i)).toHaveCount(1);
  });

  test("Ready can rewind and re-advance to Ready", async ({ page }) => {
    await page.goto("/demo");
    await startAndCompleteDemo(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "6");
    await expect(page.getByTestId("demo-review-fix")).toHaveCount(0);

    await page.getByTestId("demo-previous-step").click();
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "5", {
      timeout: 60_000,
    });
    await expect(
      page.getByText(/Ready to submit — all required items verified/i),
    ).toHaveCount(0);
    await expect(page.getByTestId("demo-review-fix")).toBeVisible();
    await applyFixOnce(page);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "6");
    await expect(
      page.getByText(/Ready to submit — all required items verified/i),
    ).toBeVisible();
  });

  test("UUID remains stable across forward rewind evidence and report", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    const id = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    await advanceToStep(page, 2);
    await page.getByTestId("demo-previous-step").click();
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1", {
      timeout: 60_000,
    });
    await page.getByRole("link", { name: "View evidence" }).click();
    await expect(page).toHaveURL(new RegExp(`/applications/${id}`));
    await page.getByRole("link", { name: "Printable report" }).click();
    await expect(page).toHaveURL(new RegExp(`/applications/${id}/report`));
    await page.getByRole("link", { name: "Back to guided demo" }).click();
    await waitForDemoPageReady(page);
    const after = await page.evaluate(() =>
      sessionStorage.getItem("applyready.publicDemoApplicationId"),
    );
    expect(after).toBe(id);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1");
  });

  test("visitor B is unaffected when visitor A rewinds", async ({ browser, baseURL }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto(`${baseURL}/demo`);
    await pageB.goto(`${baseURL}/demo`);
    await startDemo(pageA);
    await startDemo(pageB);
    await advanceToStep(pageA, 3);
    await advanceToStep(pageB, 1);
    await pageA.getByTestId("demo-previous-step").click();
    await expect(pageA.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "2", {
      timeout: 60_000,
    });
    await expect(pageB.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1");
    await expect(pageB.getByText(/Transcript added/i)).toBeVisible();
    await contextA.close();
    await contextB.close();
  });

  test("concurrent previous clicks only mutate once", async ({ page }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 2);

    let stepPosts = 0;
    page.on("request", (req) => {
      if (
        req.method() === "POST" &&
        req.url().includes("/api/demo/") &&
        req.url().includes("/step")
      ) {
        stepPosts += 1;
      }
    });

    const prev = page.getByTestId("demo-previous-step");
    await prev.evaluate((el) => {
      const button = el as HTMLButtonElement;
      button.click();
      button.click();
    });
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1", {
      timeout: 60_000,
    });
    expect(stepPosts).toBe(1);
  });

  test("mobile stepper does not cause page overflow", async ({ page }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 3);
    for (const size of [
      { width: 390, height: 844 },
      { width: 430, height: 932 },
      { width: 768, height: 1024 },
    ]) {
      await page.setViewportSize(size);
      await expect(page.getByTestId("demo-stepper")).toBeVisible();
      const scroll = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(scroll, `${size.width}x${size.height}`).toBeLessThanOrEqual(1);
    }
  });

  test("Review fix opens dialog without mutating; Keep current does nothing", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    let fixPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && isDemoFixPost(req.url())) {
        fixPosts += 1;
      }
    });

    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await expect(page.getByText(/Unofficial_Transcript\.pdf/i)).toBeVisible();
    expect(fixPosts).toBe(0);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "0");

    await page.getByTestId("fix-review-keep-current").click();
    await expect(page.getByTestId("fix-review-dialog")).toHaveCount(0);
    expect(fixPosts).toBe(0);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "0");
  });

  test("Escape closes review dialog and returns focus to Review button", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("fix-review-dialog")).toHaveCount(0);
    await expect(page.getByTestId("demo-review-fix")).toBeFocused();
  });

  test("custom wrong organization stays on step and updates CURRENT preview", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 2);

    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await expect(page.getByTestId("fix-review-dialog")).toContainText(
      /Horizon Innovators Scholarship/i,
    );
    await expect(page.getByTestId("fix-review-dialog")).toContainText(
      /Future Engineers Scholarship/i,
    );

    await page.getByTestId("fix-review-custom-input").fill("Stanford Scholarship");
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && isDemoFixPost(r.url()),
      { timeout: 60_000 },
    );
    await page.getByTestId("fix-review-use-custom").click();
    await response;

    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "2");
    await expect(page.getByTestId("demo-applied-fix")).toBeVisible();
    await expect(page.getByText(/Issue still needs attention/i)).toBeVisible();
    await expect(page.getByText("Stanford Scholarship").first()).toBeVisible();

    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await expect(page.getByTestId("fix-review-dialog")).toContainText(
      "Stanford Scholarship",
    );
  });

  test("custom correct organization advances and evidence shows visitor marker", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 2);
    await page.getByTestId("demo-review-fix").click();
    await page
      .getByTestId("fix-review-custom-input")
      .fill("Future Engineers Scholarship");
    const response = page.waitForResponse(
      (r) => r.request().method() === "POST" && isDemoFixPost(r.url()),
      { timeout: 60_000 },
    );
    await page.getByTestId("fix-review-use-custom").click();
    await response;
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "3");
    await expect(page.getByText(/Issue resolved/i)).toBeVisible();

    await page.getByTestId("demo-applied-fix").getByRole("link", { name: "View evidence" }).click();
    await expect(page.getByTestId("application-detail")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByTestId("visitor-demo-edit-marker").first()).toBeVisible();
    await expect(page.getByText(/Future Engineers Scholarship/i).first()).toBeVisible();
  });

  test("double-click Review apply only mutates once", async ({ page }) => {
    await page.goto("/demo");
    await startDemo(page);
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();

    let fixPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && isDemoFixPost(req.url())) {
        fixPosts += 1;
      }
    });

    const btn = page.getByTestId("fix-review-use-suggested");
    await btn.evaluate((el) => {
      const button = el as HTMLButtonElement;
      button.click();
      button.click();
    });
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1", {
      timeout: 60_000,
    });
    expect(fixPosts).toBe(1);
  });

  test("mobile review dialog fits without document overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 2);
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await expect(page.getByTestId("fix-review-use-suggested")).toBeVisible();
    await expect(page.getByTestId("fix-review-keep-current")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="fix-review-dialog"]');
      if (!dialog) return { page: 99, dialog: 99 };
      const pageOverflow =
        document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const style = window.getComputedStyle(dialog);
      return {
        page: pageOverflow,
        dialogScroll: (dialog as HTMLElement).scrollWidth - (dialog as HTMLElement).clientWidth,
        maxHeight: style.maxHeight,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(1);
    expect(overflow.dialogScroll).toBeLessThanOrEqual(2);
  });

  test("Escape and backdrop cannot dismiss review dialog while mutation is pending", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();

    await page.route("**/api/demo/*/fix", async (route) => {
      if (route.request().method() !== "POST" || !isDemoFixPost(route.request().url())) {
        await route.continue();
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });

    let fixPosts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && isDemoFixPost(req.url())) fixPosts += 1;
    });

    const pending = page.waitForResponse(
      (r) => r.request().method() === "POST" && isDemoFixPost(r.url()),
      { timeout: 60_000 },
    );
    await page.getByTestId("fix-review-use-suggested").evaluate((el) =>
      (el as HTMLButtonElement).click(),
    );
    await expect(page.getByTestId("fix-review-dialog")).toHaveAttribute(
      "data-busy",
      "true",
    );
    await page.keyboard.press("Escape");
    await page.getByTestId("fix-review-backdrop").click({ force: true });
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await pending;
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "1", {
      timeout: 60_000,
    });
    expect(fixPosts).toBe(1);
  });

  test("invalid custom email stays unresolved and preview keeps literal current value", async ({
    page,
  }) => {
    await page.goto("/demo");
    await startDemo(page);
    await advanceToStep(page, 3);
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toBeVisible();
    await page.getByTestId("fix-review-custom-input").fill("not-an-email");
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && isDemoFixPost(r.url()),
        { timeout: 60_000 },
      ),
      page.getByTestId("fix-review-use-custom").click(),
    ]);
    await expect(page.getByTestId("demo-page")).toHaveAttribute("data-demo-step", "3");
    await expect(page.getByTestId("demo-applied-fix")).toContainText(
      /No valid email detected/i,
    );
    await page.getByTestId("demo-review-fix").click();
    await expect(page.getByTestId("fix-review-dialog")).toContainText("not-an-email");
    await expect(page.getByTestId("fix-review-dialog")).not.toContainText(
      "alex.old.email@example.com",
    );
  });

  test("privacy route discloses temporary custom demo edits", async ({ page }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: /Privacy/i }),
    ).toBeVisible();
    await expect(
      page
        .getByText(/temporarily processed inside the generated fictional packet/i)
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Do not enter personal or sensitive information/i).first(),
    ).toBeVisible();
  });
});
