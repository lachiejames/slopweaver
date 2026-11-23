import { describe, expect, it } from "vitest";

import { OnboardErrors } from "../../../../../cli/commands/onboard/errors.js";
import {
  mainCheckoutRoot,
  ONBOARD_EVAL_FLAG_NAMES,
  type OnboardEvalOptions,
  onboardEvalOptions,
  parseOnboardEvalArgs,
} from "../../../../../cli/commands/onboard/evalCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

function options({ rest }: { rest: readonly string[] }): OnboardEvalOptions {
  return unwrap(onboardEvalOptions({ parsed: unwrap(parseOnboardEvalArgs({ rest })) }));
}

describe("onboard eval parsing", () => {
  it("advertises exactly the flags it accepts", () => {
    expect(ONBOARD_EVAL_FLAG_NAMES).toEqual([
      "--eval-home",
      "--file-findings",
      "--json",
      "--repo",
      "--run",
      "--schema",
    ]);
  });

  it("requires --run unless --schema is given", () => {
    expect(unwrapErr(onboardEvalOptions({ parsed: unwrap(parseOnboardEvalArgs({ rest: [] })) }))).toEqual(
      OnboardErrors.runMissing(),
    );
    expect(unwrapErr(onboardEvalOptions({ parsed: unwrap(parseOnboardEvalArgs({ rest: [] })) })).message).toBe(
      "--run is required (or pass --schema to print the run artifact shape)",
    );
    expect(options({ rest: ["--schema"] }).schema).toBe(true);
  });

  it("defaults --file-findings to 0 and rejects a non-integer or negative value", () => {
    expect(options({ rest: ["--run", "/tmp/r.json"] }).fileFindings).toBe(0);
    expect(options({ rest: ["--run", "/tmp/r.json", "--file-findings", "3"] }).fileFindings).toBe(3);
    expect(
      unwrapErr(
        onboardEvalOptions({
          parsed: unwrap(parseOnboardEvalArgs({ rest: ["--run", "/tmp/r.json", "--file-findings", "-1"] })),
        }),
      ),
    ).toEqual(OnboardErrors.fileFindingsNotNonNegative({ got: "-1" }));
    expect(
      unwrapErr(
        onboardEvalOptions({
          parsed: unwrap(parseOnboardEvalArgs({ rest: ["--run", "/tmp/r.json", "--file-findings", "abc"] })),
        }),
      ),
    ).toEqual(OnboardErrors.fileFindingsNotNonNegative({ got: "abc" }));
  });

  it("leaves --eval-home and --repo undefined when not given, so the run file applies its own defaults", () => {
    const resolved = options({ rest: ["--run", "/tmp/r.json"] });
    expect(resolved.evalHome).toBeUndefined();
    expect(resolved.repo).toBeUndefined();
  });
});

describe("mainCheckoutRoot", () => {
  it("strips a trailing .claude/worktrees/<slug> segment", () => {
    expect(mainCheckoutRoot({ cwd: "/repo/dev/slopweaver/.claude/worktrees/some-slug" })).toBe("/repo/dev/slopweaver");
  });

  it("leaves a main-checkout path unchanged", () => {
    expect(mainCheckoutRoot({ cwd: "/repo/dev/slopweaver" })).toBe("/repo/dev/slopweaver");
  });
});
