/**
 * The sweep prompt the supervisor arms into `ScheduleWakeup` — rendered from the contract file the skill
 * owns, never re-typed.
 *
 * ## What was actually wrong
 *
 * MEASURED across eleven consecutive supervisor handoffs' own `ScheduleWakeup` calls (repro: pull
 * every `ScheduleWakeup` tool call out of the supervisor sessions' transcripts under `~/.claude/projects`
 * and word-count its `prompt`): each armed prompt ran 592 to 1,240 words as ONE paragraph, and 412-998 of those
 * words were STANDING procedure — the same instructions, re-typed by hand every tick and re-typed again by every
 * successor. The genuinely per-shift half never exceeded 547 words.
 *
 * Copying prose by hand loses it. The same rule appeared in eight different wordings across handoffs 29-32
 * and was simply ABSENT from 36, 37 and 38 while still true. That is the forgetting the owner described, and
 * it is mechanical: a rule survives only if the previous supervisor remembered to copy it.
 *
 * ## The shape that fixes it
 *
 * The standing half lives in ONE file — `skills/supervisor/reference/sweep-contract.md` — under the
 * `agent-doc-size` cap and the canon stale-reference ratchet. The armed prompt NAMES that file by path and
 * carries only the shift state. A successor arms the contract by reference; it cannot drop a step by
 * forgetting to retype it, because there is nothing to retype.
 *
 * ## The cap is on the RENDERED prompt; the author writes the SHIFT STATE. State the difference.
 *
 * MEASURED over 31 consecutive supervisor chair ticks (420 Bash calls; repro:
 * stream a chair's transcript under `~/.claude/projects/`, pair each `tool_use` with its
 * `tool_result` and grep the results for `^supervisor sweep-prompt: `). **33 of the 50 schema refusals the
 * chair hit in those ticks were this verb's word cap** — more than one a tick — and every rendered count was
 * 701 to 790, a median of 717. Its own shift files (`~/.slopweaver/supervisor-scratch/<seat>/shift-*.txt`)
 * measure 613 to 668 words.
 *
 * That distribution is not a supervisor writing walls of text. It is a supervisor aiming at a number nobody
 * ever told it. {@link MAX_RENDERED_PROMPT_WORDS} bounds the whole prompt, of which
 * {@link sweepPromptFrameWords} is the frame the render adds; the author's actual budget is the difference,
 * and until this file computed it no output anywhere carried that number. So
 * {@link shiftStateBudgetWords} is exported, the refusal states it, and `supervisor sweep-prompt --budget`
 * prints it BEFORE a shift state is written rather than after one is refused.
 *
 * ## Three refusals, all measured, and every one of them returned together
 *
 * - {@link MAX_RENDERED_PROMPT_WORDS} = 700. Above the largest measured shift half (547) with headroom,
 *   below every measured armed prompt (592 to 1,240). A prompt over it is carrying standing text again.
 * - {@link STANDING_STEP_MARKERS} — a shift state naming a standing STEP is re-typing the contract instead
 *   of pointing at it, which the word cap alone cannot catch (one chair's 592-word prompt was all standing
 *   text and no shift state at all). This check names the step, so the refusal is actionable.
 * - {@link flagTokensIn} — a shift state naming a command-line OPTION is telling the next tick HOW to invoke
 *   a verb, which is the contract's job in every case. MEASURED on the same ticks, by the matcher this file
 *   ships rather than the lookbehind that preceded it (a count is always its matcher's output, so re-measure
 *   rather than quote this after changing one — the repro is on {@link flagTokensIn}): every one of
 *   shift-335 through shift-359 carried 7 to 10 distinct option tokens (`--tick-id`, `--out`,
 *   `--keep-recent`, `--keep-notes`, `--timeout-seconds`, …), and the sentences holding them ran **219 to
 *   356 words a tick**, 33-57% of the whole shift state, hand-copied forward every tick — while
 *   `skills/supervisor/reference/derived-narrative.md` and `reference/verbs.md` already held the same flags.
 *   Delete those sentences and the genuine per-tick state measures 268 to 449 words against a 631-word
 *   budget, which is what takes this class from "retried every tick" to "cannot arise".
 *
 * **Every defect is collected, never returned one at a time.** Returning at the first meant a seat fixed a
 * marker, re-ran, and only then learned it was also over the word cap — one refusal per lap, and the lap is
 * the cost this whole file exists to remove.
 *
 * **Both edges now pass an overflow path, so the budget no longer refuses there.** Printing the budget before the
 * write did not stop the laps — 57 of 75 refusals over one chair's ticks 14 to 44 were still this one — so an
 * over-budget state renders as a head plus a pointer to the whole of it (`./sweepPromptOverflow.ts`, which
 * carries the measurement). The marker and option refusals are unchanged; the budget refusal survives only for
 * a caller that names no overflow path.
 *
 * Pure: no I/O. The CLI edge resolves the contract path and prints.
 */

