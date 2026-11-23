/**
 * The Clerk atlas's typed failures: each factory's code and exact text, and the lines each one prints.
 *
 * Two properties beyond the text. A list-carrying variant prints one line per reason, because the CLI
 * iterates what the lines helper returns. And the failure to remember an instance root carries its cause and
 * nothing else — a valid root names the organisation's own application and instance.
 */
import { describe, expect, it } from "vitest";

import { ClerkAtlasErrors, clerkAtlasErrorLines } from "../../../../atlas/clerk/errors.js";

const PIN = { byteLength: 10, document: "fapi", sha256: "abc", url: "https://example.test/fapi.yml" } as const;

describe("ClerkAtlasErrors", () => {
  it("quotes the transport's message when the dashboard is unreachable", () => {
    const error = ClerkAtlasErrors.dashboardUnreachable({ detail: "the relay stopped answering" });
    expect(error.code).toBe("DASHBOARD_UNREACHABLE");
    expect(clerkAtlasErrorLines({ error })).toEqual([
      "could not reach the Clerk dashboard to learn its instance root: the relay stopped answering",
    ]);
  });

  it("prints the sign-in wall and its correction as two lines", () => {
    const error = ClerkAtlasErrors.signInWall();
    expect(error.code).toBe("SIGN_IN_WALL");
    expect(clerkAtlasErrorLines({ error })).toEqual([
      "the Clerk dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Clerk dashboard in your own Chrome and run the walk again",
    ]);
  });

  it("says the application list could not be reached either", () => {
    const error = ClerkAtlasErrors.applicationsUnreachable({ detail: "timed out" });
    expect(error.code).toBe("APPLICATIONS_UNREACHABLE");
    expect(error.message).toBe(
      "the Clerk dashboard did not send the bare origin to an instance, and the application list could not be reached either: timed out",
    );
  });

  it("quotes a malformed root and says what a root must read", () => {
    const error = ClerkAtlasErrors.rootMalformed({ root: "/apps/x" });
    expect(error.code).toBe("ROOT_MALFORMED");
    expect(error.message).toBe(
      '"/apps/x" is not a Clerk instance root — it must read /apps/<application>/instances/<instance>, exactly as the dashboard\'s own address does',
    );
  });

  it("carries only the cause when a root could not be remembered, never the root", () => {
    const error = ClerkAtlasErrors.rootUnremembered({ cause: new Error("EACCES: permission denied") });
    expect(error.code).toBe("ROOT_UNREMEMBERED");
    expect(error.message).toBe("the Clerk instance root could not be remembered: EACCES: permission denied");
    expect(Object.keys(error).toSorted()).toEqual(["cause", "code", "message"]);
  });

  it("names the untrustworthy remembered-root file and both ways out, never the root inside it", () => {
    const error = ClerkAtlasErrors.rememberedRootUnreadable({
      detail: "it is not JSON",
      path: "/h/instance-root.json",
    });
    expect(error.code).toBe("CLERK_REMEMBERED_ROOT_UNREADABLE");
    expect(clerkAtlasErrorLines({ error })).toEqual([
      "the remembered Clerk instance root at /h/instance-root.json is there but cannot be trusted (it is not JSON) — delete that file, or pass --root /apps/<application>/instances/<instance> to overwrite it",
    ]);
    expect(Object.keys(error).toSorted()).toEqual(["code", "detail", "message", "path"]);
  });

  it("names the document it could not parse", () => {
    const error = ClerkAtlasErrors.documentUnparseable({ cause: new Error("bad indentation"), document: "bapi" });
    expect(error.code).toBe("DOCUMENT_UNPARSEABLE");
    expect(error.message).toBe("the pinned Clerk bapi document could not be parsed: bad indentation");
  });

  it("names the document that is not a mapping", () => {
    const error = ClerkAtlasErrors.documentNotMapping({ document: "webhooks" });
    expect(error.code).toBe("DOCUMENT_NOT_MAPPING");
    expect(error.message).toBe("the pinned Clerk webhooks document is not a YAML mapping");
  });

  it("prints a digest mismatch and the immutable-commit reasoning as two lines", () => {
    const error = ClerkAtlasErrors.digestMismatch({ got: "def", pin: PIN });
    expect(error.code).toBe("DIGEST_MISMATCH");
    expect(clerkAtlasErrorLines({ error })).toEqual([
      "the pinned Clerk fapi document did not hash to its pin: got def, expected abc",
      "the pin addresses an immutable commit (https://example.test/fapi.yml), so a mismatch is a truncated or intercepted download rather than a vendor change — nothing was cached",
    ]);
  });

  it("names both byte lengths when the length disagrees", () => {
    const error = ClerkAtlasErrors.byteLengthMismatch({ byteLength: 9, pin: PIN });
    expect(error.code).toBe("BYTE_LENGTH_MISMATCH");
    expect(clerkAtlasErrorLines({ error })).toEqual(["the pinned Clerk fapi document is 9 bytes, expected 10"]);
  });

  it("prints the status and the fixed address as two lines", () => {
    const error = ClerkAtlasErrors.fetchRefused({ pin: PIN, status: 404 });
    expect(error.code).toBe("FETCH_REFUSED");
    expect(clerkAtlasErrorLines({ error })).toEqual([
      "fetching the pinned Clerk fapi document returned HTTP 404",
      "the address is fixed at https://example.test/fapi.yml and is not configurable",
    ]);
    expect(error.message).toBe(
      "fetching the pinned Clerk fapi document returned HTTP 404; the address is fixed at https://example.test/fapi.yml and is not configurable",
    );
  });

  it("quotes the failure when a fetch throws", () => {
    const error = ClerkAtlasErrors.fetchFailed({ cause: new Error("ECONNRESET"), pin: PIN });
    expect(error.code).toBe("FETCH_FAILED");
    expect(error.message).toBe("fetching the pinned Clerk fapi document failed: ECONNRESET");
  });

  it("names the path a document could not be cached at", () => {
    const error = ClerkAtlasErrors.cacheUnwritable({
      cause: new Error("ENOSPC"),
      path: "/tmp/spec/fapi.yml",
      pin: PIN,
    });
    expect(error.code).toBe("CACHE_UNWRITABLE");
    expect(error.message).toBe("the pinned Clerk fapi document could not be cached at /tmp/spec/fapi.yml: ENOSPC");
  });
});
