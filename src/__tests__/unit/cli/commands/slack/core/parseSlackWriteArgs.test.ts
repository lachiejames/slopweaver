/*
 * `parseSlackWriteArgs`: the `slack post|reply` invocation parse — the required `--as`, `--channel` and
 * `--thread-ts`, the lane `--as` routes to, `--media` order, and every rejection reported in one pass.
 */
import { describe, expect, it } from "vitest";

import { slackArgumentErrorLines } from "../../../../../../cli/commands/slack/argumentErrors.js";
import { parseSlackWriteArgs } from "../../../../../../cli/commands/slack/core.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { args, cardArm, VALID_FORM } from "./harness.js";

describe("parseSlackWriteArgs", () => {
  it("parses a complete post invocation", () => {
    const parsed = parseSlackWriteArgs({ defaultHome: "/home", rest: args(), verb: "post" });

    const options = unwrap(parsed);
    expect(options.actor).toBe("bot");
    expect(cardArm(options).channel).toBe("C1");
    expect(options.dryRun).toBe(false);
    expect(options.home).toBe("/home");
    expect(cardArm(options).media).toEqual([]);
  });

  it("requires --as, with no default that could post under the wrong name", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: "/home",
      rest: ["--channel", "C1", "--form", VALID_FORM],
      verb: "post",
    });

    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })).toContain(
      "--as is required: pass `--as bot` (a schema-enforced card) or `--as me` (a freeform drip)",
    );
  });

  it("ROUTES --as me to the drip lane rather than rendering a bot card over a human's name", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: "/home",
      rest: ["--as", "me", "--channel", "C1", "--form", VALID_FORM, "--shape", "top-level"],
      verb: "post",
    });

    const options = unwrap(parsed);
    expect(options.actor).toBe("me");
    // The card arm is genuinely unreachable from here — no `media`, no `formJson`, a `source` instead.
    expect("source" in options ? options.source : undefined).toEqual({ json: VALID_FORM, kind: "form" });
  });

  it("rejects an --as that is neither bot nor me", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: "/home",
      rest: ["--as", "somebody", "--channel", "C1", "--form", VALID_FORM],
      verb: "post",
    });

    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })).toContain(
      '--as must be `bot` or `me` (got "somebody")',
    );
  });

  it("requires --channel", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: "/home",
      rest: ["--as", "bot", "--form", VALID_FORM],
      verb: "post",
    });

    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) })).toContain("--channel is required");
  });

  it("requires --thread-ts on a reply and forbids it on a post", () => {
    const reply = parseSlackWriteArgs({ defaultHome: "/home", rest: args(), verb: "reply" });
    const post = parseSlackWriteArgs({
      defaultHome: "/home",
      rest: args({ extra: ["--thread-ts", "1.2"] }),
      verb: "post",
    });

    expect(slackArgumentErrorLines({ error: unwrapErr(reply) })).toContain("`slack reply` requires --thread-ts");
    expect(slackArgumentErrorLines({ error: unwrapErr(post) })).toContain(
      "`slack post` does not take --thread-ts; use `slack reply`",
    );
  });

  it("splits --media on commas and preserves the caller's order", () => {
    const parsed = parseSlackWriteArgs({
      defaultHome: "/home",
      rest: args({ extra: ["--media", "b.pdf, a.png ,c.csv"] }),
      verb: "post",
    });

    expect(cardArm(unwrap(parsed)).media).toEqual(["b.pdf", "a.png", "c.csv"]);
  });

  it("reports EVERY rejection in one pass rather than stopping at the first", () => {
    const parsed = parseSlackWriteArgs({ defaultHome: "/home", rest: [], verb: "reply" });

    // Without an --as there is no lane, so only the lane-independent rejections are knowable: the missing
    // --as itself, the missing --channel, and the reply's missing --thread-ts.
    expect(unwrapErr(parsed).code).toBe("ARGUMENTS_REFUSED");
    expect(slackArgumentErrorLines({ error: unwrapErr(parsed) }).length).toBe(3);
  });
});
