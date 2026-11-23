/**
 * The two guards a walk publisher owes, tested directly rather than through a platform.
 *
 * Both were found by counterexample and both fail SAFE in the wrong direction if written naively: a
 * denominator taken from the caller reports full coverage over an empty walk, and evidence read from a
 * reference reports full coverage over screenshots that exist nowhere.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { screenshotArtifact } from "../../../../atlas/kit/pageScreenshot.js";
import type { PageObservation } from "../../../../atlas/kit/pageWalk.js";
import { refuseUndeclaredWalk, verifyArtifactsOnDisk, walkTally } from "../../../../atlas/kit/walkPublish.js";
import { unwrapErr } from "../../../../lib/result.js";

const DECLARED = ["one", "two", "three"];

const scratch: string[] = [];

/** A throwaway directory, removed after the test that made it. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-walk-publish-"));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One observation, with only the fields a test is about stated. */
function observation({ over }: { over: Partial<PageObservation<string>> }): PageObservation<string> {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://toy.test/one",
    observedAt: "2026-09-05T00:00:00.000Z",
    redirected: false,
    requestedUrl: "https://toy.test/one",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "one",
    title: "One",
    unreachableBecause: null,
    ...over,
  };
}

/** One observation per declared surface. */
function fullWalk({ over }: { over: Partial<PageObservation<string>> }): readonly PageObservation<string>[] {
  return DECLARED.map((surface) => observation({ over: { ...over, surface } }));
}

describe("walkTally", () => {
  const shot = screenshotArtifact({ artifactPathFor: ({ sha256 }) => sha256, bytes: new Uint8Array([1]) });

  it("counts a reached page", () => {
    expect(walkTally({ pages: fullWalk({ over: {} }) }).reached).toBe(3);
  });

  it("counts a photographed page only when it carries its artifact", () => {
    expect(walkTally({ pages: fullWalk({ over: {} }) }).photographed).toBe(0);
  });

  it("counts a page that is reached AND carries its artifact as photographed", () => {
    expect(walkTally({ pages: fullWalk({ over: { artifacts: [shot] } }) }).photographed).toBe(3);
  });

  it("does not count a page that was never attempted as reached", () => {
    expect(walkTally({ pages: fullWalk({ over: { attempted: false } }) }).reached).toBe(0);
  });
});

describe("refuseUndeclaredWalk", () => {
  it("accepts a walk that covers the declared list exactly", () => {
    expect(refuseUndeclaredWalk({ declaredSurfaces: DECLARED, pages: fullWalk({ over: {} }) }).isOk()).toBe(true);
  });

  // The failure this guard exists for: nought of nought is all of them.
  it("refuses an empty walk rather than letting a publisher report full coverage over nothing", () => {
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED, pages: [] });
    expect(unwrapErr(refused)[0]).toBe(
      "this walk does not cover the declared page list: 3 declared page(s) absent, " +
        "0 row(s) for a page that is not declared, 0 duplicated row(s)",
    );
  });

  it("refuses a short walk", () => {
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED, pages: fullWalk({ over: {} }).slice(1) });
    expect(unwrapErr(refused)[0]).toBe(
      "this walk does not cover the declared page list: 1 declared page(s) absent, " +
        "0 row(s) for a page that is not declared, 0 duplicated row(s)",
    );
  });

  it("refuses a row for a page that is not declared", () => {
    const pages = [...fullWalk({ over: {} }), observation({ over: { surface: "invented" } })];
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED, pages });
    expect(unwrapErr(refused)[0]).toBe(
      "this walk does not cover the declared page list: 0 declared page(s) absent, " +
        "1 row(s) for a page that is not declared, 0 duplicated row(s)",
    );
  });

  it("refuses a duplicated row, because coverage is keyed on the surface name", () => {
    const pages = [...fullWalk({ over: {} }), observation({ over: { surface: "one" } })];
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED, pages });
    expect(unwrapErr(refused)[0]).toBe(
      "this walk does not cover the declared page list: 0 declared page(s) absent, " +
        "0 row(s) for a page that is not declared, 1 duplicated row(s)",
    );
  });

  it("says how many declared pages were absent, so a reader can act on the refusal", () => {
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED, pages: [] });
    expect(refused.isErr() ? refused.error[0] : "").toContain("3 declared page(s) absent");
  });
});

describe("verifyArtifactsOnDisk", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const artifact = screenshotArtifact({ artifactPathFor: ({ sha256 }) => `artifacts/pages/${sha256}.png`, bytes });

  /** Write one artifact's bytes into a directory, as a real walk would. */
  function place({ directory, content }: { directory: string; content: Uint8Array }): void {
    const path = join(directory, artifact.relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  it("keeps an artifact whose bytes are on disk and still hash to their digest", () => {
    const directory = scratchDir();
    place({ content: bytes, directory });
    const checked = verifyArtifactsOnDisk({ directory, pages: [observation({ over: { artifacts: [artifact] } })] });
    expect(checked[0]!.artifacts).toEqual([artifact]);
  });

  // A caller can hand over a reference with no file behind it; a grader reading only the reference publishes
  // `synced` coverage over screenshots that exist nowhere.
  it("strips an artifact reference with no file behind it", () => {
    const checked = verifyArtifactsOnDisk({
      directory: scratchDir(),
      pages: [observation({ over: { artifacts: [artifact] } })],
    });
    expect(checked[0]!.artifacts).toEqual([]);
  });

  it("records WHY a page lost its screenshot, rather than dropping it silently", () => {
    const checked = verifyArtifactsOnDisk({
      directory: scratchDir(),
      pages: [observation({ over: { artifacts: [artifact] } })],
    });
    expect(checked[0]!.screenshotMissingBecause).toContain("absent from the atlas directory");
  });

  it("strips an artifact whose bytes no longer hash to the digest they are addressed by", () => {
    const directory = scratchDir();
    place({ content: new Uint8Array([9, 9, 9, 9]), directory });
    const checked = verifyArtifactsOnDisk({ directory, pages: [observation({ over: { artifacts: [artifact] } })] });
    expect(checked[0]!.artifacts).toEqual([]);
  });

  it("leaves a page with no artifacts at all untouched", () => {
    const checked = verifyArtifactsOnDisk({ directory: scratchDir(), pages: [observation({ over: {} })] });
    expect(checked[0]!.screenshotMissingBecause).toBe(null);
  });
});
