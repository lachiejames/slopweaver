/**
 * `--dry-run`: render every step of the composite send, perform none of them, and WARN.
 *
 * Two rules govern this file.
 *
 * **Warnings never block.** They are advisory by owner decision, printed at preview time and never
 * enforced at send time. That is the lesson from the old system's style gate, which blocked
 * legitimate work — quoting a ticket title that happened to contain an em-dash — and had to be torn
 * out. A warning tells you something; a rejection stops you. This BOT-card preview rejects only shape. The
 * separate `--as me` seam may refuse private exact voice rules before either preview or send.
 *
 * **Dry-run is byte-identical to the real send, with exactly one stated exception.** `file_ids` do
 * not exist until the upload runs, so the `chat.update` step renders `<file-id-N>` placeholders.
 * That divergence is called out in the output itself, so nobody mistakes a placeholder for a value.
 * Everything else — the uploads, the card, the metadata — is exactly what would go on the wire.
 */
import { runSequencesOf } from "../artifact/runs.js";
import type { InlineRun, UpdateArtifact } from "../artifact/types.js";

/** An advisory finding. Never fatal, never a reason to refuse a send. */
export interface DryRunWarning {
  readonly code: string;
  readonly message: string;
}

/**
 * Text that LOOKS like markdown emphasis and will therefore render as literal punctuation.
 *
 * GLOBAL on purpose: without `g` only the FIRST lookalike in a text run was ever reported, so a paragraph
 * written entirely in markdown produced one warning and the author fixed one span. Consumed with
 * `matchAll` (never `exec`) so no `lastIndex` state leaks between runs.
 *
 * A regex is the right tool here and there is no library alternative: this is a text-pattern job on our
 * OWN authored prose, not a Slack data type. (`@slack/types` ships no runtime validators at all, and
 * `@slack/web-api` exports only clients, errors and retry policies.)
 */
