/**
 * The parts of a talk relay row the relay-words guard protects, read off one text — before a write and after it — and
 * the text an `Edit` would leave behind.
 *
 * A relay row carries the owner's words in four places a session once reworded by hand, all 38 rows of them: the
 * `summary:` value, the `ownerWords` quote group, the `# ` heading and the paragraph under the first `## ` heading
 * (`Work to dispatch` on a relay row). It also carries the voice's offer, every byte, between two markers
 * (`../talk/relayOfferRow.ts`). Each is read STRUCTURALLY — the heading is the first `# ` line of the body, the
 * paragraph is the whole first run of non-blank lines under the first `## ` — never by searching the text for the
 * words, which a settlement field may legitimately quote and a reword may move.
 *
 * Pure: strings in, values out.
 */
import { frontMatterFence, frontMatterLines, parseHandoverDoc } from "../handover/doc.js";
import { flatFields, flatValue } from "../handover/docFlat.js";
import { type HisWordsGroup, OWNER_WORDS_KEYS, OWNER_WORDS_STEER_KEY, ownerWordsView } from "../handover/hisWords.js";
import type { StatedWorkspace } from "../handover/workspace.js";
import { RELAY_OFFER_START_PREFIX } from "../talk/relayOfferRow.js";

/** What closes a relay-offer section, before the anchor. */
const RELAY_OFFER_END_PREFIX = "<!-- relay-offer:end ";

/** Every protected part of one relay row's text. */
export interface RelayRowProjection {
  readonly anchor: string | undefined;
  /** The row's own quote group as the board reads it. */
  readonly group: HisWordsGroup;
  /** Every raw value of the row's own quote group, in a fixed order — what "the group changed" compares. */
  readonly groupValues: string;
  /** Every raw value of the row's further steers, in a fixed order. */
  readonly steerValues: string;
  readonly summary: string | undefined;
  /** The text after `# ` on the body's first heading line. */
  readonly heading: string | undefined;
  /** The whole first paragraph under the body's first `## ` heading, its lines joined by a newline. */
  readonly askParagraph: string | undefined;
  /** Every line from the first relay-offer start marker to the last end marker, or `undefined` when there is none. */
  readonly offerBlock: string | undefined;
  /** The workspace the row states, with its reason — a binding of the summary's digest. */
  readonly workspace: StatedWorkspace | undefined;
}

/** The body's lines: everything after the front matter's closing fence line, or the whole text when it has none. */
function bodyLines({ text }: { text: string }): readonly string[] {
  const fence = frontMatterFence({ text });
  if (fence === undefined) {
    return text.replace(/\r\n/g, "\n").split("\n");
  }
  const afterClose = fence.normalised.indexOf("\n", fence.closeIndex + 1);
  if (afterClose === -1) {
    return [];
  }
  return fence.normalised.slice(afterClose + 1).split("\n");
}

/** The heading and the ask paragraph, read structurally off the body's lines. */
function bodySlots({ lines }: { lines: readonly string[] }): {
  heading: string | undefined;
  askParagraph: string | undefined;
} {
  const headingAt = lines.findIndex((line) => line.startsWith("# "));
  let heading: string | undefined;
  if (headingAt !== -1) {
    heading = lines[headingAt]!.slice(2);
  }
  const sectionAt = lines.findIndex((line, at) => at > headingAt && line.startsWith("## "));
  if (sectionAt === -1) {
    return { askParagraph: undefined, heading };
  }
  return { askParagraph: paragraphFrom({ lines, after: sectionAt }), heading };
}

/** A CommonMark ATX heading: up to three spaces, one to six `#`, then whitespace or the end. `#word` is paragraph text. */
const ATX_HEADING = /^ {0,3}#{1,6}(?:\s|$)/;

/** Whether a line can sit inside a Markdown paragraph — not blank, and not a heading. */
function isParagraphLine({ line }: { line: string }): boolean {
  return line.trim().length > 0 && !ATX_HEADING.test(line);
}

/**
 * The WHOLE first paragraph after a line, its lines joined: a line appended directly under the ask is part of the
 * ask paragraph, so reading only its first line would let that reword through unjudged.
 */
