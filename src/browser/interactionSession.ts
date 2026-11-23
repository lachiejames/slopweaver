/**
 * The PURE half of a browser interaction session — the record that makes `browser open`, a run of `act`
 * calls and `browser close` one continuous thing across separate processes, and the rules that decide
 * whether one is still live.
 *
 * ## Why a session exists at all, and the measurement that made it possible
 *
 * `browser shot` visits and releases in one process, which is right for a photograph and useless for a form:
 * a `fill` and the `click` that submits it are two commands, and between them the page has to still be
 * there. MEASURED against the owner's own Chrome, with a localhost fixture: the
 * `playwright-core` terminal client keeps a NAMED session (`-s=<name>`, or `PLAYWRIGHT_CLI_SESSION`) whose
 * state lives in `~/Library/Caches/ms-playwright/daemon/<sha1(workspaceDir)[0..16]>/<name>.session`, and
 * `goto`, `fill`, `select`, `check` and `click` run from FIVE separate node processes accumulated on one
 * page — the fixture ended at `{"text":"typed by a separate process","select":"c","checked":true,"count":1}`.
 * Reproduce by attaching and then running any two commands with the same `-s=`.
 *
 * So a session here is a small record naming what the client already remembers, plus the things the client
 * does not know: whose session it is, which origins it may touch, and when it goes stale.
 *
 * ## Expiry is inactivity, and an expired background session is let go of
 *
 * A session that has gone quiet for {@link INTERACTION_SESSION_TTL_MS} is not a session a later command may
 * silently act through: the page has had time to move, and the whole read-before-write argument rests on a
 * decision being recent. An expired session answers `SESSION_IDLE` and asks for a fresh `open`.
 *
 * So its window is held for nobody, and `machine reap` closes it — a BACKGROUND one, whoever opened it (measured:
 * eleven such windows on the owner's desktop, one live seat's). A foreground one was opened to be
 * shown to the owner and stays until its opener dies. Age from OPEN never decides (ownership is judged at
 * open, liveness at reap): a session in use is touched by every command. Each record carries its
 * {@link SessionOwner}, and `./sessionReap.ts` holds the whole judgement.
 */
import type { WindowPlacement } from "./foreground.js";

/**
 * How long a session may sit idle before a later command refuses to act through it.
 *
 * A POLICY choice stated as one. Fifteen minutes is long enough for a session to read a page, think, and
 * come back — and short enough that a forgotten session cannot be picked up an hour later and acted through
 * as if the page had not moved. It is deliberately longer than the window that bounds how fresh one
 * OBSERVATION must be: a session may outlive any single look at the page, and an action still has to cite a
 * recent look.
 */
export const INTERACTION_SESSION_TTL_MS = 15 * 60 * 1000;

/**
 * The opener of a session, read off its environment at `browser open`.
 *
 * Every field is nullable because each is a property of the HOST, not of the verb: a Codex seat has no
 * `CLAUDE_PID`, a plain terminal has no cmux workspace, and a session outside a fleet worktree has no run.
 */
export interface SessionOwner {
  /** The Claude Code process that opened it (`CLAUDE_PID`) — the pid `~/.claude/sessions/<pid>.json` is keyed by. */
  readonly pid: number | null;
  /** The cmux workspace it was opened from (`CMUX_WORKSPACE_ID`). */
  readonly cmuxWorkspace: string | null;
  /** The board row its worktree is named for, when it was opened inside `.claude/worktrees.noindex/<slug>`. */
  readonly runSlug: string | null;
}

/** A fleet worktree's own directory segment — the same shape `src/worktree/location.ts`'s `WORKTREE_SUFFIX` names. */
const WORKTREE_SEGMENT = /\/\.claude\/worktrees(?:\.noindex)?\/([^/]+)(?:\/|$)/u;

/**
 * The run a working directory belongs to: the slug its fleet worktree is named for.
 *
 * @param cwd the opener's working directory, which may be anywhere inside the worktree
 * @returns the slug, or `null` when the directory is not inside a fleet worktree
 */
export function runSlugOfCwd({ cwd }: { cwd: string }): string | null {
  const match = WORKTREE_SEGMENT.exec(cwd);
  if (match === null) {
    return null;
  }
  return match[1]!;
}

/**
 * Read the opener off the environment `browser open` runs in.
 *
 * @param env the process environment
 * @param cwd the working directory
 * @returns the owner, every field `null` when the host does not carry it
 */
