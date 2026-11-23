/*
 * The effectful witness read (`src/codex/baselineBumpWitnessRun.ts`): which store bump records count against what
 * a pull request loosens, and its fail-closed edges — what it cannot establish refuses with its reason, and never
 * reads as "no records".
 *
 * One real repository serves every case: its commits are read, never moved, so building it per case cost a
 * dozen seconds of git a case for nothing. MEASURED, built per case: the file took 122s for 10 cases;
 * `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/codex/baselineBumpWitnessRun.test.ts --reporter=verbose`
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { err, unwrap } from "#lib/result.js";

import { RECORD_FILENAME } from "../../../codex/artifactStore.js";
import { originBranchTip, readBaselineBumpWitness } from "../../../codex/baselineBumpWitnessRun.js";
import { bumpRecordPath, writeBumpRecord } from "../../../codex/bumpRecordStore.js";
import { SupersessionStoreErrors } from "../../../codex/supersessionErrors.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { type BumpManifest, type BumpRow, digestOf, witnessPropertyId } from "../../../devLint/baselineBump.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memorySupersessionPort } from "../../landingRegistersFixture.js";
import { gitInTemp, REAL_GIT_TIMEOUT_MS } from "../../tempGitRepo.js";

const SIZE = ".baselines/file-size-baseline.json";

// deleted-with-code: declaredLoosenings, misbasedLines

const ROW: BumpRow = { cause: "widening", entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 };
const NOWHERE = "f".repeat(40);

/**
 * A bump record declaring one row against a base.
 *
 * @returns the manifest
 */
function recordAgainst({ base, row = ROW }: { base: string; row?: BumpRow }): BumpManifest {
  return { base, digest: digestOf({ base, rows: [row] }), loosenings: [row], reason: "r" };
}

/** Where a record is kept, relative to the home. */
const pathOf = ({ manifest }: { manifest: BumpManifest }): string =>
  bumpRecordPath({ name: `${manifest.digest}.json` });

/** The fixture's commits, by what each one is for. */
interface Commits {
  readonly base: string;
  readonly quiet: string;
  readonly head: string;
  readonly touched: string;
  readonly mainMoved: string;
  readonly mainRaised: string;
  readonly misbased: string;
}

/**
 * A real repository whose origin is acme/widget: a base commit; on one line, a head that loosens nothing and a
 * head that raises the file-size baseline; beside it the same rise made by a change that also edits the file the
 * row names; and main moving on from the base, then raising the row itself, with a change raising it further.
 *
 * @returns the commits
 */
function rises({ root }: { root: string }): Commits {
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
  const sized = ({ codeLines }: { codeLines: number }): string =>
    JSON.stringify({ exempt: [], offenders: [{ codeLines, path: "tools/gen.ts" }] });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("remote", "add", "origin", "https://github.com/acme/widget.git");
  put({ path: SIZE, text: JSON.stringify({ exempt: [], offenders: [] }) });
  put({ path: "tools/gen.ts", text: "export {};\n" });
  const base = commit({ message: "base" });
  put({ path: "src/other.ts", text: "export {};\n" });
  const quiet = commit({ message: "quiet" });
  put({ path: SIZE, text: sized({ codeLines: 319 }) });
  const head = commit({ message: "head" });
  git("checkout", "-q", "--detach", base);
  put({ path: SIZE, text: sized({ codeLines: 319 }) });
  put({ path: "tools/gen.ts", text: "export const grown = 1;\n" });
  const touched = commit({ message: "the rise, and an edit to the file it names" });
  git("checkout", "-q", "--detach", base);
  put({ path: "src/later.ts", text: "export {};\n" });
  const mainMoved = commit({ message: "main moves on" });
  put({ path: SIZE, text: sized({ codeLines: 300 }) });
  const mainRaised = commit({ message: "main raises the row to 300 itself" });
  put({ path: SIZE, text: sized({ codeLines: 310 }) });
  const misbased = commit({ message: "300 -> 310 measured against main" });
  return { base, head, mainMoved, mainRaised, misbased, quiet, touched };
}

const made: string[] = [];

/** A fresh empty directory, removed after the case. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "bump-witness-"));
  made.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A depth-1 clone of the fixture holding both commits and none of their history — the checkout that holds every
 * object asked for yet cannot compute a merge base — with its origin pointed back at acme/widget.
 *
 * @returns the clone's path
 */
