/**
 * The cmux tab a `fleet resume` runs in, and when it is closed. Pure; the closes are
 * `../cli/commands/fleet/ownShellClose.ts` (its own tab) and `../cli/commands/session/closeDoneShells.ts` (a tab
 * left behind).
 *
 * ## Why the tab has to be closed at all
 *
 * The desktop app opens a NEW cmux workspace for every launch and types the resume line into it
 * (`desktop/src/fleetProcess.ts`), and nothing closed one. MEASURED: 63 workspaces titled by the main
 * checkout path, each a finished zsh, had accumulated since the keep-alive's resumes began — one per healthy
 * attempt in `fleet/resume.jsonl` (`jq -c 'select(.kind=="attempt-finished")' "$SLOPWEAVER_HOME/fleet/resume.jsonl"`).
 *
 * ## Two closers, two strengths of evidence
 *
 * - **The pass closes its own tab** once its finish line is journalled and its lines printed, however it ended: the
 *   journal carries every refusal and the sessions page reads it there, so the tab holds nothing the page does not.
 *   MEASURED: kept open on a failed end, two attempts each stranded a bare tab the chair
 *   closed by hand.
 *   Only when `--episode` was named — the desktop's typed line always names one and the command the stall note shows
 *   the owner does not — so a resume the owner typed into their own tab never closes it.
 * - **`session close-done` closes one left behind** — a self-close that failed, or a tab from before this — only
 *   on three witnesses at once: the verb's own finish line at the bottom of the screen with nothing but the prompt
 *   under it, a process tree that is positively a bare shell, and either a healthy outcome, a LATER finished attempt
 *   in the journal (the desktop launches every continuation and button press in a fresh tab, so a superseded tab
 *   says nothing current), or every seat its attempt refused journalled gone (`./goneSeats.ts`), since then it
 *   reports nothing that exists.
 *
 * One window stays open, stated rather than discovered: anything typed or started in the tab after the last reads
 * before the close — the tree once more, then the screen once more — is closed with it. The `workspace.close` call
 * names only the workspace (`../cmux/client.ts`), so a further read only narrows that window, never shuts it.
 */
import { type FleetJournalRead, foldNewestAttempt, newestAttemptReadWhole } from "./journal.js";
import type { FleetAttemptOutcome } from "./resumePlan.js";

/** How many non-blank lines at the bottom of a screen the finish line may sit in: itself, its wraps, the prompt. */
const RESUME_FINISH_TAIL_LINES = 5;

/** Every outcome an attempt can end in, as the finish line prints it. */
const OUTCOMES: readonly FleetAttemptOutcome[] = ["healthy", "hand-step", "deferred", "failed"];

/**
 * The finish line's head, matched with its whitespace removed, since a narrow terminal may wrap the line anywhere —
 * inside the attempt id included. It only names the attempt and outcome to look for: the WHOLE line is then
 * required.
 */
const FINISH_HEAD = /^fleetresume:attempt([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})ended([a-z-]+)/u;

/** What one finish line names. */
export interface ResumeFinish {
  readonly attemptId: string;
  readonly outcome: FleetAttemptOutcome;
}

/**
 * The last line `fleet resume` prints — the one a left-behind tab is recognised by, so the printer and the
 * reader cannot drift.
 *
 * @param finish the attempt and how it ended
 * @returns the line
 */
export function resumeFinishLine({ finish }: { finish: ResumeFinish }): string {
  return `fleet resume: attempt ${finish.attemptId} ended ${finish.outcome} — \`slopweaver fleet health\` shows the page`;
}

/**
 * Whether a pass closes the tab it ran in.
 *
 * @param finishJournalled whether the journal took its finish line — a tab whose attempt the page cannot see end
 *   stays, since the page still reads it running
 * @param episodeNamed whether `--episode` was passed, which only the desktop's typed line does
 * @param ownWorkspaceId the pass's own workspace, `CMUX_WORKSPACE_ID`, or `undefined` outside cmux
 * @param pinned whether that workspace is the pinned one — never closed
 * @returns true only for a journalled, desktop-launched pass in an unpinned cmux workspace, however it ended
 */
export function shouldCloseOwnShell({
  finishJournalled,
  episodeNamed,
  ownWorkspaceId,
  pinned,
}: {
  finishJournalled: boolean;
  episodeNamed: boolean;
  ownWorkspaceId: string | undefined;
  pinned: boolean;
}): boolean {
  return finishJournalled && episodeNamed && ownWorkspaceId !== undefined && !pinned;
}

/** Text with every whitespace run removed: where a terminal wraps a line, and whether it keeps the space, varies. */
function squash({ text }: { text: string }): string {
  return text.replaceAll(/\s+/gu, "");
}