import { err, ok, type Result } from "../lib/result.js";
import { type SupervisorCoreError, SupervisorCoreErrors } from "./errors.js";
import { fitShiftOverflow } from "./sweepPromptOverflow.js";

/**
 * The word cap on the whole rendered prompt. See this file's header for the measurement and its repro.
 */
export const MAX_RENDERED_PROMPT_WORDS = 700;

/** What the render puts in the shift-state slot when the tick genuinely has no state of its own. */
const QUIET_SHIFT_LINE = "nothing this tick beyond the contract.";

/**
 * Phrases that only ever appear in the STANDING contract. A shift state containing one is a supervisor
 * re-typing the procedure into the prompt rather than pointing at the file that holds it.
 *
 * Deliberately narrow: each is a verb invocation or a section name the contract owns, never a word a real
 * shift state needs. A merge queue, a workspace id, a standing order or a deadman deadline contains none of
 * them, which is what keeps this from refusing legitimate per-tick state.
 */
export const STANDING_STEP_MARKERS: readonly string[] = [
  "events tail --cursor supervisor",
  "session watch",
  "session close-done",
  "session depth",
  "session standing",
  "handover reconcile",
  "github hold --status",
  "machine capacity",
  "machine reap",
  "briefing render",
  "reflect friction-review",
  "fill-to-cap",
  "stuck-chat accounting",
];

/**
 * What prose wraps a standalone word in — quotes, brackets, markdown emphasis, terminal punctuation.
 *
 * Defined by PARTITIONING the alphabet rather than by listing characters, which is why this stopped needing
 * rounds. Against {@link BARE_OPTION} every character falls in exactly one of three classes, and all three
 * are decided here:
 *
 * - **`[a-z0-9]`** is an option's own body, so it is never decoration and both ends stop at it.
 * - **Everything else** can never appear in an option at all, so AT AN EDGE it is taken as decoration.
 *   "Cannot appear in an option" is a lexical fact; "is decoration" is the policy read off it, and
 *   {@link flagTokensIn} § the criterion is LEXICAL names what that policy costs.
 * - **`-` is the only ambiguous one**, and what settles it is {@link BARE_OPTION}'s own opener rather than
 *   position. A leading `-` is that opener only as the exact prefix `--` followed by `[a-z]`; everything
 *   else it can be — a lone `-`, a `--` not opening a word, a longer run — is decoration. That reads
 *   `-"--tick-id"-` and `--"--tick-id"--` alike, where the earlier spelling of
 *   this rule as "a `-` another `-` follows" kept the second one's decorating `--` and hid the option.
 *   {@link BARE_OPTION} ends in `[a-z0-9]`, so a trailing `-` can never close one and is always
 *   decoration — `"--tick-id"--`.
 *
 * There is no fourth class, so there is no next counterexample of this kind: `---tick-id` strips to
 * `tick-id`, which is simply a different token rather than a decorated option.
 *
 * Only the LEADING edge is a pattern. The trailing one is {@link stripProseEdges}'s backward walk, for the
 * measured reason recorded there.
 */
