/**
 * The ONE Queue card a postmortem opportunity ends in — the hand step a checked form (`./postmortemForm.ts`) becomes.
 *
 * Every now and then a Queue card asks the owner whether to send a reply so they can go to the meeting. The
 * owner's yes releases one parked reply in the incident channel, in their voice, tagging whoever runs the
 * postmortem; the calendar invite that follows is theirs to send. Nothing reaches the team before that yes.
 *
 * ## The briefing first, the ask last
 *
 * The card opens the briefing page the seat published — what happened, who is in the room, what they will want to
 * talk about — and carries two or three verbatim lines from the channel above the fold, so the card leads with the
 * conversation, never a pull request (`../hand/proofLink.ts`'s `postmortemWithoutBriefing`). The reply the owner would send
 * comes last in the details.
 *
 * ## The reply has to be the one this card is about
 *
 * {@link askDraftMisplaced} reads the parked reply against the form: still held, in the owner's voice, in this incident's
 * channel, tagging the facilitator, raised by this card's row. A reply that fails any of those is not "the ask to join
 * this meeting", whatever its words say.
 *
 * ## Updates amend the same card
 *
 * A later look (the meeting got scheduled, the facilitator changed) re-cuts the card through `./revision.ts`'s fold,
 * ids `pm-<channel id lowered>-r<n>`.
 *
 * Pure: a form, the register's rows, a parked draft and an instant in; a draft or a refusal out.
 */
import { postingRefusal } from "../hand/posting.js";
import type { HandRow } from "../hand/row.js";
import { buildHandStep, type HandStepDraft } from "../hand/step.js";
import { err, ok, type Result } from "../lib/result.js";
import type { SkippedSlackDraftLine } from "../outbound/slack/draftLog.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";
import { consoleViewerUrl } from "../pages/url.js";

import { type IncidentPostmortemError, IncidentPostmortemErrors } from "./errors.js";
import {
  checkedPostmortemForm,
  IN_THE_ROOM,
  type IncidentPostmortemForm,
  type PostmortemMeeting,
} from "./postmortemForm.js";
import { channelRevisionPattern, type IncidentRevision, nextChannelRevision } from "./revision.js";

/** The id prefix every revision of a postmortem card carries. */
const POSTMORTEM_KIND = "pm";

/**
 * The id every revision of one incident's postmortem card carries, its revision number captured.
 *
 * @param channelId the incident channel's id
 * @returns `^pm-<channel id lowered>-r(<n>)$`
 */
export function postmortemCardIdPattern({ channelId }: { channelId: string }): RegExp {
  return channelRevisionPattern({ channelId, kind: POSTMORTEM_KIND });
}

/**
 * The next revision of one incident's postmortem card, and the open revision it supersedes.
 *
 * @param channelId the incident channel's id
 * @param rows every row the hand register holds
 * @returns the revision, or the refusal when more than one revision is open
 */
export function nextPostmortemRevision({
  channelId,
  rows,
}: {
  channelId: string;
  rows: readonly HandRow[];
}): Result<IncidentRevision, IncidentPostmortemError> {
  const folded = nextChannelRevision({ channelId, kind: POSTMORTEM_KIND, rows });
  if (folded.kind === "ambiguous") {
    return err(IncidentPostmortemErrors.revisionsOpen({ open: folded.open }));
  }
  return ok(folded.revision);
}

/**
 * The card's headline — the meaning first, then the one question, the incident's reference after it.
 *
 * `meaning` is at most 62 characters (`./findingFields.ts`'s cap) and the reference at most 10 (`INC-` and six
 * digits), so this is at most 120, `../hand/step.ts`'s `what` cap. "should we" is the go-ahead phrase a decision may
 * sit under (`../hand/decision.ts`).
 *
 * @param meaning what the incident meant for people
 * @param reference incident.io's `INC-<n>`
 * @returns the step's `what`
 */
export function postmortemQuestion({ meaning, reference }: { meaning: string; reference: string }): string {
  return `${meaning}: should we send this to join the postmortem (${reference})?`;
}

