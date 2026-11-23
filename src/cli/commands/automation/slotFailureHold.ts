/**
 * What every FAILED firing does, in one place: hold the row, and file ONE finding whose fix lifts the hold.
 *
 * A row that fails once is paused until its fix lands. Cooling and firing again, three times per firing, with
 * every death filing its own `recipe-dead-letter-*` row, left nine rows failing every firing for days (measured) and
 * one broken Vanta sync standing behind five findings. So this has two callers and no others:
 * `./slotSettle.ts#settleSlot`'s failed arm, and `./slotDeadLetter.ts#deadLetter`, which every death reaches.
 *
 * ## One finding per failure class, by construction
 *
 * A row already held on a FAILURE names the finding its failure belongs to, and nothing fires a held row, so a
 * second finding for the same breakage has no path to be written. An OWNER hold names no finding, so a firing
 * admitted before the owner held the row and failing after still files its own: the owner's hold pauses the row, and it does
 * not make the integration any less broken. The rules live in `../../../live/automation/failureHold.ts`; the
 * write in `../../../live/automation/failureHoldStore.ts`. The finding is p0, because a broken integration gets its own p0 seats to fix it.
 *
 * ## Failure directions
 *
 * - A hold that could not be written still FILES the finding, and the line says the row is NOT held — a
 *   failure nobody is told about is worse than one that fires again.
 * - A finding is judged filed by the BOARD, live or archived, never by `handover register`'s exit code: that is
 *   non-zero on a mirror failure over a row it already wrote, and a 0 with no row on the board is not filed.
 * - A finding that is not on the board KEEPS the hold — a held `write` recipe must not run its effect again on a
 *   firing nobody has looked at — and is recorded OWED (`../../../live/automation/findingDebt.ts`), the argv
 *   persisted, so every `automation run-due` retries it until the row exists (`./findingDebtRetry.ts`). A hold
 *   naming a slug no board row carries is otherwise invisible: no supervisor tick reads a held recipe. If the
 *   debt will not write either, the failure hold still names the slug, and every `run-due` (named or not) fails on it as
 *   orphaned. Beneath the owner's own hold, which names none, the failure's own slot-ledger row — settled before this ran —
 *   is read back instead (`../../../live/automation/ownerHeldFailures.ts`). The diagnostic prints the argv too.
 * - A checkout that does not resolve still FILES the finding, with no `repo:`, and reports `failed`: the row is
 *   then held off RUN NOW and no spawn can seat it, so the diagnostic prints the `handover set-repo` that fixes it.
 *   The supervisor's `unseated-recipe-failure` gate (`../../../supervisor/recipeFailureGate.ts`) refuses every
 *   tick that leaves such a row with no seat and no reason, so the gap is loud on the chair's next pass too.
 */
import { resolve } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { fitOnOneLine, printableOneLine } from "#lib/oneLineSummary.js";
import type { Result } from "#lib/result.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { summaryWrittenFit } from "../../../handover/summaryCap.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { failureFindingSlug, failureHoldReason } from "../../../live/automation/failureHold.js";
import { placeFailureHold } from "../../../live/automation/failureHoldStore.js";
import { findingOnBoard, recordFindingDebt, whyNotOnBoard } from "../../../live/automation/findingDebt.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { stateHomePaths } from "../../../stateHome.js";

