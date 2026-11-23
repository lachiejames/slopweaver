/**
 * Recovering a Notion AI meeting note's TRANSCRIPT, which `pages.retrieveMarkdown` deliberately leaves out.
 *
 * A meeting note is a `transcription` block with three children — summary, notes and transcript. The markdown
 * endpoint renders the first two and replaces the third with one fixed sentence pointing at the block:
 * "Transcript omitted. Use the view tool with the meeting note url (<page url>#<block id>) to view this
 * transcript." MEASURED on a real meeting-notes page: the markdown carried the
 * summary and notes and that sentence, while `blocks.children.list` on the transcript block returned 152
 * paragraphs, 37,040 characters of speech. Reproduce with
 * `slopweaver notion read <page-url> --json --nested-calls 2000` and count the blocks under
 * `transcription.children.transcript_block_id`.
 *
 * So the body is read as markdown as before, and only a page whose body carries that sentence pays for the
 * recovery: one `blocks.retrieve` to learn the transcript block's id, then the lane's block reader over it.
 */
import type { Client } from "@notionhq/client";

import { type IngestError, ingestErrorToThrowable } from "#lib/ingestError.js";
import { isRecord } from "#lib/parsers.js";
import { safeProviderCall } from "#lib/providerCall.js";
import { err, ok, type Result } from "#lib/result.js";

import type { GatedCall } from "./callDeadline.js";
import { canonicalNotionId } from "./canonicalId.js";
import type { NotionItemBudget } from "./itemCrawl.js";
import { renderBlocks } from "./liveBlocks.js";
import type { NotionMdNode } from "./markdownNodes.js";
import { classifyNotionSkip, type NotionSkip, skipIsFatal } from "./skips.js";

