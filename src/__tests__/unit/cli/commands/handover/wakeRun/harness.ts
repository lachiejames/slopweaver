/*
 * The disk half of the `handover wake` tests: the throwaway home a case mints, the parked rows it writes onto that
 * home's board and run journals, the fake deps whose spawn journals what `cmux spawn` would, and the one `--json`
 * run. The case bodies name `home` and `runsDir` bare, so the home a case minted is held here between its
 * `beforeEach` and these helpers: each test file binds both from `mintWakeHome()`, and registers
 * `turn/dispatch/harness.ts`'s `removeFixtureDirs` with `afterEach`, since every home minted here joins that
 * module's `fixtureDirs`. It moved here when `wakeRun.test.ts` was split by behaviour.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";

import type { MergeProof } from "../../../../../../cli/commands/handover/wakeMergeProof.js";
import type { WakeReport } from "../../../../../../cli/commands/handover/wakeReport.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { runHandoverWake } from "../../../../../../cli/commands/handover/wakeRun.js";
import { activeParkedCheckpoint } from "../../../../../../handover/parked.js";
import type { ParkedDraft } from "../../../../../../handover/parkedEvent.js";
import type { ChecksWakeObservation, ParkWake } from "../../../../../../handover/parkWake.js";
import type { ProbeCheckout } from "../../../../../../handover/probeCheckout.js";
import { appendRunEvent, readRunJournal } from "../../../../../../handover/runStore.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import { stateHomePaths } from "../../../../../../stateHome.js";
import type { ChildOutcome } from "../../../../../../supervisor/scratch/childOutcome.js";
import { fixtureDirs } from "../../turn/dispatch/harness.js";
import { finishFakes } from "./finishFakes.js";
import { NOW, RETRY_AFTER, type Recorded, spawnLine } from "./fixtures.js";
import { type FakeCommit, reconcileFakes } from "./reconcileFakes.js";

export { childExit } from "./finishFakes.js";

/**
 * What one pull request's read answers in a case: an observation, a MERGED one with no commit named — which reads
 * as merged at `merge-<number>` — or a failed read.
 */
type CheckAnswer = ChecksWakeObservation | { readonly prState: "MERGED" } | "error";

/** The home one case runs over, and the run-journal directory inside it. */
interface WakeHome {
  readonly home: string;
  readonly runsDir: string;
}

/** The home the running case minted; vitest loads this module once per test file, so no file sees another's. */
let minted: WakeHome | undefined;

/**
 * Mint the throwaway home one case runs over, with its board and run-journal directories made.
 *
 * @returns the home and its run-journal directory, for the case to bind as its own `home` and `runsDir`
 */
export function mintWakeHome(): WakeHome {
  // The temp dir is the home; its board and journal directories come from `stateHomePaths`, never a hand join.
  const dir = mkdtempSync(join(tmpdir(), "handover-wake-"));
  fixtureDirs.push(dir);
  const paths = stateHomePaths({ home: dir });
  mkdirSync(paths.handovers, { recursive: true });
  mkdirSync(paths.runs, { recursive: true });
  minted = { home: dir, runsDir: paths.runs };
  return minted;
}

/** The home the running case minted, or a throw naming the `beforeEach` that never ran. */
function mintedHome(): WakeHome {
  if (minted === undefined) {
    throw new Error("no wake home was minted: bind mintWakeHome() in the test file's beforeEach");
  }
  return minted;
}

