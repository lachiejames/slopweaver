/**
 * Landing their words on a console card — the effectful half of `src/talk/cardLanding.ts`.
 *
 * Every word the owner says while a card is open lands on that card, relayed or not, and when a steer on one thing
 * also answers another thing, both close. Narrowed (`../../../talk/cardAnswer.ts`): words land only when they ANSWER the
 * card.
 * Three callers land: `talk transcript` for an utterance the voice's relay judged an answer to its card
 * (`src/talk/cardUtterance.ts`), `talk relay` for the card the voice judged it answers, and `talk land` for a
 * session closing a second card the same words answer. Every caller is refused `NOT_AN_ANSWER` on a hand step and
 * on words that are only greeting or filler, before anything is written.
 *
 * The rule is about THEIR cards, so a `pr:` card whose pull request the landing reading in force when they spoke lists as
 * somebody else's refuses with `CARD_NOT_HIS` before any write (`./cardSubjectGate.ts`). A colleague's pull
 * request that reached their Queue once held twenty-three of their utterances, most about other work.
 *
 * ## What a landing writes, per card kind
 *
 * - **ask** — a `ruling` event on the ask's own journal, through `applyRowEvent`, the very write `handover rule`
 *   makes. `src/handover/ownerWait.ts` then reads the row as waiting on a SESSION, which takes it off their queue
 *   on every surface at once, and the ask row itself is the work. Its own duplicate refusal is this write's
 *   idempotency. Before it, the words are related to the row as one more of their steers, so the card a session
 *   re-asks quotes them beside the words it first answered (`./cardLandSteer.ts`).
 * - **a hand step** — nothing: the step settles when it is done, and their words are not that.
 * - **every other kind** — nothing in the card's own register: a held draft is held, and their words are not a
 *   release. The work is a board row carrying their words: the relay's own row when a relay was made of
 *   them, an earlier landing's row when the same utterance already has one, or a `--dispatch` row registered
 *   under a slug derived from the utterance, so a second landing of the same words finds it.
 *
 * Then, and only once that board write is on disk, the ledger row — which is what the queue reads to stop
 * drawing the card. A crash between the two leaves the work visible and the card still drawn, and the next
 * batch re-derives the utterance and finishes the landing: the failure mode is one more look, never a lost word.
 * Last, the row the landing points at is quoted (`../handover/quoteRow.ts`): a `call:` row's words come off this
 * very ledger row, so they could not be read when the row was registered. A quote that fails is said on stderr and
 * never fails the landing; `handover quote --apply` retries it.
 * Putting a card back is `./cardRestoreApply.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { frontMatterLines } from "../../../handover/doc.js";
import { applyRowEvent } from "../../../handover/rowEvent.js";
import { skippedLinesNote } from "../../../handover/staleReader.js";
import { lookupArchivedDoc, scanBoard } from "../../../handover/store.js";
import { type StatedWorkspace, workspaceRegisterArgv } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import {
  type CardLandedRow,
  type CardLandingRow,
  type CardLandingSource,
  cardDispatchAsk,
  cardDispatchSlug,
  cardKeyParts,
  landedAnchors,
  repeatLanding,
  utteranceLandings,
} from "../../../talk/cardLanding.js";
import { type CardLandingError, CardLandingErrors } from "../../../talk/cardLandingErrors.js";
import {
  appendCardLanding,
  holdCardLandingLock,
  readCardLandings,
  refusedCardLanding,
} from "../../../talk/cardLandingStore.js";
import { relayAnchor, relaySlug } from "../../../talk/relayDraft.js";
import { runHandoverRegister } from "../handover/askRowRun.js";
import { quoteLandedRow } from "../handover/quoteRow.js";
import { landedCardDraftIds } from "../supervisor/landedCardReads.js";
import { relateLandedSteer, relateRepeatedSteer } from "./cardLandSteer.js";
import { cardTakesWords } from "./cardSubjectGate.js";

/** A landing's priority on the board: the same p1 a relay and a typed steer get. */
const LANDING_PRIORITY = "p1";