/** The sentence Notion's markdown writes in place of a transcript, capturing the meeting note's block id. */
const OMITTED_TRANSCRIPT =
  /Transcript omitted\. Use the view tool with the meeting note url \(https?:\/\/[^\s()#]+#([0-9a-f-]{32,36})\) to view this transcript\./gi;

/** One omitted transcript: every distinct sentence standing in for it, and the meeting note block it names. */
export interface OmittedTranscript {
  readonly sentences: readonly string[];
  readonly transcriptionId: string;
}

/**
 * Every omitted transcript in a body, one per meeting note in document order. Pure.
 *
 * Grouped by the canonical block id rather than the sentence, so a meeting note is read once however its url
 * is spelled, while every spelling is still kept for the splice to replace.
 *
 * @param text the body text the markdown projection produced
 * @returns one entry per meeting note whose transcript the markdown left out
 */
export function omittedTranscripts({ text }: { text: string }): readonly OmittedTranscript[] {
  const found = new Map<string, Set<string>>();
  for (const match of text.matchAll(OMITTED_TRANSCRIPT)) {
    const transcriptionId = canonicalNotionId({ id: match[1]!.replaceAll("-", "") });
    if (transcriptionId === undefined) {
      continue;
    }
    const sentences = found.get(transcriptionId);
    if (sentences === undefined) {
      found.set(transcriptionId, new Set([match[0]]));
    } else {
      sentences.add(match[0]);
    }
  }
  return [...found].map(([transcriptionId, sentences]) => ({ sentences: [...sentences], transcriptionId }));
}

/**
 * The transcript child's block id off a retrieved `transcription` block, or undefined. Pure.
 *
 * Undefined for any other block type, and for a meeting note that has no transcript child yet — a recording
 * still being processed carries its summary block before its transcript one.
 *
 * @param block the raw `blocks.retrieve` response
 * @returns the transcript block's id, or undefined
 */
export function transcriptBlockIdOf({ block }: { block: unknown }): string | undefined {
  if (!isRecord(block) || block["type"] !== "transcription" || !isRecord(block["transcription"])) {
    return undefined;
  }
  const children = block["transcription"]["children"];
  if (!isRecord(children) || typeof children["transcript_block_id"] !== "string") {
    return undefined;
  }
  return children["transcript_block_id"];
}

/**
 * A body with each recovered transcript put where Notion's omission sentence stood. Pure.
 *
 * The same replacement runs over the text AND every text node of the tree, so a later re-derivation from the
 * stored tree renders the transcript too rather than the sentence that replaced it.
 *
 * @param recovered each omission sentence, mapped to the transcript text that replaces it
 * @returns the text and tree with every recovered sentence replaced
 */
export function spliceTranscripts({
  text,
  tree,
  recovered,
}: {
  text: string;
  tree: readonly NotionMdNode[];
  recovered: readonly { sentence: string; transcript: string }[];
}): { text: string; tree: readonly NotionMdNode[] } {
  const bySentence = new Map(recovered.map(({ sentence, transcript }) => [sentence, transcript]));
  // ONE pass with a function replacer: an inserted transcript is never re-scanned, so nothing said in it is
  // rewritten, and a `$&` someone said is kept literally rather than read as a pattern.
  const replace = ({ value }: { value: string }): string =>
    value.replace(OMITTED_TRANSCRIPT, (sentence) => {
      const transcript = bySentence.get(sentence);
      return transcript === undefined ? sentence : `Transcript:\n\n${transcript}`;
    });
  const spliceNode = (node: NotionMdNode): NotionMdNode => {
    if (node.kind === "text") {
      return { ...node, text: replace({ value: node.text }) };
    }
    if ("children" in node) {
      return { ...node, children: node.children.map(spliceNode) };
    }
    return node;
  };
  return { text: replace({ value: text }), tree: tree.map(spliceNode) };
}

/** One `blocks.retrieve` call, gated and safe-wrapped. The sole new provider boundary in this module. */
async function retrieveBlock({
  client,
  call,
  scopeId,
  blockId,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  blockId: string;
}): Promise<Result<unknown, IngestError>> {
  const result = await safeProviderCall({
    execute: () => call(() => client.blocks.retrieve({ block_id: blockId })),
    operation: "notion.blocks.retrieve",
    provider: "notion",
    retryMode: "transient",
    scopeId,
  });
  return result.isErr() ? err(result.error) : ok(result.value);
}

/** The skip for a failed meeting-note read, or a THROW for the one class that must abort the run. */
function transcriptFailureSkip({ error }: { error: IngestError }): NotionSkip {
  const reason = classifyNotionSkip({ error });
  if (skipIsFatal({ reason })) {
    throw ingestErrorToThrowable({ error });
  }
  return { operation: error.operation, reason, subject: "meeting transcript" };
}

/**
 * Read back every transcript a page's markdown omitted and splice it into the body.
 *
 * Bounded by the item's shared allowance like every other read the item makes. A meeting note that cannot be
 * read, or has no transcript child, keeps Notion's sentence and records a skip, so the capture says it is
 * partial rather than looking whole.
 *
 * @param text the body text the markdown read produced
 * @param tree the parsed body tree the markdown read produced
 * @param itemBudget the allowance this item's whole capture shares
 * @returns the body with each recovered transcript in place, and every skip on the way
 */
export async function recoverOmittedTranscripts({
  client,
  call,
  scopeId,
  itemBudget,
  text,
  tree,
}: {
  client: Client;
  call: GatedCall;
  scopeId: string;
  itemBudget: NotionItemBudget;
  text: string;
  tree: readonly NotionMdNode[];
}): Promise<{ text: string; tree: readonly NotionMdNode[]; skips: readonly NotionSkip[] }> {
  // Checked before any scan, so a page with no meeting note does no work here at all.
  if (text.search(OMITTED_TRANSCRIPT) === -1) {
    return { skips: [], text, tree };
  }
  const recovered: { sentence: string; transcript: string }[] = [];
  const skips: NotionSkip[] = [];
  for (const omitted of omittedTranscripts({ text })) {
    if (itemBudget.exhausted()) {
      skips.push({ operation: "notion.blocks.retrieve", reason: "item-deadline", subject: "meeting transcript" });
      break;
    }
    itemBudget.spendCall();
    const block = await retrieveBlock({ blockId: omitted.transcriptionId, call, client, scopeId });
    if (block.isErr()) {
      skips.push(transcriptFailureSkip({ error: block.error }));
      continue;
    }
    const transcriptId = transcriptBlockIdOf({ block: block.value });
    if (transcriptId === undefined) {
      skips.push({ operation: "notion.blocks.retrieve", reason: "unknown", subject: "meeting transcript" });
      continue;
    }
    const rendered = await renderBlocks({ blockId: transcriptId, call, client, depth: 0, itemBudget, scopeId });
    skips.push(...rendered.skips);
    if (rendered.text.length === 0) {
      // An empty transcript is one still being written: keep Notion's sentence and stay re-fetchable.
      skips.push({ operation: "notion.blocks.children.list", reason: "unknown", subject: "meeting transcript" });
      continue;
    }
    recovered.push(...omitted.sentences.map((sentence) => ({ sentence, transcript: rendered.text })));
  }
  return { ...spliceTranscripts({ recovered, text, tree }), skips };
}
