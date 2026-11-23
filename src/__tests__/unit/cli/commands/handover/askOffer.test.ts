import { describe, expect, it } from "vitest";

import { type AskOfferVerdict, askOfferVerdict } from "../../../../../cli/commands/handover/askOffer.js";
import type { ParsedFlags } from "../../../../../cli/parseFlags.js";
import type { AskAction } from "../../../../../handover/askAction.js";
import { HOLD_OPTION } from "../../../../../handover/askActionOptions.js";
import type { AskOption } from "../../../../../handover/askShape.js";

const COMMAND = "slopweaver handover offer";

/** An action offering the two places tick 363 named. */
const WHOLE: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
    {
      conversation: "D01ARI",
      kind: "dm",
      label: "DM Ari",
      recipients: [{ label: "Ari", userId: "U01ARI" }],
      tradeoff: "only Ari sees it, so nobody else can pick it up",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

/** The shape flags an offered ask always carries beside its action. */
const SHAPE = {
  lean: "take A, because #delivery is where a review actually gets picked up",
  problem: "the E2E switch-over has sat unreviewed for four days",
  risk: "the review lapses another week",
  "blast-radius": "one PR and whoever reviews it",
  "still-real": "the PR is still open with no review on it",
};

const flags = ({ values }: { values: Readonly<Record<string, string>> }): ParsedFlags => ({
  positionals: [],
  values,
});

/** stdin, never reached by any case here. */
const NO_STDIN = (): string => {
  throw new Error("stdin was read when no spelling named it");
};

/** The lines a refusal carried, throwing when the verdict was not one. */
function refusal({ verdict }: { verdict: AskOfferVerdict }): readonly string[] {
  if (verdict.kind !== "refused") {
    throw new Error("expected a refusal");
  }
  return verdict.lines;
}

/** The shape a recordable verdict carries, throwing when it carries none — so no assertion needs a `?.`. */
function shapeOf({ verdict }: { verdict: AskOfferVerdict }): { readonly options: readonly AskOption[] } {
  const shape = recordable({ verdict }).shape;
  if (shape === undefined) {
    throw new Error("expected a shape");
  }
  return shape;
}

/** The recordable verdict, throwing when it refused. */
function recordable({ verdict }: { verdict: AskOfferVerdict }): Extract<AskOfferVerdict, { kind: "ok" }> {
  if (verdict.kind !== "ok") {
    throw new Error(`expected ok, got ${verdict.lines.join(" ")}`);
  }
  return verdict;
}

describe("askOfferVerdict", () => {
  it("derives the options off the destinations, with HOLD last", () => {
    const verdict = recordable({
      verdict: askOfferVerdict({
        command: COMMAND,
        parsed: flags({ values: { ...SHAPE, action: JSON.stringify(WHOLE) } }),
        required: true,
        stdin: NO_STDIN,
      }),
    });
    expect(verdict.action).toEqual(WHOLE);
    expect(shapeOf({ verdict }).options).toEqual([
      { letter: "A", option: "Post it to #delivery", tradeoff: "the whole channel sees we are asking" },
      { letter: "B", option: "DM Ari", tradeoff: "only Ari sees it, so nobody else can pick it up" },
      { letter: "C", option: HOLD_OPTION.option, tradeoff: HOLD_OPTION.tradeoff },
    ]);
  });

  it("refuses --options beside --action, because the options ARE the destinations", () => {
    const lines = refusal({
      verdict: askOfferVerdict({
        command: COMMAND,
        parsed: flags({
          values: { ...SHAPE, action: JSON.stringify(WHOLE), options: "post it :: everyone sees it" },
        }),
        required: true,
        stdin: NO_STDIN,
      }),
    });
    expect(lines[0]).toContain("--options AND --action");
    expect(lines[1]).toBe("Drop --options: one is derived per destination, in order, with HOLD last.");
    expect(lines[2]).toBe(
      "NOTHING was recorded and the run is not paused, so drop the flag and run the same command again.",
    );
  });

  it("carries an action refusal through whole, rather than restating it", () => {
    const lines = refusal({
      verdict: askOfferVerdict({
        command: COMMAND,
        parsed: flags({ values: { ...SHAPE, action: "{nope" } }),
        required: true,
        stdin: NO_STDIN,
      }),
    });
    expect(lines[0]).toContain("--action is not JSON");
  });

  it("refuses an action with no problem and no lean beside it", () => {
    const lines = refusal({
      verdict: askOfferVerdict({
        command: COMMAND,
        parsed: flags({ values: { action: JSON.stringify(WHOLE), problem: SHAPE.problem } }),
        required: true,
        stdin: NO_STDIN,
      }),
    });
    expect(lines[0]).toContain("an ask carries all six fields or none of them");
  });

  it("still accepts an authored shape with no action at all", () => {
    const verdict = recordable({
      verdict: askOfferVerdict({
        command: "slopweaver handover ask",
        parsed: flags({
          values: { ...SHAPE, options: "post it :: everyone sees it\nhold it :: the thread moves on" },
        }),
        required: true,
        stdin: NO_STDIN,
      }),
    });
    expect(verdict.action).toBeUndefined();
    expect(shapeOf({ verdict }).options.map((option) => option.option)).toEqual(["post it", "hold it"]);
  });
});
