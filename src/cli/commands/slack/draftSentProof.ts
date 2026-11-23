/**
 * The one Slack read `slack draft drop` makes: when its note is a `sent …` record, read each message it names and refuse
 * unless Slack holds the row's own words there, by the row's own author (`sentNoteProven`,
 * `../../../outbound/slack/draftSentNote.ts`). A well-formed note alone once dropped an approved row nobody sent
 * that way. Read before the register lock is taken: a message in Slack does not move with the register.
 */
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { sentNoteProven, sentRefsOfRow } from "../../../outbound/slack/draftSentNote.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * Why a drop's `sent …` note does not prove the send, or `undefined` when it does, when the note is not a send record
 * (the drop guard judges that), or when the row is not in the register (the drop reports that).
 *
 * @param home the state home the register and tokens are read under
 * @param id the row the drop names
 * @param note the drop note
 * @returns the refusal, or nothing
 */
export async function sentNoteRefusal({
  deps,
  home,
  id,
  note,
}: {
  deps: Pick<SlackDraftDeps, "botToken" | "readLog" | "threadReplies" | "userToken">;
  home: string;
  id: string;
  note: string;
}): Promise<string | undefined> {
  const row = foldSlackDraftLog({ log: parseSlackDraftLog({ lines: deps.readLog({ home }) }) }).find(
    (item) => item.id === id,
  );
  const refs = row === undefined ? undefined : sentRefsOfRow({ note, row });
  if (row === undefined || refs === undefined) {
    return undefined;
  }
  const token = row.draft.actor === "bot" ? deps.botToken({ home }) : deps.userToken({ home });
  const lead = `slack draft drop ${id}: the note says it was sent, but`;
  if (token === undefined) {
    return `${lead} there is no Slack token to read those messages under, so the send cannot be checked. Nothing was dropped.`;
  }
  const reads: (readonly unknown[])[] = [];
  for (const ref of refs) {
    const read = await deps.threadReplies({ channel: ref.channel, threadTs: ref.ts, token });
    if (read.isErr()) {
      return `${lead} ${ref.channel} ${ref.ts} did not read (${read.error.message}). Nothing was dropped.`;
    }
    reads.push(read.value);
  }
  if (sentNoteProven({ reads, refs, row })) {
    return undefined;
  }
  return (
    `${lead} Slack does not hold these words there under its author — each ref must be the message the row's words ` +
    "went out as, carrying its media by name and size, and a card's blocks in one message. If they did not go, " +
    `hold it with the reason (\`slopweaver slack draft hold ${id} --reason ` +
    `<thread-moved|no-fleet-slot|slack-refused|not-owner-yes> --why "<what you saw>"\`). Nothing was dropped.`
  );
}
