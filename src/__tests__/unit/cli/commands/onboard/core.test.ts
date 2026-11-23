/**
 * `onboard`'s flag surface, and the decision of whether a question gets asked at all.
 *
 * The routing test matters more than the parsing one: a verb that asks a question nothing can answer hangs,
 * and a verb that silently takes a default without saying so is the silent-failure shape this repo keeps
 * paying for. Both are decided by pure functions here.
 */
import { describe, expect, it } from "vitest";

import {
  APP_NAME_QUESTION,
  answerRoute,
  finalSource,
  ONBOARD_FLAG_NAMES,
  onboardOptions,
  parseOnboardArgs,
  TIER_QUESTION,
} from "../../../../../cli/commands/onboard/core.js";
import { ONBOARD_USAGE } from "../../../../../cli/commands/onboard/usage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseOnboardArgs", () => {
  it("defaults to asking both questions", () => {
    expect(onboardOptions({ parsed: unwrap(parseOnboardArgs({ rest: [] })) })).toEqual({
      appName: undefined,
      json: false,
      tier: undefined,
    });
  });

  it("reads every flag it advertises", () => {
    const parsed = unwrap(parseOnboardArgs({ rest: ["--tier", "restricted", "--app-name", "Team Brain", "--json"] }));

    expect(onboardOptions({ parsed })).toEqual({ appName: "Team Brain", json: true, tier: "restricted" });
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    expect(unwrapErr(parseOnboardArgs({ rest: ["--workspace", "acme"] }))).toEqual([
      "unknown flag: --workspace",
      "unexpected argument: acme",
    ]);
  });

  it("refuses --tier with no value", () => {
    expect(unwrapErr(parseOnboardArgs({ rest: ["--tier"] }))).toEqual(["--tier requires a value"]);
  });

  it("advertises exactly the flags it accepts", () => {
    expect(ONBOARD_FLAG_NAMES).toEqual(["--app-name", "--identity", "--json", "--mailbox-zone", "--tier"]);
  });
});

describe("the usage line", () => {
  it("says the agent tier is the default AND the least secure, where a reader of --help sees it", () => {
    expect(ONBOARD_USAGE).toContain("agent (the default, and the least secure");
  });

  it("says in --help itself that the Agents panel cannot be undone", () => {
    expect(ONBOARD_USAGE).toContain("CANNOT be undone");
  });
});

describe("the questions", () => {
  it("offers the agent tier first, marked recommended and least secure, with Enter as its answer", () => {
    expect(TIER_QUESTION).toContain("RECOMMENDED, and the LEAST SECURE");
    expect(TIER_QUESTION).toContain("[agent] > ");
  });

  it("states the irreversibility IN the question — the point of choice, not a footnote after it", () => {
    expect(TIER_QUESTION).toContain("Enabling the Agents panel CANNOT BE UNDONE");
    expect(TIER_QUESTION).toContain("workspace guests lose access to the app");
  });

  it("offers all three rungs, so the safer ones are one answer away rather than one doc away", () => {
    expect(TIER_QUESTION).toContain("  standard    the same bot without the Agents panel");
    expect(TIER_QUESTION).toContain("  restricted  ingest only");
  });

  it("offers the default app name in the prompt, so Enter is a complete answer", () => {
    expect(APP_NAME_QUESTION).toContain("[Slopweaver] > ");
  });
});

describe("answerRoute", () => {
  it("takes the flag when there is one, even on a terminal", () => {
    expect(answerRoute({ canAsk: true, flagValue: "restricted" })).toBe("flag");
  });

  it("asks when there is no flag and a terminal can answer", () => {
    expect(answerRoute({ canAsk: true, flagValue: undefined })).toBe("ask");
  });

  it("takes the default rather than hanging when nothing can answer a question", () => {
    expect(answerRoute({ canAsk: false, flagValue: undefined })).toBe("default");
  });
});

describe("finalSource", () => {
  it("calls a flagged answer a flag", () => {
    expect(finalSource({ raw: "", route: "flag" })).toBe("flag");
  });

  it("calls a typed answer a choice", () => {
    expect(finalSource({ raw: "restricted", route: "ask" })).toBe("asked");
  });

  it("calls a bare Enter the DEFAULT, not a choice — the difference is what the user is told they picked", () => {
    expect(finalSource({ raw: "   ", route: "ask" })).toBe("default");
  });

  it("calls an unasked answer the default", () => {
    expect(finalSource({ raw: "", route: "default" })).toBe("default");
  });
});