const PROSE_EDGE_LEADING = /^(?:--(?![a-z])|-(?!-)|[^a-z0-9-])+/;

/**
 * A single character of an option's own body — the class both edges stop at.
 *
 * Deliberately not global: a `g` flag carries `lastIndex` between calls, so the same character would test
 * `true` and then `false` on alternate invocations of the walk below.
 */
const OPTION_BODY = /[a-z0-9]/;

/**
 * An ASCII capital, and the only thing this module folds before classifying a character.
 *
 * `String.prototype.toLowerCase` is UNICODE-aware, and a handful of non-ASCII characters fold INTO the
 * ASCII body class — `U+212A`, a compatibility letter, becomes `k`. Folding first therefore lets an interior character
 * that is not an option character become one, which broke the three-class partition from the inside rather
 * than at an edge: `--tic<U+212A>-id` was reported as `--tick-id` while `<U+212A>--tick-id` was silent and
 * `é--tick-id` was not. An option is ASCII, so the fold is too, and the partition is then
 * true of the token exactly as {@link BARE_OPTION} sees it.
 */
const ASCII_CAPITAL = /[A-Z]/g;

/**
 * What separates one token from the next — ASCII whitespace, and nothing else.
 *
 * `\s` is the same trap as {@link ASCII_CAPITAL} one step earlier: it matches `U+00A0 NO-BREAK SPACE`,
 * `U+2003 EM SPACE` and `U+FEFF`, so a URL an author typed as ONE thing became two tokens and its tail
 * reported — `https://logs.example.com/<U+00A0>--out` answered `--out`, though `new URL` accepts that
 * string whole. A boundary the author cannot see is not a boundary. Splitting on ASCII
 * whitespace leaves a non-ASCII space INSIDE the token, where it disqualifies like any other non-option
 * character, so the fold, the split and the classification are decided on the same alphabet end to end.
 */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]+/;

/**
 * A long option standing ALONE, once {@link stripProseEdges} decoration is off it: `--tick-id`, `--out`.
 *
 * Anchored at both ends on purpose — that anchoring is what keeps a larger token silent without this module
 * ever parsing one: a URL, or a path whose STRIPPED form is still not an option. A path whose stripped form
 * IS one is reported, which {@link flagTokensIn} states as an accepted cost rather than a promise kept. A
 * markdown rule matches nothing because `---` and a bare `--` are decoration end to end and strip to the
 * empty string, and `--1x` strips to `1x`, which carries no `--`.
 */
const BARE_OPTION = /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * One whitespace-delimited token with its prose decoration taken off both ends.
 *
 * The trailing edge is a backward WALK rather than the `[^a-z0-9]+$` it replaced, and the reason is
 * measured rather than stylistic. `$` anchors that pattern only on the right, so the engine retries it from
 * every start position, and on a token holding a long run of internal punctuation it scans that run once
 * per position — quadratic. MEASURED on this function, `"a" + "_".repeat(n) + "b"`, Node 24: 14ms, 55ms,
 * 203ms, 800ms for n of 5k, 10k, 20k, 40k, four times the work for twice the input. The walk answers the
 * largest of those in 0.2ms, and 4,000,000 characters in 2.2ms. Repro — `node --import tsx`, never
 * `yarn tsx -e`, which compiles a top-level `await` as CJS and throws before reaching this function:
 *
 *     node --import tsx --input-type=module -e 'const {flagTokensIn}=await import("./src/supervisor/sweepPrompt.ts");
 *       for (const n of [40000,400000,4000000]) { const t=performance.now();
 *       flagTokensIn({shiftState:"a"+"_".repeat(n)+"b"}); console.log(n, (performance.now()-t).toFixed(1)+"ms"); }'
 *
 * Nothing upstream bounds this: a token is one word, so the shift state's WORD budget cannot cap its
 * length, and `flagDefect` runs the option pass before it collects the budget defect. The walk visits each
 * trailing character once, and {@link PROSE_EDGE_LEADING} is anchored with mutually exclusive consuming
 * branches, so what is left is linear in both directions.
 *
 * @param token one whitespace-delimited word, already lowercased
 * @returns what remains once neither end carries anything an option could not, empty when nothing does
 */
