/**
 * THE CHAIR'S LOADED CANON — how long the chair has been running on the skill, rule and `AGENTS.md` text it loaded
 * at boot, and whether `origin/main` has changed that text since.
 *
 * ## The owner's rule
 *
 * A chair that never hands off runs an older Claude Code and an older plug-in. The owner does not want hand-offs so
 * frequent that quality or cost suffers diminishing returns, only that the chair never runs stale for days.
 *
 * ## What a pull refreshes, and what only a hand-off does
 *
 * Every `git pull` in the chair's worktree runs lefthook's post-merge, which rebuilds the CLI, so the VERBS are
 * current on every tick. What is not is the text already in the chair's context: `AGENTS.md`, `.claude/rules` and
 * the supervisor skill, loaded when its process started. MEASURED off the hand-off docs' mtimes, a chair
 * seated off one hand-off ran four and a half days on its boot canon before the next was written. Reproduce:
 * `ls -lT $SLOPWEAVER_HOME/handovers/fresh-supervisor-handoff-*.md`.
 *
 * ## The two halves, and why both
 *
 * - **Age** — the session's process start, `startedAt` in Claude Code's own session registry
 *   (`~/.claude/sessions/<pid>.json`), which is when that text was loaded. {@link CANON_STALE_AFTER_HOURS} is set
 *   below the owner's two days because the verdict only prints on a tick, and the chair then writes a hand-off and seats a
 *   successor: firing at 36 hours is what has the successor seated before 48.
 * - **Change** — at least one commit on `origin/main`, committed after that boot, touching {@link CANON_PATHS}. Age
 *   alone is the bare clock the owner did not ask for: a chair whose canon nobody touched loses nothing by staying.
 *
 * ## The residue, stated
 *
 * The comparison is against the last-fetched `origin/main` — current to the chair's last pull — and only commits
 * AFTER the boot count, so a worktree already behind main when the chair booted is not seen. A `--resume`d chair
 * gets a fresh process start while its transcript still carries the older skill text. Both under-read; neither
 * can make a fresh chair hand off.
 *
 * Pure apart from the one injected `git log` seam.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";

/** The repository paths whose text the chair holds in context from boot. */
const CANON_PATHS = ["skills/supervisor", ".claude/rules", "AGENTS.md"] as const;

/** How many hours a chair may run on changed canon before it hands off. */
const CANON_STALE_AFTER_HOURS = 36;

/** One `origin/main` commit that changed the chair's canon. */
export interface CanonCommit {
  readonly sha: string;
  readonly committedIso: string;
  readonly subject: string;
}

/** When one chair session booted and what main has changed in its canon since, or why that could not be read. */
export type ChairCanonReading =
  | { readonly kind: "measured"; readonly bootedIso: string; readonly changed: readonly CanonCommit[] }
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * The `git` argv that lists every `origin/main` commit touching the canon since an instant, newest first.
 *
 * @param cwd the chair's worktree
 * @param sinceIso the chair session's boot; `--since` is a coarse lower bound that {@link parseCanonLog}'s caller
 *   re-filters exactly
 * @returns the argv, without the `git` itself
 */
export function canonLogArgs({ cwd, sinceIso }: { cwd: string; sinceIso: string }): readonly string[] {
  return ["-C", cwd, "log", "origin/main", `--since=${sinceIso}`, "--format=%H%x09%cI%x09%s", "--", ...CANON_PATHS];
}

/**
 * Parse `git log --format=%H%x09%cI%x09%s` output.
 *
 * @param text the command's stdout
 * @returns every commit in the order git printed them, or the first line that is not that shape
 */
export function parseCanonLog({ text }: { text: string }): Result<readonly CanonCommit[], SupervisorCoreError> {
  const commits: CanonCommit[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const first = line.indexOf("\t");
    const second = line.indexOf("\t", first + 1);
    if (first < 0 || second < 0) {
      return err(SupervisorCoreErrors.canonLogMalformed({ line }));
    }
    const sha = line.slice(0, first);
    const committedIso = line.slice(first + 1, second);
    if (!/^[0-9a-f]{40,64}$/u.test(sha) || Number.isNaN(Date.parse(committedIso))) {
      return err(SupervisorCoreErrors.canonLogMalformed({ line }));
    }
    commits.push({ committedIso, sha, subject: line.slice(second + 1) });
  }
  return ok(commits);
}

