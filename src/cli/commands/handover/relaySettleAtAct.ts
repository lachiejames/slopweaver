/**
 * Settle a voice relay row at the moment the chair takes it up — the act that used to leave it open.
 *
 * Two verbs are how the chair disposes of a relay: `supervisor intake-mark --turn talk:<turnId>` and `handover
 * register --anchor talk:<turnId>` (a row cut from it). Neither ever settled the relay row, so 870 of 1112 sat
 * READY p1 (`../../../handover/relayTakenUp.ts` carries the measurement). Both now call this after
 * their own write lands, and it settles the relay through the REAL `handover settle` in process — its lock, its
 * card plan and its two closing gates included — with the settlement `relayTakenUpOf` derives from those same
 * two registers, so a relay settled here and one `handover prune` reports agree by construction.
 *
 * **A third caller is the ask's own run.** A relay whose words landed on an `ask:` card is filed into that ask once
 * the ask's row shows action since the relay registered (`../../../handover/relayTakenUp.ts` § An answer relay), and
 * `handover start` and `handover settle` on the ask call this for each such relay (`./relaySettleForWork.ts`).
 *
 * **A mark answers a relay spoken over a card only once the owner's words reached work** — a ruling on that card's journal,
 * or a seat dispatched on the relay row (`../../../handover/relayTakenUp.ts` § A mark is not proof). Otherwise this
 * decides nothing, and the relay stays open for `handover prune` to report.
 *
 * **It never fails the caller.** The mark or the row is already written and is the chair's act; a settle refusal
 * — most often a relay spoken over an open hand card, which needs a `--card` disposition only a session can
 * judge — is printed with the command to finish it, and the relay stays open for `handover prune` to report.
 *
 * **The decision is read before settle's lock, so a mark and a cut racing on one relay can answer it while a cut
 * row exists.** Stated rather than locked against, because the cost is nil: a relay that still owes a card refuses
 * both settles without `--card`, and a cut row of one that owes none settles whatever became of the relay
 * (`relayRowMismatchOf`, `./settleCardRun.ts`).
 */
import type { HandoverDoc } from "../../../handover/doc.js";
import {
  type RelayLandingLedger,
  readRelayLandingEvidence,
  readRelayLandingLedger,
} from "../../../handover/relayLandingRead.js";
import {
  type RelayBoardRow,
  type RelayLandingEvidence,
  type RelayTakenUp,
  type RelayWorkEvidence,
  relayTakenUpOf,
} from "../../../handover/relayTakenUp.js";
import { readRelayWorkEvidence } from "../../../handover/relayTakenUpRead.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { readIntakeMarks } from "../../../supervisor/intakeStore.js";
import type { CardLandingError } from "../../../talk/cardLandingErrors.js";
import { parseRelayAnchor, relaySlug } from "../../../talk/relayDraft.js";
import { EXIT_OK } from "../../exitCodes.js";
import { resolveHandoverDir } from "./commandSupport.js";
import type { SettleOut } from "./settleResidueRun.js";
import { settleAskRow } from "./settleRowRun.js";

/** What became of the relay row, for a caller's own report. */
export type RelaySettleAtActOutcome =
  | { readonly kind: "not-a-relay" }
  | { readonly kind: "no-open-row" }
  | { readonly kind: "nothing-decided" }
  | { readonly kind: "settled"; readonly slug: string }
  | { readonly kind: "refused"; readonly slug: string; readonly why: string };

/** The board as {@link relayTakenUpOf} reads it, straight off each row's own settlement. */
function relayRowsOf({ docs }: { docs: readonly HandoverDoc[] }): readonly RelayBoardRow[] {
  return docs.map((doc) => ({ anchor: doc.anchor, settled: doc.settlement !== undefined, slug: doc.slug }));
}

