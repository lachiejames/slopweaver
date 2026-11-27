/**
 * The bump manifests a pull request commits under `.baselines/bumps/`, read on a real repository: only one the
 * change ADDS is read, and every added one must decode. Landing never reaches that read for an added file: the
 * baseline comparison it runs first refuses any write under the bump directory.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { measureLanding } from "../../../codex/baselineBumpLanding.js";
import { placeRecords } from "../../../codex/baselineBumpPlacement.js";
import { readBaselineBumpWitness } from "../../../codex/baselineBumpWitnessRun.js";
import { committedBumpManifests, landingBumpRecords } from "../../../codex/committedBumpManifests.js";
import { type BumpManifest, type BumpRow, digestOf } from "../../../devLint/baselineBump.js";
import { BaselineComparisonErrors } from "../../../devLint/baselineComparison.js";
import { memorySupersessionPort } from "../../landingRegistersFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SIZE = ".baselines/file-size-baseline.json";
const ROW: BumpRow = { cause: "growth", entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 };

/**
 * A manifest declaring the one row against a base.
 *
 * @returns the manifest
 */
function manifestAgainst({ base }: { base: string }): BumpManifest {
  return { base, digest: digestOf({ base, rows: [ROW] }), loosenings: [ROW], reason: "r" };
}

/** Where a manifest is committed, under its own digest. */
const committedPath = ({ manifest }: { manifest: BumpManifest }): string => `.baselines/bumps/${manifest.digest}.json`;

let root = "";
let home = "";
let base = "";
let quiet = "";
let declared = "";
let raisedOnly = "";
let misnamed = "";
let malformedOnly = "";
let renamedOnly = "";
let manifest: BumpManifest;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "committed-bumps-"));
  home = mkdtempSync(join(tmpdir(), "committed-bumps-home-"));
  const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: root });
  const put = ({ path, text }: { path: string; text: string }): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const commit = ({ message }: { message: string }): string => {
    git("add", ".");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const raise = (): void => {
    put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [{ codeLines: 319, path: "tools/gen.ts" }] }) });
  };
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("remote", "add", "origin", "https://github.com/acme/widget.git");
  put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [] }) });
  put({ path: "tools/gen.ts", text: "export {};\n" });
  const held = manifestAgainst({ base: "f".repeat(40) });
  put({ path: committedPath({ manifest: held }), text: `${JSON.stringify(held, null, 2)}\n` });
  base = commit({ message: "base, holding one manifest of main's" });
  put({ path: "src/other.ts", text: "export {};\n" });
  quiet = commit({ message: "quiet" });
  git("checkout", "-q", "--detach", base);
  manifest = manifestAgainst({ base });
  raise();
  put({ path: committedPath({ manifest }), text: `${JSON.stringify(manifest, null, 2)}\n` });
  declared = commit({ message: "the rise, with its manifest committed" });
  git("checkout", "-q", "--detach", base);
  raise();
  raisedOnly = commit({ message: "the rise, declared nowhere in the tree" });
  git("checkout", "-q", "--detach", base);
  raise();
  put({ path: ".baselines/bumps/notes.json", text: `${JSON.stringify(manifest, null, 2)}\n` });
  misnamed = commit({ message: "the rise, with its manifest under a name its digest does not give" });
  git("checkout", "-q", "--detach", base);
  put({ path: `.baselines/bumps/${"0".repeat(64)}.json`, text: "{}\n" });
  malformedOnly = commit({ message: "no rise, only a manifest that does not decode" });
  git("checkout", "-q", "--detach", base);
  git("mv", committedPath({ manifest: held }), ".baselines/bumps/notes.json");
  renamedOnly = commit({ message: "no rise, main's manifest renamed inside the directory to a name it does not give" });
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
  rmSync(home, { force: true, recursive: true });
});

