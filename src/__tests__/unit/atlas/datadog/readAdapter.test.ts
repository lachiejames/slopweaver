import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatadogSnapshot } from "../../../../atlas/datadog/readAdapter.js";
import { syncDatadogCatalogue } from "../../../../atlas/datadog/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-06T01:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, so nothing here ever touches the ambient one. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "dd-read-"));
  homes.push(home);
  return home;
};

/**
 * One published generation, read by every assertion in the second block.
 *
 * A full sync writes 1,735 entities across 144 files; re-running it per test put the sibling `reset` and
 * `sync` suites over vitest's 20-second per-test timeout on a loaded machine. None of these tests writes,
 * so one generation serves them all.
 *
 * `beforeAll` carries an explicit 60-second budget because vitest's default HOOK timeout is 10 seconds
 * rather than the 20 a test gets, and this publish does not fit in it under load. MEASURED: the
 * sync itself runs in ~2.0s on a quiet machine and the hook exceeded 10s while the full 1,892-file unit
 * lane ran in parallel, failing the whole FILE with `Hook timed out in 10000ms` and zero failing tests.
 * Reproduce the quiet number with `yarn vitest run --config config/vitest/unit.ts <this file>` and the
 * loaded one with `yarn test:unit`.
 */
let syncedHome = "";

beforeAll(() => {
  syncedHome = freshHome();
  unwrap(syncDatadogCatalogue({ at: AT, home: syncedHome }));
}, 60_000);

afterAll(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("readDatadogSnapshot with no generation", () => {
  // An empty snapshot would answer "zero monitors" to a question about this organisation's alerting, which
  // is FALSE and indistinguishable from an organisation with none.
  it("REFUSES rather than answering an empty atlas, because empty and unpublished are different answers", () => {
    const snapshot = readDatadogSnapshot({ home: join(freshHome(), "never-synced") });

    expect(snapshot.isErr()).toBe(true);
    expect(unwrapErr(snapshot).code).toBe("ATLAS_GENERATION_UNPUBLISHED");
  });

  // `kit/answerable.ts` already refuses this state for every atlas; what this adapter adds is a REMEDY only
  // Datadog can write, and the generic one would not carry any of the three sentences below.
  it("names the platform and the one command that would change it", () => {
    const error = unwrapErr(readDatadogSnapshot({ home: join(freshHome(), "never-synced") }));

    expect(error.message).toContain("datadog");
    expect(error.message).toContain("slopweaver atlas datadog sync");
    expect(error.message).toContain("needs no credential");
  });

  // The registry IS committed to this repository, so "the atlas knows every operation" is true of the CODE
  // and not yet of any generation. Conflating those is the first thing a reader would get wrong.
  it("separates the committed registry from the absent generation, in words", () => {
    const error = unwrapErr(readDatadogSnapshot({ home: join(freshHome(), "never-synced") }));

    expect(error.message).toContain("generated/surfaces.ts");
    expect(error.message).toContain("1,735-operation registry");
  });

  it("warns that a sync fills ONE of the three surfaces, so a reader does not read it as all of them", () => {
    const error = unwrapErr(readDatadogSnapshot({ home: join(freshHome(), "never-synced") }));

    expect(error.message).toContain("`api`");
    expect(error.message).toContain("console");
  });
});

describe("readDatadogSnapshot over a published generation", () => {
  it("projects the compiled channel into one observation per entity", () => {
    const monitor = unwrap(readDatadogSnapshot({ home: syncedHome })).kinds.find((kind) => kind.kind === "monitor")!;
    const entity = monitor.entities[0]!;

    expect(entity.observations.length).toBe(1);
    expect(entity.observations[0]!.surface).toBe("compiled-catalogue");
    expect(entity.observations[0]!.state).toBe("observed");
  });

  it("scopes an entity to the pinned client, which is what the store holds", () => {
    const monitor = unwrap(readDatadogSnapshot({ home: syncedHome })).kinds.find((kind) => kind.kind === "monitor")!;

    expect(monitor.entities[0]!.scope).toBe("@datadog/datadog-api-client 1.62.0");
  });

  it("reports the generation as whole, with nothing missing, mismatched or unpublished", () => {
    const generation = unwrap(readDatadogSnapshot({ home: syncedHome })).generation;

    expect(generation.missing).toStrictEqual([]);
    expect(generation.mismatched).toStrictEqual([]);
    expect(generation.unpublished).toStrictEqual([]);
    // `superseded` is the fourth of the store's ways a generation can disagree with its manifest, and the
    // compiler did NOT catch this adapter omitting it — `read --kind` threw `not iterable` at runtime
    // instead. Asserted rather than assumed for that reason.
    expect(generation.superseded).toStrictEqual([]);
    expect(generation.updatedAt).toBe(AT);
  });

  // The cell's `surface` is the CHANNEL, and `coverageCore.ts` decides a declared surface is filled by
  // matching that name. A cell carrying the kind there would make every surface read declared-unfilled.
  it("carries the three channel names as the coverage cells' surfaces", () => {
    const monitor = unwrap(readDatadogSnapshot({ home: syncedHome })).kinds.find((kind) => kind.kind === "monitor")!;

    expect(monitor.coverage.map((cell) => cell.surface).toSorted()).toStrictEqual([
      "api",
      "compiled-catalogue",
      "console",
    ]);
    expect(monitor.coverage.every((cell) => cell.scope === "monitor")).toBe(true);
  });

  // `kit/answerable.ts`'s dark check is `publishedCount > 0 && entities.length === 0`. Every Datadog kind
  // exists because the registry carries rows for it, so a whole sync leaves no kind dark — this is the
  // assertion that says so rather than assuming it.
  it("leaves no kind the manifest vouches for and the reader cannot see", () => {
    const kinds = unwrap(readDatadogSnapshot({ home: syncedHome })).kinds;
    const dark = kinds.filter((kind) => kind.publishedCount > 0 && kind.entities.length === 0);

    expect(dark.map((kind) => kind.kind)).toStrictEqual([]);
  });
});
