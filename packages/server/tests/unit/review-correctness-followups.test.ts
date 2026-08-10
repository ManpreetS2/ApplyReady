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
  advanceGuidedDemo,
  resetGuidedDemo,
  setDemoReplaceTestHooks,
  setDemoResetTestHooks,
  setDemoStepTestHooks,
  setGuidedDemoStep,
  startGuidedDemo,
} from "../../src/services/demo/demo.js";
import { useTempDb } from "../helpers.js";

const ctx = useTempDb();

afterEach(() => {
  setDemoResetTestHooks(null);
  setDemoReplaceTestHooks(null);
  setDemoStepTestHooks(null);
});

describe("review fixes — demo step rewind failure safety", () => {
  it("keeps the live demo when staged rewind fails before swap", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    await advanceGuidedDemo(db, id);
    await advanceGuidedDemo(db, id);
    expect(repos.getApplication(id)!.demoStep).toBe(2);

    const beforeDocs = repos.listDocuments(id);
    const beforeStored = beforeDocs.map((d) => d.storedFilename);
    const beforeStep = repos.getApplication(id)!.demoStep;
    const essay = beforeDocs.find((d) => d.category === "essay")!;
    const essayText = repos.getDocumentText(essay.id);

    setDemoStepTestHooks({ failAfter: "before_swap" });
    await expect(setGuidedDemoStep(db, id, 1)).rejects.toThrow(
      /Injected demo step failure before swap/,
    );

    expect(repos.getApplication(id)!.demoStep).toBe(beforeStep);
    expect(repos.listDocuments(id).map((d) => d.id).sort()).toEqual(
      beforeDocs.map((d) => d.id).sort(),
    );
    for (const name of beforeStored) {
      expect(fs.existsSync(resolveUploadPath("applications", name))).toBe(true);
    }
    expect(repos.getDocumentText(essay.id)).toBe(essayText);
    expect(repos.listApplications().filter((a) => a.id !== id)).toHaveLength(0);
  });

  it("rewinds deterministically and can advance again", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    await advanceGuidedDemo(db, id);
    await advanceGuidedDemo(db, id);
    await advanceGuidedDemo(db, id);
    expect(repos.getApplication(id)!.demoStep).toBe(3);

    const rewound = await setGuidedDemoStep(db, id, 1);
    expect(rewound.application!.id).toBe(id);
    expect(rewound.application!.demoStep).toBe(1);
    expect(rewound.step.title).toMatch(/Transcript added/i);
    const docs = repos.listDocuments(id);
    expect(docs.some((d) => d.category === "transcript")).toBe(true);
    expect(
      rewound.analysis.issues.some(
        (i) =>
          i.status === "open" &&
          (i.code === "WORD_LIMIT" ||
            i.code === "ORGANIZATION_MISMATCH" ||
            /essay|organization|word/i.test(i.title)),
      ),
    ).toBe(true);

    const advanced = await advanceGuidedDemo(db, id);
    expect(advanced.application!.demoStep).toBe(2);
    expect(repos.listDocuments(id).filter((d) => d.category === "essay")).toHaveLength(1);
  });
});

