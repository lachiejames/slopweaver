/**
 * `slopweaver atlas knowbe4 sync` before the owner has stored a token: an expected-empty exit carrying the hand
 * step, never a network call and never a write into the home.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Knowbe4FillObservation, runKnowbe4Fill } from "../../../../../../atlas/knowbe4/fill/run.js";
import { runKnowbe4SyncVerb, syncExitCode } from "../../../../../../cli/commands/atlas/knowbe4/syncRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../../lib/result.js";
import { Knowbe4ReadErrors } from "../../../../../../live/knowbe4/errors.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-knowbe4-sync-verb-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The process argv the router hands the verb: runtime, script, noun, platform, verb, then the flags. */
const ARGV_HEAD = ["node", "slopweaver", "atlas", "knowbe4", "sync"] as const;

describe("runKnowbe4SyncVerb", () => {
  it("exits expected-empty with no token stored, and writes nothing into the home", async () => {
    expect(await runKnowbe4SyncVerb([...ARGV_HEAD, "--home", home])).toBe(EXIT_EXPECTED_EMPTY);
    expect(readdirSync(home)).toEqual([]);
  });

  it("refuses an unknown flag as usage, before it reads any token", async () => {
    expect(await runKnowbe4SyncVerb([...ARGV_HEAD, "--home", home, "--write"])).toBe(EXIT_USAGE);
  });
});

/**
 * A run in which the given statuses failed on `/v1/users`, one failure each, and nothing answered.
 *
 * @param statuses each failure's HTTP status, `null` for one that never got an answer
 * @returns the observation
 */
function failedWith({ statuses }: { statuses: readonly (number | null)[] }): Knowbe4FillObservation {
  return {
    answered: [],
    failed: statuses.map((status) => ({ kind: "user", message: "failed", status, template: "/v1/users" })),
    filledAtIso: "2026-10-15T00:00:00.000Z",
  };
}

describe("syncExitCode", () => {
  it("is OK when every path answered", () => {
    expect(syncExitCode({ fill: failedWith({ statuses: [] }) })).toBe(EXIT_OK);
  });

  it("is OK when the only failures are 403s, which the kind carries as a named permission block", () => {
    expect(syncExitCode({ fill: failedWith({ statuses: [403, 403] }) })).toBe(EXIT_OK);
  });

  it("is an error when any path failed on anything else, including a prior success now all 401", () => {
    expect([[401], [403, 500], [null]].map((statuses) => syncExitCode({ fill: failedWith({ statuses }) }))).toEqual([
      EXIT_ERROR,
      EXIT_ERROR,
      EXIT_ERROR,
    ]);
  });

  it("is an error when a path answered but stopped at a bound, since that kind is no fresher than its last whole read", () => {
    const fill: Knowbe4FillObservation = {
      answered: [{ items: [], kind: "user", template: "/v1/users", truncatedBy: "the 20-page bound" }],
      failed: [],
      filledAtIso: "2026-10-15T00:00:00.000Z",
    };
    expect(syncExitCode({ fill })).toBe(EXIT_ERROR);
  });

  it("is OK when a PARENT list 403s, since its per-parent child is refused on the same ground", async () => {
    const codes = [];
    for (const refused of ["/v1/groups", "/v1/phishing/security_tests"]) {
      const fill = await runKnowbe4Fill({
        at: "2026-10-15T00:00:00.000Z",
        get: async ({ url }) => {
          if (url.pathname === refused) {
            return err(
              Knowbe4ReadErrors.transportFailed({ message: `KnowBe4 answered 403 on ${refused}`, status: 403 }),
            );
          }
          const body = url.pathname === "/v1/account" ? { name: "Example Co", subscription_level: "Diamond" } : [];
          return ok(JSON.stringify(body));
        },
      });
      codes.push([fill.failed.map((failure) => failure.status), syncExitCode({ fill })]);
    }
    expect(codes).toEqual([
      [[403, 403], EXIT_OK],
      [[403, 403], EXIT_OK],
    ]);
  });
});
