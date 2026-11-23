/**
 * Seat recovery — pure: which live workspace is a seat standing behind a WALL it cannot answer through, and
 * what re-seats it. The verb (`../cli/commands/session/reSeat.ts`) owns the socket, the capacity read, the
 * close and the boot; `session watch` reads the same detector to report the seat before anyone runs the verb.
 *
 * ## The two walls
 *
 * **Logged out.** `cmux spawn` boots Claude with its seat's setup token handed in on file descriptor 3
 * (`../claude/seatPinning.ts`'s `bootEnvPrefix`), against a credential store that deliberately holds nothing
 * (`../claude/seatToken.ts`). When the machine restarts, cmux reopens every workspace and re-runs a bare
 * `claude` in it — no descriptor, no token, and an empty store — so each one comes up reading
 * `Not logged in · Please run /login` and cannot resume. MEASURED:
 * one seat read exactly that, and eighteen more had all reopened the same way.
 *
 * **Limit retrying.** A seat whose plan spent its window sits on Claude Code's own retry spinner —
 * `✻ Weekly limit reached · Retrying in 5h …` — alive, reading busy to every hook, and answering nothing for
 * hours (`../claude/limitBanner.ts` carries the measured line and its matcher). The owner's rule is to nudge or respawn a
 * limit-hit seat, never leave it retrying — after two seats, the console
 * archive port and the live Slack loop, sat on a plan at 100% of its week until the chair re-seated both by
 * hand. A respawn is the move because `cmux spawn`'s plan routing picks a plan with headroom; sending the
 * stuck prompt anything cannot move it off the spent one.
 *
 * ## Why the answer is a respawn, never a `/login`
 *
 * A hand `/login` writes the account into the shared keychain, which is the mutation the whole seat design
 * exists to prevent. The credential path is `cmux spawn` itself, and an open run's pickup from it is already
 * `handover resume` (`../cmux/pickupCommand.ts`), so re-seating is: close the walled workspace — its old
 * `claude` process with it, so the successor's resume does not find a live writer on the journal — and spawn
 * the row's slug again on the model its ledger row recorded.
 *
 * ## Which rows it can re-seat, and which it never reads
 *
 * Only an OPEN, slug-backed ledger row pinned to a model. The pairing is `./closeDone.ts`'s
 * `pairRowsToWorkspaces` — ref and worktree, then worktree alone — because cmux renumbers every
 * `workspace:N` on restart. A walled workspace no slug-backed row claims (a bot-turn child, a hand-opened
 * tab) is REPORTED and left alone: there is no doc to spawn, and closing it would be deciding for its owner.
 * A row whose boot model was inherited or never recorded is reported too, because `cmux spawn` refuses a boot
 * with no `--model` and guessing a tier is the exact drift that refusal exists for. A PINNED workspace is
 * never read at all: the supervisor chair hands itself off on its own cadence, and recovering it here would
 * race that.
 */
import { detectLimitRetryBanner } from "../claude/limitBanner.js";
import type { CmuxWorkspaceSummary } from "../cmux/client.js";
import { pairRowsToWorkspaces } from "./closeDone.js";
import type { SessionItem } from "./session.js";

/**
 * How many of a screen's last non-blank lines a wall is looked for in.
 *
 * Claude Code draws `Not logged in · Please run /login` under its prompt box and its retry spinner just above
 * it, both among the last few lines of the surface. Bounding the search keeps a transcript that merely QUOTES
 * either line higher up — this very issue being discussed in a seat, say — from reading as a walled seat.
 */
export const SEAT_WALL_TAIL_LINES = 12;

/**
 * The banner a logged-out Claude Code session shows, matched on its stable words rather than the separator, and
 * only as the WHOLE of its line: Claude Code draws it alone, indented, under the prompt box.
 */
const LOGGED_OUT_LINE = /^\s*Not logged in\b[^\n]*\/login\b/i;

