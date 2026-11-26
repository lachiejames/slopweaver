/**
 * The landing half of a ratchet bump, read on a real repository: what a landing measures, which records it
 * places, and where those records come from — the state home and nowhere else. A record the home holds, with its
 * exact Codex witness, clears the landing; the same declaration committed under `.baselines/bumps/` declares
 * nothing, and the landing refuses the file itself.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import { RECORD_FILENAME } from "../../../codex/artifactStore.js";
import { measureLanding } from "../../../codex/baselineBumpLanding.js";
import { placeRecords } from "../../../codex/baselineBumpPlacement.js";
import { readBaselineBumpWitness } from "../../../codex/baselineBumpWitnessRun.js";
import { bumpRecordPath, writeBumpRecord } from "../../../codex/bumpRecordStore.js";
import { commitDiffsNow } from "../../../codex/diffsNow.js";
import { commitTreeFingerprint, resolveRepoRoot } from "../../../codex/gitDiff.js";
import {
  type BumpManifest,
  type BumpRow,
  digestOf,
  witnessClaim,
  witnessPropertyId,
} from "../../../devLint/baselineBump.js";
import { BaselineComparisonErrors } from "../../../devLint/baselineComparison.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memorySupersessionPort } from "../../landingRegistersFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SIZE = ".baselines/file-size-baseline.json";
const ROW: BumpRow = { cause: "widening", entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 };

/**
 * A manifest declaring the one row against a base.
 *
 * @returns the manifest
 */
function manifestAgainst({ base }: { base: string }): BumpManifest {
  return { base, digest: digestOf({ base, rows: [ROW] }), loosenings: [ROW], reason: "r" };
}

/** Where the home keeps a record, relative to the home. */
const homePath = ({ manifest }: { manifest: BumpManifest }): string =>
  bumpRecordPath({ name: `${manifest.digest}.json` });

let root = "";
const made: string[] = [];
let base = "";
let raised = "";
let committed = "";
let addedOnly = "";
let manifest: BumpManifest;

/** A fresh empty directory, removed after the file. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "bump-landing-"));
  made.push(dir);
  return dir;
}

beforeAll(() => {
  root = scratch();
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
  base = commit({ message: "base" });
  raise();
  raised = commit({ message: "the rise, declared nowhere in the tree" });
  manifest = manifestAgainst({ base });
  put({ path: `.baselines/bumps/${manifest.digest}.json`, text: `${JSON.stringify(manifest, null, 2)}\n` });
  committed = commit({ message: "the rise, with a declaration committed beside it" });
  git("checkout", "-q", "--detach", base);
  put({ path: `.baselines/bumps/${"0".repeat(64)}.json`, text: "{}\n" });
  addedOnly = commit({ message: "no rise, only a file added under the bump directory" });
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A home holding the record, and a CLEAN r3 Codex review of its exact claim recorded against the raised head —
 * current there, with no uncommitted bytes, its base pinned to the pull request's base commit.
 *
 * @returns the home
 */
function homeWithWitnessedRecord(): string {
  const home = scratch();
  unwrap(writeBumpRecord({ home, manifest }));
  const atHead = unwrap(commitTreeFingerprint({ commit: raised, cwd: root }));
  const diffSha256 = commitDiffsNow({ baseRefs: [base], commit: raised, cwd: root }).get(base)!;
  const propertyId = witnessPropertyId({ digest: manifest.digest });
  const run = join(stateHomePaths({ home }).orchestration, "witness-1");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "artifact.md"), "# witness-1\n");
  writeFileSync(
    join(run, RECORD_FILENAME),
    JSON.stringify({
      artifactId: "witness-1",
      attempts: [],
      bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
      createdAtIso: "2026-11-02T01:00:00.000Z",
      observedElapsedMs: 10,
      outcome: {
        answer: { counterexample: "", evidence: "read", propertyId, summary: "", verdict: "CLEAN" },
        kind: "answered",
        rawFinalResponse: "{}",
      },
      repoRoot: unwrap(resolveRepoRoot({ cwd: root })),
      requestedApprovalPolicy: "never",
      requestedModel: "m",
      requestedNetworkAccess: true,
      requestedReasoningEffort: "medium",
      requestedSandboxMode: "workspace-write",
      requestedWebSearch: true,
      requestedWritableRoots: [],
      schemaVersion: 1,
      scope: {
        baseRef: base,
        baseSha: base,
        diffBytes: 100,
        diffSha256,
        headSha: raised,
        mode: "review",
        pass: "r3",
        property: { id: propertyId, statement: witnessClaim({ manifest }) },
      },
      tree: { branch: "feature", dirtyBytes: 0, fingerprint: atHead.digest, headSha: raised, treeSha: atHead.treeSha },
    }),
  );
  return home;
}

