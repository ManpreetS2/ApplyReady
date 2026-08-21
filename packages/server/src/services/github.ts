import { AppError } from "../utils/errors.js";
import { fetchPublicResource } from "./urlFetch.js";

export type GithubContentEntry = {
  name: string;
  path: string;
  type: string;
  download_url?: string | null;
};

export type ParsedGithubUrl =
  | {
      kind: "raw";
      owner: string;
      repo: string;
      ref: string;
      path: string;
      rawUrl: string;
    }
  | { kind: "tree"; owner: string; repo: string; ref: string; path: string };

export type ResolvedGithubResource = {
  url: string;
  text: string;
};

export type GithubFetchResource = (
  url: string,
  options?: { allowJson?: boolean; headers?: Record<string, string> },
) => Promise<{ body: Buffer; contentType: string }>;

const USABLE_EXTENSIONS = [".md", ".markdown", ".txt"];
const MAX_DIRECTORY_ENTRIES = 10;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function encodeApiPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function buildRawContentUrl(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): string {
  const cleanPath = encodeApiPath(path);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}${cleanPath ? `/${cleanPath}` : ""}`;
}

export function buildContentsApiUrl(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): string {
  const cleanPath = encodeApiPath(path);
  return `https://api.github.com/repos/${owner}/${repo}/contents${cleanPath ? `/${cleanPath}` : ""}?ref=${encodeURIComponent(ref)}`;
}

export function parseGithubUrl(rawUrl: string): ParsedGithubUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const hostname = url.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") return null;

  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  if (segments.length < 4) return null;
  const owner = segments[0] ?? "";
  const repo = segments[1] ?? "";
  const kind = segments[2] ?? "";
  const rest = segments.slice(3);
  const ref = rest[0] ?? "";
  const path = rest.slice(1).join("/");

  if (kind === "blob" || kind === "raw") {
    if (!path) return null;
    return {
      kind: "raw",
      owner,
      repo,
      ref,
      path,
      rawUrl: buildRawContentUrl(owner, repo, ref, path),
    };
  }
  if (kind === "tree") {
    return { kind: "tree", owner, repo, ref, path };
  }
  return null;
}

export function selectReadableEntries(
  entries: GithubContentEntry[],
): GithubContentEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.type === "file" &&
        USABLE_EXTENSIONS.some((ext) =>
          entry.name.toLowerCase().endsWith(ext),
        ),
    )
    .slice(0, MAX_DIRECTORY_ENTRIES);
}

function emptyRequirementsError(): AppError {
  return new AppError(
    "EMPTY_REQUIREMENTS",
    "No readable requirement files (.md/.markdown/.txt) were found at this GitHub location.",
    400,
    [
      "Open the file on GitHub and paste its raw URL, or upload/paste the requirements.",
    ],
  );
}

async function fetchText(
  fetchResource: GithubFetchResource,
  url: string,
): Promise<string> {
  const fetched = await fetchResource(url);
  return fetched.body.toString("utf8");
}

async function resolveTree(
  parsed: Extract<ParsedGithubUrl, { kind: "tree" }>,
  fetchResource: GithubFetchResource,
): Promise<ResolvedGithubResource | null> {
  const apiUrl = buildContentsApiUrl(
    parsed.owner,
    parsed.repo,
    parsed.ref,
    parsed.path,
  );
  const listing = await fetchResource(apiUrl, {
    allowJson: true,
    headers: { Accept: "application/vnd.github+json" },
  });
  let payload: unknown;
  try {
    payload = JSON.parse(listing.body.toString("utf8"));
  } catch {
    throw emptyRequirementsError();
  }

  if (Array.isArray(payload)) {
    const usable = selectReadableEntries(payload as GithubContentEntry[]);
    if (usable.length === 0) throw emptyRequirementsError();
    let combined = "";
    for (const entry of usable) {
      const target =
        entry.download_url ||
        buildRawContentUrl(parsed.owner, parsed.repo, parsed.ref, entry.path);
      const content = (await fetchText(fetchResource, target)).trim();
      if (!content) continue;
      combined = combined
        ? `${combined}\n\n## ${entry.name}\n\n${content}`
        : content;
    }
    if (!combined.trim()) throw emptyRequirementsError();
    return { url: apiUrl, text: combined };
  }

  const single = payload as Partial<GithubContentEntry>;
  if (single && single.type === "file") {
    const target =
      single.download_url ||
      buildRawContentUrl(parsed.owner, parsed.repo, parsed.ref, parsed.path);
    const text = await fetchText(fetchResource, target);
    if (!text.trim()) throw emptyRequirementsError();
    return { url: target, text };
  }
  throw emptyRequirementsError();
}

export async function resolveGithubResource(
  rawUrl: string,
  fetchResource: GithubFetchResource = fetchPublicResource,
): Promise<ResolvedGithubResource | null> {
  const parsed = parseGithubUrl(rawUrl);
  if (!parsed) return null;
  if (parsed.kind === "raw") {
    const text = await fetchText(fetchResource, parsed.rawUrl);
    if (!text.trim()) throw emptyRequirementsError();
    return { url: parsed.rawUrl, text };
  }
  return resolveTree(parsed, fetchResource);
}
