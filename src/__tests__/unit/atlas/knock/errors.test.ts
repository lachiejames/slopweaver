import { describe, expect, it } from "vitest";

import { KnockAtlasErrors, knockAtlasErrorLines } from "../../../../atlas/knock/errors.js";

describe("KnockAtlasErrors", () => {
  it("quotes the probe's transport reason as the one line of an unreachable dashboard", () => {
    const error = KnockAtlasErrors.rootUnreachable({ detail: "net::ERR_NAME_NOT_RESOLVED" });
    expect(error).toEqual({
      code: "ROOT_UNREACHABLE",
      detail: "net::ERR_NAME_NOT_RESOLVED",
      message: "could not reach the Knock dashboard to learn its account root: net::ERR_NAME_NOT_RESOLVED",
    });
    expect(knockAtlasErrorLines({ error })).toEqual([
      "could not reach the Knock dashboard to learn its account root: net::ERR_NAME_NOT_RESOLVED",
    ]);
  });

  it("prints the sign-in wall as two lines and joins them for a one-line display", () => {
    const error = KnockAtlasErrors.signedOut();
    expect(error.code).toBe("SIGNED_OUT");
    expect(knockAtlasErrorLines({ error })).toEqual([
      "the Knock dashboard sent this browser to a sign-in wall, so no page could be walked",
      "sign in to the Knock dashboard in your own Chrome and run the walk again",
    ]);
    expect(error.message).toBe(
      "the Knock dashboard sent this browser to a sign-in wall, so no page could be walked; sign in to the Knock dashboard in your own Chrome and run the walk again",
    );
  });
});
