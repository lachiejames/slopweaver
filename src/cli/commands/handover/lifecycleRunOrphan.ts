/**
 * `handover abandon`, including the ONE lifecycle path that may act without a doc on the board — a run whose
 * doc was archived, renamed or deleted after the run opened. Split out of `lifecycleRun.ts`, which re-exports
 * everything here unchanged; see {@link ./lifecycleRunCore} for the shared resolve/flag machinery this
 * depends on.
 */

import { realCmuxCli } from "../../../cmux/sidebar.js";
import { type RunEvent, type RunPhase, runStateOf } from "../../../handover/ledger.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { currentSessionId, foreignRunLine, runOwnership } from "../../../handover/runOwner.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import { publishRunWorkspaceRef } from "../../../handover/workspaceRefPublish.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, stringFlagOr } from "../../parseFlags.js";
import { productionMonitorDeps } from "../monitor/deps.js";
import { recordText } from "./lifecycleRecordText.js";
import {
  holderLiveness,
  lifecycleUsage,
  nowIso,
  parseLifecycleArgs,
  routingFlagSuffix,
  stringFlag,
  VERB_ARG_OFFSET,
} from "./lifecycleRunCore.js";
import { fireSteerAtRiskIfSteered } from "./steerRiskCard.js";

/**
 * What an orphan abandon should DO, given everything already read from disk. Pure.
 *
 * Extracted so each rule is one testable line rather than a branch inside an I/O function, and because two
 * adversarial passes found the same class of bug twice here: an "absent" that was really an "unreadable". Keeping
 * the decision pure is what makes the third instance hard to write.
 *
 * `fall-through` means "not my case, let the ordinary doc-backed path answer" — including the no-journal case,
 * so the familiar `no doc on the board claims the slug` refusal still prints.
 *
 * @param slug the slug being abandoned
 * @param boardHasSlug whether a READABLE doc on the board carries it
 * @param boardUnreadable the names of docs the board scan could not read
 * @param journalUnreadable the line numbers the journal decoder could not read
 * @param phase the run phase derived from the decoded events
 * @returns the action to take, with the sentence to print when it refuses
 */
export function orphanAbandonVerdict({
  slug,
  boardHasSlug,
  boardUnreadable,
  journalUnreadable,
  phase,
}: {
  slug: string;
  boardHasSlug: boolean;
  boardUnreadable: readonly string[];
  journalUnreadable: readonly number[];
  phase: RunPhase;
}): { kind: "fall-through" } | { kind: "refuse"; why: string } | { kind: "abandon" } {
  if (boardHasSlug) {
    return { kind: "fall-through" };
  }
  // An unreadable doc is IGNORANCE, not absence. `scanBoard` succeeds while omitting a file over its 2 MiB
  // limit, a FIFO, or one whose front-matter will not parse — all land in `unreadable` rather than `docs`. A slug
  // cannot be read out of a file that would not parse, so any unreadable entry means this cannot show the run is
  // orphaned. Found by an adversarial pass against an earlier cut that abandoned a live run in exactly that case.
  if (boardUnreadable.length > 0) {
    return {
      kind: "refuse",
      why:
        `${String(boardUnreadable.length)} doc(s) on the board could not be read (${boardUnreadable.join(", ")}), ` +
        `so "${slug}" cannot be shown to be orphaned — fix or remove them first`,
    };
  }
  // The same rule for the journal, found by a SECOND adversarial pass. `parseLedger` discards a line it cannot
  // decode, so a journal whose ending was torn mid-write decodes to `started` alone and derives `open` — and
  // abandoning then writes a second ending over a run that may already have been FINISHED, misrepresenting how it
  // ended rather than merely duplicating it. Measured safe to be strict: 0 of the 60 journals in the live home
  // carry an unreadable line, so this fires on nothing that works today.
  if (journalUnreadable.length > 0) {
    return {
      kind: "refuse",
      why:
        `${slug}'s journal has ${String(journalUnreadable.length)} line(s) that could not be decoded ` +
        `(${journalUnreadable.join(", ")}), so it cannot show whether the run is still open`,
    };
  }
  return phase === "closed" ? { kind: "fall-through" } : { kind: "abandon" };
}