function stripProseEdges({ token }: { token: string }): string {
  let end = token.length;
  while (end > 0 && !OPTION_BODY.test(token[end - 1]!)) {
    end -= 1;
  }
  return token.slice(0, end).replace(PROSE_EDGE_LEADING, "");
}

/**
 * A rendered sweep prompt, with the numbers that let a caller see how much room the shift state has left.
 *
 * @internal — `renderSweepPrompt`'s success value; the CLI edge reads its fields, never its name.
 */
export interface RenderedSweepPrompt {
  /** The exact string to pass to `ScheduleWakeup`'s `prompt`. */
  readonly prompt: string;
  /** Its word count, against {@link MAX_RENDERED_PROMPT_WORDS}. */
  readonly words: number;
  /** What the render itself costs, so `words` minus this is always the shift state's own share. */
  readonly frameWords: number;
  /** The words the shift state actually contributed — {@link QUIET_SHIFT_LINE}'s own on a quiet tick. */
  readonly shiftWords: number;
  /** {@link shiftStateBudgetWords} for this contract path. */
  readonly budgetWords: number;
  /** Budget less `shiftWords`: how much a next tick may add before the state overflows to a file. */
  readonly remainingWords: number;
  /** Whether the state ran over its budget and the prompt carries a head and a pointer to the whole of it. */
  readonly overflowed: boolean;
  /** Authored words only the overflow file carries; 0 when nothing overflowed. */
  readonly overflowWords: number;
}

/**
 * Count words the way a reader would — whitespace-separated, empties dropped.
 *
 * @param text the text to measure
 * @returns the number of words
 */
export function wordCount({ text }: { text: string }): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * The whole prompt, given the shift-state line that goes in its slot.
 *
 * @param contractPath the already-trimmed contract path
 * @param shiftLine what the shift-state slot carries, never empty
 * @returns the prompt text
 */
function promptText({ contractPath, shiftLine }: { contractPath: string; shiftLine: string }): string {
  return [
    "Run the supervisor sweep cycle.",
    `THE STANDING CONTRACT IS ${contractPath} — read it THIS TICK and run it in the order it gives.`,
    "It is the source; this prompt is not. Anything it says that this prompt does not is still owed.",
    `SHIFT STATE (the only per-tick half): ${shiftLine}`,
    "Re-arm this same wakeup before ending the tick, rendered the same way by 'slopweaver supervisor sweep-prompt', never by retyping the contract.",
  ].join(" ");
}

/**
 * What the render costs before the shift state says anything — every word this module adds around it.
 *
 * It is computed from the real render over a one-word stand-in rather than declared as a constant, so the
 * frame and its measurement cannot drift apart when a line of the prompt is reworded.
 *
 * @param contractPath the contract path the prompt will name, whose own length is part of the frame
 * @returns the frame's word count
 */
export function sweepPromptFrameWords({ contractPath }: { contractPath: string }): number {
  return wordCount({ text: promptText({ contractPath: contractPath.trim(), shiftLine: "x" }) }) - 1;
}

/**
 * How many words this tick's shift state may run to — the cap less the frame.
 *
 * This is the number a supervisor is actually writing against, and the one nothing printed before this file computed it
 * (see this file's header). It depends on the contract path because the path is rendered into the prompt.
 *
 * **Floored at zero**, which is not cosmetic: a negative budget refused a seat that had written nothing at
 * all, telling it to "cut 1 words" (`budget-charges-only-authored-words`). Nothing can be written
 * against a budget below zero, so zero is what the number means, and a frame that does not fit the cap is a
 * fact about the contract path rather than a fault in the shift state.
 *
 * @param contractPath the contract path the prompt will name
 * @returns the shift state's word budget, never below zero
 */