/**
 * Settle the relay row a `talk:<turnId>` pointer names, if the chair's registers now decide it.
 *
 * @param pointer the anchor or intake pointer the caller just wrote; anything but a relay anchor is a no-op
 * @param verb the calling verb, which every printed line names
 * @param dir `--dir`, when the caller was given one
 * @param ledger the card-landing ledger a caller settling several relays already read, so it is read once
 * @param out where the settle's receipt lines go — stdout when absent; a hook firing after another verb passes
 *   stderr, so the stdout that verb owns stays exactly its own
 * @returns what became of the relay row
 */
export async function settleRelayAtAct({
  home,
  dir,
  ledger,
  out,
  pointer,
  verb,
}: {
  home: string;
  dir: string | undefined;
  ledger?: Result<RelayLandingLedger, CardLandingError>;
  out?: SettleOut;
  pointer: string;
  verb: string;
}): Promise<RelaySettleAtActOutcome> {
  const anchor = parseRelayAnchor({ text: pointer });
  if (anchor === undefined) {
    return { kind: "not-a-relay" };
  }
  const slug = relaySlug({ turnId: anchor.slice(anchor.indexOf(":") + 1) });
  const handoverDir = resolveHandoverDir({ dir, home });
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return refused({ slug, verb, why: `the board would not read: ${scan.error.message}` });
  }
  // The slug keeps 12 hex digits of the turn, so a row at it is this relay's only when it carries the same anchor —
  // another turn sharing that prefix must never be settled on this one's landing.
  const relay = scan.value.docs.find(
    (doc) => doc.slug === slug && doc.anchor !== undefined && parseRelayAnchor({ text: doc.anchor }) === anchor,
  );
  if (relay === undefined || relay.settlement !== undefined) {
    return { kind: "no-open-row" };
  }
  // The settle below finds its row by slug alone, so a second row at this slug could be the one it writes.
  const sharing = scan.value.docs.filter((doc) => doc.slug === slug).length;
  if (sharing > 1) {
    return refused({
      slug,
      verb,
      why: `${String(sharing)} rows share the slug, so a settle by slug could reach another`,
    });
  }
  const decided = decideRelay({ anchor, docs: scan.value.docs, handoverDir, home, ledger, relay, slug, verb });
  if ("kind" in decided) {
    return decided;
  }
  return performSettle({ anchor, decided, dir, home, out: receiptChannel({ out }), slug, verb });
}

/**
 * What the chair's registers decide about one open relay row, or the outcome that stops the settle.
 *
 * @param docs the whole board, read once by the caller
 * @param relay the open relay row
 * @param ledger the card-landing ledger a caller already read, when it did
 * @param verb the calling verb, which a refusal line names
 * @returns the settlement to perform, or `nothing-decided` / `refused` when there is none
 */
function decideRelay({
  anchor,
  docs,
  handoverDir,
  home,
  ledger,
  relay,
  slug,
  verb,
}: {
  anchor: string;
  docs: readonly HandoverDoc[];
  handoverDir: string;
  home: string;
  ledger: Result<RelayLandingLedger, CardLandingError> | undefined;
  relay: HandoverDoc;
  slug: string;
  verb: string;
}): RelayTakenUp | RelaySettleAtActOutcome {
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    return refused({ slug, verb, why: marks.error.message });
  }
  const rows = relayRowsOf({ docs });
  // Each register is read only where the decision reaches it, so an unreadable one is said only there.
  const read: { evidence?: RelayWorkEvidence; landing?: RelayLandingEvidence } = {};
  const decided = relayTakenUpOf({
    landing: () => {
      read.landing = readRelayLandingEvidence({
        anchor,
        handoverDir,
        home,
        ledger: preparedLedger({ home, ledger }),
        relaySlug: slug,
      });
      return read.landing;
    },
    marks: marks.value,
    relay: { anchor: relay.anchor, settled: false, slug },
    rows,
    work: () => {
      read.evidence = readRelayWorkEvidence({ anchor, home, slug });
      return read.evidence;
    },
  });
  if (decided === undefined && read.landing?.kind === "unreadable") {
    return refused({ slug, verb, why: `whether the owner's words landed on an ask is unknown — ${read.landing.why}` });
  }
  if (decided === undefined && read.evidence?.kind === "unreadable") {
    return refused({ slug, verb, why: `whether the owner's words reached a card is unknown — ${read.evidence.why}` });
  }
  if (decided === undefined) {
    return { kind: "nothing-decided" };
  }
  return decided;
}