/**
 * The same banner as Claude Code 2.1.289 draws it: RIGHT-ALIGNED at the end of the mode row under the prompt, after
 * a run of padding — `  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents      Not logged in · Run /login`.
 * MEASURED on a seat booted with an empty `CLAUDE_CONFIG_DIR`: the own-line shape above matched nothing,
 * so `cmux reseat --all --dry-run` read the walled seat as clear. The padding and the end of the row are both
 * required, so a sentence that merely mentions the banner mid-row does not count.
 */
const RIGHT_ALIGNED_LOGGED_OUT = /\S {2,}Not logged in\b[^\n]*\/login\s*$/i;

/**
 * The same banner where 2.1.289 draws it once the mode row is full: right-aligned on a row of its OWN directly above
 * the prompt box's top rule. MEASURED (drill X2): with `· ← for agents` on the mode row the banner moved
 * up there, the reader saw only the footer, and `fleet resume` nudged a logged-out supervisor for its whole wait.
 * The words alone are not enough: {@link bannerRightAlignedAboveRule} also wants the row RIGHT-ALIGNED to the rule.
 */
const ABOVE_RULE_LOGGED_OUT = /^ +Not logged in\b[^\n]*\/login\s*$/i;

/** The prompt box's top rule. */
const RULE_LINE = /^─+\s*$/;

/**
 * How far short of the rule's right end the banner may stop. MEASURED (drill X2): the banner ended two
 * columns short of a 99-column rule — `slopweaver cmux read-screen --workspace <walled seat>`.
 */
const RIGHT_EDGE_SLACK = 4;

/**
 * Whether a row above the prompt box is Claude Code's own right-aligned banner rather than a transcript quoting it:
 * the banner is padded across at least half the rule and ends at its right edge (an eight-space
 * transcript quote two rows above the prompt read as a wall when indentation was the whole test). RESIDUE, stated:
 * a reply that reproduces the banner byte for byte, padded to the right edge, as the last row above the
 * prompt is indistinguishable on screen. Tightening further would risk missing a real wall, which stalls a whole
 * recovery; the false read costs one in-place reseat that keeps the seat's context.
 */
function bannerRightAlignedAboveRule({ row, rule }: { row: string; rule: string }): boolean {
  if (!ABOVE_RULE_LOGGED_OUT.test(row)) {
    return false;
  }
  const width = rule.trimEnd().length;
  const indent = row.length - row.trimStart().length;
  return indent * 2 >= width && row.trimEnd().length >= width - RIGHT_EDGE_SLACK;
}

/** A line only the transcript draws: an assistant or tool bullet, or a tool result. */
const TRANSCRIPT_LINE = /^\s*(?:⏺|⎿)/;

/** The live input line — `│ >` inside the prompt box, or a bare `>` / `❯` prompt. */
const PROMPT_LINE = /^\s*(?:│\s*)?[>❯](?:\s|$)/;

/**
 * Claude Code's retry spinner as it draws it: one of its own animation glyphs at column 0, then the banner, ending
 * on the retry counter it ticks (`· attempt 1/300`, `limitBanner.ts`'s capture). An ALLOWLIST: a
 * denylist of transcript prefixes let a quoted line through, and a glyph alone let a `* ` bullet through.
 */
const LIVE_SPINNER_LINE = /^[·✢✳✶✻✽*] [^\n]*·\s*attempt \d+\/\d+\s*$/;

/**
 * A line the walk up from the prompt passes over: blank, indented (a tip or todo under the spinner), or a rule or
 * box edge of the prompt itself. Anything else at column 0 is the nearest thing Claude Code drew above its prompt.
 */
const UNDER_SPINNER_LINE = /^(?:\s|[─╭╰]|$)/;

/** A row that continues the one above it: indented text a narrow pane hard-wrapped, never a `⎿` tip or a rule. */
const WRAPPED_CONTINUATION = /^\s+(?![⎿─\s])\S/;

/**
 * One drawn line, rejoined: the row at `start` plus every hard-wrapped continuation row directly beneath it, so a
 * spinner whose retry counter a narrow pane pushed onto the next row still reads whole.
 */
function rejoinWrapped({ rows, start }: { rows: readonly string[]; start: number }): string {
  const continuation = rows.slice(start + 1).findIndex((row) => !WRAPPED_CONTINUATION.test(row));
  const end = continuation === -1 ? rows.length : start + 1 + continuation;
  return rows
    .slice(start, end)
    .map((row, index) => (index === 0 ? row.trimEnd() : row.trim()))
    .join(" ");
}

