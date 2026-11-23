import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import {
  type GithubPushRestrictionDeps,
  runGithubPushRestriction,
} from "../../../../../cli/commands/github/pushRestrictionRun.js";
import { ok } from "../../../../../lib/result.js";
import type { GithubPushRestrictionApi } from "../../../../../outbound/github/pushRestrictionWrite.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const homes: string[] = [];

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

/** A throwaway state home the door records into. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-push-restriction-"));
  homes.push(home);
  return home;
}

/** A plain fake: one `main` rule whose read observes whatever the last update stored. */
function api({
  stored,
  updates,
}: {
  stored: { logins: string[]; restricts: boolean };
  updates: string[];
}): GithubPushRestrictionApi {
  return {
    readRules: () =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          repository: {
            branchProtectionRules: {
              nodes: [
                {
                  id: "rule-main",
                  isAdminEnforced: false,
                  pattern: "main",
                  pushAllowances: {
                    nodes: stored.logins.map((login) => ({ actor: { __typename: "User", login } })),
                    totalCount: stored.logins.length,
                  },
                  requiresApprovingReviews: false,
                  requiresCodeOwnerReviews: false,
                  restrictsPushes: stored.restricts,
                },
              ],
              totalCount: 1,
            },
          },
        }),
      ),
    update: ({ restrictsPushes, actorIds }) => {
      updates.push(`${String(restrictsPushes)}:${actorIds.join(",")}`);
      stored.restricts = restrictsPushes;
      stored.logins = actorIds.map((id) => id.replace("U_", ""));
      return ResultAsync.fromSafePromise(Promise.resolve(undefined));
    },
    userId: ({ login }) => ResultAsync.fromSafePromise(Promise.resolve({ user: { id: `U_${login}`, login } })),
  };
}

function depsFor({
  door = memoryDoorLedger().port,
  home,
  out,
  diagnostic,
  stored,
  updates,
}: {
  door?: DoorLedgerPort;
  home: string;
  out: string[];
  diagnostic: string[];
  stored: { logins: string[]; restricts: boolean };
  updates: string[];
}): GithubPushRestrictionDeps {
  return {
    doorLedger: door,
    home: () => home,
    makeApi: () => api({ stored, updates }),
    out: (line) => out.push(line),
    resolveRepo: () => ok({ owner: "o", repo: "r" }),
    token: () => "token",
    writeDiagnostic: (line) => diagnostic.push(line),
  };
}

describe("runGithubPushRestriction", () => {
  it("reads and writes nothing when no change is named", async () => {
    const out: string[] = [];
    const updates: string[] = [];
    const home = newHome();

    const code = await runGithubPushRestriction({
      deps: depsFor({ diagnostic: [], home, out, stored: { logins: [], restricts: false }, updates }),
      rest: ["--repo", "o/r", "--home", home, "--json"],
    });

    expect(code).toBe(0);
    expect(updates).toEqual([]);
    const document: unknown = JSON.parse(out[0]!);
    expect(document).toEqual({
      allowances: [],
      branch: "main",
      isAdminEnforced: false,
      outcome: "read",
      pattern: "main",
      repo: "o/r",
      requiresApprovingReviews: false,
      requiresCodeOwnerReviews: false,
      restrictsPushes: false,
      target: null,
    });
  });

  it("prints the change on --dry-run and sends nothing", async () => {
    const out: string[] = [];
    const updates: string[] = [];
    const home = newHome();

    const code = await runGithubPushRestriction({
      deps: depsFor({ diagnostic: [], home, out, stored: { logins: [], restricts: false }, updates }),
      rest: ["--repo", "o/r", "--home", home, "--allow", "ada", "--dry-run"],
    });

    expect(code).toBe(0);
    expect(updates).toEqual([]);
    expect(out).toEqual([
      "would set o/r@main",
      "  push:    unrestricted",
      "  admins:  bypass the rule",
      "  reviews: no approval required",
      "  asked:   restricted to user:ada",
    ]);
  });

  it("writes through the door and reports the read-back", async () => {
    const out: string[] = [];
    const updates: string[] = [];
    const home = newHome();

    const code = await runGithubPushRestriction({
      deps: depsFor({ diagnostic: [], home, out, stored: { logins: [], restricts: false }, updates }),
      rest: ["--repo", "o/r", "--home", home, "--allow", "ada"],
    });

    expect(code).toBe(0);
    expect(updates).toEqual(["true:U_ada"]);
    expect(out[0]).toBe("set o/r@main");
    expect(out[1]).toBe("  push:    restricted to user:ada");
  });

  it("sends nothing when the branch already holds the restriction", async () => {
    const out: string[] = [];
    const updates: string[] = [];
    const home = newHome();

    const code = await runGithubPushRestriction({
      deps: depsFor({ diagnostic: [], home, out, stored: { logins: ["ada"], restricts: true }, updates }),
      rest: ["--repo", "o/r", "--home", home, "--allow", "ADA"],
    });

    expect(code).toBe(0);
    expect(updates).toEqual([]);
    expect(out[0]).toBe("already set o/r@main");
  });

  it("performs nothing when the door cannot record the write", async () => {
    const diagnostic: string[] = [];
    const updates: string[] = [];
    const home = newHome();

    const code = await runGithubPushRestriction({
      deps: depsFor({
        diagnostic,
        door: unreachableDoorLedger(),
        home,
        out: [],
        stored: { logins: [], restricts: false },
        updates,
      }),
      rest: ["--repo", "o/r", "--home", home, "--allow", "ada"],
    });

    expect(code).toBe(1);
    expect(updates).toEqual([]);
    expect(diagnostic.join("\n")).toContain("not performed:");
  });

  it("refuses a usage error before any read", async () => {
    const diagnostic: string[] = [];
    const updates: string[] = [];
    const home = newHome();

    const code = await runGithubPushRestriction({
      deps: depsFor({ diagnostic, home, out: [], stored: { logins: [], restricts: false }, updates }),
      rest: ["--allow", "a", "--unrestrict"],
    });

    expect(code).toBe(2);
    expect(diagnostic[0]).toBe("--allow and --unrestrict are opposite changes; pass one");
  });
});
