/**
 * What the console voice is told the moment it relays the owner's steer, and the line the page journals once
 * `talk relay` has written its row.
 *
 * The voice never waits on a relay. Measured: every post took 4–8s, and the delegated turn held on it before saying a
 * word while the owner sat waiting (repro: the `sending` → `relayed` gaps,
 * `jq -r 'select(.kind=="relay") | "\(.atIso) \(.outcome)"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`): the voice only says
 * it has it and moves on to the next thing. So the model is handed {@link handedOffAnswer} at once and the post runs
 * behind it (`components/voice/relayAttempt.ts`).
 *
 * Nothing about the relay is SAID unless the owner asks. The owner does not want to be told whether the supervisor
 * has it or whether the voice is relaying it, because the supervisor reads the call live (`talk unread`, every word,
 * relayed or not). So the hand-off carries {@link SILENT_RELAY}, and where a steer went is read back through
 * `recent_steers` when the owner asks.
 *
 * Where it went is still split on the delivery the verb recorded ({@link relayedLine}). Five relays recorded a `failed`
 * delivery ("cmux could not list workspaces: … the connection closed") while the voice said "Got it, the supervisor
 * has it now". A row on the board is not the supervisor's chat: only a line cmux took into the chat — `typed`, or
 * `queued` behind a running turn — is the supervisor having it.
 */
import { isBag, num, str } from "./bag";
import { type DiscussFirstDecision, discussFirstSpeech } from "./discussFirst";
import type { CheckInCovers } from "./talkRelayRequestWire";

/** The delivery kinds that mean the line is in the supervisor's chat — the only two the voice may call reached. */
const REACHED_KINDS: ReadonlySet<string> = new Set(["typed", "queued"]);

/**
 * The instruction every hand-off opens with: say nothing about the relay, answer the owner, and when the owner is
 * being walked through items, end the same answer on the next unruled item or the current one's question. Exported so
 * the test can hold every hand-off to it.
 *
 * The answer is never "answer what the owner said, OR go on to the next item": walking the workstream candidates,
 * relay after relay ended on a bare acknowledgement ("That settles that one as superseded"), and the owner has to
 * ask for the next item six times and greet once before steering, to a voice that does not know they are ready for
 * the next thing
 * (repro: the owner's final segments,
 * `jq -r 'select(.kind=="segment" and .final and .who!="voice") | .text' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`).
 * The walk also covers a preference interview: a
 * recap ending "we'll relay exactly that", a silent relay, then nothing leaves the owner asking why the next question
 * never came.
 * Its one exception (`src/talk/alignmentQuestionLines.ts`): a steer on what something should become takes a few
 * alignment questions before the next item.
 * And a card the owner reads aloud themselves is never a walk (`src/talk/walkLines.ts`'s `HIS_READING_VOICE_LINES`):
 * a relay mid-reading followed by the next rule ignores what the owner just said. The same holds for any card open on
 * the owner's screen, just opened, read in silence or old: only the owner's word since it opened moves the voice off
 * it, a relayed steer included.
 */
export const SILENT_RELAY =
  "Say nothing about this relay unless the owner asks whether it landed: not that it was passed along, not whether " +
  "the supervisor has it: the owner knows the supervisor watches the call live. Answer what the owner said, and if you are " +
  "walking them through items or asking them a run of questions, end this same answer by putting something to " +
  "them: the next item or question they have not answered, or the current one again if they have not answered it " +
  "yet. Silence about the relay never silences the next question. Never end on an acknowledgement " +
  "while items remain, never on a further question about the item they just settled or on whether they are ready for " +
  "the next, and say 'that's the last one' when none do. The one exception: a steer on what something should " +
  "become is followed by its next alignment question, a concrete choice they left open, before the next item; " +
  "never past the count you said on one thing unless they asked for more themselves (a steer in an answer on a " +
  "different thing starts its own), and never once they said 'stop asking' or 'move on' on this call: the answer " +
  "to the last one says the card count a " +
  "check-in verdict on its rule held back, if one did, then the current item again if it is still " +
  "unanswered, else the next item. " +
  "If the owner also said an answer annoyed them and you cannot tell why, your one question about it is this whole " +
  "answer, and the rest waits for their reply. " +
  "A card open on their screen, however they read it, is not a walk: answer what they just said and stop, never its next section, rule, question or another card until, since " +
  "it opened, they rule it, ask what is next, or say they are done with it, whatever this note says after.";

