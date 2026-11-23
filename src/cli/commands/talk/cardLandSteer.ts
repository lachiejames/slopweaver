/**
 * Relating the words a card landing puts on an ask to that ask's row as one more of their steers
 * (`../handover/quoteSteerRow.ts`), so the card a session re-asks shows them beside the words it first answered.
 * Split from `./cardLandApply.ts`, which lands the ruling these words also are.
 */
import { scanBoard } from "../../../handover/store.js";
import { mirrorAfterWrite } from "../handover/mirrorAfterWrite.js";
import { relateSteer } from "../handover/quoteSteerRow.js";

/**
 * Relate a repeated landing's words to the ask it landed on, read off the live board — a no-op once related, so
 * retrying a landing whose steer did not reach the row is how it gets there.
 *
 * @param anchor the landing's anchor, the steer related
 * @param home the Slopweaver home the landing ledger lives under
 * @param handoverDir the board the ask's row is read off
 * @param slug the ask's slug
 * @returns why the steer is still not on the row — empty once it is, or when the row is archived
 */
export async function relateRepeatedSteer({
  anchor,
  home,
  handoverDir,
  slug,
}: {
  anchor: string;
  home: string;
  handoverDir: string;
  slug: string;
}): Promise<readonly string[]> {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return [`${anchor} not related to ${slug}: ${scan.error.message}`];
  }
  const live = scan.value.docs.find((doc) => doc.slug === slug);
  if (live === undefined) {
    return [];
  }
  return relateLandedSteer({ anchor, home, path: live.path, slug });
}

/**
 * Relate the words landing on an ask to its row. Before the ruling, so a `call:` steer is related as unread and the
 * quote after the ledger append reads it. A row that will not take it never holds the ruling back — their decision
 * outranks its provenance — and the landing reports it.
 *
 * @param path the ask's row on the live board
 * @param anchor the landing's anchor, the steer related
 * @param home the Slopweaver home the landing ledger lives under
 * @returns why the steer did not reach the row, with the command that relates it — empty when it did
 */
export async function relateLandedSteer({
  path,
  anchor,
  home,
  slug,
}: {
  path: string;
  anchor: string;
  home: string;
  slug: string;
}): Promise<readonly string[]> {
  const related = relateSteer({ anchor, apply: true, home, path });
  const problems = [...related.problems];
  if (related.wrote && (await mirrorAfterWrite({ home, path, verb: "quote" }))) {
    problems.push("it was written, but its mirror failed");
  }
  if (problems.length === 0) {
    return [];
  }
  const command = `slopweaver handover quote ${slug} --add-steer ${anchor} --apply`;
  return [`${anchor} not related to ${slug}: ${problems.join("; ")}; \`${command}\` relates it`];
}