export function shiftStateBudgetWords({ contractPath }: { contractPath: string }): number {
  return Math.max(0, MAX_RENDERED_PROMPT_WORDS - sweepPromptFrameWords({ contractPath }));
}

/**
 * Which standing step markers a shift state names, in the order they are declared.
 *
 * @param shiftState the per-tick half the caller wants to arm
 * @returns every marker present, empty when the shift state names none
 */
export function standingMarkersIn({ shiftState }: { shiftState: string }): readonly string[] {
  const lowered = shiftState.toLowerCase();
  return STANDING_STEP_MARKERS.filter((marker) => lowered.includes(marker.toLowerCase()));
}

/**
 * Which command-line options a shift state names, deduplicated, in the order they first appear.
 *
 * ## It asks whether a token IS an option, never whether one sits inside a URL
 *
 * The original shape blanked URLs out of the prose first and failed seven review rounds in a row —
 * `…/run_history`, `…/run__42/%20`, `…/run%20__.json`, `…/run__:42.json`, then a `mailto:`
 * with no `://` at all, then a query value opened by `+`. Every round fixed its counterexample and every
 * round produced the next one, because blanking needs a decision about where a URL ENDS, and `.` `-` `:`
 * `_` `%` are each simultaneously a legal URL character and prose punctuation. That question has no answer,
 * so no amount of care was ever going to close it.
 *
 * What replaced it decides the opposite question, which does have one. Split the shift state on whitespace,
 * {@link stripProseEdges} off each token, and report it when what remains IS a {@link BARE_OPTION}. A URL is
 * silent not because it was recognised but because `https://logs.example.com/search?q=--timeout` is not
 * equal to `--timeout` — and so is a `mailto:` and a percent-escape, with no line of code about any of them.
 * There is no rule about URLs here, and the honest form of that is to state the criterion and STOP. A URL
 * is reported exactly when one of the whitespace-delimited TOKENS it falls into strips to an option, which
 * is the same test every other token gets. A literal tab inside a URL is a token boundary like any other
 * ASCII whitespace, so the tail after it takes that same test and nothing about the URL enters into it:
 * `?q=<TAB>--timeout` reports and `?q=<TAB>--timeout&from=now-1h` does not, while the whole string strips
 * to nothing either way.
 * Three successive drafts each tried to explain a URL's silence by some property of URLs — that `//--out/`
 * carries no host (its hostname IS `--out`), that a host spelled unlike an option keeps one
 * silent (`//é--out/` reports, hostname `xn----out-9ra`), that a surviving ASCII body character is
 * what does it (`//---out/` is silent on the odd-run merge instead) — and each was falsified by a
 * URL the criterion itself handles correctly. A reported URL is the over-report class below; a silent one
 * is silent for whichever of the reasons above applies to its stripped form, and naming a URL-shaped
 * reason has been wrong every time.
 *
 * ## The criterion is LEXICAL, so state what that does and does not buy
 *
 * "Cannot appear in an option" is what decides a character here; "is prose decoration" is not, and the two
 * are not the same claim, and a block that says they are is wrong. Nothing lexical can tell `(--out)` from `./--out` — one is a decorated option and the other a
 * path — so the classes below are POLICY, chosen on what each one costs, and the cost is asymmetric: this
 * list drives a REFUSAL (`flagDefect`), so a false positive rejects a sweep prompt whose author did nothing
 * wrong, which is the tax this whole module exists to remove, while a false negative lets a few words past
 * a nudge.
 *
 * **Two classes it misses.** An option carrying anything that is not an option character INSIDE it — other
 * ASCII text abutting with no whitespace (`…/flags)?--tick-id`, `_https://…/run_.--tick-id`), or a non-ASCII
 * character in the body (`--tic<U+212A>-id`, {@link ASCII_CAPITAL}) — and a leading hyphen run that MERGES
 * with an option's own `--` into something nothing can split back apart: `---tick-id` strips to `tick-id`,
 * and by the same pair-at-a-time consumption every ODD run does, while an even one (`----tick-id`) leaves
 * the opener standing.
 *
 * **One class it over-reports.** A token whose non-option characters all sit at its ENDS reads as a
 * decorated option however it was meant: `./--out`, `../--out` and `~/--out` are reported, as is `é--out`,
 * whose abutting letter is outside the ASCII body class and so strips like any other decoration. A path
 * with a body character before the option (`src/cli/--out`) or after it (`out/--out.json`) is silent.
 *
 * Those two are the SAME partition read from each side: a non-option character at an edge strips, one
 * inside the body disqualifies, and after {@link ASCII_CAPITAL} and {@link ASCII_WHITESPACE} there is no
 * character whose class depends on where a fold or a split left it.
 *
 * **What closes the list is a third thing, not a third class.** The partition is about the ALPHABET, while
 * {@link BARE_OPTION} is also a GRAMMAR, so a token built entirely of option characters can still fail it:
 * `--tick--id` has a doubled interior hyphen, `--1x` a digit where the name should open.
 * A PARSER would take both — `node:util`'s `parseArgs` accepts `--tick--id` under `strict` —
 * so the pattern is deliberately narrower than what is parseable, and what makes that the right width is
 * this CLI rather than a convention: EVERY option literal under `src/cli/` matches it, none excepted. The
 * total moves with the tree and nothing depends on it, so this repro counts the ones that FAIL, and that
 * number is 0:
 *
 *     grep -rhoE '"--[a-zA-Z0-9][a-zA-Z0-9-]*"' src/cli/ | sort -u | sed 's/"//g' |
 *       grep -vcE '^--[a-z][a-z0-9]*(-[a-z0-9]+)*$'
 *
 * So silence on a token no verb here could name is a miss whose cost is nil — but it is still a reason a
 * token goes unreported that has nothing to do with decoration, and a reader counting classes needs it said.
 *
 * Both sides are cheap at the measured shape, which is prose: the 25 files shift-335 through shift-359 each
 * carried 7 to 10 distinct options across 613 to 668 words, in option-bearing sentences (split on
 * `/(?<=[.!?])\s+/`) of 219 to 356, every one of them a whitespace-delimited word, and no instance of any
 * class above. Repro — the home comes from `slopweaverHome()`, never a `$SLOPWEAVER_HOME` the shell would
 * not expand inside single quotes:
 *
 *     node --import tsx --input-type=module -e 'const {flagTokensIn}=await import("./src/supervisor/sweepPrompt.ts");
 *       const {slopweaverHome}=await import("./src/homeDir.ts"); const {readFileSync}=await import("node:fs");
 *       const d=slopweaverHome()+"/supervisor-scratch/handoff-<n>"; const w=(s)=>s.trim().split(/\s+/).length;
 *       for (let i=335;i<=359;i++) { const t=readFileSync(d+"/shift-"+i+".txt","utf8");
 *       const h=t.split(/(?<=[.!?])\s+/).filter((s)=>flagTokensIn({shiftState:s}).length>0);
 *       console.log(i, flagTokensIn({shiftState:t}).length, w(t), h.reduce((n,s)=>n+w(s),0)); }'
 *
 * It also REPORTS what the old matcher hid, and the honest account of that is its GUARDS rather than any
 * list of examples: it was fenced by `(?<![\w-])` and `(?![\w-])`, so it lost every form wrapped in a word
 * character or a hyphen — `_--tick-id_`, `__--out__`, `----tick-id`, `--tick-id--` — while `*--out*`,
 * `"--keep-notes"`, `(--out)` and a backticked one were never word characters and passed all along. Two
 * drafts of this sentence were wrong in opposite directions, one crediting the inversion with all four
 * bracket forms and its replacement with the underscore alone, which is why it now
 * names the character class. Markdown emphasis round a hand-copied option is a likelier shape than any URL
 * case above, so the inversion fixed a real miss.
 *
 * @param shiftState the per-tick half the caller wants to arm
 * @returns every distinct option named, empty when the shift state names none
 */