/**
 * How a check-in walk ends, in both check-in clauses: without it, the verdict on the last card was told to read a
 * next check-in that does not exist, against {@link SILENT_RELAY}'s "that's the last one".
 */
const LAST_CHECK_IN = "If none is left, say 'that's the last one' instead.";

/**
 * Where both check-in clauses defer to {@link SILENT_RELAY}'s order: a verdict that also steers what the feature
 * should become ("not sound — make it auto-dismiss these when the evidence is stale") takes its alignment questions
 * before the next check-in, and one said with an unclear annoyance waits for that question's answer.
 * Either question ENDS the answer: "after whatever the note above puts first, say how many cards…" would let one
 * answer ask the first alignment question and read the next check-in too.
 */
const ALIGNMENT_FIRST =
  "When the note above puts a question first (an unclear annoyance's one question, or an alignment question their " +
  "words left owed), that question ends this answer and the rest waits for their answer to the last of them. " +
  "Otherwise ";

/**
 * What every hand-off says after {@link SILENT_RELAY}: there is nothing to wait for, so the answer goes on at once.
 * No id rides it, since a row's slug would be read aloud off a note that named it, and nothing says the work is not
 * done yet, which the owner already knows of a hand-off.
 */
const HANDED_OFF =
  "The owner's steer is handed to the supervisor in the background: nothing comes back to wait for, so carry on at once, " +
  "never a lookup to confirm it. If they ask whether the steer landed, recent_steers says where it went; one it does " +
  "not list yet has no known outcome, so say it may still be going through, never that it failed or landed. Never " +
  "read an id or a link aloud, never add that nothing has been done yet, and never say anything was sent, passed " +
  "along, delivered, done or handled, or that the supervisor has it. Never say whether it reached the supervisor " +
  "chat or only the board, in this answer or any later one, unless they ask whether it landed.";

/**
 * What the owner's words ask to be done outside the call, as `relay_steer` declared it
 * (`components/voice/talkToolRunArgs.ts`'s `relayOutwardOf`). A `slack-send` carries the link of the thread it goes
 * to, so the page can read what became of it and tell the owner.
 *
 * It is typed because a send approved aloud is not a send. Measured: the owner said "Love it. Send it" of a reply to
 * Seth, the hand-off told the voice a steer gets "a word or two ('got it')", and it said "Got it." and then "Yep, got
 * it. You approved the reply to Seth" while the as-me gates had held the reply — nothing was sent.
 */
export type RelayOutward =
  | { readonly kind: "none" }
  | { readonly kind: "other-outward" }
  | { readonly kind: "slack-send"; readonly url: string };

/**
 * The words the voice says the moment it hands off a Slack send — its act is pending, and the owner hears of it again only
 * if it does not go.
 */
export const SLACK_SEND_PENDING = "On it. I'll tell you if it doesn't go.";

/** The clause each outward act adds to {@link HANDED_OFF}: an act the owner asked for is pending until something says not. */
function outwardClause({ outward }: { outward: RelayOutward }): string {
  if (outward.kind === "slack-send") {
    return (
      ` The owner asked for a Slack send: say only "${SLACK_SEND_PENDING}" and go on. Never say it ` +
      "was sent, approved or done, and never 'got it' alone. You will be told only if it is held or fails, and you " +
      "tell them then; a send that goes is never said unasked. If they ask, read slack_send_outcome with the url and " +
      "since in checkSend."
    );
  }
  if (outward.kind === "other-outward") {
    return (
      " The owner asked for an act outside the call: say only 'On it' and go on. Never say it was " +
      "sent, done, merged, approved or handled, never 'got it' alone, and never promise to tell them when it is " +
      "done: nothing reports it back to you."
    );
  }
  return (
    " It asks for no act outside the call: answer what the owner said in a few words, then the next thing, unless the " +
    "note above makes one question the whole answer, or a card is open on their screen, where the answer ends " +
    "on their words."
  );
}

