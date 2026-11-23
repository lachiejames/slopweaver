/**
 * `slopweaver fathom clear-inbox` over injected edges — ingest every meeting Fathom's inbox mail points at, then
 * archive the mail whose meeting the fathom source is PROVEN to hold.
 *
 * Ingest first, archive second: the order is the contract, and it lives in one verb rather than in a seat following two:
 *
 * 1. read Fathom's mail and ingest each share link not yet held (`discover --ingest`'s own pass);
 * 2. if that pass failed anywhere — a share read, a bronze write, the store settle — archive NOTHING, because it
 *    proved nothing; the next pass repairs and archives;
 * 3. re-read what fathom bronze holds, and archive an inbox mail only when it carries at least one share link and
 *    every link it carries is held. A mail with no share link cannot be matched to a meeting, so it is kept and
 *    said out loud rather than archived on an unprovable claim.
 *
 * The recap mail itself is never read into anything: its text is scanned for share tokens and dropped.
 */
import { shareTokensIn } from "../../../corpus/fathom/sharePage.js";

import type { FathomMail } from "./discoverCore.js";

/**
 * One Fathom inbox mail `clear-inbox` leaves where it is, and why.
 *
 * @internal
 */
export interface KeptFathomMail {
  readonly id: string;
  readonly reason: string;
}

/** Which Fathom inbox mail a pass archives and which it keeps. */
export interface FathomInboxPlan {
  /** Inbox mail every one of whose share links the fathom source holds, in the order it was read. */
  readonly archive: readonly string[];
  readonly kept: readonly KeptFathomMail[];
}

/**
 * Decide, per Fathom mail still in the inbox, whether its meeting is proven held. Mail already out of the inbox is
 * neither: there is nothing to do with it. Pure.
 *
 * @param mails the Fathom mails read, newest first
 * @param held every share token fathom bronze holds a transcript for, read AFTER the ingest pass
 * @returns the ids to archive and the ids kept with their reasons
 */
export function fathomInboxPlan({
  mails,
  held,
}: {
  mails: readonly FathomMail[];
  held: ReadonlySet<string>;
}): FathomInboxPlan {
  const archive: string[] = [];
  const kept: KeptFathomMail[] = [];
  for (const mail of mails.filter((one) => one.inInbox)) {
    const tokens = shareTokensIn({ texts: mail.texts });
    const unheld = tokens.filter((token) => !held.has(token));
    if (tokens.length === 0) {
      kept.push({
        id: mail.id,
        reason: "carries no share link, so the Fathom integration cannot prove it holds this meeting",
      });
    } else if (unheld.length > 0) {
      kept.push({ id: mail.id, reason: `share link(s) not held yet: ${unheld.join(", ")}` });
    } else {
      archive.push(mail.id);
    }
  }
  return { archive, kept };
}

/**
 * The lines a pass prints about the inbox, after discovery's own report. Pure.
 *
 * @param plan what the pass archives and keeps
 * @param withheld why nothing was archived, when the ingest pass failed; undefined when it did not
 * @param dryRun whether the pass only said what it would archive
 * @returns the lines to print, in order
 */
export function clearInboxLines({
  plan,
  withheld,
  dryRun,
}: {
  plan: FathomInboxPlan;
  withheld: string | undefined;
  dryRun: boolean;
}): readonly string[] {
  const inbox = plan.archive.length + plan.kept.length;
  const lines = [`fathom clear-inbox — ${String(inbox)} Fathom mail(s) in the inbox`];
  if (withheld !== undefined) {
    lines.push(`  archived NOTHING: ${withheld}`);
  } else if (plan.archive.length > 0) {
    const verb = dryRun ? "would archive" : "archiving";
    lines.push(`  ${verb} ${String(plan.archive.length)}, every share link held: ${plan.archive.join(" ")}`);
  }
  for (const mail of plan.kept) {
    lines.push(`  kept ${mail.id}: ${mail.reason}`);
  }
  return lines;
}
