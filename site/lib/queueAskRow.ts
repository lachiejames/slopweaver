/**
 * One ask card off one board row, and what that card reads off the row: every text it draws, which is where a draft
 * id it names can sit, and the Slack thread it points at. Split from `./queueRows.ts`, which folds every register into
 * one list, so that file stays under the 300-line cap.
 */

import type { BoardRowOption } from "../components/live/read";
import type { BoardRowActionRead } from "../components/live/readAction";
import type { ParkedDraft } from "../components/live/readSlackDrafts";
import type { LiveState } from "../components/live/useLive";
import { draftMessages } from "./askAction";
import { liftedAsk } from "./askCommands";
import { askedOptions, offeredSends } from "./askOffered";
import { askVerified } from "./askVerified";
import { type BriefingCardBasis, briefingCardForm } from "./briefingCardForm";
import { artifactCitedForm, artifactPage } from "./cardPages";
import type { QueueAskBoardRow } from "./detachedAskRow";
import { askHint } from "./ownerAsks";
import { queueProvenanceOf } from "./provenance";
import { askTeamFacing } from "./queueAskWait";
import { askCard } from "./queueCardAsk";
import { boardRowSource, sourceForm } from "./queueCardSource";
import { firstRefusal, heldOf, hint } from "./queueRowFields";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { boardRowPlacement } from "./registerPlacement";
import { drawnOnceForm, namedDrafts, slackDraftIdsIn } from "./slackDraftIds";
import { slackLinksIn, threadKeyOf } from "./slackLink";
import { waitingTierOf } from "./waitingRank";
import type { WorkspacePlacer } from "./workspacePlacement";

/**
 * Every text an ask's card draws, in the order the card draws it — where a draft id it names can sit.
 *
 * @param row the ask row
 * @param options the options the card offers, as {@link askedOptions} admitted them
 * @returns the texts, an absent field skipped by the id reader
 */
export function askTexts({
  row,
  options,
}: {
  row: QueueAskBoardRow;
  options: readonly BoardRowOption[];
}): readonly (string | undefined)[] {
  return [
    row.slug,
    row.question,
    row.summary,
    row.problem,
    row.risk,
    row.blastRadius,
    row.stillReal,
    ...options.flatMap((one) => [one.option, one.tradeoff]),
    row.lean,
    row.reason,
    // A detached ask's read reason, drawn beneath its sentence and once inside it.
    row.reasonWhy,
    ...actionTextsOf({ action: row.action }),
  ];
}

/**
 * Every text an ask's action draws — a Slack action's body, mention names and each destination's label, trade-off
 * and recipients through `SlackActionPreview`; a mail's sender, recipients, subject and body through
 * `MailActionPreview` — or nothing for none or unreadable. The verb reads the same set (`actionTexts`).
 *
 * @param action the row's action, in whichever state it arrived
 * @returns the texts, in the order the preview draws them
 */
function actionTextsOf({ action }: { action: BoardRowActionRead }): readonly string[] {
  if (action.kind === "mail") {
    const { from, to, cc, bcc, subject, body } = action.mail;
    return [from, ...to, ...cc, ...bcc, subject, body];
  }
  if (action.kind !== "action") {
    return [];
  }
  const drafted = action.action;
  const destinations = drafted.destinations.flatMap((one) => [
    one.label,
    one.tradeoff,
    ...(one.kind === "dm" ? one.recipients.map((person) => person.label) : []),
  ]);
  return [...draftMessages({ action: drafted }), ...drafted.mentions.map((person) => person.label), ...destinations];
}

/**
 * One ask card off one board row: the ONE builder behind an ask on the owner's Queue and an ask that has just left it
 * (`./recentQueueDepartures.ts`), so the card the voice reads after a settle is the card the owner was reading before it.
 *
 * @param row the board row
 * @param question what the card asks — the open question on the Queue, the row's summary once it has settled
 * @param posts the parked-drafts reading, which the card's named drafts are drawn from
 * @param whenIso the instant the card ages from
 * @param placer the organisation's address readers, which place the row
 * @returns the card, before its tags are read off the board
 */