/** A doc on the board, and a journal whose seat parked — on the wake named, or on none. */
export function parkedRow({
  slug,
  wake,
  drafts,
  file = slug,
  front = ["status: in-progress"],
  parkedAtIso = "2026-10-15T02:00:00.000Z",
  question,
  repo = "/repo/acme",
  startedBranch = slug,
  worktree = `/wt/${slug}`,
}: {
  slug: string;
  wake: ParkWake | undefined;
  /** A question the park asked beside its wake; a park with no wake always asks one. */
  question?: string;
  drafts?: readonly ParkedDraft[];
  file?: string;
  front?: readonly string[];
  /** The doc's `repo:` — the checkout a finish in the state home probes; `null` writes no `repo:` line at all. */
  repo?: string | null;
  /** When the seat parked — what orders two checks wakes that are both due. */
  parkedAtIso?: string;
  /** The branch the `started` line records; the park records the slug whatever this is. */
  startedBranch?: string;
  /** The seat's recorded checkout; the default is a path no disk holds, as for a worktree since removed. */
  worktree?: string;
}): void {
  const { runsDir } = mintedHome();
  writeRowDoc({ file, front, repo, slug });
  const events = [
    { atIso: "2026-10-15T01:00:00.000Z", branch: startedBranch, docHash: "h", kind: "started" },
    { atIso: "2026-10-15T01:00:01.000Z", kind: "launched", pid: 7, sessionId: `s-${slug}`, worktree },
    {
      atIso: parkedAtIso,
      branch: slug,
      kind: "parked",
      screenTail: "❯ ",
      sessionId: `s-${slug}`,
      ...(wake === undefined ? { question: "which base?" } : { wake }),
      ...(question === undefined ? {} : { question }),
      ...(drafts === undefined ? {} : { drafts }),
      workspaceRef: "workspace:238",
      worktree,
    },
  ] as const;
  for (const event of events) {
    unwrap(appendRunEvent({ event, runsDir, slug }));
  }
}

/** The row's board doc, written into the minted home's handovers. */
function writeRowDoc({
  file,
  front,
  repo,
  slug,
}: {
  file: string;
  front: readonly string[];
  repo: string | null;
  slug: string;
}): void {
  const { home } = mintedHome();
  writeFileSync(
    join(stateHomePaths({ home }).handovers, `${file}.md`),
    [
      "---",
      `slug: ${slug}`,
      "summary: a run",
      ...(repo === null ? [] : [`repo: ${repo}`]),
      ...front,
      "---",
      "",
      `# ${slug}`,
      "",
    ].join("\n"),
  );
}

/**
 * Whether a slug is still parked on its journal.
 *
 * @returns true while the journal's latest park has not cleared
 */
export function stillParked({ slug }: { slug: string }): boolean {
  const { runsDir } = mintedHome();
  return activeParkedCheckpoint({ events: unwrap(readRunJournal({ runsDir, slug })).events }) !== undefined;
}

/** The clock half of {@link fakes}: attempt ids, a clock the fake sleep advances, and the backoff read. */
function clockFakes({
  recorded,
  retryAfterIso,
}: {
  recorded: Recorded;
  retryAfterIso: string;
}): Pick<HandoverWakeDeps, "nonce" | "now" | "rerunAllowed" | "retryAfter" | "sleep"> {
  let nowMs = NOW.getTime();
  return {
    nonce: () => `n-${String(recorded.nonces.push(0))}`,
    now: () => new Date(nowMs),
    rerunAllowed: false,
    retryAfter: () => ok(retryAfterIso),
    sleep: async ({ ms }) => {
      recorded.slept.push(ms);
      nowMs += ms;
    },
  };
}

/** The provider half of {@link fakes}: checks off a per-pull-request table, and a spawn that journals as told. */
function providerFakes({
  checks,
  exitCode,
  exitCodes,
  journals,
  leftOpen,
  recorded,
}: {
  checks: Readonly<Record<number, CheckAnswer>>;
  exitCode: number;
  exitCodes: readonly number[];
  journals: readonly ("dispatched" | "abandoned" | "started")[];
  leftOpen: boolean;
  recorded: Recorded;
}): Pick<HandoverWakeDeps, "readChecks" | "reseat"> {
  const { runsDir } = mintedHome();
  return {
    readChecks:
      () =>
      async ({ number }) => {
        const answer = checks[number];
        if (answer === undefined || answer === "error") {
          return err(GithubLiveErrors.readFailed({ message: "rate limited" }));
        }
        if (answer.prState === "MERGED") {
          return ok({ mergeCommitOid: `merge-${String(number)}`, ...answer });
        }
        return ok(answer);
      },
    reseat: async ({ slug }): Promise<ChildOutcome> => {
      const listed = exitCodes[recorded.spawned.length];
      recorded.spawned.push(slug);
      let code = exitCode;
      if (listed !== undefined) {
        code = listed;
      }
      for (const kind of code === 0 || leftOpen ? journals : []) {
        unwrap(appendRunEvent({ event: spawnLine({ kind, slug }), runsDir, slug }));
      }
      return { durationMs: 10, exitCode: code, kind: "exited" };
    },
  };
}