/**
 * The slug and directories an orphan abandon needs, or `undefined` when this invocation is not one it can handle.
 *
 * Split out so {@link abandonOrphan} reads as decide-then-act. Every `undefined` here means "let the ordinary
 * doc-backed path parse and complain", so a bad flag still produces that path's message rather than two.
 *
 * @param argv the full process argv
 * @returns the resolved slug, directories and parsed flags, or `undefined` to fall through
 */
function orphanTarget({
  argv,
}: {
  argv: readonly string[];
}): { slug: string; home: string; handoverDir: string; runsDir: string; parsed: ParsedFlags } | undefined {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    return undefined;
  }
  const parsed = parseLifecycleArgs({ rest, verb: "abandon" });
  if (parsed.isErr()) {
    return undefined;
  }
  const slug = parsed.value.positionals[0];
  if (slug === undefined) {
    return undefined;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const paths = stateHomePaths({ home });
  return {
    handoverDir: stringFlagOr({ fallback: paths.handovers, name: "dir", parsed: parsed.value }),
    home,
    parsed: parsed.value,
    runsDir: paths.runs,
    slug,
  };
}

/**
 * Whether an orphaned run's ownership blocks abandoning it — `undefined` when it may proceed.
 *
 * A provably dead writer does not get the standing "another session is driving it" protection `claim` already
 * waives for the same case (see `claimRefusal`) — without this, an orphaned run (doc archived/deleted) whose
 * last writer's session has since died is unclaimable (`claim` needs a doc) AND unabandonable (this refusal),
 * which is exactly the never-ending "run that simply stops" state the orphan path above exists to prevent.
 * Measured: a run archived and answered days earlier stayed reported as
 * held-elsewhere by a 6-day-dead pid on every SessionStart. Live or unknown liveness keeps the refusal.
 *
 * A `released` run gets the same waiver, for the identical reason: `claim` needs a doc too, so a released
 * orphan is exactly as unclaimable as a dead-writer one, and blocking abandon here would recreate the same
 * deadlock for a run whose writer deliberately let go of it rather than one whose writer died.
 */
function orphanOwnershipRefusal({
  journal,
  slug,
  flagSuffix,
}: {
  journal: { readonly events: readonly RunEvent[]; readonly unreadable: readonly number[] };
  slug: string;
  flagSuffix: string;
}): string | undefined {
  // An AMBIGUOUS journal refuses OUTRIGHT, before ownership is even consulted: ownership read off the lines
  // that did parse is a guess (the undecodable line could be the very claim that names a holder), so neither a
  // waiver nor a "not foreign, proceed" verdict may be derived from it. orphanAbandonVerdict screened the FIRST
  // read; the RE-READ can observe a journal that gained an undecodable line since — two r1 review passes found
  // first the dropped state, then the parseable-subset-reads-unowned hole this ordering closes.
  if (journal.unreadable.length > 0) {
    return (
      `the journal for "${slug}" has undecodable line(s) as of this read, so ownership cannot be proven — ` +
      "nothing was written"
    );
  }
  const readerSession = currentSessionId({ env: process.env });
  const ownership = runOwnership({ events: journal.events, sessionId: readerSession });
  const phase = runStateOf({ events: journal.events }).phase;
  // ONE liveness verdict for both the waiver decision and the rendered line — measuring twice risks waiving
  // from one instant while telling the reader about another — and none at all for a closed cycle, whose
  // rendering never consumes it (r1: the cycle can close between the verdict read and this fresh one).
  const liveness = phase === "closed" ? undefined : holderLiveness({ ownership });
  const foreign = foreignRunLine({
    docClaim: "none",
    flagSuffix,
    journalAmbiguous: false,
    liveness,
    ownership,
    phase,
    readerIdentified: readerSession !== undefined,
    slug,
  });
  const waived = (ownership.kind === "elsewhere" && liveness?.kind === "dead") || ownership.kind === "released";
  return foreign !== undefined && !waived ? foreign : undefined;
}