export function askRowOf({
  row,
  question,
  posts,
  whenIso,
  placer,
}: {
  placer: WorkspacePlacer;
  row: QueueAskBoardRow;
  question: string;
  posts: LiveState<readonly ParkedDraft[]>;
  whenIso: string | undefined;
}): Omit<QueueRow, keyof QueueTags> {
  const source = boardRowSource({ row });
  const threadUrl = askThreadUrl({ question, row });
  const options = askedOptions({ action: row.action, options: row.options });
  const named = namedDrafts({ ids: slackDraftIdsIn({ texts: askTexts({ options, row }) }), posts });
  // The page the row published leads its chips, though the question rarely names it (`./cardPages.ts`).
  const page = artifactPage({ artifact: row.artifact });
  const offered = offeredSends({ action: row.action });
  const card = askCard({
    row: { ...row, ...liftedAsk({ question }), artifactPage: page, offered, options, threadUrl },
  });
  const cited = artifactCitedForm({ artifact: row.artifact, pages: card.pages });
  const basis: BriefingCardBasis = {
    lean: heldOf({ value: row.lean }),
    problem: heldOf({ value: row.problem }),
    stakes: [row.risk, row.blastRadius, row.stillReal].every((value) => heldOf({ value }) === "present")
      ? "present"
      : "absent",
    what: "present",
  };
  const placement = boardRowPlacement({ placer, row });
  return {
    card,
    hint: askHint({ row }),
    id: row.slug,
    key: `ask:${row.slug}`,
    kind: "ask",
    pill: said({ absent: "no priority", value: row.priority }),
    provenance: queueProvenanceOf({ placement }),
    record: {
      drafts: named,
      form: firstRefusal({
        forms: [sourceForm({ source }), briefingCardForm({ basis, card }), drawnOnceForm({ named }), cited],
      }),
      kind: "ask",
      row,
    },
    placement,
    source,
    threadUrl,
    tier: waitingTierOf({ checkIn: false, teamFacing: askTeamFacing({ placement }) }),
    ...askVerified({ row }),
    whenIso,
  };
}

/**
 * A field the record may not carry, with the absence said out loud rather than coalesced away.
 *
 * @param absent the word shown in the value's place
 * @returns the value, or that word
 */
function said({ value, absent }: { value: string | undefined; absent: string }): string {
  if (value === undefined) {
    return absent;
  }
  return value;
}

/**
 * The Slack thread an ask row points at — the PUBLISHED anchor ahead of anything parsed out of prose.
 *
 * The order is the measurement, not a preference. `summary` reaches this page capped at 320 characters,
 * and `BoardRow.summaryAnchor` exists because 106 of the 129 board summaries carrying a permalink held it
 * PAST that cap — so scraping the capped text alone loses the thread on five rows in six that have one.
 * The row's own `anchor` comes next when it is a Slack permalink: a row the fleet raised off a thread anchors on
 * that thread and may never name it in prose. A review card whose thread lives only there
 * shows the Slack message itself, not a line telling the owner about it. An anchor that is a
 * transcript, a call or a pull request is no thread, and `threadKeyOf` refuses it. The prose scan stays last for
 * the rows whose link is in the question or the reason instead — the read's reason a detached ask carries beside
 * its sentence included, since it can sit inside that sentence.
 *
 * @param row the board's row
 * @param question the row's question, already known to be present
 * @returns the thread link, or `undefined` when the row names none anywhere
 */
export function askThreadUrl({ row, question }: { row: QueueAskBoardRow; question: string }): string | undefined {
  if (row.summaryAnchor !== undefined) {
    return row.summaryAnchor;
  }
  if (row.anchor !== undefined && threadKeyOf({ link: row.anchor }) !== undefined) {
    return row.anchor;
  }
  const prose = `${question} ${row.reason} ${hint({ value: row.reasonWhy })} ${hint({ value: row.summary })}`;
  return slackLinksIn({ text: prose }).at(0);
}
