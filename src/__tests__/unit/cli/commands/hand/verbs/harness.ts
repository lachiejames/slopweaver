/*
 * The shared harness for the `hand` verb test files: the recording seams every verb runs over, the argv the
 * posting cases build, and the liveness helpers the note cases stamp with.
 *
 * Each test file keeps its own `home`, `out`, `diagnostics`, `commands` and `looked` bindings, because its case
 * bodies reassign them, and hands the harness a getter over them. Every seam reads that getter at the moment it
 * records, exactly as the old in-file fake read the module bindings, so a `deps(...)` built before a case
 * reassigns `out` still records into the new array. No mocks, per `testing.md`: the two macOS calls are recorded
 * by plain functions instead of run.
 */
import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HandDeps } from "../../../../../../cli/commands/hand/deps.js";
import type { HandPageLook } from "../../../../../../cli/commands/hand/pageLookRun.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import type { RowPullRequests } from "../../../../../../hand/rowPullRequest.js";
import { NOW, UNLANDED_SECRET } from "./fixtures.js";

/** The bindings one test file owns, which its case bodies reassign between runs of a verb. */
interface HandState {
  readonly commands: NoteCommand[];
  readonly diagnostics: string[];
  readonly home: string;
  readonly looked: string[];
  readonly out: string[];
}

/** What a case may vary about the seams. */
interface DepsOptions {
  platform?: string;
  throws?: boolean;
  nowIso?: string;
  look?: HandPageLook;
  pulls?: RowPullRequests;
}

/**
 * The seams, with the two macOS calls recorded instead of run, and the page look and the row read faked.
 *
 * @param state the file's bindings, read at each record so an array a case reassigned still receives it
 * @returns the dependencies one verb run takes
 */
function depsFor({
  state,
  platform = "darwin",
  throws = false,
  nowIso = NOW,
  look = { kind: "seen", picture: undefined },
  pulls = { kind: "not-asked" },
}: DepsOptions & { state: () => HandState }): HandDeps {
  return {
    branchesDeclaring: ({ name }) => (name === UNLANDED_SECRET ? ["refs/heads/secops-atlas-connect"] : []),
    consoleBase: () => "http://localhost:3000",
    lookAt: ({ url }) => {
      state().looked.push(url);
      return look;
    },
    now: () => nowIso,
    platform,
    rowPullRequests: () => pulls,
    run: (command) => {
      state().commands.push(command);
      if (throws) {
        throw new Error("open: could not launch");
      }
    },
    writeDiagnostic: (line) => {
      state().diagnostics.push(line);
    },
    writeOut: (line) => {
      state().out.push(line);
    },
  };
}

/**
 * The posting form a case did not choose itself: `--standalone`, unless the tail names a row.
 *
 * @param tail the case's own flags
 * @returns the classification flag to add, or none
 */
function form({ tail }: { tail: readonly string[] }): readonly string[] {
  return tail.includes("--row") || tail.includes("--standalone") ? [] : ["--standalone"];
}

/**
 * The tier a case did not state itself: `--blocks`, unless the tail says `--check-in` or `--blocks`.
 *
 * @param tail the case's own flags
 * @returns the tier flag to add, or none
 */
function tier({ tail }: { tail: readonly string[] }): readonly string[] {
  return tail.includes("--check-in") || tail.includes("--blocks") ? [] : ["--blocks"];
}

/** The flags that say where a step happens — a case naming one of its own gets no default address. */
const ADDRESS_FLAGS: ReadonlySet<string> = new Set(["--url", "--open", "--no-address"]);

/**
 * The case's own tail, with a default address appended when it names none, so every case about something else
 * posts a step the address rule accepts.
 *
 * @param tail the flags the case adds
 * @param fallback the address flags to use when the tail names none
 * @returns the tail to post
 */
function addressed({ tail, fallback }: { tail: readonly string[]; fallback: readonly string[] }): readonly string[] {
  return tail.some((arg) => ADDRESS_FLAGS.has(arg)) ? tail : [...tail, ...fallback];
}

/**
 * The four flags every post needs, the sign-in page it happens at, and whatever the case adds.
 *
 * @param home the state home the case minted
 * @returns the argv to post
 */
function postFor({ home, tail = [] }: { home: string; tail?: readonly string[] }): readonly string[] {
  return [
    "--home",
    home,
    "--id",
    "gcloud-signin",
    "--what",
    "Sign in to Google Cloud so the monitor deploy can finish",
    "--unblocks",
    "handover run datadog-monitor-deploy",
    "--witness",
    "slopweaver hand done gcloud-signin",
    ...form({ tail }),
    ...tier({ tail }),
    ...addressed({ fallback: ["--url", "https://console.cloud.google.com/"], tail }),
  ];
}

/**
 * A post of a step under another id, so a case can hold several open at once.
 *
 * @param home the state home the case minted
 * @returns the argv to post
 */
function postAsFor({ home, id, tail = [] }: { home: string; id: string; tail?: readonly string[] }): readonly string[] {
  return [
    "--home",
    home,
    "--id",
    id,
    "--what",
    `Answer ${id}, so its run can go on`,
    "--unblocks",
    `the run parked on ${id}`,
    "--witness",
    `slopweaver hand done ${id}`,
    ...form({ tail }),
    ...tier({ tail }),
    ...addressed({ fallback: ["--no-address", `the answer goes in the thread ${id} parked`], tail }),
  ];
}

/**
 * Bind the seams and the posting argv to one test file's own bindings.
 *
 * @param state a getter over the file's bindings, read each time a seam records or a post is built
 * @returns the `deps`, `post` and `postAs` helpers the file's case bodies call
 */
export function handHarness({ state }: { state: () => HandState }): {
  readonly deps: (options?: DepsOptions) => HandDeps;
  readonly post: (options?: { tail?: readonly string[] }) => readonly string[];
  readonly postAs: (options: { id: string; tail?: readonly string[] }) => readonly string[];
} {
  return {
    deps: (options) => depsFor({ ...options, state }),
    post: (options) => postFor({ ...options, home: state().home }),
    postAs: (options) => postAsFor({ ...options, home: state().home }),
  };
}

/**
 * A fresh case: a throwaway home and empty recording arrays, for each test file's `beforeEach`.
 *
 * @returns the bindings a case starts from; the file's `afterEach` removes the home
 */
export function freshHand(): HandState {
  return { commands: [], diagnostics: [], home: mkdtempSync(join(tmpdir(), "hand-cli-")), looked: [], out: [] };
}

/**
 * The token a launched bundle was named for.
 *
 * @returns the bundle directory's name, which the raise minted
 */
export function tokenOf({ command }: { command: NoteCommand }): string {
  const bundle = command.args[2];
  if (bundle === undefined) {
    throw new Error("the launch named no bundle");
  }
  const token = bundle.split("/").at(-2);
  if (token === undefined) {
    throw new Error(`the bundle path ${bundle} has no parent directory`);
  }
  return token;
}

/** Stamp a liveness file as written at {@link NOW}, standing in for the wall clock the verbs never read. */
export function stampAtNow({ path }: { path: string }): void {
  utimesSync(path, new Date(NOW), new Date(NOW));
}