/** The pull request under judgement, on `feature` against the fixture's base. */
const headOf = ({ headSha }: { headSha: string }) => ({
  baseSha: base,
  branch: "feature",
  headSha,
  repository: "acme/widget",
});

describe("readBaselineBumpWitness reads records from the state home only", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("clears a rise the home's record declares and its exact Codex witness judged CLEAN", async () => {
    const verdict = await readBaselineBumpWitness({
      cwd: root,
      head: headOf({ headSha: raised }),
      home: homeWithWitnessedRecord(),
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toEqual({ kind: "clear" });
  });

  it("names the home's record when no witness judged it, so the record is what the landing read", async () => {
    const home = scratch();
    unwrap(writeBumpRecord({ home, manifest }));

    const verdict = await readBaselineBumpWitness({
      cwd: root,
      head: headOf({ headSha: raised }),
      home,
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toMatchObject({
      details: [
        `the store bump records do not cover what this pull request loosens against ${base.slice(0, 12)}:`,
        `  ${SIZE} offenders:tools/gen.ts: null -> 319 (no applicable store bump record declaring it has a ` +
          "qualifying Codex witness)",
        expect.stringContaining(`${homePath({ manifest })} has no Codex witness`),
      ],
      kind: "refused",
    });
  });

  it("refuses a declaration the change commits under .baselines/bumps/, even with the home empty", async () => {
    const verdict = await readBaselineBumpWitness({
      cwd: root,
      head: headOf({ headSha: committed }),
      home: scratch(),
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toEqual({
      details: [
        "the baselines could not be compared against the base: " +
          BaselineComparisonErrors.addedBumpManifest({ path: `.baselines/bumps/${manifest.digest}.json` }).message,
      ],
      kind: "refused",
    });
  });

  it("refuses a change that loosens nothing but adds a file under .baselines/bumps/, before any quiet clear", async () => {
    const verdict = await readBaselineBumpWitness({
      cwd: root,
      head: headOf({ headSha: addedOnly }),
      home: scratch(),
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toEqual({
      details: [
        "the baselines could not be compared against the base: " +
          BaselineComparisonErrors.addedBumpManifest({ path: `.baselines/bumps/${"0".repeat(64)}.json` }).message,
      ],
      kind: "refused",
    });
  });
});

describe("measureLanding", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("measures the merge landing would produce, with what it loosens against the base", () => {
    const measured = measureLanding({
      baseSha: base,
      candidates: { ownRoot: root, roots: [root] },
      head: headOf({ headSha: raised }),
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
        head: headOf({ headSha: raised }),
      }),
    ).toMatchObject({
      details: [expect.stringContaining(`checkout holding base ${base} and head ${raised}`)],
      kind: "refused",
    });
  });
});

describe("placeRecords", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("places a record declared against main's own commit, with nothing making it ineligible", () => {
    const record = { manifest, path: homePath({ manifest }) };

    expect(
      placeRecords({ applicable: [record], baseSha: base, candidate: raised, changedPaths: new Set(), root }),
    ).toEqual({ kind: "placed", records: [{ ineligible: [], record }] });
  });

  it("drops a record whose base commit this checkout does not hold, as inert history", () => {
    const foreign = manifestAgainst({ base: "f".repeat(40) });

    expect(
      placeRecords({
        applicable: [{ manifest: foreign, path: homePath({ manifest: foreign }) }],
        baseSha: base,
        candidate: raised,
        changedPaths: new Set(),
        root,
      }),
    ).toEqual({ kind: "placed", records: [] });
  });
});
