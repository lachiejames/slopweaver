/**
 * Read the headers `chatgpt conversation` needs out of a request the owner copied from Chrome DevTools. Pure.
 *
 * DevTools hands a request over in two shapes: the Headers pane selected and copied, where each header is a
 * `name` line followed by a `value` line, and "Copy request headers", where each is one `name: value` line.
 * Both are read. Only the five headers a measured read of the backend was made with are kept — the rest of a
 * paste (response headers, `sec-*` hints, Cloudflare's report-to) is never written anywhere.
 */
import { epochSecondsToIso } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptError, ChatgptErrors } from "./errors.js";

/**
 * The headers a signed-in read of one conversation carries. MEASURED: a plain Node `fetch` of
 * `/backend-api/conversations/<id>/messages` with these five answered HTTP 200 JSON through Cloudflare.
 */
export interface ChatgptSessionHeaders {
  readonly authorization: string;
  readonly cookie: string;
  readonly "chatgpt-account-id": string;
  readonly "oai-did": string;
  readonly "user-agent": string;
}

/** The header names kept from a paste, in the order they are reported. */
export const KEPT_HEADERS = ["authorization", "cookie", "chatgpt-account-id", "oai-did", "user-agent"] as const;

/** A header name, as the left of one `name: value` line (the "Copy request headers" shape). */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * The value of one `name: value` line for `name`, split at the first colon rather than matched by one pattern,
 * so no two quantifiers compete for the same whitespace.
 *
 * @param line one trimmed line
 * @param name the lowercase header name
 * @returns the value, or `null` when the line is not that header
 */
function inlineHeaderValue({ line, name }: { line: string; name: string }): string | null {
  const colon = line.indexOf(":");
  if (colon < 1) {
    return null;
  }
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1).trim();
  if (!HEADER_NAME.test(left) || left.toLowerCase() !== name || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * The value of one header in a paste, whichever DevTools shape it came in.
 *
 * @param lines the paste split into lines, each trimmed
 * @param name the lowercase header name
 * @returns the value, or `null` when the paste does not carry it
 */
function headerValue({ lines, name }: { lines: readonly string[]; name: string }): string | null {
  for (const [index, line] of lines.entries()) {
    if (line.toLowerCase() === name) {
      const next = lines[index + 1];
      if (next !== undefined && next.length > 0) {
        return next;
      }
    }
    const inline = inlineHeaderValue({ line, name });
    if (inline !== null) {
      return inline;
    }
  }
  return null;
}

/**
 * The five session headers from a DevTools paste, refusing on the first one it lacks.
 *
 * @param text the whole paste
 * @returns the kept headers, or `HEADER_MISSING` naming the absent one — never a value
 */
export function parseRequestPaste({ text }: { text: string }): Result<ChatgptSessionHeaders, ChatgptError> {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const found: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headerValue({ lines, name });
    if (value === null) {
      return err(ChatgptErrors.headerMissing({ header: name }));
    }
    found[name] = value;
  }
  return ok({
    authorization: found["authorization"]!,
    "chatgpt-account-id": found["chatgpt-account-id"]!,
    cookie: found["cookie"]!,
    "oai-did": found["oai-did"]!,
    "user-agent": found["user-agent"]!,
  });
}

/**
 * When the pasted bearer stops working, read from its own `exp` claim — a date, never the token.
 *
 * @param authorization the `Bearer <jwt>` header value
 * @returns the expiry instant, or `null` when the value is not a JWT carrying a numeric `exp`
 */
export function bearerExpiryIso({ authorization }: { authorization: string }): string | null {
  const payload = authorization.replace(/^Bearer\s+/i, "").split(".")[1];
  if (payload === undefined) {
    return null;
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null || !("exp" in claims) || typeof claims.exp !== "number") {
    return null;
  }
  const iso = epochSecondsToIso({ seconds: claims.exp });
  if (iso === undefined) {
    return null;
  }
  return iso;
}
