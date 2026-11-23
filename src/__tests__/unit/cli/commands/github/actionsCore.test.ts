/**
 * `github actions`'s pure core: the parser that only ever builds a read, a preview or a switch-off, the door request
 * that names the setting, the state renderings, and the outcome a performed switch-off is judged by.
 */
import { describe, expect, it } from "vitest";

import {
  appliedOutcome,
  type GithubActionsApplyArgs,
  parseGithubActionsArgs,
  repoActionsDoorRequest,
  stateJson,
  stateLine,
  switchedOff,
} from "../../../../../cli/commands/github/actionsCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubActionsArgs", () => {
  it("parses a bare read", () => {
    expect(unwrap(parseGithubActionsArgs({ rest: ["--repo", "acme/widgets"] }))).toStrictEqual({
      apply: false,
      disable: false,
      home: undefined,
      json: false,
      owner: "acme",
      repo: "widgets",
    });
  });

  it("parses a preview", () => {
    const args = unwrap(parseGithubActionsArgs({ rest: ["--repo", "acme/widgets", "--disable", "--json"] }));
    expect(args.disable).toBe(true);
    expect(args.apply).toBe(false);
    expect(args.json).toBe(true);
  });

  it("parses an apply with its home", () => {
    const args = unwrap(
      parseGithubActionsArgs({ rest: ["--repo", "acme/widgets", "--disable", "--apply", "--home", "/h"] }),
    );
    expect(args.disable).toBe(true);
    expect(args.apply).toBe(true);
    expect(args.home).toBe("/h");
  });

  it("refuses --apply without --disable", () => {
    expect(unwrapErr(parseGithubActionsArgs({ rest: ["--repo", "acme/widgets", "--apply"] }))).toEqual([
      "--apply requires --disable; this verb only ever switches Actions off",
    ]);
  });

  it("refuses a missing repository", () => {
    expect(unwrapErr(parseGithubActionsArgs({ rest: ["--disable"] }))).toEqual(["--repo owner/name is required"]);
  });

  it("refuses a malformed repository", () => {
    expect(unwrapErr(parseGithubActionsArgs({ rest: ["--repo", "widgets"] }))).toEqual([
      "--repo owner/name is required",
    ]);
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseGithubActionsArgs({ rest: ["--repo", "acme/widgets", "--enable"] })).length).toBe(1);
  });

  it("refuses a stray positional", () => {
    expect(unwrapErr(parseGithubActionsArgs({ rest: ["--repo", "acme/widgets", "on"] })).length).toBe(1);
  });
});

describe("repoActionsDoorRequest", () => {
  it("names the setting, not only the repository, as an external write needing no approval gate", () => {
    const args: GithubActionsApplyArgs = {
      apply: true,
      disable: true,
      home: undefined,
      json: false,
      owner: "acme",
      repo: "widgets",
    };
    expect(repoActionsDoorRequest({ args, home: "/h" })).toStrictEqual({
      action: { kind: "verb", noun: "github", verb: "actions disable" },
      artifact: { id: "acme/widgets actions/permissions" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/h", requiresApproval: false },
    });
  });
});

describe("state rendering", () => {
  it("renders a reported allowed-actions value", () => {
    expect(stateLine({ state: { allowedActions: "selected", enabled: true } })).toBe(
      "enabled=true allowed-actions=selected",
    );
  });

  it("renders an absent allowed-actions value as not reported, and as null in JSON", () => {
    const state = { allowedActions: undefined, enabled: false };
    expect(stateLine({ state })).toBe("enabled=false allowed-actions=not reported");
    expect(stateJson({ state })).toStrictEqual({ allowedActions: null, enabled: false });
  });

  it("projects the switch-off as off with no allowed actions, as GitHub reports an off repository", () => {
    expect(switchedOff()).toStrictEqual({ allowedActions: undefined, enabled: false });
  });
});

describe("appliedOutcome", () => {
  it("is disabled when the write was acknowledged and reads back off", () => {
    expect(appliedOutcome({ after: { allowedActions: "all", enabled: false }, wrote: true })).toStrictEqual({
      outcome: "disabled",
      succeeded: true,
    });
  });

  it("is off despite the write error when the write failed but reads back off", () => {
    expect(appliedOutcome({ after: { allowedActions: "all", enabled: false }, wrote: false })).toStrictEqual({
      outcome: "off despite write error",
      succeeded: true,
    });
  });

  it("is not confirmed when the write was acknowledged but still reads on", () => {
    expect(appliedOutcome({ after: { allowedActions: "all", enabled: true }, wrote: true })).toStrictEqual({
      outcome: "NOT confirmed",
      succeeded: false,
    });
  });

  it("is unchanged when the write failed and still reads on", () => {
    expect(appliedOutcome({ after: { allowedActions: "all", enabled: true }, wrote: false })).toStrictEqual({
      outcome: "unchanged",
      succeeded: false,
    });
  });
});
