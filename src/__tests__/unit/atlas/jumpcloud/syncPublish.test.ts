/*
 * Whether a JumpCloud generation may publish — `src/atlas/jumpcloud/syncPublish.ts`.
 *
 * The publishing arm writes a generation and is proven end to end by the sync's own test; these cases pin the
 * two judgements that stop a publish: which failures refuse one, and what a refused report says.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type JumpcloudReadError, JumpcloudReadErrors } from "../../../../atlas/jumpcloud/errors.js";
import { jumpcloudAtlasPaths } from "../../../../atlas/jumpcloud/store.js";
import type { JumpcloudKindWalk } from "../../../../atlas/jumpcloud/syncEngine.js";
import { blockingFailures, publishOrRefuse } from "../../../../atlas/jumpcloud/syncPublish.js";
import { unwrap } from "../../../../lib/result.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway state home, removed after every test. */
function scratchHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-jumpcloud-publish-"));
  homes.push(home);
  return home;
}

/**
 * One kind's walk that read nothing, carrying the given failures and shortfalls.
 *
 * @param failures the typed failures the walk recorded
 * @param clearableIncomplete the operations whose shortfall a later run could clear
 * @returns the walk
 */
function walk({
  failures,
  clearableIncomplete,
}: {
  failures: readonly JumpcloudReadError[];
  clearableIncomplete: readonly string[];
}): JumpcloudKindWalk {
  return {
    clearableIncomplete,
    declaredTotal: null,
    emptyOperations: [],
    entities: [],
    failures: failures.map((error) => ({ error, surface: error.surface })),
    firstAt: null,
    incompleteOperations: [],
    journalledDrops: [],
    kind: "gcep",
    lastAt: null,
    pagesExhausted: true,
    projections: [],
    providerIds: [],
    providerIdsBySurface: {},
    resumed: 0,
  };
}

describe("blockingFailures", () => {
  it("keeps a failure a later run could clear and the shortfalls, and drops a 403 and a 404", () => {
    const redirect = JumpcloudReadErrors.redirectRefused({ status: 302, surface: "v2-gcep-device-state" });
    const lines = blockingFailures({
      walk: walk({
        clearableIncomplete: ["v2-gcep-devices: 125 of a declared 150"],
        failures: [
          redirect,
          JumpcloudReadErrors.permissionRefused({ status: 403, surface: "v2-gcep-policies" }),
          JumpcloudReadErrors.routeAbsent({ surface: "v2-gcep-configuration" }),
        ],
      }),
    });
    expect(lines).toEqual([
      `gcep/v2-gcep-device-state: ${redirect.message}`,
      "gcep/v2-gcep-devices: 125 of a declared 150",
    ]);
  });

  it("returns nothing for a walk with no failure and no shortfall", () => {
    const empty: readonly JumpcloudReadError[] = [];
    const none: readonly string[] = [];
    expect(blockingFailures({ walk: walk({ clearableIncomplete: none, failures: empty }) })).toEqual([]);
  });
});

describe("publishOrRefuse", () => {
  it("refuses a generation carrying a refusal, writes nothing, and sorts the kinds", () => {
    const paths = jumpcloudAtlasPaths({ home: scratchHome() });
    const report = unwrap(
      publishOrRefuse({
        generation: {
          files: {},
          outcomes: [
            { entityCount: 2, kind: "systems", reason: "read", resumed: 0, state: "synced" },
            { entityCount: 0, kind: "gcep", reason: "redirected", resumed: 1, state: "failed" },
          ],
          refusals: ["gcep/v2-gcep-device-state: redirected"],
          statuses: {},
        },
        knownSecrets: [],
        paths,
        prior: null,
      }),
    );
    expect(report).toEqual({
      kinds: [
        { entityCount: 0, kind: "gcep", reason: "redirected", resumed: 1, state: "failed" },
        { entityCount: 2, kind: "systems", reason: "read", resumed: 0, state: "synced" },
      ],
      published: false,
      refusals: [
        "gcep/v2-gcep-device-state: redirected",
        "nothing was published: a generation with a family that failed for a reason a later run could clear would be read as this organisation's whole answer. Re-run the sync — the resume journal keeps every call already made",
      ],
      written: [],
    });
  });
});
