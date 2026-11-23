/**
 * Opening the ONE visible judgement pass a corpus sync's propagation joins: resolve the checkout, register the
 * dispatch row, then `cmux spawn` — `automation seat`'s own order, and rule 2's allowed shape. Shared by the resync's
 * propagation (`propagateRun.ts`) and `automation propagate --seat`.
 *
 * A seated pass is replaced only when cmux says its workspace is gone with syncs pending; `unknown` never
 * reseats, because a second visible session over the same batch is the failure this module exists to prevent.
 */
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { realWorkspaceLivenessCheck, type WorkspaceLiveness } from "../../../cmux/liveness.js";
import { workspaceRegisterArgv } from "../../../handover/workspace.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import type { Result } from "../../../lib/result.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import {
  type PassSession,
  type PropagationBatch,
  pendingSyncs,
  reseatBatch,
  seatNeed,
} from "../../../live/resync/propagationBatch.js";
import { writeActiveBatch } from "../../../live/resync/propagationStore.js";
import { listLiveCmuxWorkspaces } from "../../../sessionHarness/cmuxHost.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_DEFERRED, EXIT_OK } from "../../exitCodes.js";
import { runCmuxSpawn } from "../cmux/run.js";
import { runHandoverRegister } from "../handover/askRowRun.js";

/** The model a judgement pass is seated on — named per `AGENTS.md` rule 5: investigating is Opus work. */
export const PASS_MODEL = "opus";

/** Where the seated session reads what to do. */
const PASS_PROCEDURE = "skills/automation/reference/corpus-propagation.md";

/** The three edges opening a pass needs, shared with `automation propagate --seat`. */
export interface PassSeatEdges {
  /** The declared main checkout the pass's worktree is cut from. */
  readonly checkoutFor: (args: { readonly home: string }) => Result<string>;
  /** Whether the board already holds a row at this slug — a crash between register and record. */
  readonly rowExists: (args: { readonly home: string; readonly slug: string }) => boolean;
  readonly register: (args: { readonly argv: readonly string[] }) => Promise<number>;
  readonly openSession: (args: { readonly argv: readonly string[] }) => Promise<number>;
  /** Whether a workspace for this slug is still open — asked only of a seated pass with syncs pending. */
  readonly passSession: (args: { readonly slug: string }) => Promise<PassSession>;
}

/**
 * The production seat edges.
 *
 * @returns the checkout resolver, board probe, register and spawn
 * @internal
 */
export function productionPassSeatEdges(): PassSeatEdges {
  return {
    checkoutFor: ({ home }) => checkoutForRunningRepo({ home, verb: "automation propagate" }),
    openSession: ({ argv }) => runCmuxSpawn(["node", "slopweaver", "cmux", "spawn", ...argv]),
    passSession: async ({ slug }) => {
      const listed = await listLiveCmuxWorkspaces();
      if (listed.isErr()) {
        return "unknown";
      }
      // `cmux spawn` cuts the pass's worktree under its slug, so a workspace standing in it is the pass's.
      const standing = listed.value.filter((workspace) => basename(workspace.currentDirectory) === slug);
      const check = realWorkspaceLivenessCheck();
      const verdicts = await Promise.all(standing.map((workspace) => check({ workspaceId: workspace.workspaceId })));
      return passSessionFrom({ verdicts });
    },
    register: ({ argv }) => runHandoverRegister(["node", "slopweaver", "handover", "register", ...argv]),
    rowExists: ({ home, slug }) => existsSync(join(stateHomePaths({ home }).handovers, `${slug}.md`)),
  };
}

/**
 * What cmux's liveness verdicts on every workspace standing in a pass's worktree say of the pass.
 *
 * Listed is not running. MEASURED on the proof run: `cmux spawn` reported "no workspace was
 * opened" when `workspace.create` did not answer inside 15s, yet cmux had made one — `workspace:428`, titled
 * `Terminal`, whose process tree (`slopweaver cmux processes --workspace workspace:428 --json`) was `[]`. An
 * inventory match adopted that empty terminal as the pass. So a workspace counts only when something beyond an
 * idle shell runs in it (`../../../cmux/liveness.ts`).
 *
 * @param verdicts one liveness verdict per workspace standing in the pass's worktree
 * @returns `open` when any runs a session, `unknown` when any could not be read, else `gone`
 * @internal
 */
export function passSessionFrom({ verdicts }: { readonly verdicts: readonly WorkspaceLiveness[] }): PassSession {
  if (verdicts.some((verdict) => verdict.kind === "alive")) {
    return "open";
  }
  if (verdicts.some((verdict) => verdict.kind === "unknown")) {
    return "unknown";
  }
  return "gone";
}

/**
 * Ask cmux about the seated pass only when the answer could matter: a seated batch with syncs pending.
 *
 * @param batch the open batch
 * @param edges the seat edges, whose probe is asked
 * @returns what cmux says, or `open` when there is nothing to ask about
 */
