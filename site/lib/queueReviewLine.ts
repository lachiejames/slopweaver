/**
 * The "review before sending" line a Queue row prints, chosen by the row's register: `./reviewLine.ts` flattens and
 * cuts the text, and this picks which text a held reply, a post composed as the owner or a parked review sends.
 */
import type { QueueRow } from "./queueRows";
import { reviewOpening } from "./reviewDraftRows";
import { reviewLineOf } from "./reviewLine";
import { slackUnescaped, slackWireWords, type WireToken } from "./slackEscapes";
import {
  groupLabel,
  mentionLabel,
  type PersonLabel,
  type SlackPeople,
  taggedLabels,
  tokenAsSlackDraws,
} from "./slackPeople";

/**
 * The "review before sending" line for a row whose message goes out on the owner's word, or `undefined` for any other.
 *
 * A held reply, a post composed as the owner and a review parked under their name are the three; an ask, a hand step,
 * a pull request and an act send nothing when the owner acts on them. A post's text is Slack's wire text, read in one pass by
 * `slackWireWords`: its tags read as the names its card already prints, through the same {@link taggedLabels}; a
 * person the draft did not record is still named off the roster, and a group by {@link groupLabel} — its recorded
 * key, else its wire handle, else "a group", never its `S…` id; a link reads as its label, else its address (never the raw `<https://app.vanta.com/…|Change management procedure…` wire text); and Slack's escapes are
 * undone once. A held reply reads through {@link heldReplyLineOf}.
 *
 * @returns the flattened, shortened message
 */
export function reviewLineFor({ row }: { row: QueueRow }): string | undefined {
  if (row.record.kind === "draft") {
    return heldReplyLineOf({ text: row.record.draft.text });
  }
  if (row.record.kind === "post") {
    const { post } = row.record;
    const labels = taggedLabels({ mentions: post.mentions, people: post.people });
    const named = slackWireWords({
      drawToken: (token) => postTokenWords({ labels, mentions: post.mentions, people: post.people, token }),
      text: post.fallback,
    });
    return reviewLineOf({ text: named });
  }
  if (row.record.kind === "review") {
    return reviewLineOf({ text: reviewOpening({ review: row.record.review }) });
  }
  return undefined;
}

/** What a draft recorded for one tag: the key the author wrote, the id it notifies, and which kind. */
type RecordedMention = { readonly key: string; readonly target: string; readonly kind: string };

/** A person mention's target as Slack's wire text spells it, the `@U…` of `<@U…>`. */
const WIRE_PERSON = /^@([UW][A-Z0-9]+)$/u;

/** A user-group mention's target as Slack's wire text spells it, the `!subteam^S…` of `<!subteam^S…|@handle>`. */
const WIRE_GROUP = /^!subteam\^([A-Z0-9]+)$/u;

/**
 * One token of a post's wire text as its line reads it: a recorded person by the card's own label, an unrecorded one
 * off the roster, a group by {@link groupWords}, and anything else — a link, a channel, a broadcast, a date — the way
 * Slack draws it, by {@link tokenAsSlackDraws}.
 */
function postTokenWords({
  token,
  labels,
  mentions,
  people,
}: {
  token: WireToken;
  labels: readonly PersonLabel[];
  mentions: readonly RecordedMention[];
  people: SlackPeople;
}): string {
  const person = WIRE_PERSON.exec(token.target);
  if (person !== null) {
    const at = mentions.findIndex((mention) => mention.kind === "person" && mention.target === person[1]);
    if (at !== -1) {
      return `@${labels[at].text}`;
    }
    return `@${mentionLabel({ id: person[1], people, recordedKey: undefined }).text}`;
  }
  const group = WIRE_GROUP.exec(token.target);
  if (group !== null) {
    return groupWords({ id: group[1], mentions, written: token.label });
  }
  return tokenAsSlackDraws({ people, token });
}

/**
 * One complete Slack token written into a held reply's words: a person (`<@U…|label>`), a group
 * (`<!subteam^S…|@handle>`) or a link (`<https://…|label>`, any scheme, `<mailto:|email>` included). It must close
 * with its `>`, and its address carries no space, so a `<` in prose (`p95 < 2s`) or a token cut short never matches.
 */
const HELD_TOKEN = /<(@[UW][A-Z0-9]+|!subteam\^S[A-Z0-9]+|[A-Za-z][A-Za-z0-9+.-]*:[^<>|\s]*)(?:\|([^<>]*))?>/gu;

/**
 * A held reply's review line. Its text is its form's words rather than Slack's wire text, so only complete Slack
 * tokens are read in it, in one pass, and nothing in it is unescaped — a `<` in the prose stays a `<` and a typed
 * `&amp;` stays as typed. A person reads as the label written with it, else its id; a group as its handle, else "a
 * group", never its `S…` id; a link as its label, else its address.
 *
 * @param text the held reply's flattened body
 * @returns the flattened, shortened line, or `undefined` when the reply has no words
 */
export function heldReplyLineOf({ text }: { text: string }): string | undefined {
  const named = text.replaceAll(HELD_TOKEN, (_whole, target: string, written: string | undefined) =>
    heldTokenWords({ target, written }),
  );
  return reviewLineOf({ text: named });
}

/** No roster reaches a held reply's line, so a person in it is named by what was written with it. */
const NO_ROSTER: SlackPeople = new Map();

/** One complete token of a held reply as its line reads it, every word taken verbatim. */
function heldTokenWords({ target, written }: { target: string; written: string | undefined }): string {
  if (target.startsWith("@")) {
    return `@${mentionLabel({ id: target.slice(1), people: NO_ROSTER, recordedKey: written }).text}`;
  }
  if (target.startsWith("!subteam^")) {
    const groupId = target.slice("!subteam^".length);
    return `@${groupLabel({ groupId, handle: written, recordedKey: undefined }).text}`;
  }
  if (written === undefined || written.trim() === "") {
    return target;
  }
  return written;
}

/**
 * One `<!subteam^S…|@handle>` of a post's wire text as the line reads it: the key the message recorded for that
 * group, else the handle the wire wrote, unescaped once, else "a group" — never its `S…` id.
 */
function groupWords({
  id,
  written,
  mentions,
}: {
  id: string;
  written: string | undefined;
  mentions: readonly RecordedMention[];
}): string {
  const recorded = mentions.find((mention) => mention.kind === "group" && mention.target === id);
  let handle: string | undefined;
  if (written !== undefined) {
    handle = slackUnescaped({ text: written });
  }
  let recordedKey: string | undefined;
  if (recorded !== undefined) {
    recordedKey = recorded.key;
  }
  return `@${groupLabel({ groupId: id, handle, recordedKey }).text}`;
}
