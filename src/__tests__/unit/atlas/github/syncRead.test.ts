/**
 * The read half of `github sync`: one outcome per admitted call per distinct scope, a refused read carried as
 * its typed error, and a 200 omitting a field GitHub declares required settled as a failure here rather than
 * reaching the fold.
 */
import { describe, expect, it } from "vitest";

import type { GithubAtlasApi, GithubReadOutcome } from "../../../../atlas/github/client.js";
import { GithubAtlasErrors } from "../../../../atlas/github/errors.js";
import { githubCallById, githubCallsAt } from "../../../../atlas/github/inventory.js";
import { githubCallRoute } from "../../../../atlas/github/inventoryShape.js";
import { readEveryScope } from "../../../../atlas/github/syncRead.js";
import { okAsync } from "../../../../lib/result.js";

const ORG = "sync-read-org";
const RULESETS_ROUTE = githubCallRoute({ call: githubCallById({ id: "org-rulesets" }), scopeRef: ORG })!;
const ORG_CALL_IDS = githubCallsAt({ level: "organization" }).map((call) => call.id);

/** A seam answering every route with the given ruleset records on the rulesets route and nothing elsewhere. */
function apiAnswering({ rulesets }: { rulesets: readonly unknown[] }): GithubAtlasApi {
  return {
    read: ({ route }) => {
      const records = route === RULESETS_ROUTE ? rulesets : [];
      const outcome: GithubReadOutcome = { pagesExhausted: true, records, reportedTotal: null };
      return okAsync(outcome);
    },
  };
}

describe("readEveryScope", () => {
  it("reads each organisation call once for a scope named twice, and keeps a usable ruleset read", async () => {
    const lines: string[] = [];
    const outcomes = await readEveryScope({
      api: apiAnswering({ rulesets: [{ enforcement: "active", id: 41, name: "kept-ruleset" }] }),
      progress: ({ line }) => lines.push(line),
      scopes: { organisations: [ORG, ORG], repositories: [] },
    });
    expect(ORG_CALL_IDS.length).toBeGreaterThan(0);
    expect(outcomes.map((outcome) => outcome.call.id)).toEqual(ORG_CALL_IDS);
    expect(lines).toEqual(ORG_CALL_IDS.map((id) => `github atlas: ${id} ${ORG}`));
    const rulesets = outcomes.find((outcome) => outcome.route === RULESETS_ROUTE)!;
    expect(rulesets.error).toBe(null);
    expect(rulesets.outcome).toEqual({
      pagesExhausted: true,
      records: [{ enforcement: "active", id: 41, name: "kept-ruleset" }],
      reportedTotal: null,
    });
  });

  it("settles a ruleset read omitting required enforcement as a failure carrying no outcome", async () => {
    const outcomes = await readEveryScope({
      api: apiAnswering({ rulesets: [{ id: 42, name: "unenforced-ruleset" }] }),
      scopes: { organisations: [ORG], repositories: [] },
    });
    const rulesets = outcomes.find((outcome) => outcome.route === RULESETS_ROUTE)!;
    expect(rulesets.outcome).toBe(null);
    expect(rulesets.error).toEqual(
      GithubAtlasErrors.unusableResponse({
        reason: "ruleset record 0 omitted the required field enforcement",
        route: RULESETS_ROUTE,
      }),
    );
    expect(outcomes.filter((outcome) => outcome.error !== null).map((outcome) => outcome.route)).toEqual([
      RULESETS_ROUTE,
    ]);
  });

  it("reads nothing when handed no scope", async () => {
    const outcomes = await readEveryScope({
      api: apiAnswering({ rulesets: [] }),
      scopes: { organisations: [], repositories: [] },
    });
    expect(outcomes).toEqual([]);
  });
});