/** What a relay rules on beside the owner's words, when it does — so the hand-off says how the walk goes on. */
export type HandOffRuling =
  | { readonly kind: "check-in"; readonly covers: CheckInCovers }
  | { readonly kind: "candidate" }
  | { readonly kind: "triage"; readonly rewrite: boolean };

/**
 * The whole note when a relay puts the discuss-first question (`./discussFirst.ts`): the question is the answer, said
 * once and light, and nothing after it — not 'On it', not the next item — because the owner's answer to it decides what
 * happens. Exported so the test can hold the note to the exact sentence.
 *
 * @param thread whether the relay carried the thread the conversation would start in
 * @returns the note
 */
export function discussFirstNote({ thread }: { thread: boolean }): string {
  return (
    "Say nothing about this relay. The owner asked for a fix on a team repository and nothing on this call says the team " +
    `has discussed it, so your whole answer is this, said exactly once and lightly: "${discussFirstSpeech({ thread })}" ` +
    "Then stop and wait for the owner. Never read a link or an id aloud, never say anything was started, sent or done, and " +
    "never add the next item to this answer. The owner's answer stands either way: when the owner says go ahead, relay that with the " +
    "same fix_repo and it is not asked again; when the owner says they will raise it with the team first, relay that instead."
  );
}

/** The `slack_send_outcome` arguments a Slack send's hand-off carries: the thread, and the instant it was asked for. */
export interface CheckSend {
  readonly url: string;
  readonly since: string;
}

/**
 * The tool answer the model is handed the moment a relay is accepted, before its post has run. It carries no
 * outcome, because none exists yet: a check-in verdict is spoken as the cards its rule COVERS, which the model read
 * off the pack, never a count of cards cleared; a candidate ruling counts as ruled for the rest of the call, so
 * a fresh list that has not caught up with the post never re-offers it.
 *
 * @param ruling the check-in verdict or candidate ruling the relay carries, or `undefined` for a plain steer
 * @param outward what the owner's words ask to be done outside the call
 * @param sinceIso the instant the relay was accepted, which a Slack send's outcome is read after
 * @param discussFirst whether this relay puts the discuss-first question, which is then the whole answer
 * @returns the hand-off, with its note, and a Slack send's `slack_send_outcome` arguments
 */
export function handedOffAnswer({
  ruling,
  outward,
  sinceIso,
  discussFirst,
}: {
  ruling: HandOffRuling | undefined;
  outward: RelayOutward;
  sinceIso: string;
  discussFirst: DiscussFirstDecision;
}): {
  readonly handedOff: true;
  readonly note: string;
  readonly performed: false;
  readonly checkSend?: CheckSend;
} {
  if (discussFirst.kind === "put") {
    return { handedOff: true, note: discussFirstNote({ thread: discussFirst.thread !== undefined }), performed: false };
  }
  let clause = "";
  if (ruling?.kind === "check-in" && ruling.covers === "rule") {
    clause =
      ` The owner's verdict is being recorded on every card its rule covers, in the background. ${ALIGNMENT_FIRST}say in a ` +
      "few words how many cards the rule covers, from what you read them (never a count of cards cleared), then read " +
      `them the next check-in without waiting to be asked. ${LAST_CHECK_IN}`;
  } else if (ruling?.kind === "check-in") {
    clause =
      ` The owner's verdict is being recorded on that one card, in the background. ${ALIGNMENT_FIRST}read them the next ` +
      `check-in without waiting to be asked. ${LAST_CHECK_IN}`;
  } else if (ruling?.kind === "candidate") {
    clause =
      " The owner's ruling is being written onto the candidate in the background: count it as ruled for the rest of this " +
      "call, even if a fresh list still shows it open, and never offer it to them as open again.";
  } else if (ruling?.kind === "triage" && ruling.rewrite) {
    clause =
      " The card goes to be rewritten from the owner's words in the background; the pass does not wait for it. Say a word " +
      "or two, then call triage_next at once: it brings the card back first as soon as it is rewritten.";
  } else if (ruling?.kind === "triage") {
    clause =
      " The owner's triage call is on that card. Say a word or two, then call triage_next at once and give them the next card.";
  }
  const note = `${SILENT_RELAY} ${HANDED_OFF}${outwardClause({ outward })}${clause}`;
  if (outward.kind === "slack-send") {
    return { checkSend: { since: sinceIso, url: outward.url }, handedOff: true, note, performed: false };
  }
  return { handedOff: true, note, performed: false };
}

