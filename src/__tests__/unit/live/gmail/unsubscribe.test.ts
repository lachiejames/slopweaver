/**
 * Unit: RFC 8058 one-click — reading a sender's published targets, judging the promise, and judging the answer.
 * The two header shapes are the two measured on the owner's inbox: a BARE https target (Linear) and none
 * at all (incident.io). The token values below are synthetic.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IngestError } from "../../../../lib/ingestError.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailMessage } from "../../../../live/gmail/parse.js";
import {
  describeOneClickTarget,
  GmailUnsubscribeErrors,
  listUnsubscribeTargets,
  ONE_CLICK_BODY,
  type OneClickPost,
  oneClickPoster,
  oneClickTarget,
  performOneClick,
  promisesOneClick,
} from "../../../../live/gmail/unsubscribe.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const LINEAR_TARGET = "https://linear.app/api/unsubscribe?token=synthetic-token&userId=u-1&type=unread";

/** The synthetic private person term the poster cases judge under. */
const QUILLFEATHER = ["person\ti\tquillfeather\tsynthetic"];

function messageWith({ headers }: { headers: readonly { name: string; value: string }[] }): GmailMessage {
  return { id: "m-1", payload: { headers: [{ name: "From", value: "Sender <a@example.test>" }, ...headers] } };
}

describe("listUnsubscribeTargets", () => {
  it("reads a bare https target, the shape Linear sends", () => {
    expect(listUnsubscribeTargets({ value: LINEAR_TARGET })).toStrictEqual({ https: [LINEAR_TARGET], mailto: [] });
  });

  it("reads bracketed targets in order, keeping a comma inside a URL whole", () => {
    const value = "<mailto:u@example.test?subject=stop>, <https://example.test/u?a=1,2>";
    expect(listUnsubscribeTargets({ value })).toStrictEqual({
      https: ["https://example.test/u?a=1,2"],
      mailto: ["mailto:u@example.test?subject=stop"],
    });
  });

  it("drops a plain-http target and anything that is neither scheme", () => {
    expect(listUnsubscribeTargets({ value: "<http://example.test/u>, <ftp://x>" })).toStrictEqual({
      https: [],
      mailto: [],
    });
  });

  it("stops at an unclosed bracket rather than reading past it", () => {
    expect(listUnsubscribeTargets({ value: "<https://example.test/u" })).toStrictEqual({ https: [], mailto: [] });
  });
});

describe("promisesOneClick", () => {
  it("is true for the exact RFC 8058 field, whatever its case and surrounding space", () => {
    expect(promisesOneClick({ value: "  list-unsubscribe=one-click " })).toBe(true);
  });

  it("is false when the header is absent", () => {
    expect(promisesOneClick({ value: undefined })).toBe(false);
  });

  it("is false for any other value", () => {
    expect(promisesOneClick({ value: "List-Unsubscribe=Yes" })).toBe(false);
  });
});

describe("oneClickTarget", () => {
  it("returns the bare https target when the sender promised one-click", () => {
    const message = messageWith({
      headers: [
        { name: "List-Unsubscribe", value: LINEAR_TARGET },
        { name: "List-Unsubscribe-Post", value: ONE_CLICK_BODY },
      ],
    });
    const target = oneClickTarget({ message });
    expect(target.isOk()).toBe(true);
    expect(unwrap(target).href).toBe(LINEAR_TARGET);
  });

  it("refuses a sender with no List-Unsubscribe as offering none", () => {
    const target = oneClickTarget({ message: messageWith({ headers: [] }) });
    expect(unwrapErr(target)).toStrictEqual(GmailUnsubscribeErrors.noOneClick({ offered: "none" }));
  });

  it("refuses an https target without the one-click promise as a link", () => {
    const target = oneClickTarget({
      message: messageWith({ headers: [{ name: "List-Unsubscribe", value: LINEAR_TARGET }] }),
    });
    expect(unwrapErr(target).offered).toBe("link");
  });

  it("refuses a mailto-only sender as mailto, even with the promise header", () => {
    const message = messageWith({
      headers: [
        { name: "List-Unsubscribe", value: "<mailto:u@example.test>" },
        { name: "List-Unsubscribe-Post", value: ONE_CLICK_BODY },
      ],
    });
    expect(unwrapErr(oneClickTarget({ message })).offered).toBe("mailto");
  });

  it("names what the sender offers in the refusal message", () => {
    const target = oneClickTarget({ message: messageWith({ headers: [] }) });
    expect(unwrapErr(target).message).toBe(
      "this sender publishes no RFC 8058 one-click unsubscribe — it offers no List-Unsubscribe at all, so its own settings page is the way out; nothing was sent",
    );
  });
});

