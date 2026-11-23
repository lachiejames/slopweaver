/**
 * `github hold` and `github release`'s argument parsing — including the two refusals that exist so a hold
 * is never believed to be standing when it is not: `--status` combined with placement flags, and a hold
 * placed with no stated reason.
 */
import { describe, expect, it } from "vitest";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import {
  GITHUB_HOLD_FLAG_NAMES,
  GITHUB_HOLD_FLAGS,
  GITHUB_RELEASE_FLAG_NAMES,
  GITHUB_RELEASE_FLAGS,
  holderLiveness,
  holderNamedBy,
  parseGithubHoldArgs,
  parseGithubReleaseArgs,
} from "../../../../../cli/commands/github/holdCore.js";
import { unwrap } from "../../../../../lib/result.js";
import { measured } from "../../../../../measurement/status.js";
import { DEFAULT_HOLD_STALE_MINUTES } from "../../../../../outbound/github/mergeHold.js";

const PLACE: readonly string[] = ["--pr", "32", "--repo", "owner/name", "--why", "rebase hell"];

describe("holderNamedBy", () => {
  it("names the session when it has an id", () => {
    expect(holderNamedBy({ sessionId: "a-session" })).toBe("a-session");
  });

  it("labels a hold placed outside a visible session", () => {
    expect(holderNamedBy({ sessionId: undefined })).toBe("an unidentified session");
  });
});

describe("holderLiveness", () => {
  const emptyRoster = measured({ value: { blindSpots: [], liveIds: new Set<string>(), refused: [] } });

  it("does not call a hold with no recorded session GONE: the label names nobody the registry could lack", () => {
    expect(holderLiveness({ holder: holderNamedBy({ sessionId: undefined }), roster: emptyRoster })).toEqual({
      known: false,
      why: "the journal records no session id, so there is nothing to ask about",
    });
  });

  it("still calls an identified session absent from a complete registry GONE", () => {
    expect(holderLiveness({ holder: "a-session", roster: emptyRoster })).toEqual({ known: true, value: false });
  });
});

describe("parseGithubHoldArgs", () => {
  it("parses a placement, defaulting the staleness threshold", () => {
    const parsed = parseGithubHoldArgs({ rest: PLACE });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({
      asJson: false,
      home: undefined,
      mode: "place",
      pr: 32,
      repo: "owner/name",
      staleMinutes: DEFAULT_HOLD_STALE_MINUTES,
      why: "rebase hell",
    });
  });

  it("parses --status on its own", () => {
    const parsed = parseGithubHoldArgs({ rest: ["--status", "--json"] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ asJson: true, home: undefined, mode: "status" });
  });

  it("refuses --status combined with a placement flag, by name", () => {
    const parsed = parseGithubHoldArgs({ rest: ["--status", "--pr", "32"] });

    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("--pr");
  });

  it("refuses a hold with no stated reason", () => {
    const parsed = parseGithubHoldArgs({ rest: ["--pr", "32", "--repo", "owner/name"] });

    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("--why");
  });

  it("refuses a --repo that is not owner/name", () => {
    const parsed = parseGithubHoldArgs({ rest: ["--pr", "32", "--repo", "name", "--why", "x"] });

    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toBe(
      '--repo must be owner/name; "name" is not',
    );
  });

  it("refuses a --pr that is not a positive whole number", () => {
    const parsed = parseGithubHoldArgs({ rest: ["--pr", "0", "--repo", "owner/name", "--why", "x"] });

    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toBe(
      '--pr must be a positive whole number; "0" is not',
    );
  });

  it("refuses a --stale-minutes that is not a positive whole number", () => {
    const parsed = parseGithubHoldArgs({ rest: [...PLACE, "--stale-minutes", "-5"] });

    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: parsed._unsafeUnwrapErr() })[0]).toContain("--stale-minutes");
  });

  it("keeps the caller's own threshold", () => {
    const parsed = parseGithubHoldArgs({ rest: [...PLACE, "--stale-minutes", "90"] });

    expect(unwrap(parsed)).toEqual({
      asJson: false,
      home: undefined,
      mode: "place",
      pr: 32,
      repo: "owner/name",
      staleMinutes: 90,
      why: "rebase hell",
    });
  });

  it("advertises exactly the flags GITHUB_HOLD_FLAG_NAMES declares", () => {
    expect(GITHUB_HOLD_FLAG_NAMES.toSorted()).toEqual(
      [...GITHUB_HOLD_FLAGS.string!, ...GITHUB_HOLD_FLAGS.boolean!].map((name) => `--${name}`).toSorted(),
    );
  });
});

describe("parseGithubReleaseArgs", () => {
  it("parses a release, with the landed commit", () => {
    const parsed = parseGithubReleaseArgs({ rest: ["--pr", "32", "--repo", "owner/name", "--sha", "abc1234"] });

    expect(unwrap(parsed)).toEqual({ home: undefined, pr: 32, repo: "owner/name", sha: "abc1234" });
  });

  it("parses a release with no landed commit recorded", () => {
    const parsed = parseGithubReleaseArgs({ rest: ["--pr", "32", "--repo", "owner/name"] });

    expect(unwrap(parsed).sha).toBe(undefined);
  });

  it("reports every missing flag at once rather than one at a time", () => {
    const parsed = parseGithubReleaseArgs({ rest: [] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--pr <n> is required", "--repo owner/name is required"]);
  });

  it("advertises exactly the flags GITHUB_RELEASE_FLAG_NAMES declares", () => {
    expect(GITHUB_RELEASE_FLAG_NAMES.toSorted()).toEqual(
      [...GITHUB_RELEASE_FLAGS.string!, ...GITHUB_RELEASE_FLAGS.boolean!].map((name) => `--${name}`).toSorted(),
    );
  });
});
