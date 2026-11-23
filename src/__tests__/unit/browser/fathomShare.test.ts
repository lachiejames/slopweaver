/**
 * Unit: the pure halves of the Fathom share transport — the one operation it asks the relay for, and how
 * the terminal client's output is decoded. The leased browser run itself is the relay's, and not re-proved
 * here.
 */
import { describe, expect, it } from "vitest";

import { decodeFathomShareOutput, FATHOM_SHARE_SETTLE_MS, fathomShareOperation } from "../../../browser/fathomShare.js";
import { relayOperationSnippet } from "../../../browser/relayDispatch.js";

const URL = "https://fathom.video/share/cPAstBybUhyaoL9wD_xuMQK_byssuMG_";

describe("fathomShareOperation", () => {
  it("is the fixed share-transcript arm on the given address with the measured settle", () => {
    expect(fathomShareOperation({ url: URL })).toEqual({
      kind: "fathom-share-transcript",
      settleMs: FATHOM_SHARE_SETTLE_MS,
      url: URL,
    });
    expect(FATHOM_SHARE_SETTLE_MS).toBe(4_000);
  });

  it("dispatches to a snippet that navigates to that address", () => {
    expect(relayOperationSnippet({ operation: fathomShareOperation({ url: URL }) })).toContain(
      `await page.goto(${JSON.stringify(URL)},`,
    );
  });
});

describe("decodeFathomShareOutput", () => {
  it("unwraps the client's doubly encoded result into the snippet's own object", () => {
    const inner = JSON.stringify({ finalUrl: URL, read: { present: false } });
    const stdout = JSON.stringify({ result: JSON.stringify(inner) });
    const decoded = decodeFathomShareOutput({ stdout });
    expect(decoded._unsafeUnwrap()).toEqual({ finalUrl: URL, read: { present: false } });
  });

  it("names a lost session when nothing parseable came home", () => {
    const decoded = decodeFathomShareOutput({ stdout: "Error: browser closed" });
    expect(decoded._unsafeUnwrapErr().code).toBe("SESSION_LOST");
    expect(decoded._unsafeUnwrapErr().message).toContain("the Fathom share read printed nothing");
  });
});
