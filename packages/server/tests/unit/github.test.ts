import { describe, expect, it } from "vitest";
import {
  buildContentsApiUrl,
  buildRawContentUrl,
  parseGithubUrl,
  resolveGithubResource,
  selectReadableEntries,
} from "../../src/services/github.js";
import type { GithubContentEntry, GithubFetchResource } from "../../src/services/github.js";

function fakeFetcher(
  responses: Record<string, { body?: string; contentType?: string }>,
): GithubFetchResource {
  return async (url) => {
    const response = responses[url];
    if (!response) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return {
      body: Buffer.from(response.body ?? "", "utf8"),
      contentType: response.contentType ?? "text/plain",
    };
  };
}

describe("github url mapping", () => {
  it("maps blob URLs to raw content URLs", () => {
    const parsed = parseGithubUrl(
      "https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md",
    );
    expect(parsed).toMatchObject({
      kind: "raw",
      owner: "cursor",
      repo: "plugins",
      ref: "main",
      path: "pstack/skills/unslop/SKILL.md",
    });
    if (parsed && parsed.kind === "raw") {
      expect(parsed.rawUrl).toBe(
        "https://raw.githubusercontent.com/cursor/plugins/main/pstack/skills/unslop/SKILL.md",
      );
    }
  });

  it("maps raw URLs to raw content URLs", () => {
    const parsed = parseGithubUrl(
      "https://github.com/cursor/plugins/raw/main/README.md",
    );
    expect(parsed).toMatchObject({
      kind: "raw",
      ref: "main",
      path: "README.md",
    });
    if (parsed && parsed.kind === "raw") {
      expect(parsed.rawUrl).toBe(
        "https://raw.githubusercontent.com/cursor/plugins/main/README.md",
      );
    }
  });

  it("maps tree URLs to the contents API shape", () => {
    const parsed = parseGithubUrl(
      "https://github.com/cursor/plugins/tree/main/pstack/skills/unslop",
    );
    expect(parsed).toMatchObject({
      kind: "tree",
      owner: "cursor",
      repo: "plugins",
      ref: "main",
      path: "pstack/skills/unslop",
    });
    if (parsed && parsed.kind === "tree") {
      expect(buildContentsApiUrl(parsed.owner, parsed.repo, parsed.ref, parsed.path)).toBe(
        "https://api.github.com/repos/cursor/plugins/contents/pstack/skills/unslop?ref=main",
      );
    }
  });

  it("passes through non-GitHub and non-file GitHub URLs as null", () => {
    expect(parseGithubUrl("https://example.com/requirements")).toBeNull();
    expect(parseGithubUrl("https://gitlab.com/o/r/blob/main/a.md")).toBeNull();
    expect(parseGithubUrl("https://github.com/o/r/issues/12")).toBeNull();
  });

  it("falls back gracefully on malformed GitHub paths", () => {
    expect(parseGithubUrl("not-a-url")).toBeNull();
    expect(parseGithubUrl("https://github.com/cursor")).toBeNull();
    expect(parseGithubUrl("https://github.com/cursor/plugins")).toBeNull();
    expect(parseGithubUrl("https://github.com/cursor/plugins/blob/main")).toBeNull();
    expect(parseGithubUrl("ftp://github.com/o/r/raw/main/a.md")).toBeNull();
  });

  it("decodes percent-encoded path segments", () => {
    const parsed = parseGithubUrl(
      "https://github.com/o/r/blob/main/docs/my%20notes.md",
    );
    expect(parsed).toMatchObject({ path: "docs/my notes.md" });
  });

  it("selects only readable file entries capped at ten", () => {
    const entries: GithubContentEntry[] = [
      { name: "README.md", path: "README.md", type: "file" },
      { name: "logo.png", path: "logo.png", type: "file" },
      { name: "docs", path: "docs", type: "dir" },
      { name: "NOTES.TXT", path: "NOTES.TXT", type: "file" },
      { name: "guide.markdown", path: "guide.markdown", type: "file" },
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `file-${i}.md`,
        path: `file-${i}.md`,
        type: "file",
      })),
    ];
    const selected = selectReadableEntries(entries);
    expect(selected).toHaveLength(10);
    expect(selected.every((entry) => entry.type === "file")).toBe(true);
    expect(selected.map((entry) => entry.name)).not.toContain("logo.png");
  });

  it("builds raw URLs for fallback download targets", () => {
    expect(buildRawContentUrl("o", "r", "main", "docs/a.md")).toBe(
      "https://raw.githubusercontent.com/o/r/main/docs/a.md",
    );
  });
});

