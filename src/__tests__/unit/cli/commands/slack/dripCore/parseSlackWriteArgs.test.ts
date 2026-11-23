/*
 * `parseSlackWriteArgs` on the as-me lane: `--shape` required on a post and refused on a reply, `--form` or
 * `--body` exactly once, `--media` split in the caller's order, `--resend-unconfirmed` carried, and every
 * rejection reported in one pass.
 */
import { describe, expect, it } from "vitest";

import { slackArgumentErrorLines } from "../../../../../../cli/commands/slack/argumentErrors.js";
import {
  isDraftRelease,
  parseSlackWriteArgs,
  type SlackDripOptions,
  type SlackWriteOptions,
} from "../../../../../../cli/commands/slack/core.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";

/** Narrow a parsed invocation to the AS-ME arm, loudly rather than by reading `undefined`. */
function dripArm(parsed: SlackWriteOptions): SlackDripOptions {
  if (parsed.actor !== "me") {
    throw new Error(`expected the drip arm, got --as ${parsed.actor}`);
  }
  if (isDraftRelease(parsed)) {
    throw new Error("expected the drip arm, got a --draft release");
  }
  return parsed;
}

describe("parseSlackWriteArgs — the as-me lane", () => {
  const base = ["--as", "me", "--channel", "C1", "--form", "-"];

  it("parses a complete as-me post", () => {
    const parsed = dripArm(
      unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest: [...base, "--shape", "top-level"], verb: "post" })),
    );

    expect(parsed.actor).toBe("me");
    expect(parsed.shape).toBe("top-level");
    expect(parsed.source).toEqual({ json: "-", kind: "form" });
    expect(parsed.resendUnconfirmed).toBe(false);
  });

  it("REQUIRES --shape, because the right answer depends on the conversation", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(parseSlackWriteArgs({ defaultHome: "/h", rest: base, verb: "post" })),
    });

    expect(errors.some((error) => error.includes("--shape is required"))).toBe(true);
    expect(errors.some((error) => error.includes("deliberately NO default"))).toBe(true);
  });

  it("rejects a --shape that is neither top-level nor thread", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(
        parseSlackWriteArgs({ defaultHome: "/h", rest: [...base, "--shape", "sideways"], verb: "post" }),
      ),
    });

    expect(errors).toEqual(['--shape must be `top-level` or `thread` (got "sideways")']);
  });

  it("refuses --shape on a reply, where the thread is already named by --thread-ts", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(
        parseSlackWriteArgs({
          defaultHome: "/h",
          rest: [...base, "--thread-ts", "1.1", "--shape", "thread"],
          verb: "reply",
        }),
      ),
    });

    expect(errors.some((error) => error.includes("does not take --shape"))).toBe(true);
  });

  it("defaults a reply drip to the thread shape without being asked", () => {
    const parsed = dripArm(
      unwrap(parseSlackWriteArgs({ defaultHome: "/h", rest: [...base, "--thread-ts", "1.1"], verb: "reply" })),
    );

    expect(parsed.shape).toBe("thread");
    expect(parsed.threadTs).toBe("1.1");
  });

  it("takes --body as the escape hatch", () => {
    const parsed = dripArm(
      unwrap(
        parseSlackWriteArgs({
          defaultHome: "/h",
          rest: ["--as", "me", "--channel", "C1", "--body", "just this", "--shape", "top-level"],
          verb: "post",
        }),
      ),
    );

    expect(parsed.source).toEqual({ kind: "body", text: "just this" });
  });

  it("refuses --form and --body together", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(
        parseSlackWriteArgs({
          defaultHome: "/h",
          rest: [...base, "--body", "x", "--shape", "top-level"],
          verb: "post",
        }),
      ),
    });

    expect(errors.some((error) => error.includes("not both"))).toBe(true);
  });

  it("requires one of --form or --body", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(
        parseSlackWriteArgs({
          defaultHome: "/h",
          rest: ["--as", "me", "--channel", "C1", "--shape", "top-level"],
          verb: "post",
        }),
      ),
    });

    expect(errors.some((error) => error.includes("--form or --body is required"))).toBe(true);
  });

  it("accepts --media, splitting on commas and preserving the caller's order", () => {
    const parsed = unwrap(
      parseSlackWriteArgs({
        defaultHome: "/h",
        rest: [...base, "--shape", "top-level", "--media", "b.png, a.png ,c.png"],
        verb: "post",
      }),
    );

    expect(dripArm(parsed).media).toEqual(["b.png", "a.png", "c.png"]);
  });

  it("leaves media EMPTY when --media is absent, so an as-me post attaches nothing by default", () => {
    const parsed = unwrap(
      parseSlackWriteArgs({ defaultHome: "/h", rest: [...base, "--shape", "top-level"], verb: "post" }),
    );

    expect(dripArm(parsed).media).toEqual([]);
  });

  it("refuses --shape and --body on the BOT lane, where neither means anything", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(
        parseSlackWriteArgs({
          defaultHome: "/h",
          rest: ["--as", "bot", "--channel", "C1", "--form", "-", "--shape", "thread", "--body", "x"],
          verb: "post",
        }),
      ),
    });

    expect(errors).toEqual(["--shape is not valid with `--as bot`", "--body is not valid with `--as bot`"]);
  });

  it("carries --resend-unconfirmed through as an explicit opt-in", () => {
    const parsed = dripArm(
      unwrap(
        parseSlackWriteArgs({
          defaultHome: "/h",
          rest: [...base, "--shape", "top-level", "--resend-unconfirmed"],
          verb: "post",
        }),
      ),
    );

    expect(parsed.resendUnconfirmed).toBe(true);
  });

  it("reports every rejection in one pass", () => {
    const errors = slackArgumentErrorLines({
      error: unwrapErr(parseSlackWriteArgs({ defaultHome: "/h", rest: ["--as", "me"], verb: "post" })),
    });

    expect(errors.some((error) => error.includes("--channel is required"))).toBe(true);
    expect(errors.some((error) => error.includes("--form or --body"))).toBe(true);
    expect(errors.some((error) => error.includes("--shape is required"))).toBe(true);
  });
});