/**
 * Read one chair session's canon staleness: its boot off the registry, then main's canon commits since.
 *
 * @param startedAtMs the session registry's `startedAt`, epoch milliseconds; `0` is how an absent one decodes
 * @param runLog runs `git` with {@link canonLogArgs}'s argv for that boot and returns stdout, or the failure
 * @returns the boot and every canon commit strictly after it, or why either could not be read
 */
export function readChairCanonFor({
  startedAtMs,
  runLog,
}: {
  startedAtMs: number;
  runLog: (options: { sinceIso: string }) => Result<string, SupervisorCoreError>;
}): ChairCanonReading {
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return { kind: "unmeasured", why: "its session registry file records no `startedAt`, so its boot is unknown" };
  }
  return readChairCanonSince({ bootedIso: new Date(startedAtMs).toISOString(), runLog });
}

/**
 * Read a chair's canon staleness from an instant it is known to have loaded its canon by — a Claude session's
 * registry boot, or the instant a Codex chair's pin or chain link took the chair, which can only be LATER than the
 * thread's own start, so it delays a stale verdict and never brings one early.
 *
 * @param bootedIso the instant the chair's canon was loaded by
 * @param runLog runs `git` with {@link canonLogArgs}'s argv for that instant and returns stdout, or the failure
 * @returns the instant and every canon commit strictly after it, or why either could not be read
 */
export function readChairCanonSince({
  bootedIso,
  runLog,
}: {
  bootedIso: string;
  runLog: (options: { sinceIso: string }) => Result<string, SupervisorCoreError>;
}): ChairCanonReading {
  const bootedMs = Date.parse(bootedIso);
  if (Number.isNaN(bootedMs)) {
    return { kind: "unmeasured", why: `its canon floor ${bootedIso} is not an instant` };
  }
  const parsed = runLog({ sinceIso: bootedIso }).andThen((text) => parseCanonLog({ text }));
  if (parsed.isErr()) {
    return { kind: "unmeasured", why: parsed.error.message };
  }
  return {
    bootedIso,
    changed: parsed.value.filter((commit) => Date.parse(commit.committedIso) > bootedMs),
    kind: "measured",
  };
}

/** One hour, in the milliseconds two ISO instants subtract to. */
const HOUR_MS = 3_600_000;

/** The hand-off reason a chair session's stale canon gives — one arm of `./chairCadence.ts`'s reasons. */
export interface CanonStaleReason {
  readonly kind: "canon-stale";
  readonly bootedIso: string;
  readonly ageHours: number;
  readonly commits: number;
  readonly newestSha: string;
  readonly newestSubject: string;
}

/**
 * Judge one chair session's canon: old enough AND its canon changed on main since boot, never either alone.
 *
 * @param sessionId the chair session, named in a note
 * @param canon what {@link readChairCanonFor} read for it
 * @param nowIso the tick's own instant, which the session's age is measured to
 * @returns the reason or the note, either possibly absent
 */
export function judgeChairCanon({
  sessionId,
  canon,
  nowIso,
}: {
  sessionId: string;
  canon: ChairCanonReading;
  nowIso: string;
}): { reason?: CanonStaleReason; note?: string } {
  if (canon.kind === "unmeasured") {
    return { note: `session ${sessionId}: whether its loaded canon is stale is UNMEASURED — ${canon.why}` };
  }
  const ageHours = Math.floor((Date.parse(nowIso) - Date.parse(canon.bootedIso)) / HOUR_MS);
  // A NaN compares false against everything, so an unparseable instant must be caught here or it would read as stale.
  if (Number.isNaN(ageHours)) {
    return {
      note: `session ${sessionId}: its age is UNMEASURED — ${nowIso} or its boot ${canon.bootedIso} is not an instant`,
    };
  }
  const newest = canon.changed[0];
  if (ageHours < CANON_STALE_AFTER_HOURS || newest === undefined) {
    return {};
  }
  return {
    reason: {
      ageHours,
      bootedIso: canon.bootedIso,
      commits: canon.changed.length,
      kind: "canon-stale",
      newestSha: newest.sha.slice(0, 9),
      newestSubject: newest.subject,
    },
  };
}

/**
 * The stale-canon reason, as the hand-off block prints it.
 *
 * @returns one line, unindented
 */
export function canonStaleLine({ reason }: { reason: CanonStaleReason }): string {
  return (
    `this chair booted ${reason.bootedIso}, ${String(reason.ageHours)}h ago — at or past ${String(CANON_STALE_AFTER_HOURS)}h — ` +
    `and origin/main has since changed its loaded canon (${CANON_PATHS.join(", ")}) in ${String(reason.commits)} commit(s), ` +
    `newest ${reason.newestSha} "${reason.newestSubject}"`
  );
}
