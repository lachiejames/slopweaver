/** The owner-judgement half of `turn brief`: an empty authority reads empty, an unreadable one refuses. */
import { describe, expect, it } from "vitest";

import {
  ownerDirectiveRefusal,
  ownerDirectivesForBrief,
} from "../../../../../cli/commands/turn/briefOwnerJudgement.js";
import { ownerJudgementFake } from "../../../../ownerJudgementFixture.js";

/** The fake reads no file, so the home is only a name the port passes to its seams. */
const HOME = "/acme/home";

describe("ownerDirectivesForBrief", () => {
  it("reads an empty authority as no directives, never a refusal", async () => {
    const fake = ownerJudgementFake();

    expect(await ownerDirectivesForBrief({ home: HOME, port: fake.port })).toEqual({
      directives: [],
      kind: "directives",
    });
  });

  it("refuses with the port's own account of an outage", async () => {
    const fake = ownerJudgementFake({ connection: "unavailable" });

    expect(await ownerDirectivesForBrief({ home: HOME, port: fake.port })).toEqual({
      kind: "refusal",
      message: ownerDirectiveRefusal({
        why: "the store could not be opened for owner directives: connection refused",
      }),
    });
  });

  it("opens the refusal on what failed and names the way out", () => {
    const message = ownerDirectiveRefusal({ why: "acme-db is down" });

    expect(
      message.startsWith("turn brief REFUSES: the owner's directives and corrections in the store could not"),
    ).toBe(true);
    expect(message).toContain("— acme-db is down. ");
    expect(message).toContain("Restore the store, then re-run");
  });
});