describe("resolveGithubResource", () => {
  it("fetches blob content through the raw URL", async () => {
    const fetcher = fakeFetcher({
      "https://raw.githubusercontent.com/o/r/main/SKILL.md": {
        body: "Avoid AI slop patterns in generated text.",
        contentType: "text/plain; charset=utf-8",
      },
    });
    const resolved = await resolveGithubResource(
      "https://github.com/o/r/blob/main/SKILL.md",
      fetcher,
    );
    expect(resolved).toEqual({
      url: "https://raw.githubusercontent.com/o/r/main/SKILL.md",
      text: "Avoid AI slop patterns in generated text.",
    });
  });

  it("concatenates markdown directory entries with filename headers", async () => {
    const apiUrl =
      "https://api.github.com/repos/o/r/contents/skills/unslop?ref=main";
    const rawA = "https://raw.githubusercontent.com/o/r/main/skills/unslop/SKILL.md";
    const rawB = "https://raw.githubusercontent.com/o/r/main/skills/unslop/NOTES.txt";
    const listing = [
      { name: "SKILL.md", path: "skills/unslop/SKILL.md", type: "file", download_url: rawA },
      { name: "icon.png", path: "skills/unslop/icon.png", type: "file", download_url: "https://raw.githubusercontent.com/o/r/main/icon.png" },
      { name: "NOTES.txt", path: "skills/unslop/NOTES.txt", type: "file", download_url: rawB },
    ];
    const fetcher = fakeFetcher({
      [apiUrl]: {
        body: JSON.stringify(listing),
        contentType: "application/json; charset=utf-8",
      },
      [rawA]: { body: "Unslop guidance for skills." },
      [rawB]: { body: "Extra notes." },
    });
    const resolved = await resolveGithubResource(
      "https://github.com/o/r/tree/main/skills/unslop",
      fetcher,
    );
    expect(resolved?.url).toBe(apiUrl);
    expect(resolved?.text).toContain("Unslop guidance");
    expect(resolved?.text).toContain("## NOTES.txt");
    expect(resolved?.text).toContain("Extra notes.");
    expect(resolved?.text.indexOf("Unslop")).toBeLessThan(
      resolved!.text.indexOf("## NOTES.txt"),
    );
  });

  it("throws EMPTY_REQUIREMENTS when a tree directory has no readable files", async () => {
    const apiUrl = "https://api.github.com/repos/o/r/contents/assets?ref=main";
    const fetcher = fakeFetcher({
      [apiUrl]: {
        body: JSON.stringify([
          { name: "logo.png", path: "assets/logo.png", type: "file", download_url: "https://raw.githubusercontent.com/o/r/main/logo.png" },
        ]),
        contentType: "application/json",
      },
    });
    await expect(
      resolveGithubResource("https://github.com/o/r/tree/main/assets", fetcher),
    ).rejects.toMatchObject({
      code: "EMPTY_REQUIREMENTS",
      nextSteps: expect.arrayContaining([expect.stringContaining("raw URL")]),
    });
  });

  it("resolves a single-file API payload via its download_url", async () => {
    const apiUrl = "https://api.github.com/repos/o/r/contents/README.md?ref=dev";
    const raw = "https://raw.githubusercontent.com/o/r/dev/README.md";
    const fetcher = fakeFetcher({
      [apiUrl]: {
        body: JSON.stringify({
          name: "README.md",
          path: "README.md",
          type: "file",
          download_url: raw,
        }),
        contentType: "application/json",
      },
      [raw]: { body: "Requirements live here in enough quantity." },
    });
    const resolved = await resolveGithubResource(
      "https://github.com/o/r/tree/dev/README.md",
      fetcher,
    );
    expect(resolved).toEqual({ url: raw, text: "Requirements live here in enough quantity." });
  });

  it("returns null for non-GitHub URLs without fetching", async () => {
    const fetcher = fakeFetcher({});
    expect(await resolveGithubResource("https://example.com/x", fetcher)).toBeNull();
  });
});
