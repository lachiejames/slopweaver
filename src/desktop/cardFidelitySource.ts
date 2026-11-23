/**
 * The SOURCE a card-fidelity judgement is made against: exactly what the model was handed when it read or opened the
 * card — the `answer` of that `read_card`/`open_card` tool line (`src/talk/callToolLine.ts`, kept whole) — never the card as it stands later, which may have moved on. Pure.
 *
 * The answer is the console's own `{ card, links }` (`site/lib/queueVoice.ts`'s `CardForVoice`, `site/lib/openCard.ts`'s
 * `CardLinks`), which `src/` cannot import, so it is parsed here LENIENTLY and only for the fields a judgement reads: a
 * field absent or of another shape is simply not a claim unit, and an answer that is not that object at all is no
 * source, so the judgement says `not-measured` rather than scoring nothing as clean.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { safeJsonParse } from "#lib/safeJson.js";

/** One claim the card makes that an account of it should carry: its label and its words. */
export interface CardClaimUnit {
  /** `question`, `problem`, `what`, `option A`, `lean`, `if silent`, or a hand step's own row label. */
  readonly label: string;
  readonly text: string;
}

/** The card as the model was handed it, reduced to what a judgement reads. */
export interface CardSource {
  readonly key: string;
  /** sha256 of the exact answer string, so two surfaces are compared only over the same card text. */
  readonly digest: string;
  /** The card's question, word for word, or `undefined` when it carries none. */
  readonly question: string | undefined;
  /** Every claim unit, in the order the card draws them. */
  readonly claims: readonly CardClaimUnit[];
  /** The board slug `board_row` reads the card's briefing by, on an ask; `undefined` on any other card. */
  readonly boardSlug: string | undefined;
  /** Every local file the card names, which `file_read` takes: its attached briefing or plan files. */
  readonly files: readonly string[];
  /** The whole answer, for the figures check: a figure the model said must be somewhere it read. */
  readonly text: string;
}

/** A string field that is anything else reads as absent. */
const optionalText = z.string().optional().catch(undefined);

/** The fields of the console's card a judgement reads. */
const cardShape = z.object({
  boardSlug: optionalText,
  ifSilent: optionalText,
  key: z.string(),
  lean: optionalText,
  options: z
    .array(z.object({ letter: z.string(), sentence: z.string() }))
    .default([])
    .catch([]),
  problem: optionalText,
  question: optionalText,
  rows: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .default([])
    .catch([]),
  what: optionalText,
});

/** The fields of the console's links a judgement reads. */
const linksShape = z
  .object({
    files: z.array(z.string()).default([]).catch([]),
    pages: z
      .array(z.object({ file: z.string().optional().catch(undefined) }))
      .default([])
      .catch([]),
  })
  .default({ files: [], pages: [] })
  .catch({ files: [], pages: [] });

/** The answer as a whole. */
const answerShape = z.object({ card: cardShape, links: linksShape });

/**
 * Parse one card tool's answer into the source a judgement reads.
 *
 * @param answer the tool line's `answer`, exactly what the model was handed
 * @param cardKey the card the line named, which the answer's own key must be
 * @returns the source, or `undefined` when the answer is not JSON, not the console's card shape, or another card
 */
export function cardSourceOf({ answer, cardKey }: { answer: string; cardKey: string }): CardSource | undefined {
  let value: unknown;
  try {
    value = safeJsonParse({ label: "card tool answer", text: answer });
  } catch {
    return undefined;
  }
  const parsed = answerShape.safeParse(value);
  if (!parsed.success || parsed.data.card.key !== cardKey) {
    return undefined;
  }
  const { card, links } = parsed.data;
  const claims: CardClaimUnit[] = [];
  const push = ({ label, text }: { label: string; text: string | undefined }): void => {
    if (text !== undefined && text.trim() !== "") {
      claims.push({ label, text });
    }
  };
  push({ label: "question", text: card.question });
  push({ label: "problem", text: card.problem });
  push({ label: "what", text: card.what });
  for (const option of card.options) {
    push({ label: `option ${option.letter}`, text: option.sentence });
  }
  for (const row of card.rows) {
    push({ label: row.label, text: row.value });
  }
  push({ label: "lean", text: card.lean });
  push({ label: "if silent", text: card.ifSilent });
  const pageFiles = links.pages.flatMap((page) => (page.file === undefined ? [] : [page.file]));
  return {
    boardSlug: card.boardSlug,
    claims,
    digest: createHash("sha256").update(answer).digest("hex"),
    files: [...new Set([...links.files, ...pageFiles])],
    key: cardKey,
    question: card.question,
    text: answer,
  };
}
