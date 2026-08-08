import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Repositories } from "../../src/db/repositories.js";
import { resolveUploadPath } from "../../src/utils/files.js";
import { newId } from "../../src/utils/ids.js";
import { analyzeApplication } from "../../src/services/analysis/analyze.js";
import { isSatisfyingMatch } from "../../src/services/matching/satisfying.js";
import { RuleRequirementExtractor } from "../../src/services/requirements/extractor.js";
import { isGlobalUnicastIp, isPrivateIp } from "../../src/services/net/privateIp.js";
import {
  resetGuidedDemo,
  setDemoResetTestHooks,
  startGuidedDemo,
} from "../../src/services/demo/demo.js";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb();

afterEach(() => {
  setDemoResetTestHooks(null);
});

describe("review fixes — demo reset failure safety", () => {
  it("keeps the prior working demo when staged reset fails", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    const beforeDocs = repos.listDocuments(id);
    const beforeReqs = repos.listRequirements(id);
    const beforeStored = beforeDocs.map((d) => d.storedFilename);
    expect(beforeDocs.length).toBeGreaterThan(0);
    expect(beforeReqs.length).toBeGreaterThan(0);
    for (const name of beforeStored) {
      expect(fs.existsSync(resolveUploadPath("applications", name))).toBe(true);
    }

    setDemoResetTestHooks({ failAfter: "ingest" });
    await expect(resetGuidedDemo(db, id)).rejects.toThrow(/Injected demo reset failure/);

    const after = repos.getApplication(id)!;
    expect(after.id).toBe(id);
    expect(repos.listDocuments(id).map((d) => d.id).sort()).toEqual(
      beforeDocs.map((d) => d.id).sort(),
    );
    expect(repos.listRequirements(id).map((r) => r.id).sort()).toEqual(
      beforeReqs.map((r) => r.id).sort(),
    );
    for (const name of beforeStored) {
      expect(fs.existsSync(resolveUploadPath("applications", name))).toBe(true);
      expect(repos.getDocumentText(beforeDocs.find((d) => d.storedFilename === name)!.id)).toBeTruthy();
    }

    // No leftover staging applications.
    expect(repos.listApplications().filter((a) => a.id !== id)).toHaveLength(0);

    setDemoResetTestHooks(null);
    const reset = await resetGuidedDemo(db, id);
    expect(reset.application!.id).toBe(id);
    expect(reset.application!.demoStep).toBe(0);
    expect(repos.listDocuments(id).length).toBeGreaterThan(0);
  });
});

describe("review fixes — organization extraction fidelity", () => {
  const extractor = new RuleRequirementExtractor();
  const ctxOrg = {
    applicationName: "App",
    organization: "Future Engineers Scholarship",
    sourceType: "pasted_text",
    sourceName: "t",
  } as const;

  it("does not invent organizationNameExpected from generic for-the language", () => {
    for (const sentence of [
      "Submit a recommendation for the application.",
      "Provide an essay for the scholarship.",
      "Upload a resume for the review committee.",
    ]) {
      const drafts = extractor.extract(sentence, ctxOrg);
      for (const d of drafts) {
        expect(d.organizationNameExpected).toBeNull();
      }
    }
  });

  it("sets organizationNameExpected only with explicit verb + concrete name", () => {
    const addressed = extractor.extract(
      "The recommendation letter must be addressed to Future Engineers Scholarship.",
      ctxOrg,
    );
    expect(
      addressed.some((d) =>
        d.organizationNameExpected?.includes("Future Engineers Scholarship"),
      ),
    ).toBe(true);

    const referenced = extractor.extract(
      "The essay must reference Future Engineers Scholarship.",
      ctxOrg,
    );
    expect(
      referenced.some((d) =>
        d.organizationNameExpected?.includes("Future Engineers Scholarship"),
      ),
    ).toBe(true);

    const vagueAddress = extractor.extract(
      "Address the letter to the organization listed above.",
      ctxOrg,
    );
    expect(vagueAddress.every((d) => d.organizationNameExpected == null)).toBe(
      true,
    );
  });
});

