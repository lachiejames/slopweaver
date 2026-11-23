/**
 * The result document and its two renderings.
 *
 * The consumer is Claude in a session, so the human lane is not a pretty transcript — it is plain,
 * complete and cheap to parse, then it gets out of the way. Two things it must always carry:
 *
 *  - **`replyTarget`**, which is exactly the `--channel`/`--thread-ts` pair `slack reply` consumes, so the
 *    model can draft and send without re-parsing the permalink.
 *  - **`limitations`**, stating what was NOT retrieved and why. An attachment nobody mentions is
 *    indistinguishable from one that did not exist.
 *
 * **`messageCount` and `replyCount` always describe the WHOLE THREAD**, never the `messages` array. Those
 * are the same number on a full read and deliberately are not under `--since` or `--around`: the fetch is
 * complete either way, so the thread's size is a fact this document knows and should not throw away. What is
 * in `messages` is `selection.returned`. Recomputing either over a returned subset would make both false — and
 * `completeness.held`, which is derived from the complete fetch, would then disagree with them.
 */
import { slackTsToIso } from "../../lib/slackTs.js";
import { GLYPHLESS_LINE } from "../../pdf/limits.js";
import type { FileCompleteness, ThreadCompleteness, UnretrievableFile } from "./completeness.js";
import type { FileScopePreflight } from "./filePlan.js";
import type { ChannelMessageSummary, SlackNeighbourhood } from "./neighbourhood.js";
import type { SlackThreadTarget } from "./permalink.js";
import { describeSelection, selectionLine, type ThreadSelection } from "./selection.js";
import type { RetrievedFile, SkippedFile, VisibleSlackMessage } from "./types.js";

/** Copyable next reads. Present only when at least one context layer was deliberately bounded. */
interface SlackReadNavigation {
  readonly readWholeThread: string;
  readonly widenThread?: string;
  readonly widenChannel?: string;
}

/** Inputs assembled by the effectful reader into one stable result document. */
interface BuildThreadDocumentOptions {
  readonly target: SlackThreadTarget;
  readonly messages: readonly VisibleSlackMessage[];
  readonly threadMessageCount: number;
  readonly selection: ThreadSelection;
  readonly neighbourhood?: SlackNeighbourhood | undefined;
  readonly files: readonly RetrievedFile[];
  readonly skippedFiles: readonly SkippedFile[];
  readonly unretrievableFiles: readonly UnretrievableFile[];
  readonly limitations: readonly string[];
  readonly warnings: readonly string[];
  readonly observation: { readonly startedAt: string; readonly completedAt: string; readonly pageCount: number };
  readonly completeness: ThreadCompleteness;
  readonly fileCompleteness: FileCompleteness;
  readonly scopePreflight: FileScopePreflight;
}

