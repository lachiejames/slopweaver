/**
 * The unpicked-steer tick gate's shell half: its one read of the steers, its hatch, and its refusal's text. The
 * verdict is `../../../supervisor/unpickedSteerGate.ts`, composed with the other five gates in `./tickRecordGates.ts`
 * for `supervisor tick-record` and `supervisor tick close` alike.
 */
import { autonomyLedgerPort } from "../../../autonomy/port.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import {
  type JudgedSteer,
  judgeUnpickedSteers,
  type UnpickedSteerRead,
  type UnpickedSteerVerdict,
} from "../../../supervisor/unpickedSteerGate.js";
import { readSteeredCards } from "../../../talk/steeredCardsRead.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "../talk/args.js";

/** How many owed steers the steer refusal quotes before it counts the rest. */
const STEERS_SHOWN = 10;

/** How many characters of the owner's words each quoted steer carries — `talk steers --json` carries the whole clip. */
const STEER_WORD_CHARS = 120;

/**
 * Whether the `unpicked-steers` hatch is open.
 *
 * @returns true when the ambient variable or a journalled grant opens it
 */
export function steerHatchOpenLive(): boolean {
  return hatchOpen({
    env: process.env,
    id: "unpicked-steers",
    nowIso: new Date().toISOString(),
  });
}

/**
 * Every steer the owner spoke over a Queue card in the last week, judged by the reading the console's own `talk steers` serves.
 *
 * @param home the Slopweaver home the ledgers live under, or the ambient one
 * @param nowIso the tick's own instant, which each verdict is judged at
 * @returns the steers and the relay lines that did not decode, or why a ledger every verdict needs did not read
 */
export async function readUnpickedSteersLive({
  home,
  nowIso,
}: {
  home: string | undefined;
  nowIso: string;
}): Promise<UnpickedSteerRead> {
  const resolved = talkHomeOf({ home });
  const read = await readSteeredCards({
    handoverDir: resolveHandoverDir({ dir: undefined, home: resolved }),
    home: resolved,
    ledger: autonomyLedgerPort(),
    nowIso,
  });
  if (read.isErr()) {
    return { kind: "unreadable", why: read.error.message };
  }
  return { kind: "read", steers: read.value.steers, undecodedRelays: read.value.undecodedRelays };
}

/**
 * One owed steer as the refusal quotes it: when it registered, its pointer, the card it named, its relay row, why it
 * is owed, and the start of the owner's words.
 *
 * @param steer the owed steer
 * @returns the indented line
 */
function quotedSteer({ steer }: { steer: JudgedSteer }): string {
  const state = steer.verdict.kind === "reverted" ? steer.verdict.reason : steer.verdict.kind;
  return (
    `  ${steer.registeredAtIso} talk:${steer.turnId} on ${steer.cardKey} (row ${steer.relaySlug}, ${state}) ` +
    `"${steer.heard.trim().slice(0, STEER_WORD_CHARS)}"`
  );
}

/**
 * The owed steers past the quoted ones, each still NAMED by its pointer and row so the chair can mark every one this
 * tick owes — `talk steers --json` lists settled and later steers beside them, so it cannot stand in for the names.
 *
 * @param steers the owed steers the refusal did not quote
 * @returns one line naming each
 */
function overflowLine({ steers }: { steers: readonly JudgedSteer[] }): string {
  const named = steers.map((steer) => `talk:${steer.turnId} (row ${steer.relaySlug})`);
  return `  … and ${String(steers.length)} more, unquoted: ${named.join(", ")}`;
}

/**
 * The residue a steer refusal names beside the owed steers: every steer passed because its registration does not
 * parse, and the relay-ledger lines that did not decode.
 *
 * @param verdict the refused verdict, carrying both
 * @returns nothing when both are empty
 */
function steerResidueLines({
  verdict,
}: {
  verdict: Extract<UnpickedSteerVerdict, { kind: "refused" }>;
}): readonly string[] {
  const undated = verdict.undated.map(
    (steer) =>
      `  talk:${steer.turnId} on ${steer.cardKey} registered at "${steer.registeredAtIso}", which does not parse`,
  );
  return [
    ...(undated.length > 0
      ? [
          `${String(undated.length)} steer(s) carry a registration instant that does not parse, so no deadline can ` +
            "be judged and they do not refuse this tick — repair the relay line or intake-mark each:",
          ...undated,
        ]
      : []),
    ...(verdict.undecodedRelays > 0
      ? [
          `${String(verdict.undecodedRelays)} line(s) of talk/relays.jsonl did not decode: a steer on one of them is ` +
            "unseen by this gate, never proof none is owed.",
        ]
      : []),
  ];
}

/**
 * The unpicked-steer gate over one tick, judged against the tick's own start: its refusal block, or nothing when the
 * hatch is open or no steer is owed.
 *
 * @param hatchIsOpen whether the `unpicked-steers` hatch is open
 * @param read the steers the owner spoke over Queue cards, as the shell read them once
 * @param startedIso when this tick started — the deadline every steer is judged against
 * @returns the refusal lines, or undefined when the tick may be recorded
 */
export function steerRefusal({
  hatchIsOpen,
  read,
  startedIso,
}: {
  hatchIsOpen: boolean;
  read: UnpickedSteerRead;
  startedIso: string;
}): readonly string[] | undefined {
  if (hatchIsOpen) {
    return undefined;
  }
  const verdict = judgeUnpickedSteers({ read, startedIso });
  if (verdict.kind === "clean") {
    return undefined;
  }
  return steerRefusalLines({ verdict });
}

/**
 * Render the unpicked-steer gate's refusal: every steer this tick is the deadline for, and the ways through.
 *
 * @param verdict the refused or unreadable verdict
 * @returns the hatch's four lines, one line per quoted steer, the overflow line when any, the residue and the way out
 */
export function steerRefusalLines({
  verdict,
}: {
  verdict: Exclude<UnpickedSteerVerdict, { kind: "clean" }>;
}): readonly string[] {
  const hatch = hatchFor({ id: "unpicked-steers" });
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({
        detail: `the steers the owner spoke over Queue cards could not be judged — ${verdict.why}`,
        hatch,
      }),
      "Fix what that names and re-run this. It refuses rather than passing, because a check that reports clean on an " +
        "input it never saw is worse than no check.",
    ];
  }
  const shown = verdict.steers.slice(0, STEERS_SHOWN).map((steer) => quotedSteer({ steer }));
  const rest = verdict.steers.length - shown.length;
  return [
    ...hatchRefusalLines({
      detail:
        `${String(verdict.steers.length)} steer(s) the owner spoke over a Queue card registered before this tick started ` +
        "and carry no action, so recording it puts each back on the owner's Queue as Not picked up",
      hatch,
    }),
    ...shown,
    ...(rest > 0 ? [overflowLine({ steers: verdict.steers.slice(STEERS_SHOWN) })] : []),
    ...steerResidueLines({ verdict }),
    "For EACH, act on the owner's words, then leave the witness: `slopweaver supervisor intake-mark --turn talk:<turnId> --as " +
      'card|answered|no-ask --witness "<what it became>"` (it clears every state above, a card that no longer exists ' +
      "included), or `slopweaver handover settle <row> --as answered|filed --witness <…>`, or take its row up with " +
      "`handover claim`/`start`. Never mark one you did not act on — the Queue reads that mark as done. Re-run this.",
  ];
}