function shallowCheckout({ root, into, commits }: { root: string; into: string; commits: Commits }): string {
  gitInTemp({ args: ["branch", "moved", commits.mainMoved], cwd: root });
  gitInTemp({ args: ["branch", "quiet", commits.quiet], cwd: root });
  const shallow = join(into, "shallow");
  gitInTemp({ args: ["clone", "--quiet", "--depth", "1", "--branch", "moved", `file://${root}`, shallow], cwd: root });
  gitInTemp({ args: ["fetch", "--quiet", "--depth", "1", "origin", "quiet"], cwd: shallow });
  gitInTemp({ args: ["remote", "set-url", "origin", "https://github.com/acme/widget.git"], cwd: shallow });
  return shallow;
}

/**
 * A state home whose profile declares the given main checkouts.
 *
 * @returns the home
 */
function homeDeclaring({ paths }: { paths: readonly string[] }): string {
  const home = scratch();
  const profile = { displayName: "", gitNamespace: "", id: "me", mainCheckouts: paths.map((path) => ({ path })) };
  writeFileSync(join(home, "profile.json"), JSON.stringify({ ...profile, schemaVersion: 1, sources: [] }), "utf8");
  return home;
}

/**
 * A state home holding the given bump records, written by the real writer, and optionally one pass record that
 * does not parse.
 *
 * @returns the home
 */
function homeHolding({
  records,
  unreadablePass = false,
}: {
  records: readonly BumpManifest[];
  unreadablePass?: boolean;
}): string {
  const home = scratch();
  for (const manifest of records) {
    unwrap(writeBumpRecord({ home, manifest }));
  }
  if (unreadablePass) {
    const run = join(stateHomePaths({ home }).orchestration, "run-1");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "artifact.md"), "# a pass\n", "utf8");
    writeFileSync(join(run, RECORD_FILENAME), "{ not json", "utf8");
  }
  return home;
}

/** A supersession register the store cannot reach — a plain fake, never a mock. */
const UNREACHABLE: SupersessionPort = {
  append: async () => err(SupersessionStoreErrors.storeUnavailable({ doing: "connect", reason: "offline" })),
  read: async () => err(SupersessionStoreErrors.storeUnavailable({ doing: "connect", reason: "offline" })),
};

let fixture: string;
let commits: Commits;
let shallow: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "bump-witness-fixture-"));
  const root = join(fixture, "repo");
  mkdirSync(root);
  commits = rises({ root });
  shallow = shallowCheckout({ commits, into: fixture, root });
}, REAL_GIT_TIMEOUT_MS);

afterAll(() => {
  rmSync(fixture, { force: true, recursive: true });
});

/** The fixture's full-history checkout. */
const repo = (): string => join(fixture, "repo");

/**
 * Read the witness for one head of the fixture against one base.
 *
 * @returns the verdict
 */
function readFor({
  base,
  headSha,
  cwd = repo(),
  home = scratch(),
  supersessions = memorySupersessionPort(),
}: {
  base: string;
  headSha: string;
  cwd?: string;
  home?: string;
  supersessions?: SupersessionPort;
}): ReturnType<typeof readBaselineBumpWitness> {
  return readBaselineBumpWitness({
    cwd,
    head: { baseSha: base, branch: "feature", headSha, repository: "acme/widget" },
    home,
    supersessions,
  });
}

/** The refusal's opening line against a base. */
const header = ({ base }: { base: string }): string =>
  `the store bump records do not cover what this pull request loosens against ${base.slice(0, 12)}:`;

/** The rise every case but one judges, with why it is uncovered. */
const uncovered = ({ declared }: { declared: boolean }): string =>
  `  ${SIZE} offenders:tools/gen.ts: null -> 319 (${
    declared
      ? "no applicable store bump record declaring it has a qualifying Codex witness"
      : "no applicable store bump record declares this loosening"
  })`;