/** The edges a failure hold reaches. Every dispatcher's deps carry them. */
export interface FailureHoldDeps {
  /**
   * The declared main checkout the finding's seat cuts its worktree from — `checkoutForRunningRepo` in production,
   * the same resolver `./seat.ts` uses. A finding with no `repo:` is one `cmux spawn` refuses outright.
   */
  readonly checkoutFor: (args: { readonly home: string }) => Result<string>;
  readonly now: () => string;
  /** Writes the finding's board row — `slopweaver handover register` in production. */
  readonly register: (args: { readonly argv: readonly string[] }) => Promise<number>;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The production {@link FailureHoldDeps.checkoutFor}: the declared main checkout whose `origin` is the repository this
 * build runs from — every recipe's verb is this repository's code, so its fix is cut from here.
 *
 * @param home the state home whose profile declares the main checkouts
 * @returns the checkout path, or why no declared one is this repository
 */
export function failureFindingCheckout({ home }: { readonly home: string }): Result<string> {
  return checkoutForRunningRepo({ home, verb: "automation run-due" });
}

/** What holding a failed row did: whether everything it owed persisted, and the tail of the line to print. */
export interface FailureHoldResult {
  /** True when the hold or the finding it owed did not persist. */
  readonly failed: boolean;
  /** How the row now stands, for the settlement line. */
  readonly line: string;
}

/**
 * Run `handover register` once, catching a throw. The exit code alone never says the row is absent — ask
 * `findingOnBoard` for that.
 *
 * @param deps the edge that registers
 * @param argv the exact `handover register` argv
 * @returns why the verb did not succeed, or `null` when it exited 0
 */
export async function registerFinding({
  deps,
  argv,
}: {
  readonly deps: Pick<FailureHoldDeps, "register">;
  readonly argv: readonly string[];
}): Promise<string | null> {
  try {
    const registered = await deps.register({ argv });
    return registered === 0 ? null : `handover register exited ${String(registered)}`;
  } catch (error: unknown) {
    return `handover register threw: ${errorMessage({ error })}`;
  }
}

/** The most of a recipe id the compact ask prints, when the id is too long for the take to fit. */
const COMPACT_RECIPE_CHARS = 200;

/**
 * One failure finding's ask, which `handover register` writes as the row's `summary:`: the failure, the exact take
 * command — shell-quoted whole with `--home`, so the seat the card spawns runs it as written against this store
 * — and the failure's detail. Every value is printable on one line.
 *
 * The result ALWAYS fits the cap `handover start` enforces, since a row over it is one no seat can start.
 * Only the trailing detail is cut while the take fits whole. A recipe id is unbounded, though: one too long for the
 * take to fit is said in prose naming its row and home, the id cut — never a command with a placeholder for the id —
 * since the row and home still identify the failure exactly. Only if even that cannot fit is the line cut. Nothing
 * before the take is a value a definition chose, so the command opens at one fixed place. PURE.
 *
 * @param finding the finding's own slug, which the take names as its row
 * @param home the state home the hold wrote to, which the take must read
 * @param what the failure's kind, in parentheses after the attempt
 * @param detail what the firing recorded, cut first when the summary would not fit
 * @returns the ask
 */
export function failureFindingAsk({
  attempt,
  detail,
  finding,
  home,
  recipeId,
  slotIso,
  what,
}: {
  readonly attempt: number;
  readonly detail: string;
  readonly finding: string;
  readonly home: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly what: string;
}): string {
  // Only a canonical instant, a number and a closed failure kind sit before the take, never the recipe id the command
  // names: a prose id could otherwise carry the words that open the command, or a shell separator.
  const failed =
    `A scheduled recipe failed its ${printableOneLine({ text: slotIso })} firing on attempt ${String(attempt)} ` +
    `(${printableOneLine({ text: what })}) and is held until this is fixed; `;
  // Absolute, so the take reads this store from any directory the seat runs in, and a relative home such as `--state`
  // can never print as a flag.
  const absoluteHome = resolve(home);
  const tail = printableOneLine({ text: detail });
  // The id never opens with `-`: the definition schema refuses one, since a verb would read it as a flag.
  const take = shellCommandLine({
    command: ["slopweaver", "automation", "repair", recipeId, "--row", finding, "--home", absoluteHome],
  });
  const full = longestFitting({ head: `${failed}take it with ${take}, which prints how to explain it — `, tail });
  if (full !== null) {
    return full;
  }
  // Prose, not a command, and never opened with the words that open one: a command the shell would run with a
  // placeholder for the id is worse than none.
  const compactHead =
    `${failed}run automation repair naming this recipe (its id is too long to print; it opens ` +
    `${fitOnOneLine({ maxChars: COMPACT_RECIPE_CHARS, text: printableOneLine({ text: recipeId }) })}), ` +
    `row ${printableOneLine({ text: finding })} and home ${printableOneLine({ text: absoluteHome })}, ` +
    "which prints how to explain it — ";
  const compact = longestFitting({ head: compactHead, tail });
  if (compact !== null) {
    return compact;
  }
  // An empty head always fits beside a lone `…`, so this cut is never null.
  return longestFitting({ head: "", tail: `${compactHead}${tail}` })!;
}

/**
 * `head` then as much of `tail` as the written summary can hold, cut with an ellipsis — or `null` when `head` and a
 * lone ellipsis already overflow. The written size only grows with the tail's length, so the longest cut is found by
 * bisection.
 *
 * @returns the longest fitting summary, or `null`
 */
function longestFitting({ head, tail }: { head: string; tail: string }): string | null {
  const whole = `${head}${tail}`;
  if (summaryWrittenFit({ summary: whole }).fits) {
    return whole;
  }
  let best = `${head}…`;
  if (!summaryWrittenFit({ summary: best }).fits) {
    return null;
  }
  let low = 1;
  let high = Array.from(tail).length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${head}${fitOnOneLine({ maxChars: mid, text: tail })}`;
    if (summaryWrittenFit({ summary: candidate }).fits) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/**
 * The `handover register` argv for one failure's p0 finding, under the slug the hold names. PURE. `checkout` is
 * `null` only when it did not resolve: the finding is still filed, and the caller says it cannot be seated.
 */
function findingArgv({
  attempt,
  checkout,
  detail,
  finding,
  home,
  observedBy,
  recipeId,
  slotIso,
  what,
}: {
  readonly attempt: number;
  readonly checkout: string | null;
  readonly detail: string;
  readonly finding: string;
  readonly home: string;
  readonly observedBy: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly what: string;
}): readonly string[] {
  const paths = stateHomePaths({ home }).live.recipe;
  return [
    "--ask",
    failureFindingAsk({ attempt, detail, finding, home, recipeId, slotIso, what }),
    "--finding",
    "--evidence",
    `slot ledger ${paths.slotAttemptsDir},definition ${paths.definitionsDir}/${recipeId}.json`,
    "--observed-by",
    observedBy,
    "--slug",
    finding,
    "--priority",
    "p0",
    // No `--workspace`: the held recipe may be the team's work (a project update, the owner's inbox), and no recipe definition
    // carries a workspace to read. A row stating none is drawn on the self view marked placed by default; a guess wears no mark.
    // `--repo` is what makes the finding SEATABLE: a row naming none is held off RUN NOW and `cmux spawn` refuses
    // it, which leaves the finding unseated until the owner sees it.
    ...(checkout === null ? [] : ["--repo", checkout]),
    "--home",
    home,
  ];
}

/** What still names an unregistered finding once its debt did not write either. */
function afterUnrecorded({ held, ownerHeld }: { readonly held: boolean; readonly ownerHeld: boolean }): string {
  if (!held) {
    return "nothing durable names it now, so register it by hand";
  }
  // This failure's own hold names the finding; the owner's names none, so run-due reads it back off the slot ledger.
  if (ownerHeld) {
    return "every automation run-due reads the failure back off the slot ledger, if it settled after their hold was asked, until a row by that slug is on the board";
  }
  return "every automation run-due reports its hold orphaned until a row by that slug is on the board";
}

/** How the registration went, as the line reports it. */
interface Registration {
  /** Why the finding is NOT on the board, or `null` when it is. */
  readonly unregistered: string | null;
  /** The tail for a row that landed though `handover register` said otherwise — a mirror failure — else empty. */
  readonly landed: string;
  /** The tail saying what became of an unregistered finding's retry, else empty. */
  readonly owed: string;
}

/**
 * Register the finding and, when it is not on the board afterwards, record it OWED.
 *
 * The BOARD says whether it landed, never the exit code: `handover register` writes the row and then mirrors it,
 * so a mirror failure exits non-zero over a row that is there. An unregistered finding is persisted
 * (`../../../live/automation/findingDebt.ts`) and every `automation run-due` retries it until the row exists.
 * That holds with no hold too: the row fires again, but a dry run fires nothing and a firing that succeeds files
 * nothing, so only the debt keeps this failure's finding owed. A second failure meanwhile files its own slug — a
 * duplicate on the board rather than a silence. When the debt itself will not write, this failure's own hold still
 * names the finding, and every `run-due` reports it orphaned (`./findingDebtRetry.ts`); the owner's own hold names none, so
 * the failure's slot-ledger row is read back instead; with no hold at all, the line this tick prints is the trace.
 */
async function registerAndOwe({
  argv,
  deps,
  finding,
  held,
  home,
  ownerHeld,
  recipeId,
  slotIso,
}: {
  readonly argv: readonly string[];
  readonly deps: FailureHoldDeps;
  readonly finding: string;
  readonly held: boolean;
  readonly home: string;
  readonly ownerHeld: boolean;
  readonly recipeId: string;
  readonly slotIso: string;
}): Promise<Registration> {
  const exited = await registerFinding({ argv, deps });
  if (findingOnBoard({ finding, home })) {
    const landed = exited === null ? "" : ` (on the board, though ${exited})`;
    return { landed, owed: "", unregistered: null };
  }
  const why = whyNotOnBoard({ exited });
  deps.writeDiagnostic(
    `recipe ${recipeId} · slot ${slotIso} failed and its finding could not be registered (${why}) — ` +
      `register it by hand: slopweaver handover register ${argv.map((arg) => JSON.stringify(arg)).join(" ")}`,
  );
  const recorded = recordFindingDebt({ debt: { argv, finding, recipeId, recordedIso: deps.now() }, home });
  if (recorded.isErr()) {
    deps.writeDiagnostic(recorded.error.message);
    return {
      landed: "",
      owed: ` — and its retry did not record either (diagnostics above); ${afterUnrecorded({ held, ownerHeld })}`,
      unregistered: why,
    };
  }
  return { landed: "", owed: " — OWED: every automation run-due retries it until it lands", unregistered: why };
}

/** The line for a failure whose hold either stands or did not write, given how its finding registered. */
function holdLine({
  checkoutFailed,
  finding,
  held,
  ownerHeld,
  registration,
  repoless,
}: {
  readonly checkoutFailed: boolean;
  readonly finding: string;
  readonly held: boolean;
  readonly ownerHeld: boolean;
  readonly registration: Registration;
  readonly repoless: string;
}): FailureHoldResult {
  const { landed, owed, unregistered } = registration;
  if (!held) {
    const filed =
      unregistered === null
        ? `finding ${finding} filed${repoless}${landed}`
        : `NO finding filed either (${unregistered})${owed}`;
    return { failed: true, line: `NOT held (the hold did not write) — it fires again; ${filed}` };
  }
  const failed = checkoutFailed || unregistered !== null || landed !== "";
  const unfiled = `could not be registered${repoless} (${String(unregistered)})${owed}`;
  if (ownerHeld) {
    const filed =
      unregistered === null
        ? `finding ${finding} filed${repoless}${landed}, so the breakage is seated while they hold it`
        : `finding ${finding} ${unfiled}`;
    return { failed, line: `already HELD by the owner's own hold; ${filed}` };
  }
  if (unregistered !== null) {
    return { failed, line: `HELD on finding ${finding}, which ${unfiled}` };
  }
  if (checkoutFailed) {
    return {
      failed,
      line: `HELD on finding ${finding}${landed}, which names no repo so no seat can open on it — the diagnostic above has the fix`,
    };
  }
  return { failed, line: `HELD on finding ${finding} until its fix lands${landed}` };
}

