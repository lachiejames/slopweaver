import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATADOG_COMPILED_CHANNEL } from "../../../../atlas/datadog/catalogue.js";
import { DATADOG_SDK_PIN } from "../../../../atlas/datadog/generated/sdkLock.js";
import { DATADOG_SURFACES } from "../../../../atlas/datadog/generated/surfaces.js";
import { DATADOG_KINDS, DATADOG_REGISTRY_KINDS } from "../../../../atlas/datadog/model.js";
import { readDatadogSnapshot } from "../../../../atlas/datadog/readAdapter.js";
import { type DatadogAtlasSnapshot, readDatadogAtlas } from "../../../../atlas/datadog/store.js";
import {
  DATADOG_CROSS_KIND_GAP_KIND,
  type DatadogSyncOutcome,
  datadogRegistryCensusMismatch,
  datadogUndeclaredKinds,
  syncDatadogCatalogue,
} from "../../../../atlas/datadog/sync.js";
import { unwrap } from "../../../../lib/result.js";
import { cloneHome } from "../homeTemplate.js";

const AT = "2026-09-06T01:00:00.000Z";
const LATER = "2026-09-07T01:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, so nothing here ever touches the ambient one. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "dd-sync-"));
  homes.push(home);
  return home;
};

/**
 * One generation, published once, read by every assertion that only INSPECTS it.
 *
 * A full sync publishes 1,735 entities across 144 files, and re-running it per test put this file over
 * vitest's 20-second per-test timeout on a loaded machine while passing on a quiet one — measured on the
 * commit that landed it. The tests that genuinely need their own home (a second run, a re-sync) still mint
 * one; the rest share this, which is safe because none of them writes.
 *
 * `beforeAll` carries an explicit 60-second budget because vitest's default HOOK timeout is 10 seconds
 * rather than the 20 a test gets, and this publish does not fit in it under load. MEASURED: the
 * sync itself runs in ~2.0s on a quiet machine and the hook exceeded 10s while the full 1,892-file unit
 * lane ran in parallel, failing the whole FILE with `Hook timed out in 10000ms` and zero failing tests.
 * Reproduce the quiet number with `yarn vitest run --config config/vitest/unit.ts <this file>` and the
 * loaded one with `yarn test:unit`.
 *
 * The outcome and one read of the published snapshot are shared the same way: the two outcome tests used to
 * publish a private generation each only to inspect the report, and every inspecting test re-read all 144
 * files. MEASURED: seven publishes became two and the file's `tests` time fell from 14.4s to
 * 3.7s, with the kit's staged-write flush cut beside it. Reproduce with `yarn vitest run --config
 * config/vitest/unit.ts --reporter=verbose <this file>`. Nothing here mutates a shared value: every assertion
 * reads, maps or `toSorted`s a copy.
 */
let sharedHome = "";
let sharedOutcome: DatadogSyncOutcome;
let sharedSnapshot: DatadogAtlasSnapshot;

beforeAll(() => {
  sharedHome = freshHome();
  sharedOutcome = unwrap(syncDatadogCatalogue({ at: AT, home: sharedHome }));
  sharedSnapshot = unwrap(readDatadogAtlas({ home: sharedHome }));
}, 60_000);