/** The output half of {@link fakes}: every stdout and stderr line the verb writes, recorded in order. */
function outputFakes({ recorded }: { recorded: Recorded }): Pick<HandoverWakeDeps, "writeDiagnostic" | "writeOut"> {
  return {
    writeDiagnostic: (line) => {
      recorded.diagnostics.push(line);
    },
    writeOut: (line) => {
      recorded.out.push(line);
    },
  };
}

/**
 * Fakes for one run: checks read off a per-pull-request table, and a spawn that exits as told and, on exit 0,
 * journals the lines named in order — its own `dispatched`, an `abandoned` some other session wrote meanwhile.
 *
 * @returns the deps, built in the order the in-file literal held them
 */
export function fakes({
  bootsInFlight = 0,
  branches = {},
  checks = {},
  commits = {},
  exitCode = 0,
  exitCodes = [],
  finishes = {},
  heads = {},
  journals = ["dispatched"],
  leftOpen = false,
  mergeHeld = "held",
  origin = "o/r",
  probeTree = "session-worktree",
  readies = {},
  recorded,
  retryAfterIso = RETRY_AFTER,
}: {
  /** Per-slug exit codes for the question pass's `finish --dry-run --beside-question`; one it does not name exits 0. */
  readies?: Readonly<Record<string, number>>;
  /** The `owner/repo` every run checkout's `origin` names; `null` is an origin that does not read. */
  origin?: string | null;
  /** The branch each existing worktree has out, by path; `null` is detached, and a path it does not name fails. */
  branches?: Readonly<Record<string, string | null>>;
  /** Each worktree's commit, dirtiness and branch, by path; `null` does not read, and a path it does not name is clean at the head. */
  commits?: Readonly<Record<string, FakeCommit | null>>;
  /** Each pull request's head branch, by number; a number it does not name fails to read. */
  heads?: Readonly<Record<number, string>>;
  /** What the doc repo proves about a merge: held on a clean tree, not yet, dirty, or git refusing. */
  mergeHeld?: MergeProof | "unreadable";
  /** Which tree a finish from an existing worktree path would probe — its own, or the doc's repo. */
  probeTree?: ProbeCheckout["kind"];
  /** Claude sessions already inside the boot window as the run begins. */
  bootsInFlight?: number;
  /** Per-slug exit codes for `handover finish`; a slug it does not name exits 1, a gate refusing. */
  finishes?: Readonly<Record<string, number>>;
  checks?: Readonly<Record<number, CheckAnswer>>;
  exitCode?: number;
  /** Per-spawn exit codes in launch order, overriding `exitCode` for as many spawns as it lists. */
  exitCodes?: readonly number[];
  journals?: readonly ("dispatched" | "abandoned" | "started")[];
  /** Journal the lines on a non-zero exit too, as `cmux spawn` does for a seat it fails but leaves open. */
  leftOpen?: boolean;
  recorded: Recorded;
  /** What the backoff read answers after a deferral. */
  retryAfterIso?: string;
}): HandoverWakeDeps {
  return {
    ...clockFakes({ recorded, retryAfterIso }),
    ...providerFakes({ checks, exitCode, exitCodes, journals, leftOpen, recorded }),
    ...finishFakes({ bootsInFlight, finishes, mergeHeld, probeTree, readies, recorded, runsDir: mintedHome().runsDir }),
    ...reconcileFakes({ branches, commits, heads, origin, recorded }),
    ...outputFakes({ recorded }),
  };
}

/**
 * Run the verb with `--json` over this home and parse its one document.
 *
 * @returns the exit code, and the report the verb printed
 */
export async function wakeJson({
  deps,
  extra = [],
  recorded,
}: {
  deps: HandoverWakeDeps;
  extra?: readonly string[];
  recorded: Recorded;
}): Promise<{ code: number; report: WakeReport }> {
  const code = await runHandoverWake({ deps, rest: ["--home", mintedHome().home, "--json", ...extra] });
  expect(recorded.out).toHaveLength(1);
  // The length assertion above already holds the document, so this guard never fires; it stands in for `!`.
  const [document] = recorded.out;
  if (document === undefined) {
    throw new Error("handover wake --json printed no document");
  }
  // `as`: the verb under test printed this document from a `WakeReport`, and the cases read it back as one.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return { code, report: JSON.parse(document) as WakeReport };
}

/**
 * The wake journal under this case's home.
 *
 * @returns the path `handover wake` journals its attempts to
 */
export function journalPath(): string {
  return stateHomePaths({ home: mintedHome().home }).handoverWakeJournalJsonl;
}