/**
 * Hold a row whose firing failed, and file the one finding whose fix lifts it.
 *
 * @param definition the row whose firing failed
 * @param deps the injected edges
 * @param home the state home the definition, the ledger and the board live under
 * @param slotIso the firing that failed
 * @param attempt which attempt at it failed
 * @param observedBy who saw it fail — the dispatcher's holder, recorded on the finding as its observer
 * @param what one line saying how it failed
 * @param detail what a reader needs in order to go and look
 * @returns whether everything persisted, and the line saying how the row now stands
 */
export async function holdOnFailure({
  definition,
  deps,
  home,
  slotIso,
  attempt,
  observedBy,
  what,
  detail,
}: {
  readonly definition: RecipeDefinition;
  readonly deps: FailureHoldDeps;
  readonly home: string;
  readonly slotIso: string;
  readonly attempt: number;
  readonly observedBy: string;
  readonly what: string;
  readonly detail: string;
}): Promise<FailureHoldResult> {
  const { recipeId } = definition;
  const finding = failureFindingSlug({ attempt, recipeId, slotIso });
  const placed = placeFailureHold({
    finding,
    home,
    nowIso: deps.now(),
    reason: failureHoldReason({ attempt, finding, recipeId, slotIso, what }),
    recipeId,
  });
  if (placed.isOk() && placed.value.kind === "already") {
    return { failed: false, line: `already HELD on finding ${placed.value.finding} — no second finding filed` };
  }
  const ownerHeld = placed.isOk() && placed.value.kind === "owner-held";
  if (placed.isErr()) {
    deps.writeDiagnostic(placed.error.message);
  }

  const checkout = deps.checkoutFor({ home });
  if (checkout.isErr()) {
    deps.writeDiagnostic(
      `recipe ${recipeId} · slot ${slotIso} failed and its finding names no repo, so no seat can open on it ` +
        `(${checkout.error.join("; ")}) — give it one: slopweaver handover set-repo ${finding} --repo <main checkout>`,
    );
  }
  const argv = findingArgv({
    attempt,
    checkout: checkout.isOk() ? checkout.value : null,
    detail,
    finding,
    home,
    observedBy,
    recipeId,
    slotIso,
    what,
  });
  const held = placed.isOk();
  const registration = await registerAndOwe({ argv, deps, finding, held, home, ownerHeld, recipeId, slotIso });
  // Every arm that filed or owes a finding with no repo says so, because that row is unseatable until it has one.
  const repoless = checkout.isErr() ? ", naming no repo so no seat can open on it until it has one" : "";
  return holdLine({ checkoutFailed: checkout.isErr(), finding, held, ownerHeld, registration, repoless });
}