/** What stops a live seat from answering, as its screen shows it. */
export type SeatWall =
  /** `Not logged in · Please run /login` — reopened without its setup token. */
  | { readonly kind: "logged-out" }
  /** Claude Code's usage-limit retry spinner; `banner` is the line exactly as the screen drew it. */
  | { readonly kind: "limit-retrying"; readonly banner: string };

/** The screen's last {@link SEAT_WALL_TAIL_LINES} non-blank lines. */
function screenTail({ screen }: { screen: string }): readonly string[] {
  return screen
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-SEAT_WALL_TAIL_LINES);
}

/**
 * Whether a screen shows a Claude Code session that is not logged in.
 *
 * The banner must stand BELOW the live prompt line, where Claude Code draws it — a line of its own, or right-aligned
 * at the end of the mode row as 2.1.289 draws it — or, the one exception, right-aligned on its own row directly above
 * the prompt box's top rule, where 2.1.289 moves it when the mode row is full. A transcript that
 * quotes it sits above the prompt, so it never counts however near the bottom it is; and a screen
 * with no prompt line in its tail is not a Claude Code prompt at all, so it is no wall either.
 *
 * @param screen the surface text, or `undefined` when it could not be read
 * @returns true only when the banner line follows the last prompt line among the screen's last
 *   {@link SEAT_WALL_TAIL_LINES} non-blank lines
 */
export function screenShowsLoggedOut({ screen }: { screen: string | undefined }): boolean {
  if (screen === undefined) {
    return false;
  }
  const tail = screenTail({ screen });
  const prompt = tail.findLastIndex((line) => PROMPT_LINE.test(line));
  if (prompt === -1) {
    return false;
  }
  const footer = tail.slice(prompt + 1);
  // Claude Code draws no transcript below its live prompt, so a bullet or tool result there means this is not the
  // screen shape the banner was measured on — and a wrong wall closes a healthy seat.
  if (footer.some((line) => TRANSCRIPT_LINE.test(line))) {
    return false;
  }
  if (footer.some((line) => RIGHT_ALIGNED_LOGGED_OUT.test(line))) {
    return true;
  }
  const rule = tail[prompt - 1];
  const aboveRule = tail[prompt - 2];
  if (
    rule !== undefined &&
    RULE_LINE.test(rule) &&
    aboveRule !== undefined &&
    bannerRightAlignedAboveRule({ row: aboveRule, rule })
  ) {
    return true;
  }
  // A narrow pane hard-wraps the banner across as many rows as it needs, at column 0, so each
  // footer row is read together with every row beneath it — the footer is chrome only, checked just above — and
  // the banner still has to START a row.
  return footer.some((_, index) =>
    LOGGED_OUT_LINE.test(
      footer
        .slice(index)
        .map((row) => row.trim())
        .join(" "),
    ),
  );
}

/**
 * The retry spinner's line, when it stands in the screen's tail as the spinner itself rather than as quoted text:
 * the NEAREST column-0 line above the live prompt, where Claude Code draws it, in the spinner's own shape. A screen
 * with no prompt line in its tail is not a Claude Code prompt, so it shows no spinner either.
 *
 * @param screen the surface text
 * @returns the banner line exactly as drawn, or undefined
 */
function limitSpinnerLine({ screen }: { screen: string }): string | undefined {
  const tail = screenTail({ screen });
  const prompt = tail.findLastIndex((line) => PROMPT_LINE.test(line));
  const above = tail.slice(0, Math.max(prompt, 0));
  const start = above.findLastIndex((line) => !UNDER_SPINNER_LINE.test(line));
  if (start === -1) {
    return undefined;
  }
  const nearest = rejoinWrapped({ rows: above, start });
  if (!LIVE_SPINNER_LINE.test(nearest)) {
    return undefined;
  }
  return detectLimitRetryBanner({ text: nearest });
}

