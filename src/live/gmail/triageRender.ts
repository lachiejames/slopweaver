/**
 * The human rendering of a `gmail triage` document, and its one JSON form. Pure.
 *
 * A group prints as the three things a card is built from — who, how many, and what a way out would cost — plus
 * its key, because the key is what a card, a standing rule and `gmail triage --key` all name. Ids print only for a
 * group the caller named, where they are the argument the next command takes. A group a declared rule archives
 * (`./triageRules.ts`), a thread the owner answered last, and an invite whose meeting has passed, each prints on one line
 * in a trailing section, apart from every
 * group a card could be made of.
 */
import { safeJsonStringify } from "../../lib/safeJson.js";
import type { GmailTriageDocument, GmailTriageGroup } from "./triage.js";
import type { TriageCardStanding } from "./triageCarded.js";
import type { GmailUnsubscribeKind } from "./triageKey.js";

/** What each way out means to the person deciding, in the words a card would use. */
const UNSUBSCRIBE_WORDS: Readonly<Record<GmailUnsubscribeKind, string>> = {
  link: "unsubscribe: a link (opens the sender's page)",
  mailto: "unsubscribe: by email (a send under your name)",
  none: "unsubscribe: none offered — archive is the lever",
  "one-click": "unsubscribe: one-click (RFC 8058)",
};

/** The date half of an instant, or a stand-in a reader cannot mistake for one. */
function dayOf({ iso }: { iso: string | undefined }): string {
  if (iso === undefined) {
    return "(undated)";
  }
  return iso.slice(0, 10);
}

/** A group as `gmail triage` prints it: the mailbox's group, plus whether an open card already stands for it. */
export interface PresentedGmailTriageGroup extends GmailTriageGroup {
  /**
   * The open card standing for this key — `slug` the card's, `filedInto` the still-open row it was filed into —
   * or `null` when none is proven open. Read off the board at print time and never persisted: the snapshot is the
   * mailbox's, and a card's standing moves without it.
   */
  readonly carded: { readonly slug: string; readonly filedInto: string | null } | null;
}

/**
 * One group, with its card standing attached.
 *
 * @param group the mailbox's group
 * @param carded every key's standing, as `./triageCardedStore.ts` read it
 * @returns the group plus `carded`, set only when a card is proven open
 */
export function presentGmailTriageGroup({
  group,
  carded,
}: {
  readonly group: GmailTriageGroup;
  readonly carded: ReadonlyMap<string, TriageCardStanding>;
}): PresentedGmailTriageGroup {
  const standing = carded.get(group.key);
  if (standing === undefined || !standing.carded) {
    return { ...group, carded: null };
  }
  return { ...group, carded: { filedInto: standing.filedInto, slug: standing.slug } };
}

/** The key line, naming the open card when one stands — the line step 4 of the recipe reads to skip a group. */
function keyLine({ group }: { group: PresentedGmailTriageGroup }): string {
  if (group.carded === null) {
    return `     key ${group.key}`;
  }
  const filed = group.carded.filedInto === null ? "" : `, filed into ${group.carded.filedInto} (still open)`;
  return `     key ${group.key} · already carded as ${group.carded.slug}${filed}`;
}

/** The lines one group prints. */
function groupLines({ group }: { group: PresentedGmailTriageGroup }): readonly string[] {
  const relay = group.relayedBy === undefined ? "" : ` (via ${group.relayedBy})`;
  const span =
    group.oldestIso === group.newestIso
      ? dayOf({ iso: group.newestIso })
      : `${dayOf({ iso: group.oldestIso })}..${dayOf({ iso: group.newestIso })}`;
  const kind = group.automated ? "automated" : "a person";
  let way = UNSUBSCRIBE_WORDS[group.unsubscribe];
  if (group.relayedBy !== undefined && group.unsubscribe !== "none") {
    way = `${way}, and it leaves the ${group.relayedBy} group`;
  }
  return [
    `${String(group.entries.length).padStart(3)}  ${group.sender}${relay} <${group.address}>`,
    `     ${String(group.unread)} unread · ${span} · ${kind} · ${way}`,
    keyLine({ group }),
    ...group.subjects.map((subject) => `     "${subject}"`),
  ];
}