/** What `slack read-thread` returns. */
export interface SlackThreadReadDocument {
  readonly schemaVersion: 1;
  readonly kind: "slopweaver.slack.read-thread";
  readonly thread: {
    readonly permalink: string;
    readonly workspace: string;
    readonly channel: string;
    readonly threadTs: string;
    /** The instant `threadTs` names — see `types.ts`'s `VisibleSlackMessage.tsIso` for why both are here. */
    readonly threadTsIso: string;
    /** The message the pasted link addressed — differs from `threadTs` when a reply was linked. */
    readonly addressedTs: string;
    /** The instant `addressedTs` names. */
    readonly addressedTsIso: string;
    readonly addressedReply: boolean;
  };
  /** Exactly what `slack reply` needs to answer in this thread. */
  readonly replyTarget: { readonly channel: string; readonly threadTs: string };
  readonly observation: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly pageCount: number;
    /** Always true: there is no success document where pagination was not exhausted. */
    readonly cursorExhausted: true;
  };
  /** Messages in the WHOLE thread, never the size of `messages` — see the module note. */
  readonly messageCount: number;
  /** Replies in the WHOLE thread ({@link messageCount} less its parent). */
  readonly replyCount: number;
  /**
   * What this read RETURNED, and against what. The discriminator is how a consumer tells a whole thread
   * from a deliberate subset without comparing counts and guessing.
   */
  readonly selection: ThreadSelection;
  /** Optional channel-visible context, independently bounded from the full-message thread layer. */
  readonly neighbourhood?: SlackNeighbourhood;
  /** Exact commands for agent-directed progressive disclosure. */
  readonly navigation?: SlackReadNavigation;
  /**
   * The independent completeness evidence — Slack's own `reply_count` against what this read holds.
   *
   * Separate from `observation` on purpose. That block is what OUR loop did (pages consumed, cursor
   * exhausted); this is what the PROVIDER says should exist. Keeping them apart is what lets a consumer tell
   * "our read broke" from "Slack's two figures disagree", which need different responses.
   */
  readonly completeness: ThreadCompleteness;
  /**
   * The ATTACHMENT evidence, kept separate from `completeness` above for the same reason `completeness` is
   * kept separate from `observation`: they are claims about different populations. A thread can be
   * message-complete and attachment-lossy, and one field carrying both would have to pick which.
   */
  readonly fileCompleteness: FileCompleteness;
  /** Whether this token was proven able to read attachments at all, BEFORE any byte was fetched. */
  readonly scopePreflight: FileScopePreflight;
  readonly messages: readonly VisibleSlackMessage[];
  readonly files: readonly RetrievedFile[];
  readonly skippedFiles: readonly SkippedFile[];
  /**
   * Attachments this read meant to fetch and could not, each naming the failing method and the reason.
   * Separate from `skippedFiles`: that list is policy, this one is failure, and only one of them is worth
   * retrying.
   */
  readonly unretrievableFiles: readonly UnretrievableFile[];
  readonly limitations: readonly string[];
  readonly warnings: readonly string[];
}

/** The canonical permalink for the exact message the caller addressed, not merely its thread parent. */
function addressedPermalink({ target }: { target: SlackThreadTarget }): string {
  const base = `${target.workspace}/archives/${target.channel}/p${target.addressedTs.replace(".", "")}`;
  return target.addressedReply ? `${base}?thread_ts=${target.threadTs}&cid=${target.channel}` : base;
}

/** One shell-safe command prefix over the provider-constrained permalink this reader constructed. */
function readCommand({ target }: { target: SlackThreadTarget }): string {
  return `slopweaver slack read-thread '${addressedPermalink({ target })}'`;
}

/** Add flags while keeping each independently selected layer unchanged unless that layer is being widened. */
function navigationOf({
  target,
  selection,
  neighbourhood,
}: {
  target: SlackThreadTarget;
  selection: ThreadSelection;
  neighbourhood: SlackNeighbourhood | undefined;
}): SlackReadNavigation | undefined {
  if (selection.mode !== "around" && neighbourhood === undefined) {
    return undefined;
  }
  const base = readCommand({ target });
  const currentThread = selection.mode === "around" ? ` --around ${String(selection.around)}` : "";
  const currentChannel = neighbourhood === undefined ? "" : ` --channel-around ${String(neighbourhood.around)}`;
  const widenThread =
    selection.mode === "around" && (selection.withheldBefore > 0 || selection.withheldAfter > 0)
      ? `${base} --around ${String(selection.around + 1)}${currentChannel}`
      : undefined;
  const widenChannel =
    neighbourhood !== undefined && (neighbourhood.withheldBefore > 0 || neighbourhood.withheldAfter > 0)
      ? `${base}${currentThread} --channel-around ${String(neighbourhood.around + 1)}`
      : undefined;
  return {
    readWholeThread: base,
    ...(widenThread === undefined ? {} : { widenThread }),
    ...(widenChannel === undefined ? {} : { widenChannel }),
  };
}

/**
 * Assemble the document from the finished stages.
 *
 * @param target the resolved thread
 * @param messages the messages this read RETURNS, parent first — the whole thread only on a full read
 * @param threadMessageCount messages in the whole thread, which is not `messages.length` under `--since`
 * @param selection what this read returned and against what
 * @param neighbourhood optional bounded channel-visible context around the parent
 * @param files the attachments retrieved to disk
 * @param skippedFiles the attachments deliberately not retrieved
 * @param unretrievableFiles the attachments meant to be retrieved that have no bytes
 * @param limitations one sentence per skip class, plus one per unretrievable file
 * @param warnings non-fatal notes (e.g. a bot-token fallback, a count discrepancy, a scope gap)
 * @param observation the pagination evidence and timing
 * @param completeness the derived provider-count evidence
 * @param fileCompleteness the derived attachment evidence
 * @param scopePreflight the file-lane scope verdict
 * @returns the result document
 */