/**
 * The wall a screen shows, if any. Only the two concrete banners count — never quiet time, hook state or a
 * plan reading — because what this feeds closes a workspace. Logged out wins when both show: the seat cannot
 * be recovered without its credential whatever limit line it also carries.
 *
 * @param screen the surface text, or `undefined` when it could not be read (which is no wall, not health)
 * @returns the wall, or `undefined` when neither banner stands in the screen's tail
 */
export function detectSeatWall({ screen }: { screen: string | undefined }): SeatWall | undefined {
  if (screen === undefined) {
    return undefined;
  }
  if (screenShowsLoggedOut({ screen })) {
    return { kind: "logged-out" };
  }
  const banner = limitSpinnerLine({ screen });
  if (banner === undefined) {
    return undefined;
  }
  return { banner, kind: "limit-retrying" };
}

/**
 * The live workspaces whose screens are worth reading: every one but a pinned one, the recorded chair and the
 * caller's own. The recorded pin is a second witness beside cmux's `pinned` flag, because an inventory row that
 * omits the flag parses as unpinned and the chair is the one seat this must never close.
 * Deliberately blind to hook state — a limit-walled seat reads `working` for as long as it retries.
 *
 * @param workspaces the live cmux inventory
 * @param ownWorkspaceId the caller's own workspace id, or `undefined` outside cmux
 * @param chairWorkspaceId the workspace `cmux pin` recorded as the supervisor's, or `undefined` when none is
 * @returns the workspaces to read, in inventory order
 */
export function seatRecoveryScreenTargets({
  workspaces,
  ownWorkspaceId,
  chairWorkspaceId,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  ownWorkspaceId: string | undefined;
  chairWorkspaceId: string | undefined;
}): readonly CmuxWorkspaceSummary[] {
  return workspaces.filter(
    (workspace) =>
      !workspace.pinned && workspace.workspaceId !== ownWorkspaceId && workspace.workspaceId !== chairWorkspaceId,
  );
}

/** Why a walled workspace is reported rather than re-seated. */
type NotRespawnableReason =
  /** No open, slug-backed ledger row claims this workspace — there is no doc to spawn. */
  | "no-slug-row"
  /** The row's boot model was inherited or never recorded, and `cmux spawn` refuses a boot with no `--model`. */
  | "no-pinned-model";

/** One walled workspace, placed. */
export type SeatRecoveryItem =
  /** Close it, then `cmux spawn <slug> --model <model>`. */
  | {
      readonly kind: "respawn";
      readonly wall: SeatWall;
      readonly workspace: CmuxWorkspaceSummary;
      readonly row: SessionItem;
      readonly slug: string;
      readonly model: string;
    }
  /** Walled, and left alone — the reason says why. */
  | {
      readonly kind: "not-respawnable";
      readonly wall: SeatWall;
      readonly workspace: CmuxWorkspaceSummary;
      readonly row: SessionItem | undefined;
      readonly reason: NotRespawnableReason;
    };

/** A walled seat the verb closes and boots again. */
export type RespawnableSeat = Extract<SeatRecoveryItem, { readonly kind: "respawn" }>;

/** A walled seat the verb reports and leaves standing. */
export type NonRespawnableSeat = Extract<SeatRecoveryItem, { readonly kind: "not-respawnable" }>;

/**
 * Place every walled workspace: re-seat it, or report why not.
 *
 * @param rows the folded session ledger, most recently opened first; only OPEN rows are paired
 * @param workspaces the live cmux inventory
 * @param wallsByWorkspaceId the wall each walled workspace's screen showed, keyed by workspace id
 * @returns one item per walled workspace, in inventory order
 */