/** The lines naming mail held out of every group: no usable From, Fathom, and Gemini meeting notes. */
function heldOutLines({ document }: { document: GmailTriageDocument }): readonly string[] {
  const lines: string[] = [];
  if (document.unkeyed.length > 0) {
    lines.push(`${String(document.unkeyed.length)} message(s) carried no usable From and are in no group`);
  }
  if (document.fathom.length > 0) {
    lines.push(
      `${String(document.fathom.length)} Fathom mail(s) held out of triage — never carded; the Fathom integration ` +
        "ingests each meeting, then archives the mail: slopweaver fathom clear-inbox",
    );
  }
  if (document.meetingNotes.length > 0) {
    lines.push(
      `${String(document.meetingNotes.length)} Gemini meeting-notes mail(s) held out of triage — never carded here; ` +
        "each is archived once its transcript is proven in the corpus, or proven absent: " +
        "slopweaver gmail clear-meeting-notes",
    );
  }
  return lines;
}

/** One line per group a standing rule archives, thread the owner answered last, and invite whose meeting has passed. */
function ruledLines({ document }: { document: GmailTriageDocument }): readonly string[] {
  const ruled: string[] = [];
  for (const group of document.groups) {
    if (group.archiveRule !== undefined) {
      ruled.push(
        `${String(group.entries.length).padStart(3)}  ${group.sender} <${group.address}> · key ${group.key} · ` +
          `ruled ${group.archiveRule.anchor}`,
      );
    }
  }
  for (const thread of document.replied) {
    ruled.push(
      `${String(thread.ids.length).padStart(3)}  ${thread.sender} · key thread:${thread.threadId} · ` +
        "your reply is the last message",
    );
  }
  for (const invite of document.passedInvites) {
    ruled.push(`  1  ${invite.sender} · key invite:${invite.id} · the meeting has passed: "${invite.subject}"`);
  }
  return ruled;
}

/**
 * Render the whole reading, or one group with the ids of its messages when the caller named it.
 *
 * @param document the triage document
 * @param only the one group, when the caller named a key
 * @param carded every key's card standing, so a group an open card already stands for says so
 * @returns the text, one line per row
 */
export function renderGmailTriageText({
  document,
  only,
  carded,
}: {
  document: GmailTriageDocument;
  only: GmailTriageGroup | undefined;
  carded: ReadonlyMap<string, TriageCardStanding>;
}): string {
  const messages = document.groups.reduce((total, group) => total + group.entries.length, 0);
  const unread = document.groups.reduce((total, group) => total + group.unread, 0);
  const estimate =
    document.inboxEstimate === undefined ? "" : ` · Gmail ESTIMATES ${String(document.inboxEstimate)} in the inbox`;
  const reach = document.complete ? "the whole inbox" : "STOPPED at the message cap — more remain";
  const lines = [
    `gmail triage: ${document.account} · read at ${document.readAtIso}`,
    `inbox: ${String(messages)} message(s), ${String(unread)} unread, in ${String(document.groups.length)} ` +
      `sender group(s) · ${reach}${estimate}`,
    ...heldOutLines({ document }),
  ];
  if (only !== undefined) {
    lines.push("", ...groupLines({ group: presentGmailTriageGroup({ carded, group: only }) }));
    lines.push(`     ${String(only.entries.length)} id(s): ${only.entries.map((entry) => entry.id).join(" ")}`);
    return lines.join("\n");
  }
  for (const group of document.groups) {
    if (group.archiveRule === undefined) {
      lines.push("", ...groupLines({ group: presentGmailTriageGroup({ carded, group }) }));
    }
  }
  const ruled = ruledLines({ document });
  if (ruled.length > 0) {
    lines.push("", "archived under a standing rule, never carded — `gmail triage --ruled` prints their ids:", ...ruled);
  }
  return lines.join("\n");
}

/**
 * The document as `--json` prints it and `--write` persists it.
 *
 * @param document the triage document
 * @returns pretty-printed JSON
 */
export function renderGmailTriageJson({ document }: { document: GmailTriageDocument }): string {
  return safeJsonStringify({ label: "gmail triage document", space: 2, value: document });
}

/**
 * The reading as `gmail triage --json` prints it: the document, every group carrying `carded`. Never what `--write`
 * persists — that stays {@link renderGmailTriageJson}, the mailbox's alone.
 *
 * @param document the triage document
 * @param carded every key's card standing
 * @returns pretty-printed JSON
 */
export function renderGmailTriageReadingJson({
  document,
  carded,
}: {
  readonly document: GmailTriageDocument;
  readonly carded: ReadonlyMap<string, TriageCardStanding>;
}): string {
  const value = { ...document, groups: document.groups.map((group) => presentGmailTriageGroup({ carded, group })) };
  return safeJsonStringify({ label: "gmail triage document", space: 2, value });
}
