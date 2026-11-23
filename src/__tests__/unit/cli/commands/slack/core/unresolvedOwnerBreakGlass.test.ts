/*
 * `parseSlackWriteArgs` and `--allow-unresolved-owner` on the card lane: off unless asked for, on when passed.
 */
import { describe, expect, it } from "vitest";

import { parseSlackWriteArgs } from "../../../../../../cli/commands/slack/core.js";
import { unwrap } from "../../../../../../lib/result.js";
import { args, cardArm } from "./harness.js";

describe("parseSlackWriteArgs — the unresolved-owner break-glass", () => {
  it("is OFF unless asked for, because a broken ping must not ship by default", () => {
    const parsed = unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest: args(), verb: "post" }));

    expect(parsed.actor).toBe("bot");
    expect(cardArm(parsed).allowUnresolvedOwner).toBe(false);
  });

  it("is ON when the flag is passed", () => {
    const rest = args({ extra: ["--allow-unresolved-owner"] });
    const parsed = unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "post" }));

    expect(cardArm(parsed).allowUnresolvedOwner).toBe(true);
  });
});