export function planSeatRecovery({
  rows,
  workspaces,
  wallsByWorkspaceId,
}: {
  rows: readonly SessionItem[];
  workspaces: readonly CmuxWorkspaceSummary[];
  wallsByWorkspaceId: ReadonlyMap<string, SeatWall>;
}): readonly SeatRecoveryItem[] {
  const paired = pairRowsToWorkspaces({ rows: rows.filter((row) => row.status === "open"), workspaces });
  const rowByWorkspace = new Map<string, SessionItem>();
  for (const [row, workspace] of paired) {
    rowByWorkspace.set(workspace.workspaceId, row);
  }
  const items: SeatRecoveryItem[] = [];
  for (const workspace of workspaces) {
    const wall = wallsByWorkspaceId.get(workspace.workspaceId);
    if (wall === undefined) {
      continue;
    }
    const row = rowByWorkspace.get(workspace.workspaceId);
    if (row?.slug === undefined) {
      items.push({ kind: "not-respawnable", reason: "no-slug-row", row, wall, workspace });
      continue;
    }
    if (row.bootModel?.kind !== "pinned") {
      items.push({ kind: "not-respawnable", reason: "no-pinned-model", row, wall, workspace });
      continue;
    }
    items.push({ kind: "respawn", model: row.bootModel.model, row, slug: row.slug, wall, workspace });
  }
  return items;
}

/** How one placed item ended. */
export type SeatRecoveryOutcome =
  /** Closed and re-spawned; the spawn's own line names the new workspace. */
  | {
      readonly kind: "respawned";
      readonly item: RespawnableSeat;
      /** Why the old row's ledger close did not record, when it did not — the boot ran regardless. */
      readonly ledgerProblem?: string;
    }
  /** Would have been re-seated — a dry run. */
  | { readonly kind: "would-respawn"; readonly item: RespawnableSeat }
  /** The capacity HOLD outlasted its wait; nothing was closed, and every later seat was left as it stood. */
  | { readonly kind: "held"; readonly item: RespawnableSeat }
  /** Refused before the close (the model pin), so the seat stands as it was. */
  | { readonly kind: "refused"; readonly item: RespawnableSeat; readonly reason: string }
  /** The close failed and a fresh inventory still lists the workspace; nothing was spawned. */
  | { readonly kind: "close-failed"; readonly item: RespawnableSeat; readonly reason: string }
  /** The close answered an error and the inventory could not be re-read: it may have happened, so nothing was spawned. */
  | { readonly kind: "close-unknown"; readonly item: RespawnableSeat; readonly reason: string }
  /** Closed, but `cmux spawn` exited non-zero — its own lines say why. */
  | {
      readonly kind: "spawn-failed";
      readonly item: RespawnableSeat;
      readonly exitCode: number;
      /** What `cmux spawn` threw, when it threw rather than exiting. */
      readonly thrown?: string;
      /** Why the old row's ledger close did not record, when it did not. */
      readonly ledgerProblem?: string;
    }
  /** Reported and left alone. */
  | { readonly kind: "reported"; readonly item: NonRespawnableSeat };

/** The two columns naming a seat: its ref, with its title when cmux has one, then the wall it stands behind. */
function seatColumns({ item }: { item: SeatRecoveryItem }): string {
  const { workspace } = item;
  if (workspace.title === undefined) {
    return `${workspace.workspaceRef}\t${item.wall.kind}`;
  }
  return `${workspace.workspaceRef} (${workspace.title})\t${item.wall.kind}`;
}

/** The line for a walled workspace the verb leaves alone, naming the one hand step that re-seats it. */
function renderReported({ item, name }: { item: NonRespawnableSeat; name: string }): string {
  const close = `slopweaver cmux close ${item.workspace.workspaceRef}`;
  const slug = item.row?.slug;
  if (item.reason === "no-slug-row" || slug === undefined) {
    return `reported\t${name}\tno open doc row claims it, so there is nothing to spawn — ${close} if it is done`;
  }
  return `reported\t${name}\t${slug} recorded no pinned model — re-seat by hand: ${close}, then slopweaver cmux spawn ${slug} --model <opus|sonnet>`;
}

/** How a failed spawn ended: the exit code it returned, or what it threw. */
function spawnFailure({ outcome }: { outcome: { readonly exitCode: number; readonly thrown?: string } }): string {
  if (outcome.thrown === undefined) {
    return `exited ${String(outcome.exitCode)}`;
  }
  return `threw (${outcome.thrown})`;
}