function paragraphFrom({ lines, after }: { lines: readonly string[]; after: number }): string | undefined {
  const start = lines.findIndex((line, at) => at > after && isParagraphLine({ line }));
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex((line, at) => at > start && !isParagraphLine({ line }));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

/** Whether a line is a relay-offer marker LINE — a marker's text inside the owner's quoted words is not one. */
function isMarkerLine({ line, prefix }: { line: string; prefix: string }): boolean {
  return line.startsWith(prefix) && line.endsWith(" -->");
}

/** Every line from the first start marker to the last end marker — to the end of the text when none closes it. */
function offerBlockOf({ lines }: { lines: readonly string[] }): string | undefined {
  const start = lines.findIndex((line) => isMarkerLine({ line, prefix: RELAY_OFFER_START_PREFIX }));
  if (start === -1) {
    return undefined;
  }
  const end = lines.findLastIndex((line) => isMarkerLine({ line, prefix: RELAY_OFFER_END_PREFIX }));
  const stop = end < start ? lines.length - 1 : end;
  return `${lines.slice(start, stop + 1).join("\n")}\n`;
}

/** Every raw value under the keys a predicate selects, in a fixed order, as one comparable string. */
function rawValues({
  fields,
  selects,
}: {
  fields: ReadonlyMap<string, string>;
  selects: (args: { key: string }) => boolean;
}): string {
  const picked = [...fields].filter(([key]) => selects({ key })).toSorted(([one], [other]) => one.localeCompare(other));
  return JSON.stringify(picked);
}

/**
 * Read every protected part of one relay row's text.
 *
 * @param text the row's whole text
 * @param path the row's path, which the board's reader names it by
 * @returns the projection
 */
export function relayRowProjection({ text, path }: { text: string; path: string }): RelayRowProjection {
  const doc = parseHandoverDoc({ path, text });
  const flat = flatFields({ lines: frontMatterLines({ text }) });
  // Both spellings read as one, and a key declared in both spellings reads as changed only if a value does.
  const view = ownerWordsView({ duplicated: flat.duplicated, fields: flat.fields });
  const groupKeys: readonly string[] = OWNER_WORDS_KEYS;
  const because = flatValue({ fields: flat.fields, key: "workspaceBecause" });
  let workspace: StatedWorkspace | undefined;
  if (doc.workspace !== undefined && because !== undefined) {
    workspace = { because, workspace: doc.workspace };
  }
  const lines = bodyLines({ text });
  return {
    anchor: doc.anchor,
    group: doc.hisWords,
    groupValues: rawValues({ fields: view.fields, selects: ({ key }) => groupKeys.includes(key) }),
    offerBlock: offerBlockOf({ lines }),
    steerValues: rawValues({ fields: view.fields, selects: ({ key }) => OWNER_WORDS_STEER_KEY.test(key) }),
    summary: doc.summary,
    workspace,
    ...bodySlots({ lines }),
  };
}

/**
 * The text an `Edit` or `Write` would leave on disk, judged the way Claude Code performs it, or `undefined` when the
 * tool would refuse the call itself — so the guard never judges a state the tool will not write.
 *
 * An `Edit` needs a non-empty `old_string` that occurs exactly once, unless `replace_all` is set; the replacement is
 * literal, so a `$&` in the new text stays a `$&`.
 *
 * @param toolName `Write` or `Edit`
 * @param priorText the file as it is now
 * @param text the `Write`'s content, or the `Edit`'s `new_string`
 * @param replacedText the `Edit`'s `old_string`, `null` for a `Write`
 * @param replaceAll whether the `Edit` replaces every occurrence
 * @returns the text after the call, or `undefined` when the tool would refuse it
 */
export function rowAfterWrite({
  toolName,
  priorText,
  text,
  replacedText,
  replaceAll,
}: {
  toolName: string;
  priorText: string;
  text: string;
  replacedText: string | null;
  replaceAll: boolean;
}): string | undefined {
  if (toolName === "Write") {
    return text;
  }
  if (replacedText === null || replacedText.length === 0) {
    return undefined;
  }
  const parts = priorText.split(replacedText);
  const occurrences = parts.length - 1;
  if (occurrences === 0 || (occurrences > 1 && !replaceAll)) {
    return undefined;
  }
  return parts.join(text);
}