/** One utterance to land on one card. */
export interface LandCardInput {
  readonly home: string;
  readonly handoverDir: string;
  readonly cardKey: string;
  readonly words: string;
  /**
   * Whether `words` may be fewer than the owner said, as the call file showed them (`src/talk/cardUtterance.ts`), or
   * `undefined` when the caller's record says nothing of it — a relay's anchor, or a session's own — which no reader
   * binding their yes takes as whole.
   */
  readonly wordsCut: boolean | undefined;
  readonly anchor: string;
  readonly decidedIso: string;
  readonly source: CardLandingSource;
  /** Turn ids of relays the call recorded beside the utterance; the first whose row the board holds is reused as the work. */
  readonly relayTurns: readonly string[];
  /**
   * Anchors this same utterance was landed as when a later segment of it arrived first. The whole utterance then
   * lands under its own anchor on THAT landing's work row, so the ledger carries every word and the board one row.
   * An ask keeps the ruling the first words wrote: the call file the anchor names holds the rest. A restore of that
   * landing holds: the utterance does not land again under its own anchor.
   */
  readonly laterAnchors: readonly string[];
  /**
   * Whose work a dispatch row registered for these words is, or `undefined` when the caller holds no structured
   * evidence of it — the row is then a finding the self Queue view draws, marked placed by default, until `handover set-workspace` places it.
   */
  readonly workspace: StatedWorkspace | undefined;
  /** The write clock. */
  readonly nowIso: string;
}

/** What one landing came to. */
export interface LandCardOutcome {
  /**
   * `landed` wrote a row just now; `already` found these words landed on this card before, restored or not, or
   * fewer of them landed on a card restored since.
   */
  readonly outcome: "landed" | "already";
  readonly landing: CardLandedRow;
  /**
   * Every way their words landed but did not reach the row's card: a steer not related to the ask, or a quote not
   * written. The ruling stands either way — their decision outranks its provenance — so these are not a failed landing,
   * but a caller reports them and exits non-zero: landing the same words again relates the steer.
   */
  readonly unquoted: readonly string[];
}

/**
 * Land one utterance on one card: the ruling or the work row first, then the ledger row the queue reads.
 *
 * @param input the utterance, the card and where the home and board are
 * @returns the landing, or the first write that failed
 */
export async function landCard({
  input,
}: {
  input: LandCardInput;
}): Promise<Result<LandCardOutcome, CardLandingError>> {
  const lock = holdCardLandingLock({ home: input.home });
  if (lock.isErr()) {
    return err(lock.error);
  }
  try {
    return await landCardHeld({ input });
  } finally {
    lock.value();
  }
}

/**
 * {@link landCard} for a caller already holding the ledger's lock (`holdCardLandingLock`): read, decide, write the
 * work, append. The draft ids the card names are read before any board write, so the row keeps what the card named as
 * their words landed. `talk transcript` holds it across reading a call and landing what it derived, so a second run's
 * older read of the same call cannot land a stale grouping of an utterance after this one.
 *
 * @param input the utterance, the card and where the home and board are
 * @returns the landing, or the first write that failed
 */
export async function landCardHeld({
  input,
}: {
  input: LandCardInput;
}): Promise<Result<LandCardOutcome, CardLandingError>> {
  const parts = cardKeyParts({ cardKey: input.cardKey });
  if (parts === undefined) {
    return err(CardLandingErrors.cardKeyInvalid({ cardKey: input.cardKey }));
  }
  // Before any read or write, for every source: words that are no answer, or a colleague's pull request, leave no
  // ruling, no dispatch row and no ledger row.
  const takes = cardTakesWords({ ...input, ...parts });
  if (takes.isErr()) {
    return err(takes.error);
  }
  const ledger = readCardLandings({ home: input.home });
  if (ledger.isErr()) {
    return err(ledger.error);
  }
  const rows = ledger.value.rows;
  const same = repeatLanding({ ...input, rows });
  if (same !== undefined) {
    // A landing repeated on an ask relates its steer again — a no-op once related — so retrying a landing whose steer
    // did not reach the row is how it gets there.
    const unquoted = parts.kind === "ask" ? await relateRepeatedSteer({ ...input, slug: parts.id }) : [];
    return ok({ landing: same, outcome: "already", unquoted });
  }
  // Checked before the first board write, with the slug a dispatch row would take, so a row the ledger refuses
  // leaves no ruling or dispatch row behind it.
  const refused = refusedCardLanding({
    home: input.home,
    row: landingRow({ input, workSlug: cardDispatchSlug({ anchor: input.anchor }) }),
  });
  if (refused !== undefined) {
    return err(refused);
  }
  const named = landedCardDraftIds({ home: input.home, landing: landingRow({ input, workSlug: "-" }), rows });
  const unrelated: string[] = [];
  const work = await landingWork({ input, parts, rows, unrelated });
  if (work.isErr()) {
    return err(work.error);
  }
  const landing = { ...landingRow({ input, workSlug: work.value }), ...named };
  const appended = appendCardLanding({ home: input.home, row: landing });
  if (appended.isErr()) {
    return err(appended.error);
  }
  // The row was registered before this landing was on the ledger, so its quote reads only now — and a landing that
  // grew the utterance refreshes the words the row already carries.
  const unquoted = await quoteLandedRow({
    anchors: landedAnchors({ row: landing }),
    home: input.home,
    path: join(input.handoverDir, `${work.value}.md`),
  });
  const lines = [
    ...unrelated,
    ...unquoted.map((problem) => `${problem}; \`slopweaver handover quote --apply\` retries it`),
  ];
  return ok({ landing, outcome: "landed" as const, unquoted: lines });
}

