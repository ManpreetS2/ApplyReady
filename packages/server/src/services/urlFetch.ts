import dns from "node:dns/promises";
import net from "node:net";
import { FETCH_TIMEOUT_MS, MAX_FETCH_BYTES } from "@applyready/shared";
import { AppError } from "../utils/errors.js";

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 0) return true;
  if (ip === "0.0.0.0" || ip === "::" || ip === "::1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80"))
    return true;
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    const [a, b] = parts as [number, number, number, number];
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
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
    hostname.endsWith(".internal")
  ) {
    throw new AppError(
      "BLOCKED_HOST",
      "Local and internal hosts cannot be fetched.",
      400,
      ["Paste a public requirements page, or upload/paste the requirements instead."],
    );
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new AppError(
        "PRIVATE_IP",
        "Private or link-local IP addresses are blocked.",
        400,
        ["Use a public website URL."],
      );
    }
  } else {
    let addresses: string[] = [];
    try {
      const resolved = await dns.lookup(hostname, { all: true });
      addresses = resolved.map((r) => r.address);
    } catch {
      throw new AppError(
        "DNS_FAILURE",
        "Could not resolve the hostname.",
        400,
        ["Check the URL spelling, or paste/upload the requirements instead."],
      );
    }
    if (addresses.length === 0 || addresses.some(isPrivateIp)) {
      throw new AppError(
        "PRIVATE_IP",
        "The URL resolves to a private or blocked address.",
        400,
        ["Use a public website URL."],
      );
    }
  }

  return url;
}

export async function fetchPublicText(rawUrl: string): Promise<{
  url: string;
  contentType: string;
  text: string;
}> {
  const initial = await assertSafePublicUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(initial.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "ApplyReadyLocal/1.0 (+local document readiness tool)",
        Accept: "text/html,application/xhtml+xml,text/plain,application/pdf",
      },
    });

    let current = response;
    let hop = 0;
    let finalUrl = initial;

    while (
      [301, 302, 303, 307, 308].includes(current.status) &&
      hop < 5
    ) {
      const location = current.headers.get("location");
      if (!location) break;
      finalUrl = await assertSafePublicUrl(new URL(location, finalUrl).toString());
      current = await fetch(finalUrl.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "ApplyReadyLocal/1.0 (+local document readiness tool)",
          Accept: "text/html,application/xhtml+xml,text/plain,application/pdf",
        },
      });
      hop += 1;
    }

    if ([301, 302, 303, 307, 308].includes(current.status)) {
      throw new AppError(
        "REDIRECT_LOOP",
        "Too many redirects while fetching the URL.",
        400,
        ["Paste the final public page URL, or upload the requirements file."],
      );
    }

    if (!current.ok) {
      throw new AppError(
        "FETCH_FAILED",
        `The remote server responded with status ${current.status}.`,
        400,
        ["Try again later, or paste/upload the requirements instead."],
      );
    }

    const contentType = (current.headers.get("content-type") || "").toLowerCase();
    const allowed =
      contentType.includes("text/html") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/xhtml") ||
      contentType.includes("application/pdf") ||
      contentType.includes("application/octet-stream") ||
      contentType === "";

    if (!allowed) {
      throw new AppError(
        "UNSUPPORTED_CONTENT_TYPE",
        `Unsupported content type: ${contentType || "unknown"}.`,
        400,
        ["Use an HTML or text requirements page, or upload a PDF/DOCX/TXT file."],
      );
    }

    const lengthHeader = current.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_FETCH_BYTES) {
      throw new AppError(
        "RESPONSE_TOO_LARGE",
        "The remote response exceeds the size limit.",
        400,
        ["Upload or paste the requirements instead."],
      );
    }

    const buffer = Buffer.from(await current.arrayBuffer());
    if (buffer.byteLength > MAX_FETCH_BYTES) {
      throw new AppError(
        "RESPONSE_TOO_LARGE",
        "The remote response exceeds the size limit.",
        400,
        ["Upload or paste the requirements instead."],
      );
    }

    return {
      url: finalUrl.toString(),
      contentType,
      text: buffer.toString("utf8"),
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