export function flagTokensIn({ shiftState }: { shiftState: string }): readonly string[] {
  const options = shiftState
    .replace(ASCII_CAPITAL, (capital) => capital.toLowerCase())
    .split(ASCII_WHITESPACE)
    .map((token) => stripProseEdges({ token }))
    .filter((token) => BARE_OPTION.test(token));
  return [...new Set(options)];
}

/**
 * Render the prompt to arm, from the contract's path plus this tick's shift state.
 *
 * With an `overflowPath`, a shift state over its budget is rendered within the cap — the longest sentence-bounded
 * head that fits, then a pointer to that path ({@link fitShiftOverflow}) — and the caller must write the whole
 * state there before it prints the prompt. Without one, the budget refuses as it always did. The standing-step and
 * option checks refuse either way, over the WHOLE authored state, so procedure can never hide in the overflow.
 *
 * @param contractPath the absolute path of the standing sweep contract the wakeup must read
 * @param shiftState the per-tick half — merge queue, in-flight sessions, standing orders, the ready queue
 * @param overflowPath where the caller will keep an over-budget state whole (`./sweepPromptOverflow.ts`)
 * @returns the prompt with every word count a caller needs, or EVERY reason it was refused
 */
export function renderSweepPrompt({
  contractPath,
  shiftState,
  overflowPath,
}: {
  contractPath: string;
  shiftState: string;
  overflowPath?: string | undefined;
}): Result<RenderedSweepPrompt, SupervisorCoreError> {
  const trimmedPath = contractPath.trim();
  if (trimmedPath.length === 0) {
    return err(SupervisorCoreErrors.contractPathMissing());
  }
  const trimmedShift = shiftState.trim();
  const frameWords = sweepPromptFrameWords({ contractPath: trimmedPath });
  const budgetWords = shiftStateBudgetWords({ contractPath: trimmedPath });
  const overBudget = budgetDefect({
    authoredWords: wordCount({ text: trimmedShift }),
    budgetWords,
    contractPath: trimmedPath,
  });
  const defects = [
    ...markerDefect({ contractPath: trimmedPath, shiftState }),
    ...flagDefect({ contractPath: trimmedPath, shiftState }),
    ...(overflowPath === undefined ? overBudget : []),
  ];
  if (defects.length > 0) {
    return err(SupervisorCoreErrors.sweepPromptRefused({ reasons: defects }));
  }
  let shiftLine = trimmedShift.length === 0 ? QUIET_SHIFT_LINE : trimmedShift;
  let overflowWords = 0;
  if (overBudget.length > 0 && overflowPath !== undefined) {
    const fit = fitShiftOverflow({ budgetWords, overflowPath, shiftState: trimmedShift });
    if (fit === undefined) {
      return err(
        SupervisorCoreErrors.sweepPromptRefused({
          reasons: [...overBudget, `the overflow pointer to ${overflowPath} does not fit the budget by itself`],
        }),
      );
    }
    shiftLine = fit.shiftLine;
    overflowWords = fit.overflowWords;
  }
  const shiftWords = wordCount({ text: shiftLine });
  return ok({
    budgetWords,
    frameWords,
    overflowWords,
    overflowed: overflowWords > 0,
    prompt: promptText({ contractPath: trimmedPath, shiftLine }),
    remainingWords: budgetWords - shiftWords,
    shiftWords,
    words: frameWords + shiftWords,
  });
}