/**
 * The work their words land as: an earlier landing's row, a ruling on the ask, or a board row.
 *
 * @param parts the card key, split into its kind and id
 * @param rows the ledger as read under the lock
 * @param unrelated where a steer that did not reach an ask's row is reported
 * @returns the work's slug, or the write that failed
 */
async function landingWork({
  input,
  parts,
  rows,
  unrelated,
}: {
  input: LandCardInput;
  parts: { readonly kind: string; readonly id: string };
  rows: readonly CardLandingRow[];
  unrelated: string[];
}): Promise<Result<string, CardLandingError>> {
  // The same utterance landed with fewer words: grown past an overtaken batch, or its later segment
  // landed first under that segment's anchor. Its first row's work carries the rest.
  const earlier = utteranceLandings({ ...input, rows })[0];
  if (earlier !== undefined) {
    return ok(earlier.workSlug);
  }
  if (parts.kind === "ask") {
    return rulingOnAsk({ input, slug: parts.id, unrelated });
  }
  return workRow({ input, rows });
}

/** The ledger row landing `input` writes, pointing at `workSlug`. */
function landingRow({ input, workSlug }: { input: LandCardInput; workSlug: string }): CardLandedRow {
  const base: CardLandedRow = {
    anchor: input.anchor,
    atIso: input.nowIso,
    cardKey: input.cardKey,
    decidedIso: input.decidedIso,
    kind: "landed",
    source: input.source,
    words: input.words,
    workSlug,
  };
  const row = input.wordsCut === undefined ? base : { ...base, wordsCut: input.wordsCut };
  if (input.laterAnchors.length === 0) {
    return row;
  }
  return { ...row, laterAnchors: input.laterAnchors };
}

/**
 * Append their words to an ask as a ruling. A ruling already on the journal with these words, this anchor and
 * this instant is the same decision recorded once already — a retry — and counts as written.
 *
 * @param unrelated where a steer that did not reach the ask's row is reported
 * @returns the ask's slug, which is the work
 */
async function rulingOnAsk({
  input,
  slug,
  unrelated,
}: {
  input: LandCardInput;
  slug: string;
  unrelated: string[];
}): Promise<Result<string, CardLandingError>> {
  const scan = scanBoard({ handoverDir: input.handoverDir });
  if (scan.isErr()) {
    return err(CardLandingErrors.boardWriteFailed({ slug, why: scan.error.message }));
  }
  const live = scan.value.docs.find((doc) => doc.slug === slug);
  if (live === undefined && lookupArchivedDoc({ handoverDir: input.handoverDir, slug }) === undefined) {
    return err(CardLandingErrors.askMissing({ slug }));
  }
  if (live === undefined) {
    // An archived row draws no card, so there is nothing for a steer to show on; its ruling still lands.
    logger.error({ msg: `talk land: ${input.anchor} not related to ${slug} as a steer: the row is archived` });
  } else {
    for (const problem of await relateLandedSteer({ anchor: input.anchor, home: input.home, path: live.path, slug })) {
      unrelated.push(problem);
    }
  }
  const written = applyRowEvent({
    event: {
      anchor: input.anchor,
      atIso: input.nowIso,
      decidedIso: input.decidedIso,
      kind: "ruling",
      ruling: input.words,
    },
    runsDir: stateHomePaths({ home: input.home }).runs,
    slug,
  });
  if (written.isOk()) {
    const skipped = skippedLinesNote({ skipped: written.value.skipped });
    if (skipped !== undefined) {
      logger.error({ msg: `talk land: their words are on ${slug}; ${skipped}` });
    }
    return ok(slug);
  }
  const error = written.error;
  if (error.code === "RULING_INTEGRITY_FAILED" && error.cause.code === "RULING_ALREADY_RECORDED") {
    return ok(slug);
  }
  return err(CardLandingErrors.boardWriteFailed({ slug, why: error.message }));
}

/**
 * The board row a non-ask landing points at: a relay's row, an earlier landing's row for the same utterance, or a
 * dispatch row registered now under the utterance's own slug.
 *
 * @returns the row's slug
 */