describe("describeOneClickTarget", () => {
  it("prints the origin and only COUNTS what follows it, for a token carried in the query", () => {
    const described = describeOneClickTarget({ url: new URL(LINEAR_TARGET) });
    expect(LINEAR_TARGET).toContain("synthetic-token");
    expect(described).toBe("https://linear.app (2 path segment(s) and 3 query parameter(s) withheld)");
  });

  it("withholds a token carried in the PATH", () => {
    const target = "https://mail.example.test/unsubscribe/oc/synthetic-path-token";
    expect(describeOneClickTarget({ url: new URL(target) })).toBe(
      "https://mail.example.test (3 path segment(s) and 0 query parameter(s) withheld)",
    );
  });

  it("withholds a token carried as a bare query KEY, and any userinfo", () => {
    const target = "https://user:secret@mail.example.test/u?synthetic-key-token";
    expect(describeOneClickTarget({ url: new URL(target) })).toBe(
      "https://mail.example.test (1 path segment(s) and 1 query parameter(s) withheld)",
    );
  });
});

describe("performOneClick", () => {
  const url = new URL(LINEAR_TARGET);
  /** A home no fake seam below ever reads; only its arrival at the POST is asserted. */
  const home = "/synthetic/verb-home";

  it("POSTs exactly the RFC 8058 body to the target under the verb's home and counts a 2xx as success", async () => {
    const sent: { url: string; body: string; home: string }[] = [];
    const outcome = await performOneClick({
      home,
      post: async ({ url: to, body, home: judgedUnder }) => {
        sent.push({ body, home: judgedUnder, url: to.href });
        return ok({ status: 202 });
      },
      url,
    });
    expect(sent).toStrictEqual([{ body: "List-Unsubscribe=One-Click", home, url: LINEAR_TARGET }]);
    expect(unwrap(outcome)).toStrictEqual({ status: 202 });
  });

  it("refuses a non-2xx answer as POST_REJECTED, carrying the status", async () => {
    const outcome = await performOneClick({ home, post: async () => ok({ status: 302 }), url });
    expect(unwrapErr(outcome).code).toBe("POST_REJECTED");
    expect(unwrapErr(outcome).message).toBe(
      "the sender answered the one-click POST with HTTP 302, not success — it may not have unsubscribed",
    );
  });

  it("carries a transport failure as POST_FAILED", async () => {
    const cause: IngestError = {
      kind: "network",
      message: "getaddrinfo ENOTFOUND linear.app",
      operation: "mail-sender.unsubscribe.one-click",
    };
    const outcome = await performOneClick({ home, post: async () => err(cause), url });
    expect(unwrapErr(outcome).code).toBe("POST_FAILED");
    expect(unwrapErr(outcome).message).toBe("the one-click POST got no answer: getaddrinfo ENOTFOUND linear.app");
  });

  it("does not read a failure merely SAYING it was refused as a refusal", async () => {
    const cause: IngestError = {
      cause: { message: "refused before sending" },
      kind: "http",
      message: "gmail unsubscribe one-click refused before sending: the outbound privacy check stopped it.",
      operation: "mail-sender.unsubscribe.one-click",
    };
    const outcome = await performOneClick({ home, post: async () => err(cause), url });
    expect(unwrapErr(outcome).code).toBe("POST_FAILED");
  });
});

describe("oneClickPoster, the production POST judged before its fetch", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const made of homes.splice(0)) {
      rmSync(made, { force: true, recursive: true });
    }
  });

  /** A throwaway home whose private-terms file holds `rows`, or none at all when `rows` is undefined. */
  function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
    const made = mkdtempSync(join(tmpdir(), "one-click-"));
    homes.push(made);
    if (rows !== undefined) {
      writePrivateTerms({ home: made, rows });
    }
    return made;
  }

  /** The poster over a counting `fetch` that answers 200 to everything it is handed. */
  function countingPoster(): { post: OneClickPost; sent: string[] } {
    const sent: string[] = [];
    const post = oneClickPoster({
      fetch: async (input) => {
        sent.push(input instanceof Request ? input.url : input.toString());
        return new Response(null, { status: 200 });
      },
    });
    return { post, sent };
  }

  it("refuses a target whose token carries a private term, and fetches nothing", async () => {
    const { post, sent } = countingPoster();
    const url = new URL("https://mail.example.test/unsubscribe/quillfeather-list?u=1");
    const outcome = await performOneClick({ home: homeWith({ rows: QUILLFEATHER }), post, url });
    expect(unwrapErr(outcome).code).toBe("POST_REFUSED");
    expect(unwrapErr(outcome).message).toContain("gmail unsubscribe one-click url line 1: a private person term");
    expect(unwrapErr(outcome).message).not.toMatch(/quillfeather/iu);
    expect(sent).toEqual([]);
  });

  it("refuses every POST when the home holds no private-terms file, and fetches nothing", async () => {
    const { post, sent } = countingPoster();
    const outcome = await performOneClick({ home: homeWith({ rows: undefined }), post, url: new URL(LINEAR_TARGET) });
    expect(unwrapErr(outcome).code).toBe("POST_REFUSED");
    expect(unwrapErr(outcome).message).toContain("does not exist");
    expect(sent).toEqual([]);
  });

  it("sends a clean target exactly once", async () => {
    const { post, sent } = countingPoster();
    const outcome = await performOneClick({
      home: homeWith({ rows: QUILLFEATHER }),
      post,
      url: new URL(LINEAR_TARGET),
    });
    expect(unwrap(outcome)).toStrictEqual({ status: 200 });
    expect(sent).toEqual([LINEAR_TARGET]);
  });
});