export function buildThreadDocument({
  target,
  messages,
  threadMessageCount,
  selection,
  neighbourhood,
  files,
  skippedFiles,
  unretrievableFiles,
  limitations,
  warnings,
  observation,
  completeness,
  fileCompleteness,
  scopePreflight,
}: BuildThreadDocumentOptions): SlackThreadReadDocument {
  const navigation = navigationOf({ neighbourhood, selection, target });
  return {
    completeness,
    fileCompleteness,
    files,
    kind: "slopweaver.slack.read-thread",
    // The selection's own caveat leads, because it describes what is ABSENT from `messages` — a reader who
    // stops after the first limitation must meet that one rather than a note about an attachment.
    limitations: [...describeSelection({ selection }), ...limitations],
    messageCount: threadMessageCount,
    messages,
    ...(navigation === undefined ? {} : { navigation }),
    ...(neighbourhood === undefined ? {} : { neighbourhood }),
    observation: { ...observation, cursorExhausted: true },
    replyCount: Math.max(0, threadMessageCount - 1),
    replyTarget: { channel: target.channel, threadTs: target.threadTs },
    schemaVersion: 1,
    scopePreflight,
    selection,
    skippedFiles,
    thread: {
      addressedReply: target.addressedReply,
      addressedTs: target.addressedTs,
      // `!` rather than a fallback: `parseSlackThreadPermalink` is the only producer of a
      // `SlackThreadTarget`, and it refuses any path segment that is not `p` + digits, so both of these
      // timestamps have already been shape-checked before they reach here.
      addressedTsIso: slackTsToIso({ ts: target.addressedTs })!,
      channel: target.channel,
      permalink: `${target.workspace}/archives/${target.channel}/p${target.threadTs.replace(".", "")}`,
      threadTs: target.threadTs,
      threadTsIso: slackTsToIso({ ts: target.threadTs })!,
      workspace: target.workspace,
    },
    unretrievableFiles,
    warnings,
  };
}

/**
 * The machine lane: exactly one JSON document.
 *
 * @param document the assembled thread document
 * @returns the indented JSON — ONE document rather than a stream, so a consumer can parse it in one read
 */
export function renderThreadJson({ document }: { document: SlackThreadReadDocument }): string {
  return JSON.stringify(document, null, 2);
}

/**
 * The one-line completeness reading: our count, Slack's advertised count, and the verdict naming which.
 *
 * `reply_count: —` rather than `0` when Slack advertised nothing, because the two are different claims and a
 * zero here would be a number this program made up.
 */
function completenessLine({ completeness }: { completeness: ThreadCompleteness }): string {
  const advertised = completeness.providerTotalObserved === null ? "—" : String(completeness.providerTotalObserved);
  return (
    `completeness: ${completeness.verdict} — holding ${String(completeness.held)}, ` +
    `Slack's reply_count advertises ${advertised} ` +
    `(${String(completeness.fetchedRaw)} rows fetched, ${String(completeness.repeatedRows)} repeated by Slack)`
  );
}

/**
 * The one-line attachment reading, printed on EVERY read for the same reason the message line is: a line that
 * appears only on loss teaches a reader that its absence means "checked and fine", when it could equally mean
 * the check never ran.
 */
function fileCompletenessLine({
  fileCompleteness,
  scopePreflight,
}: {
  fileCompleteness: FileCompleteness;
  scopePreflight: FileScopePreflight;
}): string {
  // "on the messages returned" rather than "in the thread", because under `--since` only the returned
  // messages have their attachments planned at all. On a full read the two populations are identical, so one
  // wording stays true in both modes rather than needing a branch that could disagree with the counts.
  return (
    `attachments: ${fileCompleteness.verdict} — ${String(fileCompleteness.observed)} seen on the messages ` +
    `returned, ${String(fileCompleteness.retrieved)} retrieved, ${String(fileCompleteness.skipped)} skipped ` +
    `by rule, ${String(fileCompleteness.unretrievable)} unretrievable (file scope: ${scopePreflight.verdict})`
  );
}

