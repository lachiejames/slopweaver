import { describe, expect, it } from "vitest";

import {
  parseGithubPushRestrictionArgs,
  pushRestrictionDoorRequest,
} from "../../../../../cli/commands/github/pushRestrictionCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubPushRestrictionArgs", () => {
  it("reads main with no change when nothing is named", () => {
    const parsed = parseGithubPushRestrictionArgs({ rest: ["--repo", "o/r"] });

    expect(unwrap(parsed)).toEqual({
      branch: "main",
      dryRun: false,
      home: undefined,
      json: false,
      repo: "o/r",
      target: null,
    });
  });

  it("turns --allow into an exact, deduped login list", () => {
    const parsed = parseGithubPushRestrictionArgs({
      rest: ["--allow", " a, b ,A,,", "--branch", "trunk", "--dry-run"],
    });

    const args = unwrap(parsed);
    expect(args.target).toEqual({ kind: "restrict", logins: ["a", "b"] });
    expect(args.branch).toBe("trunk");
    expect(args.dryRun).toBe(true);
  });

  it("reads --unrestrict as the lift", () => {
    const parsed = parseGithubPushRestrictionArgs({ rest: ["--unrestrict"] });

    expect(unwrap(parsed).target).toEqual({ kind: "unrestrict" });
  });

  it("refuses an --allow that names nobody", () => {
    const parsed = parseGithubPushRestrictionArgs({ rest: ["--allow", " , "] });

    expect(unwrapErr(parsed)).toEqual([
      "--allow needs at least one login: a restriction allowing nobody shuts every non-admin out of the queue",
    ]);
  });

  it("refuses --allow beside --unrestrict", () => {
    const parsed = parseGithubPushRestrictionArgs({ rest: ["--allow", "a", "--unrestrict"] });

    expect(unwrapErr(parsed)).toEqual(["--allow and --unrestrict are opposite changes; pass one"]);
  });
});

describe("pushRestrictionDoorRequest", () => {
  it("names the verb and the branch it writes", () => {
    expect(pushRestrictionDoorRequest({ branch: "main", home: "/h", identity: "o/r" })).toEqual({
      action: { kind: "verb", noun: "github", verb: "push-restriction" },
      artifact: { id: "o/r@main" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});