describe("committedBumpManifests", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("reads the manifest a change adds, filed under its own path", () => {
    expect(unwrap(committedBumpManifests({ base, candidate: declared, root }))).toEqual([
      { manifest, path: committedPath({ manifest }) },
    ]);
  });

  it("passes over a manifest main already holds, as history", () => {
    expect(unwrap(committedBumpManifests({ base, candidate: quiet, root }))).toEqual([]);
  });

  it("refuses the whole read when an added file is not a manifest filed under its own digest", () => {
    expect(unwrapErr(committedBumpManifests({ base, candidate: misnamed, root })).message).toContain(
      ".baselines/bumps/notes.json",
    );
  });

  it("reads a manifest renamed inside the directory as an addition, whatever git calls the move", () => {
    expect(unwrapErr(committedBumpManifests({ base, candidate: renamedOnly, root })).message).toContain(
      ".baselines/bumps/notes.json",
    );
  });

  it("judges a declaration kept both in the home and in the tree once, as the home's record", () => {
    const stored = [{ manifest, path: `ledgers/baseline-bumps/${manifest.digest}.json` }];
    const committed = unwrap(committedBumpManifests({ base, candidate: declared, root }));

    expect(landingBumpRecords({ committed, stored })).toEqual(stored);
    expect(landingBumpRecords({ committed, stored: [] })).toEqual([{ manifest, path: committedPath({ manifest }) }]);
  });

  it("refuses a landing that loosens nothing but adds a manifest that does not decode, before reading it", async () => {
    const verdict = await readBaselineBumpWitness({
      cwd: root,
      head: { baseSha: base, branch: "feature", headSha: malformedOnly, repository: "acme/widget" },
      home,
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toMatchObject({
      details: [
        "the baselines could not be compared against the base: " +
          BaselineComparisonErrors.bumpDirectoryWrite({
            path: `.baselines/bumps/${"0".repeat(64)}.json`,
            write: { kind: "added" },
          }).message,
      ],
      kind: "refused",
    });
  });

  it("refuses a committed manifest rather than carrying it to the witness, with nothing in the home", async () => {
    const verdict = await readBaselineBumpWitness({
      cwd: root,
      head: { baseSha: base, branch: "feature", headSha: declared, repository: "acme/widget" },
      home,
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toMatchObject({
      details: [
        "the baselines could not be compared against the base: " +
          BaselineComparisonErrors.bumpDirectoryWrite({ path: committedPath({ manifest }), write: { kind: "added" } })
            .message,
      ],
      kind: "refused",
    });
  });
});

describe("measureLanding", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  const headOf = ({ headSha }: { headSha: string }) => ({
    baseSha: base,
    branch: "feature",
    headSha,
    repository: "acme/widget",
  });

  it("measures the merge landing would produce, with what it loosens against the base", () => {
    const measured = measureLanding({
      baseSha: base,
      candidates: { ownRoot: root, roots: [root] },
      head: headOf({ headSha: raisedOnly }),
    });

    expect(measured).toMatchObject({ kind: "measured", root });
    expect(measured).toMatchObject({
      comparison: { loosened: [{ entry: ROW.entry, file: SIZE, from: null, to: 319 }] },
    });
  });

  it("refuses when no checkout considered holds both commits", () => {
    expect(
      measureLanding({
        baseSha: base,
        candidates: { ownRoot: undefined, roots: [] },
        head: headOf({ headSha: declared }),
      }),
    ).toMatchObject({
      details: [expect.stringContaining(`checkout holding base ${base} and head ${declared}`)],
      kind: "refused",
    });
  });
});

describe("placeRecords", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("places a record declared against main's own commit, with nothing making it ineligible", () => {
    const record = { manifest, path: committedPath({ manifest }) };

    expect(
      placeRecords({ applicable: [record], baseSha: base, candidate: declared, changedPaths: new Set(), root }),
    ).toEqual({ kind: "placed", records: [{ ineligible: [], record }] });
  });

  it("drops a record whose base commit this checkout does not hold, as inert history", () => {
    const foreign = manifestAgainst({ base: "f".repeat(40) });

    expect(
      placeRecords({
        applicable: [{ manifest: foreign, path: committedPath({ manifest: foreign }) }],
        baseSha: base,
        candidate: declared,
        changedPaths: new Set(),
        root,
      }),
    ).toEqual({ kind: "placed", records: [] });
  });
});
