/**
 * The effectful edge of `talk cards`' intake half: read the chair's intake marks and only the calls they name, then
 * hand both to the pure join in `src/talk/intakeCardLandings.ts`.
 */
import type { Result } from "../../../lib/result.js";
import type { SupervisorCoreError } from "../../../supervisor/errors.js";
import type { IntakeMark } from "../../../supervisor/intake.js";
import { readIntakeMarks } from "../../../supervisor/intakeStore.js";
import { readCallEntries } from "../../../talk/callStore.js";
import { type CardLandingRow, landedAnchors } from "../../../talk/cardLanding.js";
import { landingsWithTriage, type PublishedCardLanding } from "../../../talk/cardLandingTriage.js";
import type { TalkError } from "../../../talk/errors.js";
import {
  activeCardLandingsWithIntake,
  type CallRead,
  deriveIntakeCardLandings,
  type IntakeLandingGap,
  markedCallIds,
} from "../../../talk/intakeCardLandings.js";
import { parseRelayAnchor, relaySlug } from "../../../talk/relayDraft.js";
import { readRelayLedger, readTurn, type TurnRecord } from "../../../talk/relayStore.js";
import { turnIdsOnDisk } from "../../../talk/turnFiles.js";

/** Every call an acted-on intake mark names, read: only those files, never the whole calls directory. */
function markedCalls({ home, marks }: { home: string; marks: readonly IntakeMark[] }): ReadonlyMap<string, CallRead> {
  const calls = new Map<string, CallRead>();
  for (const callId of markedCallIds({ marks })) {
    const entries = readCallEntries({ callId, home });
    calls.set(
      callId,
      entries.isOk() ? { entries: entries.value, kind: "read" } : { kind: "unread", why: entries.error.message },
    );
  }
  return calls;
}

/**
 * Every landing holding a card off their queue: the ledger's active rows, then each one the intake marks prove that no
 * later restore lifted — each carrying their triage ruling when the relay it names carried one
 * (`src/talk/cardLandingTriage.ts`).
 *
 * @param home the Slopweaver home the marks and calls are read under
 * @param ledgerRows the card-landing ledger, in file order
 * @returns the landings, every voice-opened card a mark named but could not land, and how many relay lines did not
 *   read — any of which may be the only record of a park — or why the marks did not read
 */
export function landingsWithIntake({
  home,
  ledgerRows,
}: {
  home: string;
  ledgerRows: readonly CardLandingRow[];
}): Result<
  {
    readonly landings: readonly PublishedCardLanding[];
    readonly intakeGaps: readonly IntakeLandingGap[];
    readonly triageUnreadable: number;
  },
  SupervisorCoreError | TalkError
> {
  return readIntakeMarks({ home }).andThen((marks) =>
    readRelayLedger({ home }).map(({ rows, undecoded }) => {
      const relaySlugs = new Set(rows.map((row) => row.slug));
      const calls = markedCalls({ home, marks });
      const derived = deriveIntakeCardLandings({ calls, ledgerRows, marks, relaySlugs });
      const landings = activeCardLandingsWithIntake({ derived: derived.landings, ledgerRows });
      const unreceipted = unreceiptedTurns({ home, landings, receipts: rows });
      return {
        intakeGaps: derived.gaps,
        landings: landingsWithTriage({ landings, relays: [...rows, ...unreceipted.turns] }),
        triageUnreadable: undecoded + unreceipted.unread,
      };
    }),
  );
}

/** A board slug `relaySlug` minted for a relay turn (`src/talk/relayDraft.ts`). */
const RELAY_SLUG = /^talk-[0-9a-f]{12}$/u;

/**
 * The relays the landings name that no receipt carries: the turn ids their `talk:<turnId>` anchors give, and the relay
 * work slugs, which name no turn id and are found on disk by the caller.
 *
 * @param landings the landings holding a card off their queue
 * @param receipts the relay ledger's rows
 * @returns the turn ids to read, and the relay slugs still to find
 */
function unreceiptedNames({
  landings,
  receipts,
}: {
  landings: readonly CardLandingRow[];
  receipts: readonly TurnRecord[];
}): { readonly unfound: Set<string>; readonly wanted: Set<string> } {
  const anchors = new Set(receipts.map((receipt) => receipt.anchor));
  const slugs = new Set(receipts.map((receipt) => receipt.slug));
  const wanted = new Set<string>();
  const unfound = new Set<string>();
  for (const landing of landings) {
    if (landing.kind !== "landed") {
      continue;
    }
    for (const anchor of landedAnchors({ row: landing })) {
      const relay = parseRelayAnchor({ text: anchor });
      if (relay !== undefined && !anchors.has(relay)) {
        wanted.add(relay.slice(relay.indexOf(":") + 1));
      }
    }
    if (RELAY_SLUG.test(landing.workSlug) && !slugs.has(landing.workSlug)) {
      unfound.add(landing.workSlug);
    }
  }
  return { unfound, wanted };
}

/**
 * Move each relay slug whose turn is on disk from `unfound` to `wanted`, by the turn directory's names. A slug names no
 * turn id, so this is the only way to find its turn.
 *
 * @param home the Slopweaver home whose turn directory is read
 * @param unfound the relay slugs still to find, emptied of each one found
 * @param wanted the turn ids to read, joined by each one found
 * @returns how many slugs no turn on disk matched
 */
function slugsFoundOnDisk({
  home,
  unfound,
  wanted,
}: {
  home: string;
  unfound: Set<string>;
  wanted: Set<string>;
}): number {
  if (unfound.size === 0) {
    return 0;
  }
  const onDisk = turnIdsOnDisk({ home });
  if (onDisk.isOk()) {
    for (const turnId of onDisk.value) {
      if (unfound.delete(relaySlug({ turnId }))) {
        wanted.add(turnId);
      }
    }
  }
  return unfound.size;
}

/**
 * The registered relay turns a landing names — by its own `talk:<turnId>` anchor, or by a work row that is
 * a relay's — that no receipt carries, read from their turn files. `markRegistered` writes the turn
 * before it appends the receipt, so a crash between the two leaves their park on the turn file alone, and a retry never
 * appends it. A work slug names no turn id, so its turn is found by the directory's names and only that file is read.
 *
 * @param landings the landings holding a card off their queue
 * @param receipts the relay ledger's rows
 * @returns those turns, and how many named relays had no turn that read — each may be the only record of a park
 */
function unreceiptedTurns({
  home,
  landings,
  receipts,
}: {
  home: string;
  landings: readonly CardLandingRow[];
  receipts: readonly TurnRecord[];
}): { readonly turns: readonly TurnRecord[]; readonly unread: number } {
  const { unfound, wanted } = unreceiptedNames({ landings, receipts });
  let unread = slugsFoundOnDisk({ home, unfound, wanted });
  const turns: TurnRecord[] = [];
  for (const turnId of wanted) {
    const turn = readTurn({ home, turnId });
    if (turn.isErr()) {
      unread += 1;
    } else if (turn.value.state === "registered") {
      turns.push(turn.value);
    }
  }
  return { turns, unread };
}