/**
 * The refusal for a shift state that re-states a standing step, or nothing when it names none.
 *
 * @param contractPath the trimmed contract path, named so the refusal says where the step lives
 * @param shiftState the per-tick half as given
 * @returns one line, or an empty list
 */
function markerDefect({ contractPath, shiftState }: { contractPath: string; shiftState: string }): readonly string[] {
  const markers = standingMarkersIn({ shiftState });
  if (markers.length === 0) {
    return [];
  }
  return [
    `shift state re-states the standing contract: ${markers.join(", ")} — those steps live in ${contractPath}, so delete them from the shift state and let the wakeup read them`,
  ];
}

/**
 * The refusal for a shift state that spells out how to invoke a verb, or nothing when it names no option.
 *
 * @param contractPath the trimmed contract path, named so the refusal says where the invocation lives
 * @param shiftState the per-tick half as given
 * @returns one line, or an empty list
 */
function flagDefect({ contractPath, shiftState }: { contractPath: string; shiftState: string }): readonly string[] {
  const flags = flagTokensIn({ shiftState });
  if (flags.length === 0) {
    return [];
  }
  const plural = flags.length === 1 ? "option" : "options";
  return [
    `shift state spells out HOW to invoke a verb — it names the ${plural} ${flags.join(", ")}. Which flags a ` +
      `verb takes is standing procedure and lives in ${contractPath} and the reference files it links; the ` +
      "shift state carries this tick's STATE and nothing else. Delete the sentences holding them.",
  ];
}

