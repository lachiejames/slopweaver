/**
 * Whether a whole-form replacement of a pull request's title and description can discard anything this door did
 * not write — the provenance half of `./updateConsent.ts`'s replacement key.
 *
 * A whole form (`pr update --form`/`--file`, and a `stack push` re-run on an open pull request) carries no trailing
 * region and replaces both fields outright, and GitHub keeps no history of a description. The key protects what the
 * form cannot carry: an edit made on github.com by the owner or a reviewer, or a block a bot appended. When the local
 * ledger proves the live title and body are exactly what this door last confirmed writing, neither of those can be
 * live, so a changed replacement discards nothing unrecoverable and no key is asked for.
 *
 * The record judged is the one under the live pull request's own locus, and it must be this door's LATEST confirmed
 * write to that pull request: a record keeps its locus when the pull request is retargeted, so one left at a base
 * the pull request has since come back to is stale, and a later record of the same node id elsewhere outranks it.
 * Confirmation instants are compared as instants, never as strings, and one that does not parse — the judged
 * record's or another's — never waives the key. A ledger FILE that does not read or parse never waives it either:
 * it might hold the later write, and nothing about it can prove otherwise.
 * Then three comparisons, all required: the record's confirmed `number` is the live pull request's, its `bodyHash`
 * is the live body's digest (`bodyHash`, which reads CRLF as LF and never hashes an absent body like an empty one),
 * and its stored form's `title` is the live title. Any drift — a GitHub-side edit, an appended block, a record for
 * another pull request, a reservation never confirmed, a stored form that no longer decodes, a later write under
 * another locus, an unreadable ledger file — leaves the key demanded exactly as before.
 *
 * Residue: the ledger is LOCAL, so it knows only this machine's writes, and a hand-forged record under
 * `$SLOPWEAVER_HOME` is trusted like any other — this proves provenance against GitHub-side drift, not against this
 * machine's own state.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import type { WrittenPr } from "../../../corpus/github/write.js";
import { bodyHash, type PrRecord } from "../../../outbound/github/prLedger.js";

/**
 * Whether the local ledger proves the live title and description are this door's last confirmed write.
 *
 * @param live the pull request as read before the door, whose node id, number, title and body are compared
 * @param locus the live pull request's own branch locus, which names the record judged
 * @param records every record the ledger holds, read to find this pull request's latest confirmed write
 * @param unreadable how many ledger files failed to read or parse; any one of them might be a later write
 * @returns true only when the record under `locus` is that latest write and both protected fields still match it
 */
export function recordConfirmsLiveReplacement({
  live,
  locus,
  records,
  unreadable,
}: {
  live: Pick<WrittenPr, "body" | "nodeId" | "number" | "title">;
  locus: string;
  records: readonly PrRecord[];
  unreadable: number;
}): boolean {
  if (unreadable > 0) {
    return false;
  }
  const record = records.find((candidate) => candidate.locus === locus);
  if (record === undefined || record.number !== live.number || record.nodeId !== live.nodeId) {
    return false;
  }
  if (record.confirmedIso === undefined || record.bodyHash === undefined || record.form === undefined) {
    return false;
  }
  const confirmedMs = parseStrictIsoInstantMs({ text: record.confirmedIso });
  if (confirmedMs === undefined) {
    return false;
  }
  const outranked = records.some(
    (other) =>
      other.locus !== locus &&
      other.nodeId === live.nodeId &&
      other.confirmedIso !== undefined &&
      outranks({ confirmedIso: other.confirmedIso, thanMs: confirmedMs }),
  );
  return !outranked && record.bodyHash === bodyHash({ body: live.body }) && record.form.title === live.title;
}

/**
 * Whether another record's confirmation instant is at or after the judged record's, compared as instants so that
 * two spellings of one moment (`…00Z`, `…00.000Z`) rank as equal. An instant that does not parse is never provably
 * earlier, so it outranks: the key stays demanded.
 *
 * @param confirmedIso the other record's confirmation instant, as stored
 * @param thanMs the judged record's confirmation, in ms since the epoch
 * @returns true when the other write cannot be shown to precede the judged one
 */
function outranks({ confirmedIso, thanMs }: { confirmedIso: string; thanMs: number }): boolean {
  const otherMs = parseStrictIsoInstantMs({ text: confirmedIso });
  return otherMs === undefined || otherMs >= thanMs;
}
