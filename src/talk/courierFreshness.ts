/**
 * Whether the chair's courier is still running the code it should — the pure half of its in-place re-exec
 * (`../cli/commands/talk/courierReexec.ts`).
 *
 * ## The bombardment that was old code, measured
 *
 * The owner reported the chair still being bombarded by the voice during calls, so much so quickly that there was no
 * chance to act properly. The one-turn-per-quiet-stretch batch they had asked for had already landed. On a call the
 * chair's transcript still carried the pre-batch lines — a `[voice call …]` wake per finished stretch and one
 * `[voice relay …]` per relay, fifteen relays (`slopweaver talk log`) — because its `talk courier --follow` had been
 * started earlier out of a worktree whose HEAD predated the batch. A follower runs the code it loaded at boot,
 * from whichever checkout it was started in, for as long as the chair lives; the boot line says "through MAIN" and
 * nothing held it to that, nor to a pull after it.
 *
 * ## The criterion
 *
 * Restart when the follower runs from any tree but the one main checkout carrying `bin/slopweaver` (`not-main`), or
 * when that checkout's HEAD has moved past the head the follower started at by a commit touching `src`, `bin`,
 * `package.json` or `yarn.lock` (`changed`). Coarser than the follower's import closure on purpose: a restart is an
 * in-place `execve` — same pid, same pipe — so the chair never hears of one, and the courier's whole state (the wake
 * store, the held relays, the cursor) is on disk; an extra restart costs a couple of seconds and nothing else. A
 * docs-only landing restarts nothing.
 *
 * A target restarts only once it is seen twice running — the same main checkout, and for `changed` the same head — so
 * a tree mid-pull waits a check rather than being executed half-written. And a follower that was itself just exec'd
 * refuses another within {@link COURIER_REEXEC_COOLDOWN_MS}: after an exec it runs main at main's head, so it is
 * current by construction, and the cooldown only bounds a pathology such as two spellings of one path.
 *
 * Pure: every read is passed in already taken.
 */

/** How often the follower measures itself — its own deadline, apart from the five-second batch pass. */
export const COURIER_FRESHNESS_EVERY_MS = 60_000;

/** How long a follower started by a re-exec refuses another. */
export const COURIER_REEXEC_COOLDOWN_MS = 5 * 60_000;

/** The variable a re-exec stamps with its instant, read back by the follower it starts. */
export const COURIER_REEXEC_AT_ENV = "SLOPWEAVER_COURIER_REEXEC_AT";

/** The variable a re-exec stamps with its own pid, which an `execve` keeps, beside the instant. */
export const COURIER_REEXEC_PID_ENV = "SLOPWEAVER_COURIER_REEXEC_PID";

/**
 * The re-exec stamp this process carries, only when a re-exec of THIS process left it. An environment is inherited, so
 * a child the follower spawns, or a later boot under a shell that kept the variables, would otherwise read a stamp no
 * exec of its own wrote and skip the one recovery a boot runs. An `execve` keeps the pid, so
 * the stamp counts only beside this pid; an instant that does not parse counts as no stamp, the boot reading.
 *
 * @param env this process's environment
 * @param pid this process's pid
 * @returns the instant of the re-exec that started this image, or undefined for a boot
 */
export function reexecStampOf({
  env,
  pid,
}: {
  env: Readonly<Record<string, string | undefined>>;
  pid: number;
}): string | undefined {
  const at = env[COURIER_REEXEC_AT_ENV];
  if (at === undefined || env[COURIER_REEXEC_PID_ENV] !== String(pid) || Number.isNaN(Date.parse(at))) {
    return undefined;
  }
  return at;
}

/**
 * Whether a follower starting now should recover what a stopped courier left. A boot does. An image a re-exec started
 * does not: the image it replaced, under this same pid, exec'd only between awaited passes, so it left nothing taken,
 * and the boot before it already recovered. Recovering again could requeue a request a second, live courier had taken
 * and not yet claimed, which it would then type beside the batch that names it.
 *
 * @param reexecAtIso the stamp {@link reexecStampOf} read, if a re-exec of this process started it
 * @returns true for a boot, false for an image a re-exec started
 */
export function recoversAtStart({ reexecAtIso }: { reexecAtIso: string | undefined }): boolean {
  return reexecAtIso === undefined;
}

/** The paths whose change on main means the follower's loaded code is superseded. */
export const COURIER_CODE_PATHSPECS: readonly string[] = ["src", "bin", "package.json", "yarn.lock"];

/** The main checkout carrying the CLI, canonicalised, or why it could not be named. */
export type CourierMainRead =
  { readonly kind: "resolved"; readonly root: string } | { readonly kind: "unresolved"; readonly why: string };

/** Main's HEAD now and the code paths changed since the follower's start head, or why git could not say. */
export type CourierGitRead =
  | { readonly kind: "resolved"; readonly head: string; readonly changedPaths: readonly string[] }
  | { readonly kind: "unresolved"; readonly why: string };

/** What a restart would be for. */
export type CourierRestartCandidate =
  | { readonly kind: "not-main"; readonly mainRoot: string }
  | { readonly kind: "changed"; readonly mainRoot: string; readonly head: string; readonly path: string };

