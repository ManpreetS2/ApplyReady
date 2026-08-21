import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";
import { FETCH_TIMEOUT_MS, MAX_FETCH_BYTES } from "@applyready/shared";
import { AppError } from "../utils/errors.js";
import { isGlobalUnicastIp, isPrivateIp } from "./net/privateIp.js";

export { isGlobalUnicastIp, isPrivateIp } from "./net/privateIp.js";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

type LookupAllFn = (
  hostname: string,
  options: { all: true; verbatim?: boolean },
) => Promise<LookupAddress[]>;

let lookupAllImpl: LookupAllFn = (hostname, options) =>
  dns.lookup(hostname, options);
let allowPrivateForTests = false;

/** Test-only hooks. Hard-fails outside Vitest/test environments. */
export function setUrlFetchTestHooks(hooks: {
  lookupAll?: LookupAllFn | null;
  allowPrivate?: boolean;
} | null): void {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("setUrlFetchTestHooks is only available in tests");
  }
  if (!hooks) {
    lookupAllImpl = (hostname, options) => dns.lookup(hostname, options);
    allowPrivateForTests = false;
    return;
  }
  if (hooks.lookupAll) lookupAllImpl = hooks.lookupAll;
  if (hooks.lookupAll === null) {
    lookupAllImpl = (hostname, options) => dns.lookup(hostname, options);
  }
  if (hooks.allowPrivate != null) allowPrivateForTests = hooks.allowPrivate;
}

export function hasPdfMagic(buffer: Buffer): boolean {
  return (
    buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-"
  );
}

export function looksLikePdf(buffer: Buffer, contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (type.includes("application/pdf")) return true;
  return hasPdfMagic(buffer);
}

export function isAllowedFetchContentType(
  contentType: string,
  buffer: Buffer,
): boolean {
  const type = (contentType || "").toLowerCase();
  if (
    type.includes("text/html") ||
    type.includes("text/plain") ||
    type.includes("application/xhtml") ||
    type.includes("application/pdf")
  ) {
    return true;
  }
  if (type.includes("application/octet-stream") || type === "") {
    return hasPdfMagic(buffer);
  }
  return false;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("INVALID_URL", "The provided URL is invalid.", 400, [
      "Enter a full public URL starting with https:// or http://.",
    ]);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(
      "UNSUPPORTED_PROTOCOL",
      "Only HTTP and HTTPS URLs are allowed.",
      400,
      ["Use a public webpage URL."],
    );
  }

  if (url.username || url.password) {
    throw new AppError(
      "EMBEDDED_CREDENTIALS",
      "URLs with embedded credentials are not allowed.",
      400,
      ["Remove username/password from the URL and try again."],
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    throw new AppError(
      "BLOCKED_HOST",
      "Local and internal hosts cannot be fetched.",
      400,
      ["Paste a public requirements page, or upload/paste the requirements instead."],
    );
  }

  if (net.isIP(hostname)) {
    // Literal IPs stay blocked even under test hooks — only DNS pinning uses allowPrivate.
    if (isPrivateIp(hostname)) {
      throw new AppError(
        "PRIVATE_IP",
        "Private or link-local IP addresses are blocked.",
        400,
        ["Use a public website URL."],
      );
    }
  } else {
    await resolveValidatedAddresses(hostname);
  }

  return url;
}

export async function resolveValidatedAddresses(
  hostname: string,
): Promise<LookupAddress[]> {
  let resolved: LookupAddress[] = [];
  try {
    resolved = await lookupAllImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError(
      "DNS_FAILURE",
      "Could not resolve the hostname.",
      400,
      ["Check the URL spelling, or paste/upload the requirements instead."],
    );
  }
  if (
    resolved.length === 0 ||
    (resolved.some((entry) => isPrivateIp(entry.address)) &&
      !allowPrivateForTests)
  ) {
    throw new AppError(
      "PRIVATE_IP",
      "The URL resolves to a private or blocked address.",
      400,
      ["Use a public website URL."],
    );
  }
  return resolved;
}

type RawResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: URL;
};

function headerValue(headers: http.IncomingHttpHeaders, name: string): string {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] || "";
  return raw || "";
}

function pinnedLookup(addresses: LookupAddress[]) {
  return (
    _hostname: string,
    options: LookupOptions | number | undefined,
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    const cb =
      typeof options === "function"
        ? (options as NonNullable<typeof callback>)
        : callback;
    if (!cb) return;
    const opts = typeof options === "object" && options ? options : undefined;
    if (opts?.all) {
      cb(null, addresses);
      return;
    }
    const family =
      typeof options === "number"
        ? options
        : opts?.family
          ? Number(opts.family)
          : 0;
    const match =
      addresses.find((entry) => !family || entry.family === family) ||
      addresses[0];
    if (!match) {
      cb(
        Object.assign(new Error("No validated public address"), {
          code: "ENOTFOUND",
        }),
        "",
        0,
      );
      return;
    }
    cb(null, match.address, match.family);
  };
}

