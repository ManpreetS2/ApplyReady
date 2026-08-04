#!/usr/bin/env node
/**
 * Deterministic portfolio screenshots using fictional demo/fixture data.
 * Requires a production build. Starts an isolated temp-data server.
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "docs/screenshots");
const fixtures = path.join(root, "qa/fixtures/applyready");
const port = 8792;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "applyready-shots-"));
const dataDir = path.join(tmp, "data");
const uploadsDir = path.join(tmp, "uploads");
const dbPath = path.join(dataDir, "shots.sqlite");

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy");
}

async function api(pathname, init) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${pathname} failed: ${JSON.stringify(body)}`);
  return body;
}

async function upload(appId, filePath) {
  const form = new FormData();
  const buf = fs.readFileSync(filePath);
  form.append(
    "file",
    new Blob([buf], {
      type: filePath.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : filePath.endsWith(".pdf")
          ? "application/pdf"
          : "text/plain",
    }),
    path.basename(filePath),
  );
  const res = await fetch(
    `http://127.0.0.1:${port}/api/applications/${appId}/documents`,
    { method: "POST", body: form },
  );
  if (!res.ok) throw new Error(`upload failed ${path.basename(filePath)}`);
  return res.json();
}

const server = spawn(process.execPath, [path.join(root, "scripts/e2e-server.mjs"), "--port", String(port)], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    APPLYREADY_DATA_DIR: dataDir,
    APPLYREADY_UPLOADS_DIR: uploadsDir,
    APPLYREADY_DB_PATH: dbPath,
    APPLYREADY_E2E_TMP: tmp,
  },
  stdio: "inherit",
});

try {
  await waitHealth();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(outDir, "landing-page.png"), fullPage: false });

  // Seed not-ready and ready apps via API for stable screenshots
  const text = fs.readFileSync(
    path.join(fixtures, "requirements/scholarship-requirements.txt"),
    "utf8",
  );
  const badApp = await api("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Future Engineers Scholarship QA",
      organization: "Future Engineers Foundation",
      type: "scholarship",
      deadline: "2026-10-15",
    }),
  });
  const badId = badApp.application.id;
  await api(`/api/applications/${badId}/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullLegalName: "Jordan Lee",
      email: "jordan.lee@example.com",
      phone: "(555) 014-0268",
      school: "Redwood Community College",
      expectedGraduationDate: "May 2027",
      major: "Computer Science",
      gpa: "3.62",
      targetOrganization: "Future Engineers Foundation",
    }),
  });
  const sources = await api(`/api/applications/${badId}/sources/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sourceName: "official" }),
  });
  for (const req of sources.requirements) {
    await api(`/api/requirements/${req.id}/confirm`, { method: "POST" });
  }
  for (const file of [
    "Jordan_Lee_Resume.pdf",
    "Engineering_Essay_620_Words.docx",
    "Recommendation_Letter_Other_Scholarship.pdf",
    "JordanLeeFinal.pdf",
  ]) {
    await upload(badId, path.join(fixtures, "initial_bad_packet", file));
  }
  await api(`/api/applications/${badId}/analyze`, { method: "POST" });

  const readyApp = await api("/api/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Future Engineers Ready Packet",
      organization: "Future Engineers Foundation",
      type: "scholarship",
      deadline: "2026-10-20",
    }),
  });
  const readyId = readyApp.application.id;
  await api(`/api/applications/${readyId}/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullLegalName: "Jordan Lee",
      email: "jordan.lee@example.com",
      phone: "(555) 014-0268",
      school: "Redwood Community College",
      expectedGraduationDate: "May 2027",
      major: "Computer Science",
      gpa: "3.62",
      targetOrganization: "Future Engineers Foundation",
    }),
  });
  const readySources = await api(`/api/applications/${readyId}/sources/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sourceName: "official" }),
  });
  for (const req of readySources.requirements) {
    await api(`/api/requirements/${req.id}/confirm`, { method: "POST" });
  }
  for (const file of [
    "Lee_Jordan_Resume.pdf",
    "Lee_Jordan_Essay.docx",
    "Lee_Jordan_Recommendation.pdf",
    "Lee_Jordan_Transcript.pdf",
    "Lee_Jordan_2026.pdf",
  ]) {
    await upload(readyId, path.join(fixtures, "corrected_packet", file));
  }
  let analysis = await api(`/api/applications/${readyId}/analyze`, { method: "POST" });
  const best = new Map();
  for (const match of analysis.matches) {
    if (match.status === "does_not_match") continue;
    const cur = best.get(match.requirementId);
    if (!cur || match.confidence > cur.confidence) best.set(match.requirementId, match);
  }
  for (const match of best.values()) {
    await api(`/api/document-matches/${match.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed", userConfirmed: true }),
    });
  }
  const detail = await api(`/api/applications/${readyId}`);
  for (const conflict of detail.conflicts) {
    if (!conflict.resolved) {
      await api(`/api/conflicts/${conflict.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equivalent: true }),
      });
    }
  }
  for (const issue of detail.issues.filter((i) => i.status === "open" && i.dismissible)) {
    await api(`/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });
  }
  analysis = await api(`/api/applications/${readyId}/analyze`, { method: "POST" });

  await page.goto(`http://127.0.0.1:${port}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(outDir, "dashboard.png"), fullPage: false });

  await page.goto(`http://127.0.0.1:${port}/applications/${badId}`);
  await page.getByRole("tab", { name: "Requirements" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "requirement-evidence.png"), fullPage: false });

  await page.getByRole("tab", { name: "Overview" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "not-ready-analysis.png"), fullPage: false });

  await page.getByRole("tab", { name: "Issues" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "issue-evidence.png"), fullPage: false });

  await page.goto(`http://127.0.0.1:${port}/applications/${readyId}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(outDir, "ready-to-submit.png"), fullPage: false });

  // Vault screenshot
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync(path.join(fixtures, "corrected_packet/Lee_Jordan_Resume.pdf"))], {
      type: "application/pdf",
    }),
    "Lee_Jordan_Resume.pdf",
  );
  form.append("category", "resume");
  form.append("notes", "Fictional vault resume");
  await fetch(`http://127.0.0.1:${port}/api/vault`, { method: "POST", body: form });
  await page.goto(`http://127.0.0.1:${port}/vault`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(outDir, "document-vault.png"), fullPage: false });

  await page.goto(`http://127.0.0.1:${port}/applications/${readyId}/report`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(outDir, "printable-report.png"), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${port}/dashboard`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(outDir, "mobile-dashboard.png"), fullPage: false });

  await browser.close();
  console.log(`Screenshots written to ${outDir}`);
  console.log(`Ready status for screenshot seed: ${analysis.report.status}`);
} finally {
  server.kill("SIGTERM");
  fs.rmSync(tmp, { recursive: true, force: true });
}