describe("review fixes — satisfying count predicate", () => {
  it("shares satisfying semantics across statuses", () => {
    expect(
      isSatisfyingMatch({
        status: "possible",
        confidence: 0.9,
        userConfirmed: false,
      }),
    ).toBe(false);
    expect(
      isSatisfyingMatch({
        status: "needs_confirmation",
        confidence: 0.9,
        userConfirmed: false,
      }),
    ).toBe(false);
    expect(
      isSatisfyingMatch({
        status: "likely",
        confidence: 0.7,
        userConfirmed: false,
      }),
    ).toBe(false);
    expect(
      isSatisfyingMatch({
        status: "likely",
        confidence: 0.85,
        userConfirmed: false,
      }),
    ).toBe(true);
    expect(
      isSatisfyingMatch({
        status: "possible",
        confidence: 0.1,
        userConfirmed: true,
      }),
    ).toBe(true);
  });

  function seedCountApp(
    repos: Repositories,
    docs: Array<{
      id: string;
      name: string;
      category: "recommendation" | "other";
    }>,
  ) {
    const app = repos.createApplication({
      name: "Counts",
      organization: "Org",
      type: "scholarship",
    });
    const req = repos.createRequirement(app.id, {
      title: "Recommendations",
      category: "recommendation",
      sourceEvidence: "two letters",
      certainty: "required",
      minimumCount: 2,
      maximumCount: 2,
    });
    for (const doc of docs) {
      repos.createDocument({
        id: doc.id,
        applicationId: app.id,
        vaultDocumentId: null,
        originalFilename: doc.name,
        storedFilename: doc.name,
        mimeType: "application/pdf",
        fileSize: 10,
        pageCount: 1,
        wordCount: 40,
        title: null,
        category: doc.category,
        categoryConfidence: doc.category === "other" ? 0.2 : 0.95,
        parseStatus: "parsed",
        parsingWarnings: [],
        contentHash: doc.id,
        text:
          doc.category === "other"
            ? "Random notes unrelated to recommendations."
            : "Letter of Recommendation Dear Committee I recommend Alex.",
      });
    }
    return { app, req };
  }

  function confirm(
    repos: Repositories,
    appId: string,
    reqId: string,
    documentId: string,
    status: "confirmed" | "likely" | "possible",
    userConfirmed: boolean,
    confidence: number,
  ) {
    repos.upsertMatch({
      id: newId(),
      applicationId: appId,
      requirementId: reqId,
      documentId,
      status,
      confidence,
      explanation: status,
      evidence: [],
      userConfirmed,
    });
  }

  it("MINIMUM: 1 confirmed + 1 possible is insufficient", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const strong1 = newId();
    const weak = newId();
    const { app, req } = seedCountApp(repos, [
      { id: strong1, name: "rec1.pdf", category: "recommendation" },
      { id: weak, name: "notes.pdf", category: "other" },
    ]);
    confirm(repos, app.id, req.id, strong1, "confirmed", true, 1);
    confirm(repos, app.id, req.id, weak, "possible", false, 0.4);
    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some((i) => i.code === "INSUFFICIENT_DOCUMENT_COUNT"),
    ).toBe(true);
    expect(result.issues.some((i) => i.code === "TOO_MANY_DOCUMENTS")).toBe(
      false,
    );
  });

  it("MINIMUM: 2 strong satisfying docs are sufficient", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const strong1 = newId();
    const strong2 = newId();
    const { app, req } = seedCountApp(repos, [
      { id: strong1, name: "rec1.pdf", category: "recommendation" },
      { id: strong2, name: "rec2.pdf", category: "recommendation" },
    ]);
    confirm(repos, app.id, req.id, strong1, "confirmed", true, 1);
    confirm(repos, app.id, req.id, strong2, "likely", true, 0.9);
    const result = analyzeApplication(db, app.id);
    expect(
      result.issues.some((i) => i.code === "INSUFFICIENT_DOCUMENT_COUNT"),
    ).toBe(false);
  });

  it("MAXIMUM: 2 strong + 1 possible does not emit TOO_MANY", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const strong1 = newId();
    const strong2 = newId();
    const weak = newId();
    const { app, req } = seedCountApp(repos, [
      { id: strong1, name: "rec1.pdf", category: "recommendation" },
      { id: strong2, name: "rec2.pdf", category: "recommendation" },
      { id: weak, name: "notes.pdf", category: "other" },
    ]);
    confirm(repos, app.id, req.id, strong1, "confirmed", true, 1);
    confirm(repos, app.id, req.id, strong2, "likely", true, 0.9);
    confirm(repos, app.id, req.id, weak, "possible", false, 0.4);
    const result = analyzeApplication(db, app.id);
    expect(result.issues.some((i) => i.code === "TOO_MANY_DOCUMENTS")).toBe(
      false,
    );
    expect(
      result.issues.some((i) => i.code === "INSUFFICIENT_DOCUMENT_COUNT"),
    ).toBe(false);
  });

  it("MAXIMUM: 3 strong satisfying docs emits TOO_MANY", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const strong1 = newId();
    const strong2 = newId();
    const strong3 = newId();
    const { app, req } = seedCountApp(repos, [
      { id: strong1, name: "rec1.pdf", category: "recommendation" },
      { id: strong2, name: "rec2.pdf", category: "recommendation" },
      { id: strong3, name: "rec3.pdf", category: "recommendation" },
    ]);
    confirm(repos, app.id, req.id, strong1, "confirmed", true, 1);
    confirm(repos, app.id, req.id, strong2, "likely", true, 0.9);
    confirm(repos, app.id, req.id, strong3, "likely", true, 0.92);
    const result = analyzeApplication(db, app.id);
    expect(result.issues.some((i) => i.code === "TOO_MANY_DOCUMENTS")).toBe(
      true,
    );
  });

  it("MAXIMUM: user-confirmed third counts even when heuristic is weak", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const strong1 = newId();
    const strong2 = newId();
    const weak = newId();
    const { app, req } = seedCountApp(repos, [
      { id: strong1, name: "rec1.pdf", category: "recommendation" },
      { id: strong2, name: "rec2.pdf", category: "recommendation" },
      { id: weak, name: "notes.pdf", category: "other" },
    ]);
    confirm(repos, app.id, req.id, strong1, "confirmed", true, 1);
    confirm(repos, app.id, req.id, strong2, "likely", true, 0.9);
    confirm(repos, app.id, req.id, weak, "possible", true, 0.2);
    const result = analyzeApplication(db, app.id);
    expect(result.issues.some((i) => i.code === "TOO_MANY_DOCUMENTS")).toBe(
      true,
    );
  });
});


describe("review fixes — global-unicast SSRF allow semantics", () => {
  it("table-driven special-purpose vs public addresses", () => {
    const blocked = [
      "0.0.0.0",
      "10.1.2.3",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.5.5",
      "192.168.0.10",
      "100.64.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "198.51.100.1",
      "203.0.113.1",
      "198.18.0.1",
      "224.0.0.1",
      "240.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd00::1",
      "ff02::1",
      "2001:db8::1",
      "2001:2::1",
      "::ffff:127.0.0.1",
      "::ffff:192.0.2.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "64:ff9b:1::1",
      "100::1",
      "2001::1",
      "2001:10::1",
      "2002::1",
      "192.31.196.1",
      "192.52.193.1",
      "192.175.48.1",
      "192.88.99.1",
    ];
    for (const ip of blocked) {
      expect(isGlobalUnicastIp(ip), ip).toBe(false);
      expect(isPrivateIp(ip), ip).toBe(true);
    }

    const allowed = [
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "2001:4860:4860::8888",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
    ];
    for (const ip of allowed) {
      expect(isGlobalUnicastIp(ip), ip).toBe(true);
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
});
