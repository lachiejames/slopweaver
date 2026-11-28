/**
 * The authoring file's proof-slot grammar, in both directions. A slot's section is one of three shapes: `reason:
 * <why>`; the line a screenshot proves, the picture and who ran it; or the line a quote proves, the output in a
 * fenced block, its source and who ran it. The shared cell helpers are `./authoringGrammar.ts`'s.
 */
import { cell, declined, linesOf, renderCodeBlock } from "./authoringGrammar.js";
import { imageAt, renderContent, renderImage } from "./authoringInline.js";
import type { ProofSlot } from "./types.js";

/** A reason slot's one line opens with this. */
const REASON_PREFIX = "reason: ";

/** A screenshot's or quote's last line names who ran it. */
const RUN_BY = /^run by: (owner|agent)$/;

/** A quote slot's source line opens with this. */
const SOURCE_PREFIX = "source: ";

/** A fence line alone: three or more backticks and a bare language word, nothing after. */
const FENCE_LINE = /^(`{3,})([A-Za-z0-9_+-]*)$/;

/**
 * A proof slot as its section's lines: `reason: <why>`; the line it proves, the picture and who ran it; or the line
 * it proves, the fenced output, its source and who ran it.
 *
 * @returns the section's lines
 */
export function renderProofSlotLines({ slot }: { slot: ProofSlot }): string {
  switch (slot.kind) {
    case "reason":
      return `${REASON_PREFIX}${renderContent({ content: slot.reason })}`;
    case "screenshot":
      return [
        renderContent({ content: slot.proves }),
        renderImage({ image: slot.image }),
        `run by: ${slot.runBy}`,
      ].join("\n");
    case "quote":
      return [
        renderContent({ content: slot.proves }),
        renderCodeBlock({ lang: slot.lang, text: slot.text }),
        `${SOURCE_PREFIX}${renderContent({ content: [slot.source] })}`,
        `run by: ${slot.runBy}`,
      ].join("\n");
  }
}

/** The four parts of a quote slot, in the order they are written. */
const QUOTE_SHAPE =
  "a quote is four parts: the line it proves, the output in a fenced block, " +
  '"source: [label](url)" or "source: `command`", and "run by: owner" or "run by: agent"';

/**
 * A quote slot's section, read structurally rather than by its non-blank lines, so the output comes back byte for
 * byte: the proves line, a fence alone on its line, everything up to the matching close, then two lines.
 */
function parseQuoteSlot({
  source,
  section,
}: {
  source: string;
  section: string;
}): Record<string, unknown> | { readonly error: string } {
  const where = `## ${section}`;
  const lines = source.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
  const opened = lines.length > 1 ? FENCE_LINE.exec(lines[1]!) : null;
  if (opened === null) {
    return { error: `${where}: ${QUOTE_SHAPE}, with no blank line before the fence` };
  }
  const closeAt = lines.findIndex((line, index) => index > 1 && line === opened[1]);
  if (closeAt < 0) {
    return { error: `${where}: an unclosed fenced code block — it opens with ${opened[1]!} but nothing closes it` };
  }
  const tail = lines.slice(closeAt + 1).filter((line) => line.trim().length > 0);
  const runBy = tail.length === 2 ? RUN_BY.exec(tail[1]!) : null;
  if (runBy === null || !tail[0]!.startsWith(SOURCE_PREFIX)) {
    return { error: `${where}: ${QUOTE_SHAPE}` };
  }
  const proves = cell({ source: lines[0]!, where });
  const sourceRuns = cell({ source: tail[0]!.slice(SOURCE_PREFIX.length), where: `${where} source` });
  if (declined(proves)) {
    return proves;
  }
  if (declined(sourceRuns)) {
    return sourceRuns;
  }
  const run = sourceRuns.length === 1 ? sourceRuns[0]! : undefined;
  if (run?.kind !== "link" && run?.kind !== "code") {
    return { error: `${where}: the source is one link or one code span alone, and "${tail[0]!}" is not` };
  }
  return {
    kind: "quote",
    lang: opened[2]!,
    proves,
    runBy: runBy[1],
    source: run,
    text: lines.slice(2, closeAt).join("\n"),
  };
}

/**
 * A proof slot's section, as the form's field.
 *
 * @param source the section's raw text
 * @param section the section header a decline names
 * @returns the zod candidate for the slot, or a decline naming the three shapes
 */
export function parseProofSlot({
  source,
  section,
}: {
  source: string;
  section: string;
}): Record<string, unknown> | { readonly error: string } {
  const lines = linesOf({ source });
  if (lines.length > 1 && FENCE_LINE.test(lines[1]!)) {
    return parseQuoteSlot({ section, source });
  }
  const shape = {
    error:
      `## ${section}: the section is one line "reason: <why there is no screenshot>"; three: the line the ` +
      'screenshot proves, "![alt](url)" (optionally "{width=N}") alone on its line, and "run by: owner" or "run by: ' +
      `agent"; or a quote: ${QUOTE_SHAPE}`,
  };
  if (lines.length === 1 && lines[0]!.startsWith(REASON_PREFIX)) {
    const reason = cell({ source: lines[0]!.slice(REASON_PREFIX.length), where: `## ${section}` });
    return declined(reason) ? reason : { kind: "reason", reason };
  }
  if (lines.length !== 3) {
    return shape;
  }
  const proves = cell({ source: lines[0]!, where: `## ${section}` });
  const image = imageAt({ rest: lines[1]! });
  const runBy = RUN_BY.exec(lines[2]!);
  if (declined(proves)) {
    return proves;
  }
  if (image !== undefined && "error" in image) {
    return { error: `## ${section} image: ${image.error}` };
  }
  if (image === undefined || image.length !== lines[1]!.length || runBy === null) {
    return shape;
  }
  return { image: image.run, kind: "screenshot", proves, runBy: runBy[1] };
}