/**
 * The journal's events as of right now — a fresh read, never the one taken at the top of the caller's function.
 *
 * NOTE ON WHAT THIS DOES AND DOES NOT CLOSE: the single top-of-function
 * read let a dead-pid verdict survive a same-session RESUME to a live pid in the gap before the append; this
 * re-read right before that append shrinks the window from "unbounded" to "one synchronous read-then-write," the
 * same order of magnitude as the concurrent-abandon race this file already accepts without a lock. A THIRD Codex
 * pass then correctly pointed out that any finite number of re-reads still leaves a race in principle — closing
 * it for real needs a lock this file has deliberately never carried for any verb. Treated as a known, accepted,
 * narrow residual (an owner decision, not an engineering default) rather than chased with a fourth re-read.
 */
function rereadJournal({
  runsDir,
  slug,
}: {
  runsDir: string;
  slug: string;
}): { readonly events: readonly RunEvent[]; readonly unreadable: readonly number[] } | undefined {
  const read = readRunJournal({ runsDir, slug });
  // `undefined`, never a synthetic clean journal: an r1 pass found the old shape flattening a whole-read
  // FAILURE into an unambiguous empty journal, which the second ownership check then happily proceeded past.
  return read.isErr() ? undefined : read.value;
}

/**
 * The ownership refusal for an orphan abandon, judged on ONE fresh read taken right before the append — never
 * on the earlier read the verdict used. Two r1 passes killed the old two-read chain: first it dropped the
 * fresh read's unreadable state, then its `??` let a refusal rendered from the STALE read speak ahead of a
 * fresh read that had meanwhile turned ambiguous.
 */
function freshOrphanRefusal({
  runsDir,
  slug,
  flagSuffix,
}: {
  runsDir: string;
  slug: string;
  flagSuffix: string;
}): string | undefined {
  const reread = rereadJournal({ runsDir, slug });
  return reread === undefined
    ? `the run journal for "${slug}" could not be re-read before the append, so ownership cannot be proven ` +
        "— nothing was written"
    : orphanOwnershipRefusal({ flagSuffix, journal: reread, slug });
}

/**
 * Close a run whose DOC no longer exists — the orphan case, and the one place a lifecycle verb acts doc-free.
 *
 * ## The defect this fixes, found by using the tool
 *
 * A run was left open by a doc that was later deleted. Every session start then reported it as open and told the
 * next agent to resume it first — and all three typed endings refused it, because each resolves the slug through
 * the board: `no doc on the board claims the slug "…"`. So the tooling insisted the run be ended and made ending
 * it impossible, which is precisely the never-ending "run that simply stops" state the whole feature forbids.
 *
 * ## Why abandon, and ONLY abandon
 *
 * The asymmetry is not a convenience, it is what each verb needs:
 *
 *  - `resume` rebuilds a brief FROM the doc, and `finish` re-evaluates the doc's probes. Neither can mean
 *    anything without one, so both are right to refuse.
 *  - `abandon` records one sentence saying a human gave up. The journal is the durable record and it is
 *    sufficient. Requiring a doc adds nothing except the deadlock above.
 *
 * `orphanAbandonVerdict` already settled the same argument for the sweep, and its comment says why: a run whose
 * doc has been archived, renamed or marked done vanishes from the board while its journal still says it is open,
 * so the journal is the thing to enumerate. The sweep could therefore SEE these runs while nothing could END them.
 *
 * @param argv the full process argv
 * @returns the exit code when this handled the call, or `undefined` to let the ordinary doc-backed path run —
 *   including when there is no journal either, so the familiar "no doc claims the slug" refusal still prints
 */
