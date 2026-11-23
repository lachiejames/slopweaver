import { describe, expect, it } from "vitest";

import { TalkErrors } from "../../../talk/errors.js";
import { RelayDraftErrors } from "../../../talk/relayDraftErrors.js";

describe("RelayDraftErrors", () => {
  it("is reached through TalkErrors, factory for factory, so a caller of the domain needs no second import", () => {
    const names = Object.keys(RelayDraftErrors);
    expect(names.length).toBeGreaterThan(0);
    expect(
      names.filter(
        (name) =>
          !Object.is(
            TalkErrors[name as keyof typeof TalkErrors],
            RelayDraftErrors[name as keyof typeof RelayDraftErrors],
          ),
      ),
    ).toEqual([]);
  });

  it("names the measured bytes, the cap and the words-alone way through when a relay's summary is over the cap", () => {
    const failure = RelayDraftErrors.askOverCap({ bytes: 9001, cap: 8000 });
    expect(failure.code).toBe("ASK_OVER_CAP");
    expect(failure.bytes).toBe(9001);
    expect(failure.message).toBe(
      "the relay's board row would carry a 9001-byte summary, over the 8000-byte cap handover start holds a row to, " +
        "with as little of the owner's words quoted as a row can carry — the voice's reading is what does not fit; the owner's words " +
        "alone (--words-alone) always do, the row quoting as many of them as fit",
    );
  });
});
