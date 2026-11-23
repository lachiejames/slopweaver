/**
 * The id sets an act takes from a `gmail triage` reading — the pinned ids the owner's answer to a card still finds,
 * and the ids a standing rule covers. Each is the ONLY set its act may touch, which is why they are named functions
 * rather than a filter at the call site. Pure: `./triage.ts` builds the reading.
 */
import type { GmailTriageDocument } from "./triage.js";
import type { GmailTriageStructuralRule } from "./triageRules.js";

/**
 * The anchor of the structural rule a non-empty lane was filled under. The lane is filled only when its rule is on
 * (`./triage.ts`), so a lane with entries and no rule is a reading this code did not write.
 */
function structuralAnchor({
  document,
  kind,
}: {
  document: GmailTriageDocument;
  kind: GmailTriageStructuralRule["kind"];
}): string {
  return document.structuralRules.find((rule) => rule.kind === kind)!.anchor;
}

/**
 * The pinned ids a card showed the owner that a fresh reading still finds in the inbox — the ONLY set their answer
 * acts on. Mail that arrived after the pin, or came back from a snooze, was never on the card, so it is never in this
 * set; one the owner already moved themselves has left the inbox, so it drops out too. Pure.
 *
 * @param pinned the ids the card pinned, in the order it pinned them
 * @param document a fresh reading of the inbox
 * @returns the pinned ids still in the inbox, in pinned order
 */
export function pinnedStillInInbox({
  pinned,
  document,
}: {
  pinned: readonly string[];
  document: GmailTriageDocument;
}): readonly string[] {
  const inbox = new Set([
    ...document.groups.flatMap((group) => group.entries.map((entry) => entry.id)),
    ...document.unkeyed,
    ...document.fathom,
    ...document.meetingNotes,
    ...document.replied.flatMap((thread) => thread.ids),
    ...document.passedInvites.map((invite) => invite.id),
  ]);
  return pinned.filter((id) => inbox.has(id));
}

/** One declared rule's share of a reading: the group it covers and the ids an archive takes. */
export interface GmailTriageRuledGroup {
  readonly key: string;
  readonly sender: string;
  readonly anchor: string;
  readonly ids: readonly string[];
}

/**
 * Every inbox message a declared archive rule covers, grouped by rule — the ONLY set `gmail triage --ruled` hands the
 * seat to archive. Each id is one this reading found in the inbox; a reading that stopped at its cap may hold fewer
 * than the inbox does, never more. A thread the owner answered last is one entry keyed `thread:<threadId>`, after every
 * sender rule's; an invite whose meeting has passed is one entry keyed `invite:<id>`, last. Pure.
 *
 * @param document a fresh reading of the inbox
 * @returns one entry per ruled group, largest first, then one per replied thread, then one per passed invite, and
 *   every id across them in order
 */
export function ruledTriageIds({ document }: { document: GmailTriageDocument }): {
  readonly groups: readonly GmailTriageRuledGroup[];
  readonly ids: readonly string[];
} {
  const ruled = document.groups.flatMap((group) => {
    if (group.archiveRule === undefined) {
      return [];
    }
    const ids = group.entries.map((entry) => entry.id);
    return [{ anchor: group.archiveRule.anchor, ids, key: group.key, sender: group.archiveRule.sender }];
  });
  const replied = document.replied.map((thread) => ({
    anchor: structuralAnchor({ document, kind: "last-reply" }),
    ids: thread.ids,
    key: `thread:${thread.threadId}`,
    sender: `${thread.sender}, answered last by the owner`,
  }));
  const invites = document.passedInvites.map((invite) => ({
    anchor: structuralAnchor({ document, kind: "passed-invite" }),
    ids: [invite.id],
    key: `invite:${invite.id}`,
    sender: `${invite.sender}'s invite, its meeting passed`,
  }));
  const groups = [...ruled, ...replied, ...invites];
  return { groups, ids: groups.flatMap((group) => group.ids) };
}
