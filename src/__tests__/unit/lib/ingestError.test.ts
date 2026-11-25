import { RequestTimeoutError } from "@notionhq/client";
import { describe, expect, it } from "vitest";
import {
  errorCode,
  errorStatus,
  formatIngestError,
  hadNoProviderResponse,
  hasTransientStatus,
  type IngestError,
  ingestErrorToThrowable,
  toIngestError,
} from "../../../lib/ingestError.js";

/**
 * The shape `@octokit/request` throws when a provider answers with an EMPTY body: `RequestError("", status, …)`,
 * an `Error` whose message is `""`, carrying the status and the received response's lower-cased headers.
 */
class EmptyBodyHttpError extends Error {
  readonly status: number;
  readonly response: { readonly headers: Readonly<Record<string, string>> } | undefined;

  constructor({ status, headers, cause }: { status: number; headers?: Record<string, string>; cause?: unknown }) {
    super("", { cause });
    this.name = "HttpError";
    this.status = status;
    this.response = headers !== undefined ? { headers } : undefined;
  }
}

describe("toIngestError", () => {
  it("maps a 429 to a rate-limit error, preserving status/code/retry-after and cause identity", () => {
    const thrown = Object.assign(new Error("rate limited"), { code: "ratelimited", retryAfter: 3, status: 429 });
    const mapped = toIngestError({ error: thrown, operation: "slack.conversations.history", provider: "slack" });
    expect(mapped.kind).toBe("rate-limit");
    expect(mapped.status).toBe(429);
    expect(mapped.code).toBe("ratelimited");
    expect(mapped.retryAfterMs).toBe(3000);
    expect(mapped.message).toBe("rate limited");
    expect(mapped.operation).toBe("slack.conversations.history");
    expect(mapped.provider).toBe("slack");
    expect(mapped.cause).toBe(thrown); // identity preserved
  });

  it("maps a 500 to an http error", () => {
    const mapped = toIngestError({
      error: Object.assign(new Error("boom"), { status: 500 }),
      operation: "linear.issues",
      provider: "linear",
    });
    expect(mapped.kind).toBe("http");
    expect(mapped.status).toBe(500);
    expect(mapped.provider).toBe("linear");
  });

  it("maps a bare 4xx to an http error (not transient)", () => {
    const mapped = toIngestError({ error: { status: 404 }, operation: "notion.pages", provider: "notion" });
    expect(mapped.kind).toBe("http");
    expect(mapped.status).toBe(404);
  });

  it("maps a network ECONNRESET (no status) to a network error", () => {
    const mapped = toIngestError({
      error: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
      operation: "slack.auth.test",
      provider: "slack",
    });
    expect(mapped.kind).toBe("network");
    expect(mapped.code).toBe("ECONNRESET");
    expect(mapped.status).toBeUndefined();
  });

  it("reads undici's transport code out of the cause chain and refuses Octokit's synthetic status", () => {
    // The exact shape `@octokit/request` throws when `fetch` rejects: it replaces the message with the
    // cause's, stamps `status: 500`, and hangs the original on `.cause` — so the only link carrying
    // `UND_ERR_SOCKET` is two hops down. Measured on a real acme-admin pull request.
    const socket = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET", name: "SocketError" });
    const wrapped = new TypeError("fetch failed", { cause: socket });
    const requestError = Object.assign(new Error("other side closed"), {
      cause: wrapped,
      name: "HttpError",
      status: 500,
    });
    const mapped = toIngestError({
      error: requestError,
      operation: "github.enqueuePullRequest",
      provider: "github",
    });
    expect(mapped.kind).toBe("network");
    expect(mapped.code).toBe("UND_ERR_SOCKET");
    expect(mapped.status).toBeUndefined();
    expect(mapped.message).toBe("other side closed");
    expect(hadNoProviderResponse({ error: mapped })).toBe(true);
    expect(formatIngestError({ error: mapped })).toBe(
      "github github.enqueuePullRequest UND_ERR_SOCKET: other side closed",
    );
  });

  it("keeps a REAL 500 an http error — a provider that answered is not a transport failure", () => {
    const mapped = toIngestError({
      error: Object.assign(new Error("Server Error"), { name: "HttpError", status: 500 }),
      operation: "github.enqueuePullRequest",
      provider: "github",
    });
    expect(mapped.kind).toBe("http");
    expect(mapped.status).toBe(500);
    expect(hadNoProviderResponse({ error: mapped })).toBe(false);
  });

  it("reads a code through a cause chain that loops back on itself without spinning", () => {
    const outer: Error & { cause?: unknown } = new Error("outer");
    const inner = Object.assign(new Error("inner"), { cause: outer, code: "UND_ERR_CONNECT_TIMEOUT" });
    outer.cause = inner;
    const mapped = toIngestError({ error: outer, operation: "github.pulls.create", provider: "github" });
    expect(mapped.kind).toBe("network");
    expect(mapped.code).toBe("UND_ERR_CONNECT_TIMEOUT");
  });

  it("maps the Notion SDK's own request timeout to a network error that got no response", () => {
    const thrown = new RequestTimeoutError();
    const mapped = toIngestError({ error: thrown, operation: "notion.search", provider: "notion" });
    expect(mapped.kind).toBe("network");
    expect(mapped.cause).toBe(thrown);
    expect(mapped.code).toBe("notionhq_client_request_timeout");
    expect(mapped.status).toBeUndefined();
    expect(mapped.message).toBe("Request to Notion API has timed out");
    expect(hadNoProviderResponse({ error: mapped })).toBe(true);
  });

  it("keeps the Notion SDK's timeout code an http failure on another provider's call", () => {
    // `network` licenses GitHub enqueue's witness-gated resend, so another SDK's code must not reach it.
    const thrown = Object.assign(new Error("timeout"), { code: "notionhq_client_request_timeout" });
    const mapped = toIngestError({ error: thrown, operation: "github.enqueuePullRequest", provider: "github" });
    expect(mapped.kind).toBe("http");
    expect(hadNoProviderResponse({ error: mapped })).toBe(false);
  });

  it("maps a `fetch failed` message to a network error", () => {
    const mapped = toIngestError({
      error: new Error("fetch failed"),
      operation: "linear.projects",
      provider: "linear",
    });
    expect(mapped.kind).toBe("network");
  });

  it("maps a JSON SyntaxError to a parse error under the parse default kind", () => {
    const thrown = new SyntaxError("Unexpected token < in JSON at position 0");
    const mapped = toIngestError({ defaultKind: "parse", error: thrown, operation: "envelopeToMessage" });
    expect(mapped.kind).toBe("parse");
    expect(mapped.message).toBe("Unexpected token < in JSON at position 0");
    expect(mapped.provider).toBeUndefined();
    expect(mapped.cause).toBe(thrown);
  });

  it("maps an ENOENT to an io error carrying the code and path", () => {
    const thrown = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
    const mapped = toIngestError({ defaultKind: "io", error: thrown, operation: "readJsonFile", path: "/tmp/x.json" });
    expect(mapped.kind).toBe("io");
    expect(mapped.code).toBe("ENOENT");
    expect(mapped.path).toBe("/tmp/x.json");
  });

  it("maps a `codex` timeout to an llm error", () => {
    const mapped = toIngestError({
      defaultKind: "llm",
      error: new Error("codex CLI timed out"),
      operation: "codex.turn",
      provider: "codex",
    });
    expect(mapped.kind).toBe("llm");
    expect(mapped.provider).toBe("codex");
    expect(mapped.status).toBeUndefined();
  });

  it("falls back to a readable message for a non-Error thrown value", () => {
    expect(toIngestError({ error: "raw string failure", operation: "x" }).message).toBe("raw string failure");
    expect(toIngestError({ error: undefined, operation: "x" }).message).toBe("unknown error");
  });

  it("names the status and GitHub's request id when a provider answered with an empty body", () => {
    const thrown = new EmptyBodyHttpError({ headers: { "x-github-request-id": "0123:ABCD" }, status: 500 });
    const mapped = toIngestError({ error: thrown, operation: "github.pulls.create", provider: "github" });
    expect(mapped.kind).toBe("http");
    expect(mapped.status).toBe(500);
    expect(mapped.cause).toBe(thrown);
    expect(mapped.message).toBe("HTTP 500 with no error message from the provider (GitHub request ID: 0123:ABCD)");
    expect(formatIngestError({ error: mapped })).toBe(
      "github github.pulls.create HTTP 500: HTTP 500 with no error message from the provider (GitHub request ID: 0123:ABCD)",
    );
  });

  it("names only the status when the response carries no GitHub request id, ignoring a generic one", () => {
    const thrown = new EmptyBodyHttpError({ headers: { "x-request-id": "generic-id" }, status: 500 });
    const mapped = toIngestError({ error: thrown, operation: "github.pulls.create", provider: "github" });
    expect(mapped.message).toBe("HTTP 500 with no error message from the provider");
  });

  it("finds a transport code beneath a wrapper's own non-transport code, and drops the wrapper's status", () => {
    const thrown = Object.assign(new EmptyBodyHttpError({ cause: { code: "UND_ERR_SOCKET" }, status: 500 }), {
      code: "WRAPPER_ERROR",
    });
    const mapped = toIngestError({ error: thrown, operation: "github.pulls.create", provider: "github" });
    expect(mapped.kind).toBe("network");
    expect(mapped.code).toBe("UND_ERR_SOCKET");
    expect(mapped.status).toBeUndefined();
    expect(mapped.message).toBe("Transport failure UND_ERR_SOCKET; no HTTP response was received");
  });

  it("keeps a 429 above a deeper transport code as a rate limit, since a 429 is an answer", () => {
    const thrown = Object.assign(new EmptyBodyHttpError({ cause: { code: "UND_ERR_SOCKET" }, status: 429 }), {
      retryAfter: 2,
    });
    const mapped = toIngestError({ error: thrown, operation: "github.pulls.create", provider: "github" });
    expect(mapped.kind).toBe("rate-limit");
    expect(mapped.status).toBe(429);
    expect(mapped.retryAfterMs).toBe(2000);
    expect(mapped.message).toBe("HTTP 429 with no error message from the provider");
  });

  it("keeps a rate-limit code above a deeper transport code as a rate limit", () => {
    const thrown = Object.assign(new Error("rate limited"), { cause: { code: "ECONNRESET" }, code: "ratelimited" });
    const mapped = toIngestError({ error: thrown, operation: "slack.chat.postMessage", provider: "slack" });
    expect(mapped.kind).toBe("rate-limit");
    expect(mapped.code).toBe("ratelimited");
    expect(mapped.message).toBe("rate limited");
  });

  it("names the status of a plain object thrown with no message", () => {
    const thrown = { status: 503 };
    const mapped = toIngestError({ error: thrown, operation: "linear.issues", provider: "linear" });
    expect(mapped.kind).toBe("http");
    expect(mapped.status).toBe(503);
    expect(mapped.cause).toBe(thrown);
    expect(mapped.message).toBe("HTTP 503 with no error message from the provider");
  });

  it("names the transport code, never the SDK's synthetic status, when an empty-message failure never got a reply", () => {
    // `@octokit/request` stamps a synthetic 500 on a `fetch` rejection; undici's real code sits on the cause.
    const thrown = new EmptyBodyHttpError({ cause: { code: "UND_ERR_SOCKET" }, status: 500 });
    const mapped = toIngestError({ error: thrown, operation: "github.pulls.create", provider: "github" });
    expect(mapped.kind).toBe("network");
    expect(mapped.code).toBe("UND_ERR_SOCKET");
    expect(mapped.status).toBeUndefined();
    expect(mapped.message).toBe("Transport failure UND_ERR_SOCKET; no HTTP response was received");
  });
});