/**
 * The meeting line: when it is and who runs it, or that nobody has scheduled it yet.
 *
 * @param meeting the form's meeting
 * @returns one line
 */
function postmortemMeetingLine({ meeting }: { meeting: PostmortemMeeting }): string {
  if (meeting.state === "scheduled") {
    return `Meeting: ${meeting.atIso}, run by ${meeting.runBy.name}`;
  }
  return `Meeting: not scheduled yet; ${meeting.runBy.name} runs it`;
}

/**
 * The detail lines behind the disclosure row: the briefing first, then the meeting, who is in the room, the links,
 * and the reply the owner would send last.
 *
 * @param form the checked form
 * @param briefingUrl where the briefing page opens
 * @returns the lines, in that order
 */
function postmortemDetails({
  form,
  briefingUrl,
}: {
  form: IncidentPostmortemForm;
  briefingUrl: string;
}): readonly string[] {
  return [
    `Briefing: ${briefingUrl}`,
    postmortemMeetingLine({ meeting: form.meeting }),
    `${IN_THE_ROOM}${form.stakeholders.join(", ")}`,
    `Reply for #${form.channel.name}: ${form.askDraft}`,
  ];
}

/**
 * Why the parked reply is not the ask this card is about, or `undefined` when it is.
 *
 * Five checks, each a way a reply could read right and still be the wrong one: it is still held (a released or
 * dropped reply is no longer the owner's to send), it goes out in their name (the ask is theirs to join, never the bot's), it
 * lands in this incident's channel, it tags whoever runs the postmortem, and this card's row raised it. Ahead of all
 * five, ANY register line this version could not read refuses outright: the fold passed over it, so what it would
 * have said is unknown, and which draft it names is a guess too — a line that is not valid UTF-8 loses its id
 * entirely, and a hand-edited one can carry this reply's id in a spelling the broken-line reader misses while another
 * draft's id is the one it finds. A card that asks to send in the owner's name waits for
 * the register to read whole; the price, stated, is that one broken line about another draft holds every postmortem
 * card until it is repaired.
 *
 * @param form the checked form
 * @param item the draft register's fold of the reply the form names, `undefined` when the register holds none
 * @param skipped every register line the fold passed over
 * @returns the refusal, or `undefined` when the reply is this card's ask
 */
export function askDraftMisplaced({
  form,
  item,
  skipped,
}: {
  form: IncidentPostmortemForm;
  item: SlackDraftItem | undefined;
  skipped: readonly SkippedSlackDraftLine[];
}): IncidentPostmortemError | undefined {
  const unread = skipped[0];
  if (unread !== undefined) {
    return IncidentPostmortemErrors.draftMisplaced({
      draft: form.askDraft,
      why: `cannot be vouched for while line ${String(unread.line)} of the draft register will not read — which draft that line records, and what, is unknown, so repair it first`,
    });
  }
  const why = askDraftFault({ form, item });
  return why === undefined ? undefined : IncidentPostmortemErrors.draftMisplaced({ draft: form.askDraft, why });
}

/**
 * {@link askDraftMisplaced}'s five checks, as the words its refusal ends on.
 *
 * @returns what is wrong with the reply, or `undefined` when nothing is
 */
function askDraftFault({
  form,
  item,
}: {
  form: IncidentPostmortemForm;
  item: SlackDraftItem | undefined;
}): string | undefined {
  if (item === undefined) {
    return "is not in the draft register — park it with `slopweaver slack draft record` first";
  }
  if (item.state !== "held") {
    return `is ${item.state}, so there is nothing left for the owner's yes to send`;
  }
  const { draft } = item;
  if (draft.actor !== undefined) {
    return "is parked as the bot — asking to join a meeting goes out in the owner's name";
  }
  if (draft.channel !== form.channel.id) {
    return `posts to ${draft.channel}, not the incident channel ${form.channel.id}`;
  }
  const facilitator = form.meeting.runBy;
  if (!draft.mentions.some((mention) => mention.target === facilitator.slackId)) {
    return `does not tag ${facilitator.name} (${facilitator.slackId}), who runs the postmortem`;
  }
  if (draft.row === undefined) {
    return `names no board row — park it with \`--row ${form.row}\``;
  }
  if (draft.row !== form.row) {
    return `was raised by ${draft.row}, not ${form.row}`;
  }
  return undefined;
}