const MARKDOWN_LOOKALIKE = /(\*[^*\n]+\*)|(_[^_\n]+_)|(~[^~\n]+~)|(`[^`\n]+`)/g;

/**
 * An `@handle` typed into PLAIN TEXT, which pings nobody.
 *
 * Measured live: a text run reading `@some-bot` renders as those literal characters — it looks like a
 * mention in the transcript, notifies no one, and fires no listener. The author only learns this if someone
 * reports never being tagged, which is the worst possible feedback loop. A real mention is a `mention` RUN,
 * so this is a lookalike in exactly the same sense as the markdown pattern above and is warned the same way.
 *
 * Deliberately narrow: it requires a word boundary before the `@` and at least two handle characters, so an
 * email address (already matched as `local@domain`, no leading boundary) and a bare `@` do not warn. GLOBAL
 * and consumed with `matchAll`, for the same reason as above.
 */
const INERT_MENTION = /(?:^|[\s(])@([A-Za-z0-9][A-Za-z0-9._-]+)/g;

/** Every plain-text run in the artifact, with a human-readable path for the warning message. */
function plainTextRuns({ artifact }: { artifact: UpdateArtifact }): readonly { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const scan = ({ runs, path }: { runs: readonly InlineRun[]; path: string }): void => {
    runs.forEach((run, index) => {
      if (run.type === "text") {
        out.push({ path: `${path}[${index}]`, text: run.text });
      }
    });
  };
  out.push({ path: "tldr", text: artifact.tldr });
  artifact.detail.forEach((block, index) => {
    runSequencesOf({ block }).forEach((runs, seq) => {
      scan({ path: `detail[${index}][${seq}]`, runs });
    });
  });
  return out;
}

/**
 * The advisory warnings for one artifact.
 *
 * @param artifact the validated artifact
 * @returns every warning, in a stable order; empty when there is nothing to say
 */
export function dryRunWarnings({ artifact }: { artifact: UpdateArtifact }): readonly DryRunWarning[] {
  const warnings: DryRunWarning[] = [];
  if (artifact.citations.length === 0) {
    warnings.push({
      code: "no-citations",
      message:
        "this update carries no citations — nothing in it is independently verifiable. " +
        "Advisory only; the send will proceed.",
    });
  }
  for (const { path, text } of plainTextRuns({ artifact })) {
    for (const hit of text.matchAll(MARKDOWN_LOOKALIKE)) {
      warnings.push({
        code: "markdown-in-plain-text",
        message:
          `${path} contains ${JSON.stringify(hit[0])} at offset ${String(hit.index)}, which will render as ` +
          "LITERAL punctuation — rich_text does not parse markdown. Did you mean a bold/italic/code span?",
      });
    }
    for (const hit of text.matchAll(INERT_MENTION)) {
      warnings.push({
        code: "inert-mention-in-plain-text",
        message:
          // `hit[1]` is the handle group, which cannot be absent when the pattern matched at all.
          `${path} contains ${JSON.stringify(`@${hit[1]!}`)} at offset ${String(hit.index)}, which is ` +
          "INERT — plain text pings nobody and fires no listener, however much it looks like a mention. Use a " +
          '`mention` run ({"type":"mention","person":"…"}) for a person, or a `group` run ' +
          '({"type":"group","handle":"…"}) for a whole user group; the resolved-mention count above tells you it worked.',
      });
    }
  }
  return warnings;
}

/** One step of the composite send, as it would be performed. */
export interface DryRunStep {
  readonly order: number;
  readonly api: string;
  readonly detail: string;
}

/**
 * Every step the real send would perform, in order, without performing any.
 *
 * It takes the payload's SHAPE rather than the payload, and that is what lets one function serve both bot
 * forms. The card's blocks live inside its one attachment wrapper and a no-fold message's live at top level
 * with no wrapper at all, so a parameter typed as either payload would have needed this function to know
 * which — while the only thing it ever reads off one is the two numbers and the event type.
 *
 * @param blockCount how many blocks the message is made of
 * @param wrappers how many attachment wrappers it carries — 0 for a no-fold message
 * @param metadataEventType the `metadata.event_type` the send would stamp
 * @param channel the destination channel id
 * @param mediaFilenames the files that would be uploaded, in caller order
 * @param threadTs the parent timestamp when replying in a thread
 * @returns the ordered steps, with the `file_ids` placeholder divergence made explicit
 */
export function dryRunSteps({
  blockCount,
  wrappers,
  metadataEventType,
  channel,
  mediaFilenames,
  threadTs,
}: {
  blockCount: number;
  wrappers: number;
  metadataEventType: string;
  channel: string;
  mediaFilenames: readonly string[];
  threadTs?: string | undefined;
}): readonly DryRunStep[] {
  const steps: DryRunStep[] = [];
  mediaFilenames.forEach((filename, index) => {
    steps.push({
      api: "files.uploadV2",
      detail: `upload ${JSON.stringify(filename)} PRIVATELY (channel_id omitted) -> <file-id-${index}>`,
      order: steps.length + 1,
    });
  });
  if (mediaFilenames.length > 0) {
    steps.push({
      api: "files.info",
      detail: `poll each upload until its mimetype is non-empty (${mediaFilenames.length} file(s))`,
      order: steps.length + 1,
    });
  }
  steps.push({
    api: "chat.postMessage",
    detail:
      `channel=${channel}${threadTs === undefined ? "" : ` thread_ts=${threadTs}`}, ` +
      `${String(wrappers)} wrapper(s), ${String(blockCount)} block(s), ` +
      `metadata.event_type=${metadataEventType}`,
    order: steps.length + 1,
  });
  if (mediaFilenames.length > 0) {
    const placeholders = mediaFilenames.map((_, index) => `<file-id-${index}>`).join(", ");
    steps.push({
      api: "chat.update",
      detail:
        `the SAME attachments plus file_ids=[${placeholders}] — this step is what attaches media. ` +
        "The placeholders are the ONE thing a dry run cannot show for real; everything above is byte-exact.",
      order: steps.length + 1,
    });
    steps.push({
      api: "conversations.history",
      detail: `read the message back and assert files.length === ${mediaFilenames.length}; delete the message if not`,
      order: steps.length + 1,
    });
  }
  return steps;
}