/**
 * The most of a delivery's reason the journalled line carries. The reason is cmux's own words and nothing bounds
 * them, and the line rides every batch of the call record.
 */
export const RELAY_WHY_MAX = 400;

/**
 * A reason as the answer carries it: its first {@link RELAY_WHY_MAX} characters, then an ellipsis when it was longer.
 * Counted in code points, so an emoji is one character and never split.
 *
 * @returns the reason, whole or cut
 */
export function cutWhy({ why }: { why: string }): string {
  const chars = Array.from(why);
  if (chars.length <= RELAY_WHY_MAX) {
    return why;
  }
  return `${chars.slice(0, RELAY_WHY_MAX).join("")}…`;
}

/** The slug and delivery out of `talk relay --json`'s report, each `undefined` when the report lacked it. */
export interface RelayReport {
  readonly slug: string | undefined;
  readonly deliveryKind: string | undefined;
  readonly deliveryDetail: string | undefined;
  /**
   * What became of the owner's verdict on a check-in (`src/cli/commands/talk/relayReport.ts`'s `ruling`): how many cards
   * it cleared, or why none — `undefined` when the relay was not a verdict on one.
   */
  readonly ruling: RelayRuling | undefined;
  /**
   * What became of the owner's ruling on a workstream candidate (`src/cli/commands/talk/relayCandidateRuling.ts`): written
   * onto the candidate, or why not — `undefined` when the relay was not a ruling on one.
   */
  readonly candidateRuling: RelayCandidateRuling | undefined;
}

/** The owner's verdict on a check-in as the verb recorded it, or why it recorded nothing. */
export type RelayRuling =
  | { readonly recorded: true; readonly cleared: number; readonly kind: string; readonly place: string }
  | { readonly recorded: false; readonly why: string };

/** The owner's ruling on a workstream candidate as the verb recorded it, or why the candidate is still open. */
export type RelayCandidateRuling =
  | { readonly recorded: true; readonly candidate: string; readonly reaction: string }
  | { readonly recorded: false; readonly candidate: string; readonly why: string };

/**
 * The candidate half of the report, when it carries one.
 *
 * @param value the report's `candidateRuling` field
 * @returns the ruling, or `undefined` when there is none or it is not the verb's shape
 */
function candidateRulingOf({ value }: { value: unknown }): RelayCandidateRuling | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const candidate = str({ bag: value, key: "candidate" });
  const reaction = str({ bag: value, key: "reaction" });
  if (value["recorded"] === true && candidate !== undefined && reaction !== undefined) {
    return { candidate, reaction, recorded: true };
  }
  const why = str({ bag: value, key: "why" });
  if (value["recorded"] === false && candidate !== undefined && why !== undefined) {
    return { candidate, recorded: false, why: cutWhy({ why }) };
  }
  return undefined;
}