/**
 * What an attachment SAYS, printed under the line that says where it is.
 *
 * A path is not content. MEASURED: a thread read reported a 321,706-byte pentest report as a
 * local path and nothing else, and a session composing an answer from that read had no way to use it — the
 * bot cannot open a file mid-message. So a PDF's extracted text is inlined here, and a PDF with no text
 * layer says so with `GLYPHLESS_LINE` rather than printing nothing under its own line.
 *
 * @param file the retrieved attachment
 * @returns the lines to print under it, empty when there were no words to read
 */
function attachmentWords({ file }: { file: RetrievedFile }): readonly string[] {
  if (file.pdf?.glyphless === true) {
    return [GLYPHLESS_LINE];
  }
  if (file.text === undefined) {
    return [];
  }
  const pages = file.pdf === undefined ? "" : ` (${String(file.pdf.pages)} page(s))`;
  return [`--- text of ${labelOf({ file })}${pages} ---`, file.text.trimEnd(), "---"];
}

/**
 * The name a reader recognises an attachment by, or its id when Slack reported none.
 *
 * A returning `if` rather than a fallback operator, because the substitution is one this output makes
 * visible — `.claude/rules/typescript-patterns.md` § "No silent fallback".
 *
 * @param file the retrieved attachment
 * @returns the filename, or the file id
 */
function labelOf({ file }: { file: RetrievedFile }): string {
  if (file.name === undefined) {
    return file.fileId;
  }
  return file.name;
}

/**
 * One message as plain, unambiguous text.
 *
 * An unretrievable attachment is printed HERE, beside the message that carried it, and not only in the tail.
 * A model summarising this message needs to know its PDF is absent at the point it reads the message — a
 * limitation twenty messages further down is something it can carry on without noticing.
 */
function renderMessage({
  message,
  files,
  unretrievable,
}: {
  message: VisibleSlackMessage;
  files: readonly RetrievedFile[];
  unretrievable: readonly UnretrievableFile[];
}): string {
  const who = message.author.userId ?? message.author.username ?? message.author.botId ?? "unknown";
  const edited = message.editedTs === undefined ? "" : " (edited)";
  // The instant sits next to the `ts` rather than replacing it: a reader summarising the thread needs WHEN,
  // and a session composing a reply needs the `ts` itself. Printing only one of them is what forced the
  // hand-conversion `../../lib/slackTs.ts` documents.
  const head = `[${message.relation}] ${message.ts} (${message.tsIso}) ${who}${edited}`;
  const lines = [head, message.text.length > 0 ? message.text : "(no top-level text)"];
  if (message.blocks.length > 0) {
    lines.push(`blocks: ${JSON.stringify(message.blocks)}`);
  }
  if (message.attachments.length > 0) {
    lines.push(`attachments: ${JSON.stringify(message.attachments)}`);
  }
  for (const reaction of message.reactions) {
    lines.push(`reaction :${reaction.name}: x${String(reaction.count)}`);
  }
  for (const file of files.filter((f) => f.messageTs === message.ts)) {
    lines.push(`file ${file.name ?? file.fileId} (${file.mimetype ?? "unknown"}) -> READ THIS: ${file.localPath}`);
    lines.push(...attachmentWords({ file }));
  }
  for (const file of unretrievable.filter((f) => f.messageTs === message.ts)) {
    lines.push(
      `file ${file.name ?? file.fileId} (${file.mimetype ?? "unknown"}) -> NOT AVAILABLE (${file.reason}): ` +
        `${file.detail}. You are reading this message WITHOUT its content`,
    );
  }
  return lines.join("\n");
}

/** The stable raw author identity carried by a compact channel summary. */
function summaryAuthor({ summary }: { summary: ChannelMessageSummary }): string {
  return summary.author.userId ?? summary.author.username ?? summary.author.botId ?? "unknown";
}

/** Render one compact channel-visible candidate without pretending its preview is the complete body. */
function renderChannelSummary({ summary, side }: { summary: ChannelMessageSummary; side: "before" | "after" }): string {
  const metrics =
    `replies=${String(summary.replyCount)} blocks=${String(summary.blockCount)} ` +
    `attachments=${String(summary.attachmentCount)} files=${String(summary.fileCount)}`;
  const preview = summary.textPreview.length > 0 ? summary.textPreview : "(no top-level text)";
  return (
    `[channel ${side}] ${summary.ts} ${summaryAuthor({ summary })} ${metrics}\n` +
    `${preview}\n` +
    `text characters withheld=${String(summary.textWithheldCharacters)} permalink=${summary.permalink}`
  );
}