/**
 * The refusal for a shift state over its budget, stating the budget and the exact overage in SHIFT words.
 *
 * It judges what the SEAT AUTHORED, never the rendered line. A quiet tick's substitution is this module's own
 * text, so charging it to the author would refuse a seat for words it never wrote — which a review
 * reproduced (`budget-arithmetic-is-exact`: a contract path long enough to leave a budget
 * under six words refused an EMPTY shift state, telling it to cut words it had not typed).
 *
 * @param authoredWords what the seat itself wrote, before any substitution
 * @param budgetWords the shift state's budget for this contract path
 * @param contractPath the trimmed contract path, named so the refusal says where the overflow belongs
 * @returns one line, or an empty list
 */
function budgetDefect({
  authoredWords,
  budgetWords,
  contractPath,
}: {
  authoredWords: number;
  budgetWords: number;
  contractPath: string;
}): readonly string[] {
  if (authoredWords <= budgetWords) {
    return [];
  }
  return [
    `the shift state is ${String(authoredWords)} words against a budget of ${String(budgetWords)} — the ` +
      `${String(MAX_RENDERED_PROMPT_WORDS)}-word cap on the rendered prompt less its frame. Cut ` +
      `${String(authoredWords - budgetWords)} words; standing procedure belongs in ${contractPath}. ` +
      "'slopweaver supervisor sweep-prompt --budget' prints the budget before you write.",
  ];
}

/**
 * The refusal for a shift source that was NAMED and could not be read.
 *
 * Worded here rather than at the CLI edge for the reason the header gives: every judgement this verb makes
 * lives in this module, so a successor reading one file sees the whole contract.
 *
 * @param source the path, or `-` for standard input
 * @returns the refusal line
 */
export function unreadableShiftSourceMessage({ source }: { source: string }): string {
  return (
    `cannot read the shift state at ${source} — nothing was rendered. A tick with no state of its own is ` +
    "armed by passing no shift flag at all, never by naming a source that cannot be read."
  );
}

/**
 * The refusal for a shift source that was NAMED, read cleanly, and held nothing.
 *
 * A quiet tick and a broken pipe render identically, which is the whole defect: MEASURED
 * (`cli-shift-source-is-never-silently-empty`; repro: `slopweaver supervisor sweep-prompt --shift-file -
 * --json < /dev/null`), an empty stdin exited 0 and armed a wakeup announcing the tick was quiet. A seat that
 * named a source was reporting state; nothing arriving from it is a fault in the source, not a quiet tick.
 *
 * @param source the path, `-` for standard input, or the inline flag
 * @returns the refusal line
 */
export function emptyShiftSourceMessage({ source }: { source: string }): string {
  return (
    `the shift state at ${source} is empty — nothing was rendered. Naming a source says this tick HAS state, ` +
    "so an empty one is a fault in the source rather than a quiet tick; a genuinely quiet tick passes no " +
    "shift flag at all."
  );
}