export function sessionOwnerOf({
  env,
  cwd,
}: {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
}): SessionOwner {
  const rawPid = env["CLAUDE_PID"];
  let pid: number | null = null;
  if (rawPid !== undefined && /^[1-9][0-9]*$/u.test(rawPid)) {
    pid = Number(rawPid);
  }
  let cmuxWorkspace: string | null = null;
  const workspace = env["CMUX_WORKSPACE_ID"];
  if (workspace !== undefined && workspace.length > 0) {
    cmuxWorkspace = workspace;
  }
  return { cmuxWorkspace, pid, runSlug: runSlugOfCwd({ cwd }) };
}

/** One live interaction session, exactly as its record on disk carries it. */
export interface InteractionSession {
  /** The id every later command names. Generated, never supplied — a caller's name is not ownership. */
  readonly id: string;
  /** The name the terminal client knows this session by. */
  readonly clientSession: string;
  /** The private directory the client runs in, which is what keys its own session registry. */
  readonly workspace: string;
  /** The agent session that opened it, so a receipt can say who was driving. */
  readonly ownerSessionId: string;
  /**
   * Who opened it, beyond the session id — what `machine reap` judges liveness by, so a tab outlives exactly
   * the session that wanted it and no other. `null` on a record written before ownership was recorded.
   */
  readonly owner: SessionOwner | null;
  /** Origins this session may touch. A page that settles anywhere else is off-lease. */
  readonly origins: readonly string[];
  readonly openedAtIso: string;
  /** Bumped by every command, which is what "idle" is measured from. */
  readonly touchedAtIso: string;
  /**
   * Where the session's window belongs, chosen once at open and honoured by every later command that brings it
   * forward — `./foreground.ts` § the per-run choice.
   */
  readonly placement: WindowPlacement;
}

/**
 * One look at a page, which an action cites to prove it decided against what was there.
 *
 * `ref` is the terminal client's own element handle out of its accessibility snapshot, and it carries a
 * property worth more than anything this repository could build: MEASURED, a ref from a previous
 * page answers `Error: Ref f1e11 not found in the current page snapshot. Try capturing new snapshot.` So a
 * targeting mistake after a navigation fails CLOSED, in the client, before any element is touched — until the
 * new document re-issues that number to another element, which `./refIdentity.ts` catches by comparing what
 * the ref names in this look against the admission's own read.
 *
 * That is a complement to the URL check in {@link sessionObservationIsCurrent} and not a replacement for it:
 * a ref proves the snapshot is the current document's, never that the page is one this session was allowed
 * to act on, nor that the look was recent.
 */
export interface PageObservation {
  readonly id: string;
  /** The page as it was when the look was taken. */
  readonly url: string;
  readonly title: string;
  readonly observedAtIso: string;
  /** The snapshot file the client wrote, so a reader can see exactly what was on offer. */
  readonly snapshotPath: string;
  /**
   * The VIEWPORT, photographed when the look was taken — what a person at this browser would be seeing.
   *
   * A browser works well because every movement shows its result. A snapshot is a list of elements; it is not what is on
   * screen, and an agent that only ever reads one is working blind between actions.
   *
   * `null` on a record written by a build that took no picture, which a reader reports as an absence rather
   * than as a path to a file nobody wrote.
   */
  readonly screenshotPath: string | null;
}

/**
 * Whether a session is still live at one instant.
 *
 * @param session the record on disk
 * @param nowIso the instant to judge against — passed in, never read from the clock, so this stays pure
 * @returns true when a later command may act through it
 */
export function sessionIsLive({ session, nowIso }: { session: InteractionSession; nowIso: string }): boolean {
  const touched = Date.parse(session.touchedAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(touched) || Number.isNaN(now)) {
    return false;
  }
  return now - touched < INTERACTION_SESSION_TTL_MS;
}

/**
 * Whether an observation still describes the page the browser is on.
 *
 * Compared as whole URLs rather than origins: an observation of a monitor list does not vouch for the
 * monitor's own delete dialog, and the entire point of citing one is that the decision was about THIS page.
 *
 * @param observation the look the action cites
 * @param currentUrl the page the executor just read off the live browser
 * @returns true when the action may be judged against that look
 */
export function sessionObservationIsCurrent({
  observation,
  currentUrl,
}: {
  observation: PageObservation;
  currentUrl: string;
}): boolean {
  return observation.url === currentUrl;
}

/**
 * Whether an origin is one this session declared.
 *
 * @param session the record on disk
 * @param url the page an action is aimed at
 * @returns true when the page is on a declared origin
 */
export function sessionCoversUrl({ session, url }: { session: InteractionSession; url: string }): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return session.origins.includes(origin);
}