async function abandonOrphan({ argv }: { argv: readonly string[] }): Promise<number | undefined> {
  const target = orphanTarget({ argv });
  if (target === undefined) {
    return undefined;
  }
  const { slug, home, handoverDir, runsDir, parsed } = target;
  const board = scanBoard({ handoverDir });
  const read = readRunJournal({ runsDir, slug });
  if (!board.isOk() || read.isErr()) {
    // A directory or journal that could not be read at all is ignorance rather than absence — fall through so the
    // ordinary path reports it instead of this one guessing.
    return undefined;
  }
  const verdict = orphanAbandonVerdict({
    boardHasSlug: board.value.docs.some((doc) => doc.slug === slug),
    boardUnreadable: board.value.unreadable,
    journalUnreadable: read.value.unreadable,
    phase: runStateOf({ events: read.value.events }).phase,
    slug,
  });
  if (verdict.kind === "fall-through") {
    return undefined;
  }
  if (verdict.kind === "refuse") {
    logger.error({ msg: `handover abandon: ${verdict.why}` });
    return EXIT_ERROR;
  }
  const why = stringFlag({ name: "why", parsed });
  if (why === undefined || why.trim().length === 0) {
    logger.error({ msg: "handover abandon: --why is required" });
    logger.error({ msg: lifecycleUsage({ verb: "abandon" }) });
    return EXIT_USAGE;
  }
  const refusal = freshOrphanRefusal({ flagSuffix: routingFlagSuffix({ parsed }), runsDir, slug });
  if (refusal !== undefined) {
    logger.error({ msg: `handover abandon: ${refusal}` });
    return EXIT_ERROR;
  }
  // Check-then-append, with no lock — the same shape every other journal-writing verb here already has, and an
  // adversarial review flagged the race. Measured rather than argued: two `abandoned` events on one journal read
  // back cleanly (readable, zero unreadable lines, phase still `closed`), so the losing side never corrupted
  // anything. It no longer writes at all: `../../../handover/rowEvent.ts`'s write path refuses a SECOND terminal
  // on a cycle that already ended, so the loser now reports that ending instead of duplicating it. A lock here
  // alone would still make this the one verb that behaves differently, and the race's outcome is now typed.
  const appended = applyRowEvent({ event: { atIso: nowIso(), kind: "abandoned", why: why.trim() }, runsDir, slug });
  if (appended.isErr()) {
    logger.error({ msg: `handover abandon: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  // A steered row with no doc is still the owner's deliverable given up: the pass names it as a row it cannot judge. Fired
  // before the receipt, so an output channel that fails cannot stop it.
  await fireSteerAtRiskIfSteered({ deps: productionMonitorDeps(), home, slug, verb: "handover abandon" });
  logger.out({ line: `handover abandon: abandoned the ORPHANED run ${slug} — no doc on the board claims it` });
  logger.out({ line: `  journal: ${appended.value.path}` });
  return EXIT_OK;
}

/**
 * `handover abandon` — give up on a run, explicitly.
 *
 * Falls back to {@link abandonOrphan} when the board no longer carries the slug. See that function for why
 * abandon is the ONE verb that may act without a doc.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverAbandon(argv: readonly string[]): Promise<number> {
  const orphan = await abandonOrphan({ argv });
  if (orphan !== undefined) {
    return orphan;
  }
  const code = await recordText({
    // A seat giving up a row the owner explicitly steered is news they want now, not at the deadline.
    afterRecord: ({ home, slug }) =>
      fireSteerAtRiskIfSteered({ deps: productionMonitorDeps(), home, slug, verb: "handover abandon" }),
    argv,
    build: ({ value }) => ({ atIso: nowIso(), kind: "abandoned", why: value }),
    flag: "why",
    said: "abandoned the run",
    verb: "abandon",
  });
  if (code === EXIT_OK) {
    publishRunWorkspaceRef({ cli: realCmuxCli(), verb: "handover abandon" });
  }
  return code;
}