async function requestPinned(
  target: URL,
  addresses: LookupAddress[] | null,
  signal: AbortSignal,
  extraHeaders?: Record<string, string>,
): Promise<RawResponse> {
  const transport = target.protocol === "https:" ? https : http;
  const port = target.port || (target.protocol === "https:" ? "443" : "80");

  return new Promise<RawResponse>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        servername: target.hostname,
        port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: {
          Host: target.host,
          "User-Agent": "ApplyReadyLocal/1.0 (+local document readiness tool)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/pdf",
          Connection: "close",
          ...extraHeaders,
        },
        lookup: addresses ? (pinnedLookup(addresses) as never) : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;

        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          request.destroy();
          reject(error);
        };

        response.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > MAX_FETCH_BYTES) {
            fail(
              new AppError(
                "RESPONSE_TOO_LARGE",
                "The remote response exceeds the size limit.",
                400,
                ["Upload or paste the requirements instead."],
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
            url: target,
          });
        });
        response.on("error", fail);
      },
    );

    const onAbort = () => {
      request.destroy(
        new AppError("FETCH_TIMEOUT", "The request timed out.", 400, [
          "Try again, or paste/upload the requirements instead.",
        ]),
      );
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });

    request.on("error", (error) => {
      if (error instanceof AppError) {
        reject(error);
        return;
      }
      reject(
        new AppError(
          "FETCH_FAILED",
          "Could not fetch the requirements URL.",
          400,
          ["Paste or upload the requirements instead."],
          { reason: error.message },
        ),
      );
    });
    request.end();
  });
}

export type FetchedPublicResource = {
  url: string;
  contentType: string;
  body: Buffer;
  text: string;
  isPdf: boolean;
};

export type FetchPublicResourceOptions = {
  allowJson?: boolean;
  headers?: Record<string, string>;
};

export async function fetchPublicResource(
  rawUrl: string,
  options?: FetchPublicResourceOptions,
): Promise<FetchedPublicResource> {
  const initial = await assertSafePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = initial;
    let hop = 0;
    let response: RawResponse | null = null;

    while (hop <= 5) {
      const addresses = net.isIP(currentUrl.hostname)
        ? null
        : await resolveValidatedAddresses(currentUrl.hostname);
      response = await requestPinned(
        currentUrl,
        addresses,
        controller.signal,
        options?.headers,
      );

      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = headerValue(response.headers, "location");
      if (!location) break;
      if (hop >= 5) {
        throw new AppError(
          "REDIRECT_LOOP",
          "Too many redirects while fetching the URL.",
          400,
          ["Paste the final public page URL, or upload the requirements file."],
        );
      }
      currentUrl = await assertSafePublicUrl(
        new URL(location, currentUrl).toString(),
      );
      hop += 1;
    }

    if (!response) {
      throw new AppError(
        "FETCH_FAILED",
        "Could not fetch the requirements URL.",
        400,
        ["Paste or upload the requirements instead."],
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new AppError(
        "REDIRECT_LOOP",
        "Too many redirects while fetching the URL.",
        400,
        ["Paste the final public page URL, or upload the requirements file."],
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new AppError(
        "FETCH_FAILED",
        `The remote server responded with status ${response.status}.`,
        400,
        ["Try again later, or paste/upload the requirements instead."],
      );
    }

    const contentType = headerValue(response.headers, "content-type").toLowerCase();
    const lengthHeader = headerValue(response.headers, "content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_FETCH_BYTES) {
      throw new AppError(
        "RESPONSE_TOO_LARGE",
        "The remote response exceeds the size limit.",
        400,
        ["Upload or paste the requirements instead."],
      );
    }
    if (response.body.byteLength > MAX_FETCH_BYTES) {
      throw new AppError(
        "RESPONSE_TOO_LARGE",
        "The remote response exceeds the size limit.",
        400,
        ["Upload or paste the requirements instead."],
      );
    }

    const contentTypeAllowed =
      isAllowedFetchContentType(contentType, response.body) ||
      (options?.allowJson === true && contentType.includes("application/json"));
    if (!contentTypeAllowed) {
      throw new AppError(
        "UNSUPPORTED_CONTENT_TYPE",
        `Unsupported content type: ${contentType || "unknown"}.`,
        400,
        ["Use an HTML or text requirements page, or upload a PDF/DOCX/TXT file."],
      );
    }

    const isPdf = looksLikePdf(response.body, contentType);
    return {
      url: currentUrl.toString(),
      contentType,
      body: response.body,
      text: isPdf ? "" : response.body.toString("utf8"),
      isPdf,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError(
        "FETCH_TIMEOUT",
        "The request timed out.",
        400,
        ["Try again, or paste/upload the requirements instead."],
      );
    }
    throw new AppError(
      "FETCH_FAILED",
      "Could not fetch the requirements URL.",
      400,
      ["Paste or upload the requirements instead."],
      { reason: error instanceof Error ? error.message : "unknown" },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPublicText(rawUrl: string): Promise<{
  url: string;
  contentType: string;
  text: string;
}> {
  const fetched = await fetchPublicResource(rawUrl);
  return {
    url: fetched.url,
    contentType: fetched.contentType,
    text: fetched.text,
  };
}