describe("readBaselineBumpWitness", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it("refuses when GitHub named no base commit, since what it loosens cannot be judged against nothing", async () => {
    const verdict = await readBaselineBumpWitness({
      cwd: scratch(),
      head: { baseSha: undefined, branch: "feature", headSha: "cafe1234", repository: "acme/widget" },
      home: scratch(),
      supersessions: memorySupersessionPort(),
    });

    expect(verdict).toEqual({
      details: ["the pull request's base commit is unknown, so what it loosens cannot be judged"],
      kind: "refused",
    });
  });

  it("refuses when no checkout of the repository exists here, rather than reading as no records", async () => {
    const verdict = await readFor({ base: "ba5e0000", cwd: scratch(), headSha: "cafe1234" });

    expect(verdict).toEqual({
      details: [
        "none of the 0 checkout(s) of acme/widget here is a full-history checkout holding base ba5e0000 and head " +
          "cafe1234, and fetching them from origin did not supply both",
      ],
      kind: "refused",
    });
  });

  it("refuses a raised baseline no record declares, never trusting the pull request's own CI to have", async () => {
    const verdict = await readFor({ base: commits.base, headSha: commits.head });

    expect(verdict).toEqual({
      details: [header({ base: commits.base }), uncovered({ declared: false })],
      kind: "refused",
    });
  });

  it("clears a pull request that loosens nothing without reading the records, so a damaged store holds no other landing", async () => {
    const home = scratch();
    mkdirSync(stateHomePaths({ home }).baselineBumps, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).baselineBumps, "notes.txt"), "not a record", "utf8");

    const verdict = await readFor({ base: commits.base, headSha: commits.quiet, home });

    expect(verdict).toEqual({ kind: "clear" });
  });

  it("refuses a loosening when a stored record will not read, since the unread one may be the one that bears on it", async () => {
    const home = scratch();
    mkdirSync(stateHomePaths({ home }).baselineBumps, { recursive: true });
    writeFileSync(join(stateHomePaths({ home }).baselineBumps, "notes.txt"), "not a record", "utf8");

    const verdict = await readFor({ base: commits.base, headSha: commits.head, home });

    expect(verdict).toEqual({
      details: [
        "could not read the ratchet bump records: ledgers/baseline-bumps/notes.txt: not a bump record (every record " +
          "is <digest>.json)",
      ],
      kind: "refused",
    });
  });

  it("judges the merge landing would make, so a head forked before main moved is not read as undoing main", async () => {
    const verdict = await readFor({ base: commits.mainMoved, headSha: commits.quiet });

    expect(verdict).toEqual({ kind: "clear" });
  });

  it("passes over a record declared against a commit not in main's history, as history and never a cover", async () => {
    const home = homeHolding({ records: [recordAgainst({ base: NOWHERE })] });

    const verdict = await readFor({ base: commits.base, headSha: commits.head, home });

    expect(verdict).toEqual({
      details: [header({ base: commits.base }), uncovered({ declared: false })],
      kind: "refused",
    });
  });

  it("passes over a record declaring a row this change does not loosen", async () => {
    const other = recordAgainst({ base: commits.base, row: { ...ROW, to: 999 } });

    const verdict = await readFor({
      base: commits.base,
      headSha: commits.head,
      home: homeHolding({ records: [other] }),
    });

    expect(verdict).toEqual({
      details: [header({ base: commits.base }), uncovered({ declared: false })],
      kind: "refused",
    });
  });

  it("refuses a record naming an older main commit whose rows were measured against a later one", async () => {
    const wrong = recordAgainst({ base: commits.base, row: { ...ROW, cause: "growth", from: 300, to: 310 } });

    const verdict = await readFor({
      base: commits.mainRaised,
      headSha: commits.misbased,
      home: homeHolding({ records: [wrong] }),
    });

    expect(verdict).toEqual({
      details: [
        header({ base: commits.mainRaised }),
        `  ${SIZE} offenders:tools/gen.ts: 300 -> 310 (no applicable store bump record declaring it has a qualifying ` +
          "Codex witness)",
        `  ${pathOf({ manifest: wrong })}: declares ${SIZE} offenders:tools/gen.ts 300 -> 310, which the change does ` +
          `not measure against its own base ${commits.base.slice(0, 12)}`,
      ],
      kind: "refused",
    });
  });

  it("refuses a widening record when the change edits the file its row names", async () => {
    const record = recordAgainst({ base: commits.base });

    const verdict = await readFor({
      base: commits.base,
      headSha: commits.touched,
      home: homeHolding({ records: [record] }),
    });

    expect(verdict).toEqual({
      details: [
        header({ base: commits.base }),
        uncovered({ declared: true }),
        `  ${pathOf({ manifest: record })}: declares ${SIZE} offenders:tools/gen.ts as widening, but the change ` +
          "touches the file it names, so this record cannot cover the row",
      ],
      kind: "refused",
    });
  });

  it("lets a record declared against an older main commit its rows still hold against reach the witness", async () => {
    const record = recordAgainst({ base: commits.base });

    const verdict = await readFor({
      base: commits.mainMoved,
      headSha: commits.head,
      home: homeHolding({ records: [record] }),
    });

    expect(verdict).toMatchObject({
      details: [
        header({ base: commits.mainMoved }),
        uncovered({ declared: true }),
        expect.stringContaining(`${pathOf({ manifest: record })} has no Codex witness`),
      ],
      kind: "refused",
    });
  });

  it("refuses a declared rise no Codex review witnesses, naming the record, the property id and the command", async () => {
    const record = recordAgainst({ base: commits.base });

    const verdict = await readFor({
      base: commits.base,
      headSha: commits.head,
      home: homeHolding({ records: [record] }),
    });

    expect(verdict).toMatchObject({
      details: [
        header({ base: commits.base }),
        uncovered({ declared: true }),
        expect.stringContaining(`no review carries property id ${witnessPropertyId({ digest: record.digest })}`),
      ],
      kind: "refused",
    });
  });

  it("passes over a shallow checkout holding both commits for a full-history one, so missing ancestry is no conflict", async () => {
    const verdict = await readFor({
      base: commits.mainMoved,
      cwd: shallow,
      headSha: commits.quiet,
      home: homeDeclaring({ paths: [repo()] }),
    });

    expect(gitInTemp({ args: ["rev-parse", "--is-shallow-repository"], cwd: shallow })).toBe("true");
    expect(verdict).toEqual({ kind: "clear" });
  });

  it("refuses when the only checkout is shallow, rather than judging a merge its missing history cannot compute", async () => {
    const verdict = await readFor({ base: commits.mainMoved, cwd: shallow, headSha: commits.quiet });

    expect(verdict).toEqual({
      details: [
        `none of the 1 checkout(s) of acme/widget here is a full-history checkout holding base ${commits.mainMoved} ` +
          `and head ${commits.quiet}, and fetching them from origin did not supply both`,
      ],
      kind: "refused",
    });
  });

  it("refuses a declared rise when a pass record cannot be parsed, since the missing one may be a BROKEN review", async () => {
    const home = homeHolding({ records: [recordAgainst({ base: commits.base })], unreadablePass: true });

    const verdict = await readFor({ base: commits.base, headSha: commits.head, home });

    expect(verdict).toEqual({
      details: ["1 pass record(s) could not be parsed, so a witness or a BROKEN review may be missing"],
      kind: "refused",
    });
  });

  it("refuses an undeclared rise on its row, never on a ledger no eligible record needed", async () => {
    const verdict = await readFor({
      base: commits.base,
      headSha: commits.head,
      home: homeHolding({ records: [], unreadablePass: true }),
    });

    expect(verdict).toEqual({
      details: [header({ base: commits.base }), uncovered({ declared: false })],
      kind: "refused",
    });
  });

  it("refuses a declared rise when the supersession register cannot be read, since a retired pass is unknown", async () => {
    const home = homeHolding({ records: [recordAgainst({ base: commits.base })] });

    const verdict = await readFor({ base: commits.base, headSha: commits.head, home, supersessions: UNREACHABLE });

    expect(verdict).toEqual({
      details: [
        `could not read the supersession register: ${
          SupersessionStoreErrors.storeUnavailable({ doing: "connect", reason: "offline" }).message
        }`,
      ],
      kind: "refused",
    });
  });
});

describe("originBranchTip", () => {
  it(
    "reads the commit a branch on origin points at, and nothing for a branch origin does not have",
    () => {
      const dir = scratch();
      const origin = join(dir, "origin.git");
      const work = join(dir, "work");
      gitInTemp({ args: ["init", "--bare", "--initial-branch=staging", origin], cwd: dir });
      gitInTemp({ args: ["init", "--initial-branch=staging", work], cwd: dir });
      const git = (...args: readonly string[]): string => gitInTemp({ args, cwd: work });
      git("config", "user.email", "fixture@example.invalid");
      git("config", "user.name", "Fixture");
      writeFileSync(join(work, "a.txt"), "a\n");
      git("add", ".");
      git("commit", "-m", "tip");
      git("remote", "add", "origin", origin);
      git("push", "-q", "origin", "staging");

      expect(originBranchTip({ branch: "staging", cwd: work })).toBe(git("rev-parse", "HEAD"));
      expect(originBranchTip({ branch: "absent", cwd: work })).toBeUndefined();
    },
    REAL_GIT_TIMEOUT_MS,
  );
});
