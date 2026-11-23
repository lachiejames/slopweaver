/**
 * `mirrorAfterWrite`'s one decision, over plain fakes for the mirror, the authority switch and the error
 * sink: a mirrored document never fails the verb; a failed mirror prints every failure line in order and
 * fails the verb only when the store, not the file, is authoritative.
 */
import { describe, expect, it } from "vitest";

import { mirrorAfterWrite } from "../../../../../cli/commands/handover/mirrorAfterWrite.js";
import { err, ok } from "../../../../../lib/result.js";
import { mirrorFailureLines } from "../../../../../store/fleet/boardMirror.js";
import { FleetImportErrors } from "../../../../../store/fleet/errors.js";

const HOME = "/state/home";
const PATH = "/state/home/handovers/staging-pool.md";

describe("mirrorAfterWrite", () => {
  it("answers false and prints nothing when the mirror succeeds", async () => {
    const printed: string[] = [];
    const targets: { home: string; path: string }[] = [];

    const mustFail = await mirrorAfterWrite({
      home: HOME,
      mirror: (target) => {
        targets.push(target);
        return Promise.resolve(ok({ docHash: "abc123", kind: "mirrored", slug: "staging-pool" } as const));
      },
      path: PATH,
      reportError: ({ msg }) => {
        printed.push(msg);
      },
      storeIsAuthoritative: () => true,
      verb: "settle",
    });

    expect(mustFail).toBe(false);
    expect(printed).toEqual([]);
    expect(targets).toEqual([{ home: HOME, path: PATH }]);
  });

  it("prints every failure line in order and answers false while the file is authoritative", async () => {
    const failure = FleetImportErrors.sourceAbsent({ path: PATH });
    const printed: string[] = [];

    const mustFail = await mirrorAfterWrite({
      home: HOME,
      mirror: () => Promise.resolve(err(failure)),
      path: PATH,
      reportError: ({ msg }) => {
        printed.push(msg);
      },
      storeIsAuthoritative: () => false,
      verb: "settle",
    });

    expect(mustFail).toBe(false);
    expect(printed).toEqual(mirrorFailureLines({ error: failure, path: PATH, verb: "settle" }));
    expect(printed).toEqual([
      `handover settle: ${PATH} is written and is the board, but board_row is BEHIND it (SOURCE_ABSENT) — ` +
        "reconcile with `slopweaver store import-fleet --only board` once the store answers",
      `  ${PATH} does not exist — nothing to import from it`,
    ]);
  });

  it("answers true for the same failure once the store is authoritative", async () => {
    const printed: string[] = [];

    const mustFail = await mirrorAfterWrite({
      home: HOME,
      mirror: () => Promise.resolve(err(FleetImportErrors.sourceAbsent({ path: PATH }))),
      path: PATH,
      reportError: ({ msg }) => {
        printed.push(msg);
      },
      storeIsAuthoritative: () => true,
      verb: "register",
    });

    expect(mustFail).toBe(true);
    expect(printed.length).toBe(2);
    expect(printed[0]).toContain("handover register: ");
  });
});
