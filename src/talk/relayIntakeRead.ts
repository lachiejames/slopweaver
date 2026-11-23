/**
 * The effectful half of `./relayIntake.ts`: read the relay records inside the sweep window and hand them, with
 * the board and the intake marks, to the pure selector. A read that fails is reported as `unavailable` with
 * its reason, never as zero relays — a sweep that cannot see the owner's words must not read as one that found none.
 */
import type { JournalEvidence } from "../handover/assemble.js";
import type { HandoverDoc } from "../handover/doc.js";
import type { IntakeMark } from "../supervisor/intake.js";

import {
  type ChairHasRelay,
  malformedHeldInstant,
  type RelayRowEvidence,
  undeliveredRelays,
  type VoiceRelayIntake,
} from "./relayIntake.js";
import { readRelayTurns } from "./relayStore.js";

/**
 * The board narrowed to what can witness a relay: each doc's slug, anchor, settlement and journal.
 *
 * A run journal is keyed by SLUG, while a slug is authored front matter two docs can share — a live doc with
 * another live doc (r3-sweep-delivers-5), or with an ARCHIVED one (r3-sweep-delivers-7). A shared slug's
 * journal cannot be attributed to either, so it witnesses nobody, and only a settlement or a mark clears those
 * relays. An archived doc is a row in its own right: its settlement witnesses, its journal never does.
 *
 * @param docs every live board doc the scan resolved
 * @param archived the archived docs carrying a relay's slug ({@link readVoiceRelayIntake} finds them)
 * @param journals each live doc's current-cycle run journal, by slug
 * @returns one evidence row per live doc, then one per archived doc
 */
export function relayRowEvidence({
  docs,
  archived,
  journals,
}: {
  docs: readonly HandoverDoc[];
  archived: readonly HandoverDoc[];
  journals: ReadonlyMap<string, JournalEvidence>;
}): readonly RelayRowEvidence[] {
  const all = [...docs, ...archived];
  const shared = new Set(
    all.filter((doc, index) => all.findIndex((other) => other.slug === doc.slug) !== index).map((doc) => doc.slug),
  );
  const live = docs.map((doc) => {
    const journal = shared.has(doc.slug) ? undefined : journals.get(doc.slug);
    return evidenceOf({ doc, events: journal === undefined ? [] : journal.events });
  });
  return [...live, ...archived.map((doc) => evidenceOf({ doc, events: [] }))];
}

/** One doc as relay evidence, carrying the journal events it is allowed to be witnessed by. */
function evidenceOf({ doc, events }: { doc: HandoverDoc; events: RelayRowEvidence["events"] }): RelayRowEvidence {
  return { anchor: doc.anchor, events, settled: doc.settlement !== undefined, slug: doc.slug };
}

/**
 * Read the voice relays registered since `sinceIso` that never reached the chair's chat and nothing acted on.
 *
 * The archive is asked by each RELAY's exact slug, never enumerated and never driven by the live board: a
 * relay whose row was settled and then archived has no live doc left to ask on its behalf
 * (r3-sweep-delivers-9).
 *
 * @param home the Slopweaver home the relay records live under
 * @param docs every live board doc the scan resolved
 * @param journals each live doc's current-cycle run journal, by slug
 * @param archivedDoc the archived doc carrying exactly this slug, if one does
 * @param marks every intake mark; one on a relay's `talk:<turnId>` pointer clears it
 * @param chairHas whether the chair holds a relay its delivery grade says it never got
 * @param sinceIso the sweep window's floor
 * @param nowIso the instant a held relay's batch is judged overdue against
 * @returns the voice-relay half of a reconciliation
 */
export function readVoiceRelayIntake({
  home,
  docs,
  journals,
  archivedDoc,
  marks,
  chairHas,
  sinceIso,
  nowIso,
}: {
  home: string;
  docs: readonly HandoverDoc[];
  journals: ReadonlyMap<string, JournalEvidence>;
  archivedDoc: (options: { slug: string }) => HandoverDoc | undefined;
  marks: readonly IntakeMark[];
  chairHas: ChairHasRelay;
  sinceIso: string;
  nowIso: string;
}): VoiceRelayIntake {
  const records = readRelayTurns({ home, keep: { sinceIso } });
  if (records.isErr()) {
    return { kind: "unavailable", why: records.error.message };
  }
  const malformed = malformedHeldInstant({ records: records.value });
  if (malformed !== undefined) {
    return { kind: "unavailable", why: malformed };
  }
  const archived = [...new Set(records.value.map((record) => record.slug))].flatMap((slug) => {
    const found = archivedDoc({ slug });
    return found === undefined ? [] : [found];
  });
  return {
    kind: "read",
    relays: undeliveredRelays({
      chairHas,
      markedPointers: new Set(marks.map((mark) => mark.pointer)),
      nowIso,
      records: records.value,
      rows: relayRowEvidence({ archived, docs, journals }),
    }),
  };
}