afterAll(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("datadogRegistryCensusMismatch", () => {
  // The assertion is aimed at THIS repository: `generated/surfaces.ts` is generated and `sdkLock.ts` is its
  // pin, so a disagreement is a hand-edit, an unreviewed regeneration or a merge that dropped rows.
  it("finds no disagreement between the committed registry and its own pin", () => {
    expect(datadogRegistryCensusMismatch()).toBe(null);
  });

  it("agrees with the pin on the total the message would quote", () => {
    expect(DATADOG_SURFACES.length).toBe(DATADOG_SDK_PIN.census.total);
    expect(DATADOG_SURFACES.length).toBe(1735);
  });
});

describe("datadogUndeclaredKinds", () => {
  it("reports none, so every registry row has a file to be published into", () => {
    expect(datadogUndeclaredKinds()).toStrictEqual([]);
  });
});
// The re-sync pair shares one double publish of its own, so the block carries a 60-second budget rather
// than vitest's default 20 seconds per test. Same measurement as the hook above: ~2.0s per publish on a
// quiet machine, and over 20s for a double publish while the full 1,892-file unit lane runs in parallel.
// Reproduce with `yarn test:unit`.

describe("syncDatadogCatalogue", () => {
  // The two console kinds are the walk's, so a compile writes every REGISTRY kind and leaves them alone.
  it("publishes a file for every registry kind plus the manifest, and never a console kind", () => {
    const outcome = sharedOutcome;

    expect(outcome.written.length).toBe(DATADOG_REGISTRY_KINDS.length + 1);
    expect(outcome.written.some((path) => path.endsWith("console-page.jsonl"))).toBe(false);
    expect(outcome.operationCount).toBe(1735);
    expect(outcome.kindCount).toBe(144);
    expect(outcome.sdkVersion).toBe("1.62.0");
  });

  it("reports the disposition of every operation, with all four members present", () => {
    const outcome = sharedOutcome;

    expect(outcome.dispositionCounts).toStrictEqual({
      entity: 654,
      excluded: 988,
      "probe-only": 3,
      "shape-index": 90,
    });
  });

  it("writes every registry row as an entity, so nothing is dropped between the registry and the store", () => {
    const snapshot = sharedSnapshot;
    const stored = DATADOG_KINDS.reduce((sum, kind) => {
      const file = snapshot.files[kind];
      // A kind the generation wrote no file for stores no entity.
      if (file == null) {
        return sum;
      }
      return sum + file.entities.length;
    }, 0);

    expect(stored).toBe(DATADOG_SURFACES.length);
  });

  // A `synced` compiled cell beside a `deferred` api cell is the whole point: a compiled operation is a
  // declaration, never a capability, and a coverage cell is where that refusal has to live.
  it("gives every kind one synced compiled cell and two deferred cells it cannot fill", () => {
    const file = sharedSnapshot.files["monitor"]!;
    const bySurface = new Map(file.coverage.map((cell) => [cell.surface, cell]));

    expect(bySurface.get(DATADOG_COMPILED_CHANNEL)!.state).toBe("synced");
    expect(bySurface.get(DATADOG_COMPILED_CHANNEL)!.role).toBe("discovery");
    expect(bySurface.get("api")!.state).toBe("deferred");
    expect(bySurface.get("console")!.state).toBe("deferred");
  });

  it("says in the api cell that nothing has asked this organisation anything", () => {
    const file = sharedSnapshot.files["monitor"]!;
    const api = file.coverage.find((cell) => cell.surface === "api")!;

    expect(api.reason).toContain("no call has been made to this organisation");
    expect(api.unblockedBy).toContain("synthetics");
  });

  // The compiled channel stores the registry row itself and withholds nothing, so the cell must not carry
  // the withholding sentence a live read's cell would.
  it("states the compiled cell's counts without claiming anything about this organisation", () => {
    const file = sharedSnapshot.files["monitor"]!;
    const compiled = file.coverage.find((cell) => cell.surface === DATADOG_COMPILED_CHANNEL)!;

    expect(compiled.reason).toContain("says NOTHING about what this organisation answers");
    expect(compiled.reason).toContain("@datadog/datadog-api-client 1.62.0");
  });

  // The console channel is the only one that could ever produce a screenshot, and the stored schema has no
  // home for one. This pins that the compiled path produces none, so the drop stays a stated precondition.
  it("produces no artifact on the compiled path, which is why the stored cell can omit the field", () => {
    const file = sharedSnapshot.files["monitor"]!;

    expect(Object.keys(file.coverage[0]!).includes("artifacts")).toBe(false);
  });

  it("raises the two per-kind gaps nothing this verb does can close", () => {
    const file = sharedSnapshot.files["monitor"]!;

    expect(file.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "api-never-called",
      "console-never-walked",
    ]);
    expect(file.gaps.every((gap) => gap.status === "open")).toBe(true);
  });

  // A gap saying "nothing has asked YET" promises a closure a live pass would deliver. For a kind excluded
  // whole no pass will ask at all, so the same sentence on both would be a false promise on one of them.
  it("tells an excluded kind's api gap apart from a pending one, because only one of them a live pass closes", () => {
    const snapshot = sharedSnapshot;
    const excluded = snapshot.files["synthetics"]!.gaps.find((gap) => gap.condition === "api-never-called")!;
    const pending = snapshot.files["monitor"]!.gaps.find((gap) => gap.condition === "api-never-called")!;

    expect(excluded.reason).toContain("nothing will ask this organisation for any of it");
    expect(excluded.reason).toContain("reason `unsupported-sensitive-shape`");
    expect(excluded.reason).toContain("closes when that exclusion is reversed, not when a live pass runs");
    expect(pending.reason).toContain("because this build has no live pass to ask with");
  });

  // The kind is still IN the atlas, gap and all — an atlas that dropped it would answer "synthetics is
  // covered" by saying nothing, which is the failure excluding rather than deleting the rows avoids.
  it("still files both gaps for the excluded kind, so its absence is never read as coverage", () => {
    const file = sharedSnapshot.files["synthetics"]!;

    expect(file.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "api-never-called",
      "console-never-walked",
    ]);
  });

  // The sibling Microsoft 365 sync writes its cross-kind gaps into every kind file, so a reader counting
  // open gaps counts one question 74 times. Datadog files them once.
  it("files the cross-kind gap ONCE, under the root kind", () => {
    const snapshot = sharedSnapshot;
    const root = snapshot.files[DATADOG_CROSS_KIND_GAP_KIND]!;
    const elsewhere = snapshot.files["monitor"]!;

    expect(root.gaps.map((gap) => gap.condition).toSorted()).toStrictEqual([
      "api-never-called",
      "console-never-walked",
      "sdk-undeclared-family",
    ]);
    expect(elsewhere.gaps.some((gap) => gap.condition === "sdk-undeclared-family")).toBe(false);
  });

  // One home, published at AT and re-published at LATER, read by both re-sync assertions. A COPY of the
  // shared home rather than the shared one, because the second publish is the thing under test, and a copy
  // rather than a second AT publish because the bytes are identical (`homeTemplate.ts` says why).
  describe("over a re-synced home", () => {
    let resynced: DatadogAtlasSnapshot;

    beforeAll(() => {
      const home = cloneHome({ prefix: "dd-sync-", template: sharedHome });
      homes.push(home);
      unwrap(syncDatadogCatalogue({ at: LATER, home }));
      resynced = unwrap(readDatadogAtlas({ home }));
    }, 60_000);

    it("is idempotent: a second run over the same home publishes the same entity count", () => {
      const snapshot = resynced;
      const stored = DATADOG_KINDS.reduce((sum, kind) => {
        const file = snapshot.files[kind];
        // A kind the generation wrote no file for stores no entity.
        if (file == null) {
          return sum;
        }
        return sum + file.entities.length;
      }, 0);

      expect(stored).toBe(DATADOG_SURFACES.length);
    });

    // An operation the catalogue has held since the first generation must not claim to have been discovered
    // today just because a later run re-published it.
    it("carries firstSeenAt forward across a re-sync while moving lastSeenAt", () => {
      const entity = resynced.files["monitor"]!.entities[0]!;

      expect(entity.channels["compiled-catalogue"]!.firstSeenAt).toBe(AT);
      expect(entity.channels["compiled-catalogue"]!.lastSeenAt).toBe(LATER);
    });
  });

  it("makes the read verb answer where it refused before", () => {
    const snapshot = unwrap(readDatadogSnapshot({ home: sharedHome }));
    const monitor = snapshot.kinds.find((kind) => kind.kind === "monitor")!;

    expect(snapshot.kinds.length).toBe(DATADOG_KINDS.length);
    expect(monitor.entities.length).toBeGreaterThan(0);
    expect(monitor.publishedCount).toBe(monitor.entities.length);
  });

  it("flips the compiled surface to filled and leaves the other two declared-unfilled", () => {
    const surfaces = unwrap(readDatadogSnapshot({ home: sharedHome })).descriptor.surfaces;
    const byName = new Map(surfaces.map((surface) => [surface.name, surface]));

    expect(byName.get("compiled-catalogue")!.status).toBe("filled");
    expect(byName.get("compiled-catalogue")!.unfilledBecause).toBe(null);
    expect(byName.get("api")!.status).toBe("declared-unfilled");
    expect(byName.get("console")!.status).toBe("declared-unfilled");
  });
}, 60_000);
