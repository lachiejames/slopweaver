import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type DatadogManifest, emptyDatadogManifest } from "../../../../atlas/datadog/documents.js";
import { DATADOG_KINDS } from "../../../../atlas/datadog/model.js";
import { resetDatadogAtlas } from "../../../../atlas/datadog/reset.js";
import { datadogAtlasPaths, publishDatadogAtlas, readDatadogAtlas } from "../../../../atlas/datadog/store.js";
import { emptyDatadogKindFile } from "../../../../atlas/datadog/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-06T01:00:00.000Z";
const LATER = "2026-09-07T01:00:00.000Z";

const homes: string[] = [];

/** A throwaway state home, so nothing here ever touches the ambient one. */
const freshHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "dd-reset-"));
  homes.push(home);
  return home;
};

/**
 * Publish a generation of ONE kind, which is all a reset needs to have something to archive.
 *
 * Deliberately not `syncDatadogCatalogue`: that publishes 1,735 entities across 144 files, and doing it two
 * or three times per test put this file over vitest's 20-second per-test timeout on a loaded machine while
 * passing on a quiet one. `sync.test.ts` is where the real sync belongs; what these tests are about is the
 * archive-and-restore protocol, which does not care how much the generation held.
 */
function publishOneKind({ home, at }: { home: string; at: string }): void {
  const manifest: DatadogManifest = emptyDatadogManifest({ updatedAt: at });
  const kinds = { ...manifest.kinds };
  kinds["monitor"] = {
    digest: null,
    entityCount: 0,
    lastAttempt: { at, outcome: "ok", reasons: [] },
    lastSuccessAt: at,
  };
  unwrap(
    publishDatadogAtlas({
      files: { monitor: emptyDatadogKindFile({ at, kind: "monitor" }) },
      home,
      manifest: { ...manifest, kinds },
      derivedFrom: null,
    }),
  );
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resetDatadogAtlas", () => {
  it("refuses when there is no current generation, rather than inventing one", () => {
    const reset = resetDatadogAtlas({ at: AT, home: join(freshHome(), "never-synced") });

    expect(reset.isErr()).toBe(true);
    expect(unwrapErr(reset)[0]).toContain("nothing to reset");
  });

  // Nothing is ever deleted: the archive is the whole protocol, and the owner's own rule is that a
  // deletion is the final step rather than the first.
  it("archives the current generation instead of deleting it", () => {
    const home = freshHome();
    publishOneKind({ at: AT, home });

    const outcome = unwrap(resetDatadogAtlas({ at: LATER, home }));

    expect(existsSync(outcome.archivedTo)).toBe(true);
    expect(readdirSync(outcome.archivedTo)).toStrictEqual(["manifest.json", "monitor.jsonl"]);
  });

  it("installs a fresh generation that is complete rather than partial", () => {
    const home = freshHome();
    publishOneKind({ at: AT, home });
    unwrap(resetDatadogAtlas({ at: LATER, home }));

    const snapshot = unwrap(readDatadogAtlas({ home }));
    const stored = DATADOG_KINDS.reduce((sum, kind) => {
      const file = snapshot.files[kind];
      // A kind the generation wrote no file for stores no entity.
      if (file == null) {
        return sum;
      }
      return sum + file.entities.length;
    }, 0);

    expect(stored).toBe(0);
    expect(snapshot.manifest!.updatedAt).toBe(LATER);
    expect(snapshot.missing).toStrictEqual([]);
  });

  it("refuses to overwrite an archive that already exists", () => {
    const home = freshHome();
    publishOneKind({ at: AT, home });
    unwrap(resetDatadogAtlas({ at: LATER, home }));

    const second = resetDatadogAtlas({ at: LATER, home });

    expect(second.isErr()).toBe(true);
    expect(unwrapErr(second)[0]).toContain("refusing to overwrite");
  });

  it("archives under the platform's own superseded directory", () => {
    const home = freshHome();
    publishOneKind({ at: AT, home });

    const outcome = unwrap(resetDatadogAtlas({ at: LATER, home }));

    expect(outcome.archivedTo.startsWith(datadogAtlasPaths({ home }).superseded)).toBe(true);
  });
});