/**
 * The hand step draft a postmortem card posts as — `buildHandStep` and `hand post`'s admission judge it.
 *
 * @param form the checked form
 * @param revision the revision this posting is
 * @param nowIso when it is posted
 * @param postedBy the session posting it
 * @param consoleBase the console origin the briefing page's viewer address is minted on
 * @returns the draft, whose `url` opens the briefing page
 */
export function postmortemStepDraft({
  form,
  revision,
  nowIso,
  postedBy,
  consoleBase,
}: {
  form: IncidentPostmortemForm;
  revision: IncidentRevision;
  nowIso: string;
  postedBy: string;
  consoleBase: string;
}): HandStepDraft {
  const briefingUrl = consoleViewerUrl({ consoleBase, slug: form.proof });
  const reference = form.channel.reference;
  return {
    cites: form.cites,
    decision: {
      lean: form.lean,
      options: [
        {
          option: "Yes — send the ask as written",
          tradeoff: `the room sees you ask to sit in on ${reference}'s postmortem, and ${form.meeting.runBy.name} sends the invite`,
        },
        {
          option: "No — skip this one",
          tradeoff: "the postmortem runs without you, and the briefing stays yours to read",
        },
      ],
      problem: `${reference}'s postmortem is a room you are not in yet.`,
      stakes: {
        blastRadius: `#${form.channel.name}`,
        risk: "one reply in your name in the incident channel, tagging the person who runs the postmortem",
        stillReal: form.stillReal,
      },
    },
    details: postmortemDetails({ briefingUrl, form }),
    id: revision.id,
    postedBy,
    postedIso: nowIso,
    quotes: form.quotes,
    row: form.row,
    unblocks: `you sitting in on ${reference}'s postmortem`,
    url: briefingUrl,
    what: postmortemQuestion({ meaning: form.meaning, reference }),
    witness: `slopweaver slack draft show ${form.askDraft}`,
  };
}

/** The instant a trial card is built at — any valid one; nothing about the trial is recorded. */
const TRIAL_ISO = "2026-01-01T00:00:00.000Z";

/**
 * A form, checked field by field and then as the card it composes: built through `buildHandStep` and judged by every
 * posting rule, so a form whose card `hand post` would refuse is refused AT THE FORM, naming why. The field checks
 * each mirror one hand-step rule; review passes each found a field that mirror missed (a second
 * sentence, a long stakeholder list, an unbounded fraction, a long cite, a long lean), and the trial build is what
 * makes the property hold by construction rather than by the mirror being complete.
 *
 * @param value whatever the form file carried
 * @param consoleBase the console origin the briefing page's viewer address is minted on
 * @returns the checked form, or the refusal naming the field or the rule the card would break
 */
export function checkedPostmortemCard({
  value,
  consoleBase,
}: {
  value: unknown;
  consoleBase: string;
}): Result<IncidentPostmortemForm, IncidentPostmortemError> {
  return checkedPostmortemForm({ value }).andThen((form) => {
    const draft = postmortemStepDraft({
      consoleBase,
      form,
      nowIso: TRIAL_ISO,
      postedBy: "supervisor",
      revision: { id: `pm-${form.channel.id.toLowerCase()}-r1` },
    });
    const built = buildHandStep({ draft });
    if (built.isErr()) {
      return err(
        IncidentPostmortemErrors.formInvalid({ field: "form", why: cardRefusal({ why: built.error.message }) }),
      );
    }
    const refused = postingRefusal({ step: built.value });
    if (refused !== undefined) {
      return err(IncidentPostmortemErrors.formInvalid({ field: "form", why: cardRefusal({ why: refused.message }) }));
    }
    return ok(form);
  });
}

/** The words a trial-build refusal ends on. */
function cardRefusal({ why }: { why: string }): string {
  return `composes a card \`hand post\` would refuse: ${why}`;
}