/**
 * The ruling half of the report, when it carries one.
 *
 * @param value the report's `ruling` field
 * @returns the ruling, or `undefined` when there is none or it is not the verb's shape
 */
function rulingOf({ value }: { value: unknown }): RelayRuling | undefined {
  if (!isBag(value)) {
    return undefined;
  }
  const cleared = num({ bag: value, key: "cleared" });
  const kind = str({ bag: value, key: "kind" });
  const place = str({ bag: value, key: "place" });
  if (value["recorded"] === true && cleared !== undefined && kind !== undefined && place !== undefined) {
    return { cleared, kind, place, recorded: true };
  }
  const why = str({ bag: value, key: "why" });
  if (value["recorded"] === false && why !== undefined) {
    return { recorded: false, why: cutWhy({ why }) };
  }
  return undefined;
}

/**
 * The report out of `talk relay --json`'s stdout. It is the LAST JSON line: `handover register`, which the
 * verb runs, prints its own lines first.
 *
 * @param out the verb's stdout
 * @returns the slug and the delivery, each `undefined` when absent
 */
export function relayReportOf({ out }: { out: string }): RelayReport {
  for (const line of out.trim().split("\n").toReversed()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isBag(parsed)) {
      continue;
    }
    const delivery = parsed["delivery"];
    let deliveryKind: string | undefined;
    let deliveryDetail: string | undefined;
    if (isBag(delivery)) {
      deliveryKind = str({ bag: delivery, key: "kind" });
      deliveryDetail = str({ bag: delivery, key: "detail" });
    }
    return {
      candidateRuling: candidateRulingOf({ value: parsed["candidateRuling"] }),
      deliveryDetail,
      deliveryKind,
      ruling: rulingOf({ value: parsed["ruling"] }),
      slug: str({ bag: parsed, key: "slug" }),
    };
  }
  return {
    candidateRuling: undefined,
    deliveryDetail: undefined,
    deliveryKind: undefined,
    ruling: undefined,
    slug: undefined,
  };
}

/**
 * The one-line detail the transcript journals once the row is on the board, and whether its line reached the
 * supervisor's chat — only `typed` or `queued` does. A `held` relay has not yet: the chair's quiet batch names it two
 * minutes after the owner's last word (`src/talk/chairWake.ts`), and the detail says so rather than calling it lost.
 *
 * @param report the verb's report
 * @returns the transcript detail, and whether the line reached the supervisor's chat
 */
export function relayedLine({ report }: { report: RelayReport }): {
  readonly detail: string;
  readonly reachedChat: boolean;
} {
  let row = "a board row";
  if (report.slug !== undefined) {
    row = report.slug;
  }
  let why = "the relay reported no delivery";
  if (report.deliveryDetail !== undefined) {
    why = report.deliveryDetail;
  }
  why = cutWhy({ why });
  const reachedChat = report.deliveryKind !== undefined && REACHED_KINDS.has(report.deliveryKind);
  let cleared = "";
  if (report.ruling !== undefined) {
    cleared = report.ruling.recorded
      ? `; the owner's word on ${String(report.ruling.cleared)} check-in card(s)`
      : `; no ruling recorded: ${report.ruling.why}`;
  }
  if (report.candidateRuling?.recorded === true) {
    cleared += `; the owner's ruling on ${report.candidateRuling.candidate}`;
  } else if (report.candidateRuling?.recorded === false) {
    cleared += `; ${report.candidateRuling.candidate} still open: ${report.candidateRuling.why}`;
  }
  if (reachedChat) {
    return { detail: `relayed into the supervisor's chat as ${row}: ${why}${cleared}`, reachedChat };
  }
  if (report.deliveryKind === "held") {
    return {
      detail: `on the board as ${row}, held for the chair's next quiet batch, two minutes after the owner's last word: ${why}${cleared}`,
      reachedChat,
    };
  }
  return { detail: `on the board as ${row}, NOT in the supervisor's chat: ${why}${cleared}`, reachedChat };
}