/** The tail a line carries when the old row's ledger close failed to record: the row still reads open. */
function ledgerNote({ outcome }: { outcome: { readonly ledgerProblem?: string } }): string {
  if (outcome.ledgerProblem === undefined) {
    return "";
  }
  return ` — the old ledger row is still open (its close did not record: ${outcome.ledgerProblem})`;
}

/**
 * One outcome as the line the verb prints: what happened, the workspace, the wall it stood behind, and why.
 *
 * @param outcome what happened to one walled workspace
 * @returns the line
 */
export function renderSeatRecoveryOutcome({ outcome }: { outcome: SeatRecoveryOutcome }): string {
  const name = seatColumns({ item: outcome.item });
  switch (outcome.kind) {
    case "respawned":
      return `respawned\t${name}\t${outcome.item.slug} re-seated on --model ${outcome.item.model}${ledgerNote({ outcome })}`;
    case "would-respawn":
      return `would respawn\t${name}\tclose, then cmux spawn ${outcome.item.slug} --model ${outcome.item.model}`;
    case "held":
      return `held\t${name}\tmachine capacity HOLD outlasted the wait — nothing closed, the seat is still walled; re-run once it clears`;
    case "refused":
      return `refused\t${name}\t${outcome.reason}`;
    case "close-failed":
      return `close failed\t${name}\t${outcome.reason} — nothing spawned`;
    case "close-unknown":
      return `close unknown\t${name}\t${outcome.reason}, and cmux could not be re-listed, so the close may have happened — nothing spawned; if ${outcome.item.workspace.workspaceRef} is gone, re-seat: slopweaver cmux spawn ${outcome.item.slug} --model ${outcome.item.model}`;
    case "spawn-failed":
      return `spawn failed\t${name}\tclosed, but cmux spawn ${outcome.item.slug} ${spawnFailure({ outcome })}; re-run: slopweaver cmux spawn ${outcome.item.slug} --model ${outcome.item.model}${ledgerNote({ outcome })}`;
    case "reported":
      return renderReported({ item: outcome.item, name });
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** The clause naming screens the pass could not read, or nothing when it read them all. */
function unreadClause({ unreadScreens }: { unreadScreens: number }): string {
  if (unreadScreens === 0) {
    return "";
  }
  return `; ${String(unreadScreens)} screen(s) could not be read, so a wall there is unknown`;
}

/**
 * The closing summary line.
 *
 * @param outcomes every placed item's outcome
 * @param dryRun whether nothing was acted on
 * @param unreadScreens how many target screens could not be read at all
 * @returns the summary
 */
export function renderSeatRecoverySummary({
  outcomes,
  dryRun,
  unreadScreens,
}: {
  outcomes: readonly SeatRecoveryOutcome[];
  dryRun: boolean;
  unreadScreens: number;
}): string {
  const unread = unreadClause({ unreadScreens });
  if (outcomes.length === 0) {
    return `session re-seat: no read seat is logged out or limit-retrying${unread}`;
  }
  const count = ({ kind }: { kind: SeatRecoveryOutcome["kind"] }): number =>
    outcomes.filter((outcome) => outcome.kind === kind).length;
  const walls = ({ kind }: { kind: SeatWall["kind"] }): string =>
    `${String(outcomes.filter((outcome) => outcome.item.wall.kind === kind).length)} ${kind}`;
  const acted = dryRun
    ? `${String(count({ kind: "would-respawn" }))} would respawn`
    : `${String(count({ kind: "respawned" }))} respawned`;
  const failed =
    count({ kind: "close-failed" }) +
    count({ kind: "close-unknown" }) +
    count({ kind: "spawn-failed" }) +
    count({ kind: "refused" });
  const unrecorded = outcomes.filter((outcome) => "ledgerProblem" in outcome).length;
  const ledger = unrecorded === 0 ? "" : `, ${String(unrecorded)} ledger close(s) not recorded`;
  return (
    `session re-seat: ${String(outcomes.length)} walled seat(s) — ${walls({ kind: "logged-out" })}, ` +
    `${walls({ kind: "limit-retrying" })} — ${acted}, ${String(count({ kind: "held" }))} held on capacity, ` +
    `${String(failed)} failed, ${String(count({ kind: "reported" }))} reported${ledger}${unread}`
  );
}