describe("accessors + formatting", () => {
  const error: IngestError = {
    cause: new Error("boom"),
    code: "ratelimited",
    kind: "rate-limit",
    message: "rate limited",
    operation: "slack.conversations.history",
    provider: "slack",
    status: 429,
  };

  it("reads status and code off the typed error", () => {
    expect(errorStatus({ error })).toBe(429);
    expect(errorCode({ error })).toBe("ratelimited");
  });

  it("classifies a transient status", () => {
    expect(hasTransientStatus({ error })).toBe(true);
    expect(hasTransientStatus({ error: { ...error, kind: "http", status: 404 } })).toBe(false);
    expect(hasTransientStatus({ error: { kind: "io", message: "m", operation: "o" } })).toBe(false);
  });

  it("formats a typed error into a single labelled line", () => {
    expect(formatIngestError({ error })).toBe("slack slack.conversations.history HTTP 429 ratelimited: rate limited");
  });

  it("formats an error without provider/status using the kind and no status segment", () => {
    expect(formatIngestError({ error: { kind: "parse", message: "bad json", operation: "parseEnvelope" } })).toBe(
      "parse parseEnvelope: bad json",
    );
  });
});

describe("ingestErrorToThrowable", () => {
  it("returns the original cause verbatim when it is already an Error", () => {
    const cause = new Error("socket hang up");
    const typed = toIngestError({ error: cause, operation: "slack.auth.test", provider: "slack" });
    expect(ingestErrorToThrowable({ error: typed })).toBe(cause); // identity — message assertions stay exact
  });

  it("synthesises an Error carrying status/code when the cause is a non-Error throw", () => {
    // A plain object throw (no Error prototype) still carries a retryable 429 signal.
    const typed = toIngestError({ error: { code: "ratelimited", status: 429 }, operation: "linear.rawRequest" });
    const thrown = ingestErrorToThrowable({ error: typed });
    // The re-mapped throwable must still classify as a transient rate-limit (status/code survived the round-trip).
    const remapped = toIngestError({ error: thrown, operation: "retry" });
    expect(remapped.kind).toBe("rate-limit");
    expect(remapped.status).toBe(429);
    expect(remapped.code).toBe("ratelimited");
  });
});
