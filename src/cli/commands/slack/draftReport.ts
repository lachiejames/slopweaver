/**
 * What `slack draft` PRINTS — pure, so every line a reader sees is testable by calling a function.
 *
 * The body is rendered from the parked PAYLOAD rather than from the form, through the same
 * `previewBlockLines` the as-me dry run uses. That is deliberate: the payload is what would reach Slack, and
 * a preview built from the source would be a second renderer able to disagree with the one that posts.
 */
import { heldOnApproval } from "../../../outbound/slack/draftApproval.js";
import { draftProofVerdict } from "../../../outbound/slack/draftProof.js";
import type { ParkedSlackDraft, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { draftBodyLines } from "../../../outbound/slack/draftText.js";
import { whySaysThreadReply } from "../../../outbound/slack/draftThreadWhy.js";
import { asMeChannelFinding, undeclaredKindNote } from "../../../outbound/slack/findingIdentity.js";
import type { DraftMediaEvidence } from "../../../outbound/slack/firstMessageProof.js";
import { comparisonMark, comparisonShowLines } from "./draftComparisonReport.js";

/** How much of the `--why` line fits on a list row before it starts wrapping in a normal terminal. */
const WHY_COLUMN = 52;

/**
 * How a HELD row goes out: the one command that sends it, or — for a top-level row whose why says thread reply —
 * the re-record the release demands instead, because both verbs refuse that row.
 */
export type DraftRelease =
  { readonly kind: "send"; readonly command: string } | { readonly kind: "re-record"; readonly why: string };

/** Shorten to a column width, marking that it happened. */
function fit({ text, width }: { text: string; width: number }): string {
  const oneLine = text.replaceAll(/\s+/g, " ").trim();
  if (oneLine.length <= width) {
    return oneLine;
  }
  return `${oneLine.slice(0, width - 1)}…`;
}

/** The channel as a reader names it: `#name` when the recording read could say, the raw id otherwise. */
function channelLabel({ item }: { item: SlackDraftItem }): string {
  const name = item.draft.channelName;
  if (name === undefined) {
    return item.draft.channel;
  }
  return `#${name}`;
}

/** Where it lands as a reader names it — the channel, or `thread in` the channel for a reply. */
function destinationLabel({ item }: { item: SlackDraftItem }): string {
  if (item.draft.shape === "thread") {
    return `thread in ${channelLabel({ item })}`;
  }
  return channelLabel({ item });
}

/**
 * The thread a reply goes under: its root `ts`, and who wrote it and what it said as the recording read it.
 * Empty for a top-level row.
 *
 * @returns the lines naming the parent
 */
function threadLines({ draft }: { draft: ParkedSlackDraft }): readonly string[] {
  if (draft.shape !== "thread" || draft.threadTs === undefined) {
    return [];
  }
  const parent = draft.threadParent;
  if (parent === undefined) {
    return [`thread   replies under ${draft.threadTs}`];
  }
  const author = parent.userId === undefined ? "" : ` (${parent.userId})`;
  return [`thread   replies under ${draft.threadTs}${author}: ${fit({ text: parent.text, width: 120 })}`];
}

/**
 * One list row: id, state, when, where it would go, and what it is for. A held row without its proof — a finding's, or
 * a first channel message's — reads `no-proof`, never `held`, with what it lacks: the Queue draws no card for it
 * (`./draftListDocument.ts`).
 *
 * @param item the folded row
 * @param media what each attachment under it is, for the first-message proof
 * @returns the row, as one line
 */
export function draftListRow({ item, media }: { item: SlackDraftItem; media: readonly DraftMediaEvidence[] }): string {
  const missing = item.state === "held" ? draftProofVerdict({ draft: item.draft, media }).missing : [];
  const proofMissing = missing.length > 0 ? `NO PROOF: ${missing.join(", ")}. ` : "";
  return [
    item.id.padEnd(12),
    (missing.length > 0 ? "no-proof" : item.state).padEnd(8),
    item.draft.tsIso,
    destinationLabel({ item }).padEnd(22),
    fit({
      text: `${proofMissing}${comparisonMark({ item })}${approvedMark({ item })}${item.draft.why}`,
      width: WHY_COLUMN,
    }),
  ].join("  ");
}

/**
 * The whole list, with a footer naming what was filtered out.
 *
 * The footer is not decoration, for the reason `queue list`'s is not: a list showing two held drafts out of
 * thirty resolved ones looks identical to a list of a two-row register, and a reader who cannot tell those
 * apart cannot tell a drained register from a filtered view of a full one.
 *
 * @param items every folded row, newest first
 * @param mediaOf what each attachment under a row is, for the first-message proof
 * @param showResolved whether released and dropped rows were included
 * @returns the lines to print, in order
 */
export function draftListLines({
  items,
  mediaOf,
  showResolved,
}: {
  items: readonly SlackDraftItem[];
  mediaOf: (args: { item: SlackDraftItem }) => readonly DraftMediaEvidence[];
  showResolved: boolean;
}): readonly string[] {
  const shown = showResolved ? items : items.filter((item) => item.state === "held");
  const hidden = items.length - shown.length;
  if (shown.length === 0) {
    if (hidden === 0) {
      return ["no parked drafts."];
    }
    return [`no HELD drafts — ${String(hidden)} already released or dropped. \`--all\` shows them.`];
  }
  const rows = shown.map((item) => draftListRow({ item, media: mediaOf({ item }) }));
  if (hidden === 0) {
    return rows;
  }
  return [...rows, "", `${String(hidden)} released or dropped draft(s) hidden — \`--all\` shows them.`];
}

/**
 * One draft, whole: where it goes, who it goes out as, what it says, what it attaches, and the digest an
 * approval binds.
 *
 * @param item the folded row
 * @returns the lines to print, in order
 */
export function draftShowLines({ item }: { item: SlackDraftItem }): readonly string[] {
  const { draft } = item;
  const head = [
    `${draft.id}  ${item.state}  ${draft.tsIso}`,
    `channel  ${channelLabel({ item })}  (${draft.channel})`,
    `as       ${authorLabel({ item })}`,
    `shape    ${draft.shape}`,
    ...threadLines({ draft }),
    ...(draft.act === undefined ? [] : [`act      ${draft.act}`]),
    ...(draft.row === undefined ? [] : [`row      ${draft.row}`]),
    `why     ${draft.why}`,
    `digest   ${draft.digest}`,
  ];
  const mentions =
    draft.mentions.length === 0
      ? ["mentions none"]
      : draft.mentions.map((mention) => `mentions ${mention.key} → ${mention.target} (${mention.kind})`);
  const advisory = draft.advisory.length === 0 ? [] : ["", "voice findings (advisory):", ...draft.advisory];
  const outcome = outcomeLines({ item });
  return [
    ...head,
    ...mentions,
    ...advisory,
    ...approvalLines({ item }),
    ...priorAskLines({ priorAsk: draft.priorAsk }),
    "",
    "— the message, exactly as it would post —",
    ...draftBodyLines({ payload: draft.payload }),
    ...mediaLines({ media: draft.media }),
    ...comparisonShowLines({ bodyOf: draftBodyLines, item }),
    ...outcome,
    ...releaseLines({ item }),
  ];
}

/**
 * What the row declared about asking before: the claim it never was, or our earlier message, the answers kept,
 * and the change with its proof or why the replies were no answer. Nothing for a row that
 * asks nothing.
 *
 * @returns the lines, after a blank separator
 */
function priorAskLines({ priorAsk }: { priorAsk: ParkedSlackDraft["priorAsk"] }): readonly string[] {
  if (priorAsk === undefined) {
    return [];
  }
  if (priorAsk.kind === "none") {
    return ["", "asked before: never (the recorder's declaration)"];
  }
  const folded = priorAsk.answerCount - priorAsk.answers.length;
  const lines = [
    "",
    `— asked before: ${priorAsk.permalink} —`,
    `ours     ${priorAsk.ours.text}`,
    ...priorAsk.answers.map((answer) => `answer   ${answerAuthor({ userId: answer.userId })}: ${answer.text}`),
    ...(folded > 0 ? [`         and ${String(folded)} more`] : []),
  ];
  if (priorAsk.changed !== undefined) {
    lines.push(`changed  ${priorAsk.changed}`);
    if (priorAsk.proof !== undefined) {
      lines.push(
        ...priorAsk.proof.map(
          (entry) => `proof    ${entry.name} · ${String(entry.bytes)} bytes · sha256 ${entry.sha256}`,
        ),
      );
    }
  }
  if (priorAsk.notAnswered !== undefined) {
    lines.push(`no answer because ${priorAsk.notAnswered}`);
  }
  return lines;
}

/**
 * The list row's lead for a row held on their yes, so a chair scanning the list sees what it owes a send.
 *
 * @returns `APPROVED · ` for a held approved row, else nothing
 */
function approvedMark({ item }: { item: SlackDraftItem }): string {
  const hold = item.state === "held" ? item.hold : undefined;
  if (hold !== undefined) {
    return `HELD ${hold.reason} · `;
  }
  return heldOnApproval({ item }) ? "APPROVED · " : "";
}

/**
 * Their yes the row carries and what it obliges, or the change that set one down, then why it is held when a session
 * said so. Nothing for a row awaiting their word.
 *
 * @returns the lines, after a blank separator
 */
function approvalLines({ item }: { item: SlackDraftItem }): readonly string[] {
  const held =
    item.hold === undefined
      ? []
      : [`held — ${item.hold.reason} at ${item.hold.atIso}: ${item.hold.why} — the Queue card shows them this`];
  return [...consentLines({ item }), ...(held.length > 0 ? ["", ...held] : [])];
}

/** Their yes the row carries and what it obliges, or the change that set one down. */
function consentLines({ item }: { item: SlackDraftItem }): readonly string[] {
  const { approval, meaningChanged } = item.draft;
  if (meaningChanged !== undefined) {
    return ["", `meaning changed since their yes: ${meaningChanged} — this cut waits for their word again`];
  }
  if (approval === undefined) {
    return [];
  }
  const inherited = approval.inheritedFrom === undefined ? "" : ` (carried from ${approval.inheritedFrom})`;
  const lines = [
    "",
    `— approved by them at ${approval.atIso}${inherited}: ${approval.anchor} —`,
    `heard    ${approval.heard}`,
  ];
  if (heldOnApproval({ item })) {
    lines.push(
      "their yes is the send: release it now. A mechanical fix (em-dash, drip split, wrong tag, lowercase, link) is",
      `yours without asking; re-cut with --supersedes ${item.id} and the approval carries. Only a change of meaning`,
      "or a thread that moved materially earns a second ask: re-cut with --meaning-changed <what>.",
    );
  }
  return lines;
}

/**
 * Who an earlier answer came from, as its row kept it.
 *
 * @returns the member id, or a plain phrase for an author Slack did not name
 */
function answerAuthor({ userId }: { userId: string | undefined }): string {
  if (userId === undefined) {
    return "an unnamed author";
  }
  return userId;
}

/**
 * Each stored attachment by name, size and SHA-256 — the three facts the digest binds — or nothing for a
 * text-only draft, which reads exactly as it always did.
 *
 * @returns the lines naming the attachments, after a blank separator
 */
function mediaLines({ media }: { media: ParkedSlackDraft["media"] }): readonly string[] {
  if (media === undefined || media.length === 0) {
    return [];
  }
  return [
    "",
    `— attached under it (${String(media.length)}), the stored bytes the digest binds —`,
    ...media.map((entry) => `${entry.name} · ${String(entry.bytes)} bytes · sha256 ${entry.sha256}`),
  ];
}

/**
 * The command that sends a held draft exactly as shown — the same one the console's queue card prints.
 *
 * The verb is the row's: `reply` for a thread row, `post` for a top-level one, and the release refuses the
 * other, so this is the only spelling that sends.
 *
 * @param item the folded row
 * @returns `slack post|reply --as me|bot --draft <id> --approve <digest>` for this row, as the row's own identity
 */
export function draftReleaseCommand({ item }: { item: Pick<SlackDraftItem, "draft" | "id"> }): string {
  const verb = item.draft.shape === "thread" ? "reply" : "post";
  const actor = item.draft.actor === "bot" ? "bot" : "me";
  return `slopweaver slack ${verb} --as ${actor} --draft ${item.id} --approve ${item.draft.digest}`;
}

/**
 * How a held row goes out — or, for a top-level row whose why says thread reply, that no verb will: the release
 * refuses it, and the only way into the thread is to re-record it.
 *
 * @param item the folded row
 * @returns the send command, or the re-record the release demands
 */
export function draftRelease({ item }: { item: Pick<SlackDraftItem, "draft" | "id"> }): DraftRelease {
  if (item.draft.shape === "top-level" && whySaysThreadReply({ why: item.draft.why })) {
    return {
      kind: "re-record",
      why:
        "parked top-level, but its why says thread reply — the release refuses it. Re-record it into its thread, " +
        `which spends this row and carries their yes: slopweaver slack draft record --thread-ts <root ts> --supersedes ${item.id}`,
    };
  }
  if (asMeChannelFinding({ draft: item.draft })) {
    return {
      kind: "re-record",
      why:
        `${undeclaredKindNote({ draft: item.draft })}a finding parked as them at the top level of a channel — the ` +
        "release refuses it: a finding shared in a channel posts as the bot. Re-record it " +
        `with --as bot, a finding form and --supersedes ${item.id}, which drops this row as the bot's cut parks.`,
    };
  }
  return { command: draftReleaseCommand({ item }), kind: "send" };
}

/** How to send a row that is still held, or why it cannot be. Empty once resolved. */
function releaseLines({ item }: { item: SlackDraftItem }): readonly string[] {
  if (item.state !== "held") {
    return [];
  }
  const release = draftRelease({ item });
  if (release.kind === "re-record") {
    return ["", `NOT SENDABLE: ${release.why}`];
  }
  return ["", `to send it as shown: ${release.command}`];
}

/** Who the send would go out as. The id is the honest answer: `auth.test` reports no display name. */
function authorLabel({ item }: { item: SlackDraftItem }): string {
  const author = item.draft.authorId;
  if (item.draft.actor === "bot") {
    if (author === undefined) {
      return "the bot (the bot token's own identity was not read)";
    }
    return `the bot (${author})`;
  }
  if (author === undefined) {
    return "you (the user token's own identity was not read)";
  }
  return `you (${author})`;
}

/** What happened to a row that is no longer held. Empty while it is still waiting on them. */
function outcomeLines({ item }: { item: SlackDraftItem }): readonly string[] {
  if (item.state === "held") {
    return [];
  }
  const outcome = item.outcome;
  if (outcome === undefined) {
    return ["", `${item.state} — no outcome recorded.`];
  }
  return ["", `${item.state}: ${outcome}`];
}

/**
 * What `record` prints once the draft is parked: what happened, and the two ways to look at it.
 *
 * The console URL is on this report because the console is where the owner reads a draft — a recorder that
 * parks a row and says only "parked" leaves them to guess which of the console's queue kinds it landed in.
 *
 * @param consoleUrl the deep link that opens this row in the console's slide-over
 * @param item the row as it was just written
 * @returns the lines to print, in order
 */
export function draftRecordedLines({
  consoleUrl,
  item,
}: {
  consoleUrl: string;
  item: SlackDraftItem;
}): readonly string[] {
  return [
    `parked ${item.id} — NOTHING was sent.`,
    ...draftShowLines({ item }),
    "",
    `read it in the console: ${consoleUrl}`,
    `or here: slopweaver slack draft show ${item.id}`,
  ];
}
