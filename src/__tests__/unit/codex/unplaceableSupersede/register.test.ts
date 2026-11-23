/**
 * Retiring a pass that recorded NO TREE (an owner ruling: a supersede verb, explicit and journalled, the gate
 * fail-closed by default).
 *
 * The shape under test is a measured one: a plan READY with no tree, a later placed p2 READY, and a pull request
 * unable to land without a hatch because nothing could retire the first.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Supersession, UnplaceableSupersession } from "../../../../codex/supersession.js";
import { supersessionColumns } from "../../../../codex/supersessionPort.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import {
  memorySupersessionPort,
  memorySupersessionStore,
  unavailableSupersessionPort,
} from "../../../landingRegistersFixture.js";

describe("the supersession register", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A throwaway state home. */
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "supersede-"));
    homes.push(home);
    return home;
  }

  const noTree: UnplaceableSupersession = {
    artifactId: "b44980e5",
    atIso: "2026-09-30T03:00:00.000Z",
    branch: "feature",
    kind: "no-tree",
    mode: "plan",
    pass: "p2",
    reason: "re-planned",
    replacedBy: "224c5d1c",
  };
  const wording: Supersession = {
    artifactId: "a",
    atIso: "2026-09-30T02:00:00.000Z",
    propertyId: "r2-08",
    reason: "why",
    replacedBy: "b",
  };

  it("round-trips a no-tree row and a wording row, the wording read back with no kind", async () => {
    const home = freshHome();
    const store = memorySupersessionStore();
    const supersessions = memorySupersessionPort({ store });
    unwrap(await supersessions.append({ home, row: noTree }));
    unwrap(await supersessions.append({ home, row: { ...wording, kind: "wording" } }));
    const read = unwrap(await supersessions.read({ home }));
    expect(read.get("b44980e5")).toEqual(noTree);
    expect(read.get("a")).toEqual(wording);
    expect(store.rows.get("a")!.kind).toBe("wording");
  });

  it("imports a wording row written before the no-tree shape existed", async () => {
    const home = freshHome();
    writeFileSync(stateHomePaths({ home }).codexSupersessionsJsonl, `${JSON.stringify(wording)}\n`);
    expect(unwrap(await memorySupersessionPort().read({ home })).get("a")).toEqual(wording);
  });

  it("imports the LAST line for an artifact the file retired twice, as the file reader answered", async () => {
    const home = freshHome();
    const later = { ...wording, reason: "the second word" };
    writeFileSync(
      stateHomePaths({ home }).codexSupersessionsJsonl,
      `${JSON.stringify(wording)}\n${JSON.stringify(later)}\n`,
    );
    const store = memorySupersessionStore();
    expect(unwrap(await memorySupersessionPort({ store }).read({ home })).get("a")).toEqual(later);
    expect(store.rows.size).toBe(1);
  });

  it("refuses an old file holding a no-tree row missing its mode, and imports nothing", async () => {
    const home = freshHome();
    const torn = { ...noTree, mode: undefined };
    writeFileSync(
      stateHomePaths({ home }).codexSupersessionsJsonl,
      `${JSON.stringify(wording)}\n${JSON.stringify(torn)}\n`,
    );
    const store = memorySupersessionStore();
    const error = unwrapErr(await memorySupersessionPort({ store }).read({ home }));
    expect(error.code).toBe("SUPERSESSION_IMPORT_INVALID");
    expect(error.message).toContain("line 2: is a no-tree retirement missing its pass, mode or branch");
    expect(store.rows.size).toBe(0);
  });

  it("refuses to read past a stored no-tree row naming no branch, which could retire the record for none", async () => {
    const store = memorySupersessionStore();
    store.imported = true;
    store.rows.set("b44980e5", { ...supersessionColumns({ row: noTree }), branch: null });
    const error = unwrapErr(await memorySupersessionPort({ store }).read({ home: freshHome() }));
    expect(error.code).toBe("SUPERSESSION_RECORD_INVALID");
  });

  it("refuses to read past a stored retirement naming no replacement, which would hide a pass for nothing", async () => {
    const store = memorySupersessionStore();
    store.imported = true;
    store.rows.set("a", { ...supersessionColumns({ row: wording }), replacedBy: "" });
    const error = unwrapErr(await memorySupersessionPort({ store }).read({ home: freshHome() }));
    expect(error.code).toBe("SUPERSESSION_RECORD_INVALID");
  });

  it("refuses a stored retirement whose reason only renders blank, which trim() alone would accept", async () => {
    const store = memorySupersessionStore();
    store.imported = true;
    store.rows.set("a", { ...supersessionColumns({ row: wording }), reason: "⠀" });
    const error = unwrapErr(await memorySupersessionPort({ store }).read({ home: freshHome() }));
    expect(error.message).toBe(
      "the stored retirement of a is missing its reason, replacedBy or atIso, so the supersession register cannot be read",
    );
  });

  it("refuses a no-tree retirement with a blank property id before it writes anything", async () => {
    const store = memorySupersessionStore();
    const error = unwrapErr(
      await memorySupersessionPort({ store }).append({
        home: freshHome(),
        row: { ...noTree, mode: "review", propertyId: "" } satisfies UnplaceableSupersession,
      }),
    );
    expect(error.message).toBe(
      "the stored retirement of b44980e5 is a no-tree retirement with a malformed propertyId, so the supersession register cannot be read",
    );
    expect(store.rows.size).toBe(0);
  });

  it("refuses a no-tree review naming no property, and a no-tree plan naming one, before writing either", async () => {
    const store = memorySupersessionStore();
    const port = memorySupersessionPort({ store });
    const mismatch =
      "the stored retirement of b44980e5 is a no-tree retirement whose propertyId does not match its mode (a review names one, a plan none), so the supersession register cannot be read";
    const reviewRow = { ...noTree, mode: "review" } satisfies UnplaceableSupersession;
    const review = unwrapErr(await port.append({ home: freshHome(), row: reviewRow }));
    const plan = unwrapErr(await port.append({ home: freshHome(), row: { ...noTree, propertyId: "r1-01" } }));
    expect([review.message, plan.message]).toEqual([mismatch, mismatch]);
    expect(store.rows.size).toBe(0);
  });

  it("reads a no-tree review retirement that names its property", async () => {
    const store = memorySupersessionStore();
    const port = memorySupersessionPort({ store });
    const review = { ...noTree, mode: "review", pass: "r1", propertyId: "r1-01" } satisfies UnplaceableSupersession;
    unwrap(await port.append({ home: freshHome(), row: review }));
    expect(unwrap(await port.read({ home: freshHome() })).get("b44980e5")).toEqual(review);
  });

  it("refuses a retirement whose instant will not parse before it writes anything", async () => {
    const store = memorySupersessionStore();
    const error = unwrapErr(
      await memorySupersessionPort({ store }).append({ home: freshHome(), row: { ...wording, atIso: "nope" } }),
    );
    expect(error.message).toContain("is missing its reason, replacedBy or atIso");
    expect(store.rows.size).toBe(0);
  });

  it("is idempotent on the same retirement and refuses a DIFFERENT one of the same artifact", async () => {
    const home = freshHome();
    const store = memorySupersessionStore();
    const supersessions = memorySupersessionPort({ store });
    unwrap(await supersessions.append({ home, row: noTree }));
    expect(unwrap(await supersessions.append({ home, row: noTree }))).toEqual(noTree);
    const error = unwrapErr(await supersessions.append({ home, row: { ...noTree, replacedBy: "other" } }));
    expect(error.code).toBe("ALREADY_SUPERSEDED");
    expect(store.rows.get("b44980e5")!.replacedBy).toBe("224c5d1c");
  });

  it("refuses with the store's outage, never an empty register", async () => {
    const error = unwrapErr(await unavailableSupersessionPort().read({ home: freshHome() }));
    expect(error.code).toBe("SUPERSESSION_STORE_UNAVAILABLE");
  });
});
