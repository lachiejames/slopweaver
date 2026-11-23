/**
 * The `chatgpt` error factory: each variant's code, and the messages that tell the owner what to do next.
 */
import { describe, expect, it } from "vitest";

import { ChatgptErrors } from "../../../../../cli/commands/chatgpt/errors.js";

describe("ChatgptErrors", () => {
  it("tells an expired session to paste a fresh request", () => {
    const error = ChatgptErrors.httpRefused({ path: "/backend-api/conversations/x", status: 401 });
    expect(error.code).toBe("HTTP_REFUSED");
    expect(error.status).toBe(401);
    expect(error.message).toBe(
      "GET /backend-api/conversations/x answered HTTP 401 — the pasted session has expired or been refused; paste a fresh request and run chatgpt import-request again",
    );
  });

  it("names a plain server failure without the session advice", () => {
    expect(ChatgptErrors.httpRefused({ path: "/p", status: 500 }).message).toBe("GET /p answered HTTP 500");
  });

  it("names the page bound in its refusal", () => {
    const error = ChatgptErrors.pageBoundExceeded({ maxPages: 3 });
    expect(error.code).toBe("PAGE_BOUND_EXCEEDED");
    expect(error.message).toContain("past 3 pages; nothing was written");
  });

  it("points an absent session at import-request", () => {
    const error = ChatgptErrors.sessionAbsent({ path: "/h/secrets/chatgpt-web-session.json" });
    expect(error.code).toBe("SESSION_ABSENT");
    expect(error.message).toContain("run slopweaver chatgpt import-request --from");
  });

  it("names a challenge page as not JSON", () => {
    expect(ChatgptErrors.notJson({ contentType: "text/html", path: "/p" }).message).toContain(
      "answered text/html instead of JSON",
    );
  });
});