/**
 * Something the follower says once rather than acting on.
 *
 * @internal
 */
export interface CourierFreshnessNotice {
  readonly kind: "cooldown" | "unmeasured";
  readonly why: string;
}

/** What to do after this measurement. */
export type CourierFreshnessDecision =
  | {
      readonly kind: "continue";
      /** The target seen this time, carried so the next check can see it again; `undefined` when there is none. */
      readonly candidate: CourierRestartCandidate | undefined;
      readonly notice: CourierFreshnessNotice | undefined;
    }
  | { readonly kind: "restart"; readonly candidate: CourierRestartCandidate };

/** Whether two observations name the same restart: the same main, and for `changed` the same head. */
function sameTarget({ a, b }: { a: CourierRestartCandidate; b: CourierRestartCandidate | undefined }): boolean {
  if (b === undefined || a.kind !== b.kind || a.mainRoot !== b.mainRoot) {
    return false;
  }
  if (a.kind === "changed" && b.kind === "changed") {
    return a.head === b.head;
  }
  return true;
}

/**
 * The target this measurement sees, or why it saw none worth saying.
 *
 * @returns the candidate, a notice, or neither when the follower is current
 */
function observed({
  runningRoot,
  main,
  startHead,
  current,
}: {
  runningRoot: string;
  main: CourierMainRead;
  startHead: string | undefined;
  current: CourierGitRead;
}): { readonly candidate?: CourierRestartCandidate; readonly notice?: CourierFreshnessNotice } {
  if (main.kind === "unresolved") {
    return { notice: { kind: "unmeasured", why: main.why } };
  }
  if (runningRoot !== main.root) {
    return { candidate: { kind: "not-main", mainRoot: main.root } };
  }
  if (startHead === undefined) {
    return { notice: { kind: "unmeasured", why: "the head this follower started at could not be read" } };
  }
  if (current.kind === "unresolved") {
    return { notice: { kind: "unmeasured", why: current.why } };
  }
  const [path] = current.changedPaths;
  if (current.head === startHead || path === undefined) {
    return {};
  }
  return { candidate: { head: current.head, kind: "changed", mainRoot: main.root, path } };
}

/**
 * Why a follower an exec started may not exec again yet, or `undefined` when it may. A stamp that is no instant has no
 * authority; one from the future by less than the cooldown — a clock stepped back — still holds.
 */
function cooling({ reexecAtIso, nowIso }: { reexecAtIso: string | undefined; nowIso: string }): string | undefined {
  if (reexecAtIso === undefined) {
    return undefined;
  }
  const at = Date.parse(reexecAtIso);
  if (Number.isNaN(at)) {
    return undefined;
  }
  const age = Date.parse(nowIso) - at;
  if (Math.abs(age) >= COURIER_REEXEC_COOLDOWN_MS) {
    return undefined;
  }
  return `this follower was itself started by a re-exec at ${reexecAtIso}, under ${String(COURIER_REEXEC_COOLDOWN_MS / 60_000)} minutes ago — not re-executing again yet`;
}

/**
 * Decide, from one measurement, whether the courier restarts into main now.
 *
 * @param runningRoot the canonical tree this follower's code was loaded from
 * @param main the canonical main checkout carrying the CLI, or why none could be named
 * @param startHead the head the follower recorded at start, `undefined` when it runs from another tree or could not read it
 * @param current main's head now and the code paths changed since `startHead`
 * @param previousCandidate what the last measurement saw, so a target restarts only once seen twice
 * @param reexecAtIso the stamp a re-exec left in this follower's environment, if one started it
 * @param nowIso the instant judged at
 * @returns continue (carrying what was seen, and anything to say once), or restart
 */
export function decideCourierFreshness({
  runningRoot,
  main,
  startHead,
  current,
  previousCandidate,
  reexecAtIso,
  nowIso,
}: {
  runningRoot: string;
  main: CourierMainRead;
  startHead: string | undefined;
  current: CourierGitRead;
  previousCandidate: CourierRestartCandidate | undefined;
  reexecAtIso: string | undefined;
  nowIso: string;
}): CourierFreshnessDecision {
  const seen = observed({ current, main, runningRoot, startHead });
  if (seen.candidate === undefined) {
    return { candidate: undefined, kind: "continue", notice: seen.notice };
  }
  if (!sameTarget({ a: seen.candidate, b: previousCandidate })) {
    return { candidate: seen.candidate, kind: "continue", notice: undefined };
  }
  const cooldown = cooling({ nowIso, reexecAtIso });
  if (cooldown !== undefined) {
    return { candidate: seen.candidate, kind: "continue", notice: { kind: "cooldown", why: cooldown } };
  }
  return { candidate: seen.candidate, kind: "restart" };
}

/**
 * The one line the follower prints before it restarts.
 *
 * @param candidate what the restart is for
 * @returns the line
 */
export function courierRestartLine({ candidate }: { candidate: CourierRestartCandidate }): string {
  if (candidate.kind === "not-main") {
    return `talk courier: re-executing in place from the main checkout ${candidate.mainRoot} — this follower runs another tree's code`;
  }
  return `talk courier: re-executing in place at ${candidate.head} — main changed ${candidate.path} since this follower started`;
}