async function workRow({
  input,
  rows,
}: {
  input: LandCardInput;
  rows: readonly CardLandingRow[];
}): Promise<Result<string, CardLandingError>> {
  // A relay row a session already finished and archived is still the relay's row, and a row is the
  // relay's only when it carries the turn's anchor: a refused relay leaves its slug to whatever row sat on it.
  const relayed = input.relayTurns
    .map((turnId) => ({ anchor: relayAnchor({ turnId }), slug: relaySlug({ turnId }) }))
    .find(({ anchor, slug }) => rowCarriesAnchor({ anchor, dir: input.handoverDir, slug }));
  if (relayed !== undefined) {
    return ok(relayed.slug);
  }
  // Landed on any card under this anchor or a later segment's: one utterance is one work row.
  const anchors = new Set([input.anchor, ...input.laterAnchors]);
  const sibling = rows.find(
    (row): row is CardLandedRow =>
      row.kind === "landed" && landedAnchors({ row }).some((carried) => anchors.has(carried)),
  );
  if (sibling !== undefined) {
    return ok(sibling.workSlug);
  }
  const slot = dispatchSlot({ anchor: input.anchor, dir: input.handoverDir });
  if (slot.kind === "carries") {
    return ok(slot.slug);
  }
  return registerDispatch({ input, slug: slot.slug });
}

/**
 * Register the utterance's dispatch row under a free slug.
 *
 * @param slug the free slug {@link dispatchSlot} found
 * @returns the slug, once the row on disk carries the anchor
 */
async function registerDispatch({
  input,
  slug,
}: {
  input: LandCardInput;
  slug: string;
}): Promise<Result<string, CardLandingError>> {
  const exit = await runHandoverRegister([
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    cardDispatchAsk({ anchor: input.anchor, cardKey: input.cardKey, words: input.words }),
    "--priority",
    LANDING_PRIORITY,
    "--dispatch",
    "--slug",
    slug,
    "--anchor",
    input.anchor,
    ...workspaceRegisterArgv({ stated: input.workspace }),
    "--dir",
    input.handoverDir,
    "--home",
    input.home,
  ]);
  // `handover register` can exit non-zero after writing its row (a mirror step after the write), so the row on
  // disk carrying this anchor is the fact, and the exit code only the hint — `talk relay` reads it the same way.
  if (rowCarriesAnchor({ anchor: input.anchor, dir: input.handoverDir, slug })) {
    return ok(slug);
  }
  return err(CardLandingErrors.boardWriteFailed({ slug, why: `handover register exited ${String(exit)}` }));
}

/**
 * Where this utterance's dispatch row lives: the first of its anchor's slugs, then `-2`, `-3` and on, that carries its
 * anchor or holds nothing. A slug is twelve hex characters of a hash, so another row can already sit on one — a
 * collision, or a row written by hand — and a fixed slug would then refuse the landing at every retry.
 * The order is fixed, so every retry probes the same slugs and finds the row an earlier one wrote. There is no last
 * slug: the board holds finitely many rows, so a free one is always further on, and a bound would refuse the landing
 * at every retry once that many rows sat on its slugs.
 *
 * @param anchor the utterance's anchor
 * @param dir the board
 * @returns the slug carrying it, or the free slug to register
 */
function dispatchSlot({ anchor, dir }: { anchor: string; dir: string }): {
  readonly kind: "carries" | "free";
  readonly slug: string;
} {
  const base = cardDispatchSlug({ anchor });
  for (let slot = 1; ; slot += 1) {
    let slug = base;
    if (slot > 1) {
      slug = `${base}-${String(slot)}`;
    }
    if (rowCarriesAnchor({ anchor, dir, slug })) {
      return { kind: "carries", slug };
    }
    if (!existsSync(join(dir, `${slug}.md`)) && !existsSync(join(dir, "archive", `${slug}.md`))) {
      return { kind: "free", slug };
    }
  }
}

/**
 * Whether the board holds `slug`, live or archived, and it carries this utterance's anchor — a name alone could be
 * anyone's row. An archived one counts: a landing whose ledger append failed is finished by a later batch, and a
 * session may have archived its row in between, which registering again would duplicate. The anchor
 * is read from the row's own `anchor:` front-matter key, the one `handover register --anchor` writes: another row
 * merely MENTIONING the utterance is not its row.
 */
function rowCarriesAnchor({ dir, slug, anchor }: { dir: string; slug: string; anchor: string }): boolean {
  const own = new Set([`anchor: ${anchor}`, `anchor: ${JSON.stringify(anchor)}`]);
  return [join(dir, `${slug}.md`), join(dir, "archive", `${slug}.md`)].some((path) => {
    if (!existsSync(path)) {
      return false;
    }
    try {
      return frontMatterLines({ text: readFileSync(path, "utf8") }).some((line) => own.has(line.trimEnd()));
    } catch {
      return false;
    }
  });
}