describe("review fixes — demo replace failure safety", () => {
  it("keeps the prior category document when staged replacement fails before swap", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const started = await startGuidedDemo(db);
    const id = started.application!.id;

    // Advance once (add transcript) so the next step performs a category replace.
    await advanceGuidedDemo(db, id);
    expect(repos.getApplication(id)!.demoStep).toBe(1);

    const beforeEssays = repos
      .listDocuments(id)
      .filter((d) => d.category === "essay");
    expect(beforeEssays.length).toBe(1);
    const beforeEssay = beforeEssays[0]!;
    const beforeStored = beforeEssay.storedFilename;
    const beforeText = repos.getDocumentText(beforeEssay.id);
    expect(fs.existsSync(resolveUploadPath("applications", beforeStored))).toBe(true);
    expect(beforeText).toBeTruthy();

    setDemoReplaceTestHooks({ failAfter: "before_swap" });
    await expect(advanceGuidedDemo(db, id)).rejects.toThrow(
      /Injected demo replace failure before swap/,
    );

    const after = repos.getApplication(id)!;
    expect(after.demoStep).toBe(1);
    const afterEssays = repos.listDocuments(id).filter((d) => d.category === "essay");
    expect(afterEssays.map((d) => d.id)).toEqual([beforeEssay.id]);
    expect(fs.existsSync(resolveUploadPath("applications", beforeStored))).toBe(true);
    expect(repos.getDocumentText(beforeEssay.id)).toBe(beforeText);
    expect(repos.listApplications().filter((a) => a.id !== id)).toHaveLength(0);
  });
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

  it("preserves the live demo when failure is injected immediately before swap", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    const beforeDocs = repos.listDocuments(id).map((d) => d.id).sort();
    const beforeReqs = repos.listRequirements(id).map((r) => r.id).sort();
    const beforeProfile = repos.getProfile(id)!;

    setDemoResetTestHooks({ failAfter: "before_swap" });
    await expect(resetGuidedDemo(db, id)).rejects.toThrow(
      /Injected demo reset failure before swap/,
    );

    expect(repos.listDocuments(id).map((d) => d.id).sort()).toEqual(beforeDocs);
    expect(repos.listRequirements(id).map((r) => r.id).sort()).toEqual(beforeReqs);
    expect(repos.getProfile(id)).toEqual(beforeProfile);
    expect(repos.listApplications().filter((a) => a.id !== id)).toHaveLength(0);
  });

  it("resets applicant profile to a fresh guided-demo profile", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);
    const fresh = await startGuidedDemo(db);
    const freshId = fresh.application!.id;
    const freshProfile = repos.getProfile(freshId)!;

    const started = await startGuidedDemo(db);
    const id = started.application!.id;
    await advanceGuidedDemo(db, id);
    repos.updateProfile(id, {
      fullLegalName: "Stale Name",
      email: "stale@example.com",
      phone: "555-0000",
      school: "Stale U",
      gpa: "2.0",
      expectedGraduationDate: "May 2099",
      currentlyEnrolled: false,
      major: "History",
      userConfirmed: true,
      confirmedFields: [
        "fullLegalName",
        "email",
        "phone",
        "school",
        "gpa",
        "expectedGraduationDate",
        "currentlyEnrolled",
        "major",
      ],
    });

    const reset = await resetGuidedDemo(db, id);
    expect(reset.application!.id).toBe(id);
    const after = repos.getProfile(id)!;
    expect(after.fullLegalName).toBe(freshProfile.fullLegalName);
    expect(after.email).toBe(freshProfile.email);
    expect(after.phone).toBe(freshProfile.phone);
    expect(after.school).toBe(freshProfile.school);
    expect(after.gpa).toBe(freshProfile.gpa);
    expect(after.expectedGraduationDate).toBe(freshProfile.expectedGraduationDate);
    expect(after.currentlyEnrolled).toBe(freshProfile.currentlyEnrolled);
    expect(after.major).toBe(freshProfile.major);
    expect(after.confirmedFields).toEqual(freshProfile.confirmedFields);
    expect(after.userConfirmed).toBe(freshProfile.userConfirmed);
    expect(after.targetOrganization).toBe(freshProfile.targetOrganization);
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

  it("extracts the exact organization name after the verb", () => {
    expect(
      extractor.extract(
        "The essay must reference Future Engineers Scholarship.",
        ctxOrg,
      ).find((d) => d.category === "essay")?.organizationNameExpected,
    ).toBe("Future Engineers Scholarship");

    expect(
      extractor.extract(
        "Address the recommendation to Future Engineers Scholarship.",
        ctxOrg,
      ).find((d) => d.category === "recommendation")?.organizationNameExpected,
    ).toBe("Future Engineers Scholarship");

    expect(
      extractor.extract(
        "The letter must be addressed to Bright Tomorrow Foundation.",
        ctxOrg,
      ).find((d) => d.category === "recommendation")?.organizationNameExpected,
    ).toBe("Bright Tomorrow Foundation");

    expect(
      extractor.extract(
        "Address the letter to the organization.",
        ctxOrg,
      ).every((d) => d.organizationNameExpected == null),
    ).toBe(true);
  });
});

