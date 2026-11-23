/*
 * `hand post`'s flags read into a draft: `--shot` and `--box` pair or refuse, and the picture rides the draft only
 * when one was passed — the half of the verb that reads argv and touches nothing.
 */
import { describe, expect, it } from "vitest";

import { HandPostArgsErrors } from "../../../../../cli/commands/hand/postArgsErrors.js";
import { handPostDraft } from "../../../../../cli/commands/hand/postInputs.js";
import { shotDraftOf, shotFlagsOf } from "../../../../../cli/commands/hand/postPicture.js";
import { unwrap } from "../../../../../lib/result.js";

const FIELDS = {
  id: "linear-token",
  unblocks: "the Linear sync",
  what: "Paste the Linear key",
  witness: "secrets status",
};
const SHOT = {
  boxes: [{ height: 40, label: "New API key", width: 120, x: 10, y: 20 }],
  height: 900,
  sha256: "a".repeat(64),
  width: 1440,
};

describe("shotFlagsOf", () => {
  it("answers nothing when neither flag was passed", () => {
    expect(unwrap(shotFlagsOf({ rest: [], values: {} }))).toBeUndefined();
  });

  it("pairs the picture with every --box, in the order typed", () => {
    const rest = ["--shot", "/tmp/page.png", "--box", "1,2,3,4=one", "--box", "5,6,7,8=two"];
    expect(unwrap(shotFlagsOf({ rest, values: { shot: "/tmp/page.png" } }))).toEqual({
      boxes: ["1,2,3,4=one", "5,6,7,8=two"],
      path: "/tmp/page.png",
    });
  });

  it.each([
    ["a picture with no box", ["--shot", "/tmp/page.png"], { shot: "/tmp/page.png" }, true],
    ["a box with no picture", ["--box", "1,2,3,4=one"], {}, false],
  ])("refuses %s", (_name, rest, values, hasShot) => {
    expect(shotFlagsOf({ rest, values })._unsafeUnwrapErr()).toEqual(HandPostArgsErrors.shotUnpaired({ hasShot }));
  });
});

describe("shotDraftOf", () => {
  it("reads nothing for a step without a picture", () => {
    expect(unwrap(shotDraftOf({ shot: undefined }))).toBeUndefined();
  });
});

describe("handPostDraft", () => {
  it("carries the picture only when one was passed", () => {
    const withShot = handPostDraft({
      fields: FIELDS,
      nowIso: "2026-10-03T00:00:00.000Z",
      shot: SHOT,
      url: undefined,
      values: {},
    });
    const without = handPostDraft({
      fields: FIELDS,
      nowIso: "2026-10-03T00:00:00.000Z",
      shot: undefined,
      url: undefined,
      values: {},
    });
    expect(withShot.shot).toEqual(SHOT);
    expect(Object.keys(without).includes("shot")).toBe(false);
    expect(without.postedIso).toBe("2026-10-03T00:00:00.000Z");
  });
});
