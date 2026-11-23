/*
 * `--allow-unresolved-owner` on the as-me lane: refused by name with the reason, while the card lane still takes it.
 */
import { describe, expect, it } from "vitest";

import { slackArgumentErrorLines } from "../../../../../../cli/commands/slack/argumentErrors.js";
import { parseSlackWriteArgs } from "../../../../../../cli/commands/slack/core.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { args, cardArm } from "./harness.js";

/**
 * The break-glass belongs to the CARD lane only.
 *
 * It sits in the shared `FLAG_SPEC` because the parser is shared, which meant it PARSED on the as-me lane and
 * did nothing at all — accepted but never consulted, at exit 0. Found by an adversarial review of the very
 * property the flag was added to satisfy. This lane's rule is to refuse a foreign flag BY NAME.
 */
describe("the unresolved-owner break-glass is refused on the as-me lane", () => {
  function meArgs({ extra = [] }: { extra?: readonly string[] } = {}): readonly string[] {
    return ["--as", "me", "--channel", "C1", "--shape", "top-level", "--body", "hi", ...extra];
  }

  it("parses the as-me lane cleanly without the flag", () => {
    expect(parseSlackWriteArgs({ defaultHome: "/h", rest: meArgs(), verb: "post" }).isOk()).toBe(true);
  });

  it("REFUSES the flag rather than accepting and ignoring it", () => {
    const rest = meArgs({ extra: ["--allow-unresolved-owner"] });

    expect(
      slackArgumentErrorLines({ error: unwrapErr(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "post" })) }),
    ).toEqual([
      "--allow-unresolved-owner is not valid with `--as me`: it governs a DIGEST's owner ping, and the as-me " +
        "lane has no card, no digest form and no owner field. A mention in a drip that does not resolve " +
        "already refuses the send outright, and there is deliberately no override for that.",
    ]);
  });

  it("says WHY, naming the lane and that a drip has no owner field", () => {
    const rest = meArgs({ extra: ["--allow-unresolved-owner"] });
    const errors = slackArgumentErrorLines({
      error: unwrapErr(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "post" })),
    }).join(" ");

    expect(errors).toContain("is not valid with `--as me`");
    expect(errors).toContain("no owner field");
  });

  it("still accepts it on the CARD lane, so the refusal is lane-specific and not a blanket ban", () => {
    const rest = args({ extra: ["--allow-unresolved-owner"] });
    const parsed = unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest, verb: "post" }));

    expect(cardArm(parsed).allowUnresolvedOwner).toBe(true);
  });
});