describe("review fixes — recommendation count semantics", () => {
  const extractor = new RuleRequirementExtractor();
  const ctxRec = {
    applicationName: "App",
    organization: "Org",
    sourceType: "pasted_text",
    sourceName: "t",
  } as const;

  function rec(sentence: string) {
    return extractor
      .extract(sentence, ctxRec)
      .find((d) => d.category === "recommendation");
  }

  it("distinguishes minimum-only, exact, and maximum-only language", () => {
    expect(rec("Submit two recommendation letters.")).toMatchObject({
      minimumCount: 2,
      maximumCount: null,
    });
    expect(rec("At least two recommendation letters.")).toMatchObject({
      minimumCount: 2,
      maximumCount: null,
    });
    expect(rec("Exactly two recommendation letters.")).toMatchObject({
      minimumCount: 2,
      maximumCount: 2,
    });
    expect(rec("No more than two recommendation letters.")).toMatchObject({
      minimumCount: 1,
      maximumCount: 2,
    });
    expect(rec("One recommendation letter is required.")).toMatchObject({
      minimumCount: 1,
      maximumCount: null,
    });
  });

  it("readiness respects extracted min/max without inventing a max", async () => {
    const db = ctx.db();
    const repos = new Repositories(db);

    const minOnly = repos.createApplication({
      name: "MinOnly",
      organization: "Org",
      type: "scholarship",
    });
    const { ingestPastedText } = await import(
      "../../src/services/requirements/ingest.js"
    );
    await ingestPastedText(
      db,
      minOnly.id,
      "Submit two recommendation letters.",
      "rules",
    );
    const minReq = repos
      .listRequirements(minOnly.id)
      .find((r) => r.category === "recommendation")!;
    expect(minReq.maximumCount).toBeNull();
    repos.updateRequirement(minReq.id, {
      userConfirmed: true,
      certainty: "required",
      required: true,
    });
    for (const name of ["Recommendation_A.pdf", "Recommendation_B.pdf"]) {
      const id = newId();
      repos.createDocument({
        id,
        applicationId: minOnly.id,
        vaultDocumentId: null,
        originalFilename: name,
        storedFilename: name,
        mimeType: "application/pdf",
        fileSize: 10,
        pageCount: 1,
        wordCount: 40,
        title: "Letter of Recommendation",
        category: "recommendation",
        categoryConfidence: 0.95,
        parseStatus: "parsed",
        parsingWarnings: [],
        contentHash: id,
        text: "Letter of Recommendation Dear Committee I recommend Alex.",
      });
      repos.upsertMatch({
        id: newId(),
        applicationId: minOnly.id,
        requirementId: minReq.id,
        documentId: id,
        status: "confirmed",
        confidence: 1,
        explanation: "user",
        evidence: [],
        userConfirmed: true,
      });
    }
    const minResult = analyzeApplication(db, minOnly.id);
    expect(minResult.issues.some((i) => i.code === "TOO_MANY_DOCUMENTS")).toBe(
      false,
    );

    const exact = repos.createApplication({
      name: "Exact",
      organization: "Org",
      type: "scholarship",
    });
    await ingestPastedText(
      db,
      exact.id,
      "Exactly two recommendation letters are required.",
      "rules",
    );
    const exactReq = repos
      .listRequirements(exact.id)
      .find((r) => r.category === "recommendation")!;
    expect(exactReq).toMatchObject({ minimumCount: 2, maximumCount: 2 });
    repos.updateRequirement(exactReq.id, {
      userConfirmed: true,
      certainty: "required",
      required: true,
    });
    for (const name of [
      "Recommendation_1.pdf",
      "Recommendation_2.pdf",
      "Recommendation_3.pdf",
    ]) {
      const id = newId();
      repos.createDocument({
        id,
        applicationId: exact.id,
        vaultDocumentId: null,
        originalFilename: name,
        storedFilename: name,
        mimeType: "application/pdf",
        fileSize: 10,
        pageCount: 1,
        wordCount: 40,
        title: "Letter of Recommendation",
        category: "recommendation",
        categoryConfidence: 0.95,
        parseStatus: "parsed",
        parsingWarnings: [],
        contentHash: id,
        text: "Letter of Recommendation Dear Committee I recommend Alex.",
      });
      repos.upsertMatch({
        id: newId(),
        applicationId: exact.id,
        requirementId: exactReq.id,
        documentId: id,
        status: "confirmed",
        confidence: 1,
        explanation: "user",
        evidence: [],
        userConfirmed: true,
      });
    }
    const exactResult = analyzeApplication(db, exact.id);
    expect(exactResult.issues.some((i) => i.code === "TOO_MANY_DOCUMENTS")).toBe(
      true,
    );
  });
});

describe("review fixes — conditional applicability detection", () => {
  const extractor = new RuleRequirementExtractor();
  const ctxCond = {
    applicationName: "App",
    organization: "Org",
    sourceType: "pasted_text",
    sourceName: "t",
  } as const;

  it("treats explicit conditional clauses as conditional", () => {
    expect(
      extractor.extract("If applicable, submit a portfolio.", ctxCond).some(
        (d) => d.category === "portfolio" && d.conditional,
      ),
    ).toBe(true);
    expect(
      extractor
        .extract(
          "If you are currently employed, provide a supervisor reference letter.",
          ctxCond,
        )
        .some((d) => d.category === "recommendation" && d.conditional),
    ).toBe(true);
    expect(
      extractor
        .extract(
          "For applicants who attended another institution, submit that transcript.",
          ctxCond,
        )
        .some((d) => d.category === "transcript" && d.conditional),
    ).toBe(true);
    expect(
      extractor
        .extract(
          "When required by the department, provide certification.",
          ctxCond,
        )
        .some((d) => d.category === "certification" && d.conditional),
    ).toBe(true);
  });

  it("does not treat narrative when-clauses as conditional", () => {
    const drafts = extractor.extract(
      "Submit an essay describing when you demonstrated leadership.",
      ctxCond,
    );
    expect(
      drafts
        .filter((d) => d.category === "essay")
        .every((d) => d.conditional === false),
    ).toBe(true);
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
