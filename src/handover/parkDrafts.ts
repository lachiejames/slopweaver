/**
 * Every unsent message a seat holds when it parks — what its checkpoint copies so closing the seat loses none.
 *
 * A parked seat leaves the fleet and its state is tracked and resumed on demand, draft text included. Two places hold a seat's unsent words: the open question's
 * drafted ACTION (`./askAction.ts`, the Queue card's message) and every HELD Slack draft recorded against the
 * run's row (`slack draft record --row`).
 *
 * The checkpoint holds a COPY. Closing a seat never touches the draft register, which stays the authority, so a
 * draft recorded in the instant between this read and the checkpoint's append is not lost — it is in the
 * register, and the reseat's `slack draft list` shows it. What this refuses is a copy it cannot call complete:
 * a register line this build could not read may be one of this row's held drafts.
 *
 * Pure: the events and the register's parsed log in, the drafts or the refusal out.
 */
import { err, ok, type Result } from "../lib/result.js";
import { foldSlackDraftLog, type SlackDraftLog } from "../outbound/slack/draftLog.js";
import { draftBodyLines } from "../outbound/slack/draftText.js";
import { type AskAction, actionMessages, MAIL_ACTION_VERSION } from "./askAction.js";
import { heldQuestion } from "./heldQuestion.js";
import type { RunEvent } from "./ledger.js";
import { PARK_DRAFT_MAX_CHARS, type ParkedDraft } from "./parkedEvent.js";

/**
 * The drafts a parking seat holds: the open question's drafted message, then every held Slack draft on its row.
 *
 * @param events the run journal's events, in order — the open question's action is read off them
 * @param slug the run's slug, which a held draft names as its `row`
 * @param log the Slack draft register, parsed
 * @returns the drafts, or why the register cannot be read as complete
 */
export function parkedDraftsOf({
  events,
  slug,
  log,
}: {
  events: readonly RunEvent[];
  slug: string;
  log: SlackDraftLog;
}): Result<readonly ParkedDraft[]> {
  if (log.skipped.length > 0) {
    const lines = log.skipped.map((line) => String(line.line)).join(", ");
    return err([
      `the Slack draft register has ${String(log.skipped.length)} line(s) this build could not read (${lines}), so this row's held drafts cannot be called complete`,
    ]);
  }
  const action = heldQuestion({ events })?.action;
  const asked: readonly ParkedDraft[] =
    action === undefined ? [] : [{ kind: "ask-action", text: actionText({ action }) }];
  const held = foldSlackDraftLog({ log })
    .filter((item) => item.state === "held" && item.draft.row === slug)
    .map((item): ParkedDraft => ({
      id: item.id,
      kind: "slack-draft",
      text: bounded({ text: draftBodyLines({ payload: item.draft.payload }).join("\n") }),
    }));
  return ok([...asked, ...held]);
}

/**
 * The drafts a seat holds now that a checkpoint journalled earlier does not carry — a held Slack draft by its id,
 * the open question's message by its text. A checkpoint older than the `drafts` field carries none.
 *
 * @param held what the seat holds now, from {@link parkedDraftsOf}
 * @param recorded the checkpoint's own drafts, `undefined` on a line older than the field
 * @returns every held draft missing from the checkpoint, in order
 */
export function draftsMissingFrom({
  held,
  recorded,
}: {
  held: readonly ParkedDraft[];
  recorded: readonly ParkedDraft[] | undefined;
}): readonly ParkedDraft[] {
  if (recorded === undefined) {
    return held;
  }
  return held.filter((draft) => !recorded.some((kept) => sameDraft({ a: draft, b: kept })));
}

/**
 * Whether two drafts carry the same message: a Slack draft by its register id AND its text, so a checkpoint
 * holding an older copy of the same draft does not stand for the one held now; an ask
 * action by its text.
 */
function sameDraft({ a, b }: { a: ParkedDraft; b: ParkedDraft }): boolean {
  if (a.kind === "slack-draft") {
    return b.kind === "slack-draft" && b.id === a.id && b.text === a.text;
  }
  return b.kind === "ask-action" && b.text === a.text;
}

/** An ask action's message as the owner would read it: every Slack message in order, or the mail's subject and body. */
function actionText({ action }: { action: AskAction }): string {
  if (action.version === MAIL_ACTION_VERSION) {
    return bounded({ text: `Subject: ${action.form.subject}\n\n${action.form.body}` });
  }
  return bounded({ text: actionMessages({ action }).join("\n\n") });
}

/** A draft's text held under the checkpoint's cap, cut from the END, since a message reads from its start. */
function bounded({ text }: { text: string }): string {
  return text.length > PARK_DRAFT_MAX_CHARS ? text.slice(0, PARK_DRAFT_MAX_CHARS) : text;
}