/**
 * The index of the row the finish line's text ends on, read on from `index` — `undefined` when the rows run out
 * first, since then the line is cut off.
 */
function finishEndRow({
  rows,
  index,
  line,
}: {
  rows: readonly string[];
  index: number;
  line: string;
}): number | undefined {
  const want = squash({ text: line }).length;
  let have = 0;
  for (let end = index; end < rows.length; end += 1) {
    have += squash({ text: rows[end]! }).length;
    if (have >= want) {
      return end;
    }
  }
  return undefined;
}

/** A shell prompt's closing token, standing alone: zsh's `%`, sh's `$`, root's `#`, and the common `>`/`❯`. */
const PROMPT_TERMINATORS: ReadonlySet<string> = new Set(["%", "$", "#", ">", "❯"]);

/**
 * Whether a row is a prompt with nothing typed at it: its last token is a lone terminator, and it is the ONLY
 * terminator character on the row. `ada@mac slopweaver % ` is; `ada@mac slopweaver % git status` is not, nor
 * is a prompt with input that itself ends in a lone `%`, glued to it or not (`%echo %`). A shell whose
 * prompt glues the terminator on (`bash-3.2$`), or carries a second one, reads as typed-at, so its tab is kept — the
 * fail-closed direction. Stated rather than discovered, since the screen alone cannot know the shell's prompt: one
 * space typed after a prompt with no space of its own reads exactly as an untouched `% `, and so does a draft ending in
 * a lone terminator under a prompt that ends in none of them (`sh printf %`). The login shell every tab
 * opens is zsh, whose prompt ends `% ` (`dscl . -read ~ UserShell`).
 */
function untouchedPrompt({ row }: { row: string }): boolean {
  const last = row.trim().split(/\s+/u).at(-1);
  const terminators = [...PROMPT_TERMINATORS].reduce(
    (count, terminator) => count + row.split(terminator).length - 1,
    0,
  );
  // The row ENDS on the terminator and at most the prompt's own one ASCII space: cmux pads no row (`cat -e` on the live
  // a finished tab ends `% $`), so anything more is input typed at it — a second space, or a no-break one `trimEnd`
  // would have hidden.
  const bare = row.endsWith(" ") ? row.slice(0, -1) : row;
  return last !== undefined && PROMPT_TERMINATORS.has(last) && terminators === 1 && bare.endsWith(last);
}

/**
 * Whether a row carries any character a prompt closes on, anywhere — lone (`% echo`), glued before its input
 * (`bash-3.2$`) or after it with no space (`%echo`, `host:~$echo`). Judged on characters, not tokens,
 * since a token reading was beaten each time it named where the terminator sits. Output that carries one (`a -> b`,
 * `5h 5%`) reads as a prompt too, keeping the tab — fail-closed.
 */
function promptLike({ row }: { row: string }): boolean {
  return [...PROMPT_TERMINATORS].some((terminator) => row.includes(terminator));
}

/**
 * The finish line starting at one row, or `undefined` when it does not. The row must open on the line's first
 * word, unindented, so an indented or prefixed quote never counts; the line, read on across the rows under it,
 * must then be exactly the verb's own, so a cut-off head never counts either. Under it may sit at most ONE
 * non-blank row, and that one an untouched prompt (`untouchedPrompt`), so a tab where anything was typed since —
 * answered, or still a draft at the prompt — is no longer the pass's leftover.
 */
function finishAt({ rows, index }: { rows: readonly string[]; index: number }): ResumeFinish | undefined {
  const row = rows[index]!;
  if (!row.startsWith("fleet")) {
    return undefined;
  }
  const shown = squash({ text: rows.slice(index).join("") });
  const match = FINISH_HEAD.exec(shown);
  if (match === null) {
    return undefined;
  }
  const [, attemptId, word] = match;
  const outcome = OUTCOMES.find((known) => known === word);
  if (attemptId === undefined || outcome === undefined) {
    return undefined;
  }
  const finish = { attemptId, outcome };
  const line = resumeFinishLine({ finish });
  if (!shown.startsWith(squash({ text: line }))) {
    return undefined;
  }
  const end = finishEndRow({ index, line, rows });
  if (end === undefined || rows.length - end - 1 > 1) {
    return undefined;
  }
  // The rows the line spans hold the line and nothing else: text run on after it is output, not the verb.
  if (squash({ text: rows.slice(index, end + 1).join("") }) !== squash({ text: line })) {
    return undefined;
  }
  const under = rows[end + 1];
  return under === undefined || untouchedPrompt({ row: under }) ? finish : undefined;
}