/** The caller's receipt channel, or stdout when it named none. */
function receiptChannel({ out }: { out: SettleOut | undefined }): SettleOut {
  if (out !== undefined) {
    return out;
  }
  return logger.out;
}

/** The ledger a caller prepared, or one read now for this relay alone. */
function preparedLedger({
  home,
  ledger,
}: {
  home: string;
  ledger: Result<RelayLandingLedger, CardLandingError> | undefined;
}): Result<RelayLandingLedger, CardLandingError> {
  if (ledger !== undefined) {
    return ledger;
  }
  return readRelayLandingLedger({ home });
}

/**
 * Run the real `handover settle` the registers decided, in process.
 *
 * @param anchor the relay's anchor, which the row settle is about to write over must still carry
 * @param decided the settlement, its witness and why
 * @param slug the relay row
 * @param verb the calling verb, which every printed line names
 * @param dir `--dir`, when the caller was given one
 * @param out where settle's receipt and this line go
 * @returns settled, or refused with why
 */
async function performSettle({
  anchor,
  decided,
  dir,
  home,
  out,
  slug,
  verb,
}: {
  anchor: string;
  decided: RelayTakenUp;
  dir: string | undefined;
  home: string;
  out: SettleOut;
  slug: string;
  verb: string;
}): Promise<RelaySettleAtActOutcome> {
  const as = ["--as", decided.settlement, "--witness", decided.witness];
  const where = ["--home", home, ...(dir === undefined ? [] : ["--dir", dir])];
  const argv = ["node", "slopweaver", "handover", "settle", slug, ...as, ...where];
  // A throw inside settle (its operation lock is filesystem work) must not turn the caller's landed write into an
  // exit 1: the mark or the cut row is already on disk, so the throw is reported like any other refusal.
  let code: number;
  try {
    // Re-asked under the settle's own lock, over the row it is about to write: the board read above could be stale by
    // then, and a row swapped in at this slug for another turn must not take this relay's settlement.
    code = await settleAskRow({ argv, out, precondition: ({ doc }) => anchorRefusal({ anchor, doc }) });
  } catch (error: unknown) {
    return refused({
      slug,
      verb,
      why: `handover settle threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (code !== EXIT_OK) {
    return refused({ slug, verb, why: `handover settle exited ${String(code)} (its reason is printed above)` });
  }
  out({ line: `${verb}: the relay row ${slug} is settled ${decided.settlement} — ${decided.because}` });
  return { kind: "settled", slug };
}

/** Why the row about to be settled is not this relay's, or `undefined` when it still carries its anchor. */
function anchorRefusal({ anchor, doc }: { anchor: string; doc: HandoverDoc }): string | undefined {
  if (doc.anchor !== undefined && parseRelayAnchor({ text: doc.anchor }) === anchor) {
    return undefined;
  }
  return `the row at ${doc.slug} no longer carries ${anchor}, so it is not this relay's to settle`;
}

/**
 * Print why the relay row may still be open, and how to finish it, without failing the caller.
 *
 * "May": settle can write the row and still exit non-zero (a mirror failure after the write, or losing a race to
 * the other caller's settle), so the next step is to read prune, never to assume the row is open (r2 review).
 */
function refused({ slug, verb, why }: { slug: string; verb: string; why: string }): RelaySettleAtActOutcome {
  logger.error({ msg: `${verb}: the relay row ${slug} may still be open — ${why}` });
  logger.error({ msg: `  if it is, slopweaver handover prune --verdicts prints its settle line` });
  return { kind: "refused", slug, why };
}