/** Render the independently bounded channel layer and its exact residue. */
function renderNeighbourhood({ neighbourhood }: { neighbourhood: SlackNeighbourhood }): readonly string[] {
  const line =
    `channel context around parent ${neighbourhood.anchorTs}: ` +
    `${String(neighbourhood.before.length)} before, ${String(neighbourhood.after.length)} after; ` +
    `${String(neighbourhood.withheldBefore)} older and ${String(neighbourhood.withheldAfter)} newer withheld; ` +
    `${String(neighbourhood.pageCount)} page(s), pagination exhausted`;
  return [
    line,
    ...neighbourhood.before.map((summary) => renderChannelSummary({ side: "before", summary })),
    ...neighbourhood.after.map((summary) => renderChannelSummary({ side: "after", summary })),
  ];
}

/**
 * The human/model lane. Leads with the counts and the reply target, then every message in order.
 *
 * @param document the assembled result
 * @returns the plain-text rendering
 */
export function renderThreadText({ document }: { document: SlackThreadReadDocument }): string {
  const { thread, observation } = document;
  const header = [
    `thread ${thread.channel} ${thread.threadTs}`,
    `permalink ${thread.permalink}`,
    `${String(document.messageCount)} messages (${String(document.replyCount)} replies) in the thread, ` +
      `${String(observation.pageCount)} page(s), pagination exhausted`,
    // Printed on EVERY read, full or not, for the reason the completeness line is: a line that appears only
    // in the partial case teaches a reader that its absence means "you have everything", when it could
    // equally mean nobody checked.
    selectionLine({ selection: document.selection }),
    // Printed on EVERY read, agreeing or not. A line that appears only on disagreement teaches a reader that
    // its absence means "checked and fine", when it equally means "there was no count to check against" —
    // which is the difference between `corroborated` and `unverified` and is the whole point of having both.
    completenessLine({ completeness: document.completeness }),
    fileCompletenessLine({
      fileCompleteness: document.fileCompleteness,
      scopePreflight: document.scopePreflight,
    }),
    // A live read is a point-in-time observation, not a lease on the thread. Pages are exhausted as of
    // `startedAt`; attachments then download, which on a heavily-attached thread takes long enough that
    // someone can reply in the gap. No amount of re-reading closes that window — a re-read races too —
    // so the honest move is to state the window rather than imply currency.
    `observed ${observation.startedAt} → ${observation.completedAt}; anything posted after that is not here`,
    `reply with: slopweaver slack reply --as me --channel ${thread.channel} --thread-ts ${thread.threadTs}`,
  ];
  if (thread.addressedReply) {
    const scope = document.selection.mode === "full" ? "the whole thread" : "the selected thread window";
    header.push(`note: the link pointed at reply ${thread.addressedTs}; ${scope} is below`);
  }
  if (document.navigation !== undefined) {
    header.push(`read whole thread with: ${document.navigation.readWholeThread}`);
    if (document.navigation.widenThread !== undefined) {
      header.push(`widen thread with: ${document.navigation.widenThread}`);
    }
    if (document.navigation.widenChannel !== undefined) {
      header.push(`widen channel with: ${document.navigation.widenChannel}`);
    }
  }
  const body = document.messages.map((message) =>
    renderMessage({ files: document.files, message, unretrievable: document.unretrievableFiles }),
  );
  const tail: string[] = [];
  for (const warning of document.warnings) {
    tail.push(`warning: ${warning}`);
  }
  for (const limitation of document.limitations) {
    tail.push(`limitation: ${limitation}`);
  }
  const context =
    document.neighbourhood === undefined
      ? []
      : [
          "",
          "CHANNEL CONTEXT (compact navigational summaries, not full message bodies)",
          ...renderNeighbourhood({ neighbourhood: document.neighbourhood }),
        ];
  return [...header, "", ...body, ...context, ...(tail.length > 0 ? ["", ...tail] : [])].join("\n");
}