export async function passSessionOf({
  batch,
  edges,
}: {
  readonly batch: PropagationBatch;
  readonly edges: PassSeatEdges;
}): Promise<PassSession> {
  if (batch.seat.seatedAtIso === null || pendingSyncs({ batch }).length === 0) {
    return "open";
  }
  return edges.passSession({ slug: batch.seat.slug });
}

/**
 * Open the batch's session if it has none, or a fresh one if its seat's workspace is gone. Call holding the batch lock.
 *
 * @param batch the open batch, as last written
 * @param dir the propagation directory
 * @param home the state home
 * @param nowIso the instant of the check
 * @param deps the edges, and the id minter for a lapsed seat's fresh slug
 * @returns the lines reporting the seat, and whether the spawn backoff deferred it
 */
export async function seatIfNeeded({
  batch,
  dir,
  home,
  nowIso,
  deps,
}: {
  readonly batch: PropagationBatch;
  readonly dir: string;
  readonly home: string;
  readonly nowIso: string;
  readonly deps: { readonly mintId: () => string; readonly seatEdges: PassSeatEdges };
}): Promise<SeatReport> {
  const session = await passSessionOf({ batch, edges: deps.seatEdges });
  const need = seatNeed({ batch, batchId: deps.mintId(), nowIso, session });
  if (need.kind === "seated") {
    return {
      deferred: false,
      lines: [`pass ${batch.seat.slug} · already seated at ${String(batch.seat.seatedAtIso)}`],
    };
  }
  let current = batch;
  const lines: string[] = [];
  if (need.kind === "lapsed") {
    lines.push(`pass ${batch.seat.slug} · its workspace is gone with syncs pending, seating ${need.slug} in its place`);
    current = reseatBatch({ batch, slug: need.slug });
    // The fresh slug is written BEFORE its spawn: a spawn that succeeds and a save that then fails would otherwise
    // leave the batch naming the old slug, and a retry would mint a third while the second stands.
    // Written first, a retry finds the fresh slug's registered row, asks cmux about it, and adopts what is open.
    const reserved = writeActiveBatch({ batch: current, dir });
    if (reserved.isErr()) {
      return { deferred: false, lines: [...lines, reserved.error.message] };
    }
  }
  const opened = await openPass({ batch: current, edges: deps.seatEdges, home, nowIso });
  // Read off the attempt itself, never the batch as re-read: a deferral whose save then fails is still NOT YET,
  // and the unchanged batch leaves the pass unseated for the next attempt either way.
  const deferred = opened.batch.seat.lastProblem === SPAWN_DEFERRED_PROBLEM;
  const saved = writeActiveBatch({ batch: opened.batch, dir });
  if (saved.isErr()) {
    return { deferred, lines: [...lines, ...opened.lines, saved.error.message] };
  }
  return { deferred, lines: [...lines, ...opened.lines] };
}

/** What one seat check printed, and whether the spawn backoff deferred its `cmux spawn`. */
export interface SeatReport {
  readonly lines: readonly string[];
  readonly deferred: boolean;
}

/** A seat attempt's result: the batch with its seat stages stamped, and the lines to print. */
interface SeatAttempt {
  readonly batch: PropagationBatch;
  readonly lines: readonly string[];
}

/**
 * The attempt that stopped on `problem`, stamped onto the batch as it stood when it stopped.
 *
 * @param batch the batch as far as the attempt got
 * @param problem why the pass is not seated
 * @returns the stamped batch and its line
 */
function notSeated({ batch, problem }: { readonly batch: PropagationBatch; readonly problem: string }): SeatAttempt {
  return {
    batch: { ...batch, seat: { ...batch.seat, lastProblem: problem } },
    lines: [`pass ${batch.seat.slug} · NOT seated — ${problem}; \`slopweaver automation propagate --seat\` retries`],
  };
}

/**
 * The attempt that ended with a session open, stamped seated now.
 *
 * @param batch the registered batch
 * @param nowIso the instant it is seated
 * @param line what to print
 * @returns the stamped batch and its line
 */
function seated({
  batch,
  nowIso,
  line,
}: {
  readonly batch: PropagationBatch;
  readonly nowIso: string;
  readonly line: string;
}): SeatAttempt {
  return { batch: { ...batch, seat: { ...batch.seat, lastProblem: null, seatedAtIso: nowIso } }, lines: [line] };
}

/**
 * The problem a seat attempt records when the fleet-wide spawn backoff deferred its `cmux spawn`: NOT YET, so
 * `automation propagate --seat` exits 4 on it rather than 1, and the batch stays unseated for the next attempt.
 */
export const SPAWN_DEFERRED_PROBLEM = "the spawn backoff deferred cmux spawn with exit 4 while the machine is held";

/**
 * Run one exit-code edge, answering why it failed or undefined when it exited clean.
 *
 * @param what the verb's name, for the problem text
 * @param run the edge
 * @param deferredProblem what an exit 4 records instead of a plain nonzero exit, when the edge can defer
 * @returns the problem, or undefined on a clean exit
 */