/**
 * The finish line in a screen's last {@link RESUME_FINISH_TAIL_LINES} non-blank lines, newest first. A Claude
 * session quoting the line renders its composer and status bar below it, so a quote never reaches the tail.
 *
 * Only the tail's LAST row may look like a prompt. A prompt anywhere above it — with its command on the same row, on
 * the row a long prompt wrapped onto, or nothing at all — means the shell has handed the owner the tab since the pass
 * printed, so the tail carries no finish and the tab is the owner's; so does the line's head on two rows, a replay
 * (`echo "$FINISH"`). Judged on the tail's structure rather than on what one row's input looks
 * like, since a row-by-row reading was beaten three ways. The line reproduced by output whose own prompt has already
 * scrolled above the tail is not seen; that tab closes.
 *
 * @param screen the surface's rendered text
 * @returns what the line names, or `undefined` when the tail carries none
 */
export function resumeFinishFromScreen({ screen }: { screen: string }): ResumeFinish | undefined {
  const tail = screen
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-RESUME_FINISH_TAIL_LINES);
  // Counted across the whole tail, squashed, since a head may wrap between any two of its words.
  const heads = squash({ text: tail.join("") }).split("fleetresume:attempt").length - 1;
  if (heads > 1 || tail.slice(0, -1).some((row) => promptLike({ row }))) {
    return undefined;
  }
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const finish = finishAt({ index, rows: tail });
    if (finish !== undefined) {
      return finish;
    }
  }
  return undefined;
}

/**
 * Whether a screen shows this attempt's own finish line, wrapped however the terminal wrapped it. The attempt id is
 * minted fresh per pass, so a tab showing it is the tab this pass printed into — which is what ties the workspace
 * `CMUX_WORKSPACE_ID` names to the pass, since that variable is inherited, never checked.
 * Deliberately looser than {@link resumeFinishFromScreen}: this asks WHERE the pass printed, not whether the tab is
 * left untouched, and a short pass's own command row sits in the tail that reader refuses.
 *
 * @param screen the surface's rendered text
 * @param finish the attempt this pass just finished, and how
 * @returns true only when the whole line is on the screen
 */
export function screenShowsFinish({ screen, finish }: { screen: string; finish: ResumeFinish }): boolean {
  return squash({ text: screen }).includes(squash({ text: resumeFinishLine({ finish }) }));
}

/** Why a finished resume tab is closed. */
export type ResumeShellCloseReason = "healthy" | "superseded" | "seats-gone";

/**
 * Whether the tab's attempt is the newest, read whole, finished with no refusal of its own and no failed console,
 * at least one of its seats was journalled gone (`./goneSeats.ts`), and every seat still standing — the supervisor's
 * included, which is never judged gone — reseated, so nothing it reported still exists. Requiring a gone line keeps
 * an attempt that failed for some other reason, every seat reseated, held exactly as before; requiring the read
 * whole keeps a seat line that would not decode from reading as one that reseated.
 */
function everyRefusedSeatGone({ finish, journal }: { finish: ResumeFinish; journal: FleetJournalRead }): boolean {
  if (!newestAttemptReadWhole({ journal })) {
    return false;
  }
  const { events } = journal;
  const attempt = foldNewestAttempt({ events });
  if (attempt?.attemptId !== finish.attemptId || attempt.finished === undefined) {
    return false;
  }
  if (attempt.finished.refusal !== undefined || attempt.console?.state === "failed") {
    return false;
  }
  if (!events.some((event) => event.kind === "seat-gone" && event.attemptId === finish.attemptId)) {
    return false;
  }
  return [...attempt.seats.values()].every((seat) => seat.phase === "reseated");
}

/**
 * Whether a finished resume tab may close: a healthy end at once, any other only once the journal shows that
 * attempt finished AND a different attempt finished after its LAST finish, in journal order — the journal does
 * not refuse a second finish line for one attempt, and the newest one is what decides — or once every seat it
 * refused is journalled gone, since then the tab reports nothing that still exists.
 *
 * @param finish what the tab's finish line names
 * @param journal the fleet journal as read, in order, with where any line failed to decode
 * @returns the reason to close, or `undefined` while the tab may still be what the owner reads
 */
export function resumeShellCloseReason({
  finish,
  journal,
}: {
  finish: ResumeFinish;
  journal: FleetJournalRead;
}): ResumeShellCloseReason | undefined {
  if (finish.outcome === "healthy") {
    return "healthy";
  }
  const finished = journal.events.filter((event) => event.kind === "attempt-finished");
  const own = finished.findLastIndex((event) => event.attemptId === finish.attemptId);
  if (own === -1) {
    return undefined;
  }
  if (finished.slice(own + 1).some((event) => event.attemptId !== finish.attemptId)) {
    return "superseded";
  }
  return everyRefusedSeatGone({ finish, journal }) ? "seats-gone" : undefined;
}