async function edgeProblem({
  what,
  run,
  deferredProblem,
}: {
  readonly what: string;
  readonly run: () => Promise<number>;
  readonly deferredProblem?: string;
}): Promise<string | undefined> {
  let code: number;
  try {
    code = await run();
  } catch (cause) {
    return `${what} threw: ${errorMessage({ error: cause })}`;
  }
  if (code === EXIT_DEFERRED && deferredProblem !== undefined) {
    return deferredProblem;
  }
  if (code !== EXIT_OK) {
    return `${what} exited ${String(code)}`;
  }
  return undefined;
}

/**
 * Resolve the checkout, register the dispatch row (unless a crash already did), then spawn the session.
 *
 * @param batch the batch whose seat is being opened
 * @param edges the seat edges
 * @param home the state home
 * @param nowIso the instant of the attempt
 * @returns the batch with its seat stages stamped, and the lines to print
 */
async function openPass({
  batch,
  edges,
  home,
  nowIso,
}: {
  readonly batch: PropagationBatch;
  readonly edges: PassSeatEdges;
  readonly home: string;
  readonly nowIso: string;
}): Promise<SeatAttempt> {
  const slug = batch.seat.slug;
  let checkout: Result<string>;
  try {
    checkout = edges.checkoutFor({ home });
  } catch (cause) {
    return notSeated({ batch, problem: `the checkout lookup threw: ${errorMessage({ error: cause })}` });
  }
  if (checkout.isErr()) {
    return notSeated({ batch, problem: checkout.error.join("; ") });
  }
  const alreadyRegistered = batch.seat.registeredAtIso !== null || edges.rowExists({ home, slug });
  if (!alreadyRegistered) {
    const argv = passRegisterArgv({ checkout: checkout.value, home, nowIso, slug });
    const problem = await edgeProblem({ run: () => edges.register({ argv }), what: "handover register" });
    if (problem !== undefined) {
      return notSeated({ batch, problem });
    }
  }
  // A row this call just wrote, or one a crash left before the batch recorded it, is registered NOW.
  let registeredAtIso = nowIso;
  if (batch.seat.registeredAtIso !== null) {
    registeredAtIso = batch.seat.registeredAtIso;
  }
  const registered: PropagationBatch = { ...batch, seat: { ...batch.seat, registeredAtIso } };
  // An earlier attempt may have reached `cmux spawn`, whose workspace outlives a failed spawn — so ask cmux before
  // spawning a second.
  if (alreadyRegistered) {
    const session = await edges.passSession({ slug });
    if (session === "open") {
      const line = `pass ${slug} · an earlier attempt's workspace is open, so it is the pass — nothing spawned again`;
      return seated({ batch: registered, line, nowIso });
    }
    if (session === "unknown") {
      const problem = "cmux did not say whether an earlier attempt's workspace is open, so nothing was spawned";
      return notSeated({ batch: registered, problem });
    }
  }
  const argv = [slug, "--model", PASS_MODEL, "--home", home];
  const problem = await edgeProblem({
    deferredProblem: SPAWN_DEFERRED_PROBLEM,
    run: () => edges.openSession({ argv }),
    what: "cmux spawn",
  });
  if (problem !== undefined) {
    return notSeated({ batch: registered, problem });
  }
  const line = `pass ${slug} · seated on ${PASS_MODEL}, a visible session on the board row of that slug`;
  return seated({ batch: registered, line, nowIso });
}

/**
 * The argv the pass's board row is written with.
 *
 * @param slug the pass's slug
 * @param checkout the declared main checkout its worktree is cut from
 * @param home the state home
 * @param nowIso the instant it is asked
 * @returns the words past `handover register`
 */
export function passRegisterArgv({
  slug,
  checkout,
  home,
  nowIso,
}: {
  readonly slug: string;
  readonly checkout: string;
  readonly home: string;
  readonly nowIso: string;
}): readonly string[] {
  return [
    "--ask",
    "Corpus propagation pass: one or more corpus syncs just finished. Run `slopweaver automation propagate --status` " +
      "for the syncs this pass covers and what each already re-derived, then follow " +
      `${PASS_PROCEDURE}: a pass over the queue, the workstreams and the store, updating what the fresh corpus ` +
      "makes worth updating through the typed verbs, and end with `slopweaver automation propagate --done " +
      "--batch <id> --through-revision <n>` for the batch and revision you read.",
    // A pass is work the session it opens picks up and nothing the owner decides, so it is a DISPATCH row, exactly as
    // `automation seat`'s is.
    "--dispatch",
    "--slug",
    slug,
    "--priority",
    "p2",
    "--asked-iso",
    nowIso,
    ...workspaceRegisterArgv({
      stated: { because: "a pass over this installation's own corpus, queue and store", workspace: "self" },
    }),
    "--repo",
    checkout,
    "--home",
    home,
  ];
}
