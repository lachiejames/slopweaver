/**
 * The handover doc's `summary:` size contract — the pure core behind the `handover start` refusal and the
 * `handover check` finding.
 *
 * ## Why the OTHER doc needed a gate too
 *
 * {@link ../supervisor/stateDoc.ts} caps the state doc a successor supervisor boots from, and that cap works:
 * MEASURED, the live state doc passes at 397 of its 400 lines. What it does not cap is the handover
 * doc beside it, and the accretion simply moved there — into `summary:`, a front-matter scalar nothing reads
 * end to end and nothing was measuring.
 *
 * MEASURED over every doc in the register (repro:
 * `for f in ~/.slopweaver/handovers/*.md; do python3 -c 'import re,sys;t=open(sys.argv[1]).read();m=re.match(r"^---\n(.*?)\n---\n",t,re.S);s=re.search(r"^summary: (?:\"(.*?)\"|(.*?))\n(?=[a-zA-Z]+:|\Z)",m.group(1),re.S|re.M);print(len(s.group(1) or s.group(2) or ""),sys.argv[1])' "$f"; done | sort -n`):
 *
 * - 1,641 docs declare a `summary:`. Of the 1,426 that are not a supervisor handoff, the LARGEST is 5,382
 *   bytes and the 99th percentile is 3,809 — a one-line field behaving exactly as {@link ../handover/doc.ts}
 *   documents it ("one line saying what the work is").
 * - The 215 supervisor handoff docs have a median of 13,479 bytes and a maximum of **560,851** — 95.6% of a
 *   586,940-byte file, carrying 66 nested copies of predecessor boot text, growing ~10 KB every shift.
 *
 * ## Why the cap is in BYTES, not lines
 *
 * The state doc's caps are line counts because a state doc is a document. A `summary:` is a YAML scalar, and
 * the measurement above found a median of ONE line across the whole register and a maximum of 24 — the
 * 560,851-byte field is 24 lines long. Line count cannot see this class at all, which is precisely why the
 * existing gate, pointed at the other doc and counting the other unit, reported green throughout.
 *
 * ## Why the token cost has stayed near zero, and why that is the defect rather than the reprieve
 *
 * A field this size is not free because anyone is reading it — it is free because nobody is. The harness
 * refuses to inline a half-megabyte file, so a seat that runs `cat` on its own boot doc gets a couple of
 * kilobytes of "Output too large" and reads fragments with `sed` instead. So the boot prompt's instruction to
 * read the doc end to end has quietly not been happening for dozens of shifts, and the day a seat widens its
 * `sed` range it inlines the lot. The cap is what makes the doc readable again, which is the actual repair;
 * the token bound it also buys is the side effect.
 *
 * ## What is measured, and what a writer measures instead
 *
 * {@link ../handover/doc.ts}'s flat front-matter reader is a hand parser rather than YAML — deliberately, for
 * reasons measured there — and `flatScalarCodec.ts`'s `decodeFlatScalar` strips a quoted `summary: "…"`'s two
 * quotes and decodes its JSON escapes, so this cap counts the VALUE, never longer than the written scalar. A WRITER composing a
 * summary out of text it does not control asks {@link summaryWrittenFit}, which measures the whole written
 * scalar: never shorter than what the cap counts, so a row it admits is one `handover start` opens. A talk relay
 * is that writer — its limits were UTF-16 characters, and a long multibyte dictation registered a row no seat
 * could start.
 *
 * Pure: no I/O at all. The CLI edge reads the file and prints; `handover start` reads it and refuses.
 */

/**
 * The per-doc `summary:` byte cap.
 *
 * Ratcheted from the measurement in this file's header rather than rounded to taste: it admits all 1,426
 * non-supervisor docs in the register with roughly 1.5x headroom over the largest honest one (5,382 bytes),
 * admits the supervisor docs from before the accretion began, and refuses every doc carrying a predecessor's
 * boot text. Bytes as `wc -c` counts them, so a refusal is checkable in one shell command.
 */
export const MAX_SUMMARY_BYTES = 8000;

/**
 * The one spelling a registered row's `summary:` is written in — `handover register` (`askRowText.ts`) writes
 * exactly this, so a writer measuring it measures what lands on the line.
 *
 * @param summary the value to write
 * @returns the double-quoted scalar, escapes included
 */
export function summaryScalar({ summary }: { summary: string }): string {
  return JSON.stringify(summary);
}

/**
 * Whether a summary, written as {@link summaryScalar} writes it, fits the cap `handover start` holds it to.
 *
 * Measures the WRITTEN scalar, quotes and escapes included, which is never shorter than the value the flat reader
 * unquotes (`docFlat.ts`) and the cap then counts — so a summary this admits is one `handover start` admits. A
 * writer that composes a row's summary out of text it did not author (a relay's transcript, say) asks this
 * before registering, because the limits it held that text to were characters, never bytes.
 *
 * @param summary the value about to be written
 * @returns the written scalar's UTF-8 size, and whether it is within {@link MAX_SUMMARY_BYTES}
 */
export function summaryWrittenFit({ summary }: { summary: string }): {
  readonly bytes: number;
  readonly fits: boolean;
} {
  const bytes = Buffer.byteLength(summaryScalar({ summary }), "utf8");
  return { bytes, fits: bytes <= MAX_SUMMARY_BYTES };
}

/**
 * A `summary:` that has outgrown the cap, measured against it.
 *
 * @internal — flows from {@link summaryCapOffence} into the refusal and the check finding, unnamed by callers.
 */
export interface SummaryCapOffence {
  /** The measured size, as `wc -c` counts it. */
  readonly bytes: number;
  /** The cap it exceeded. */
  readonly cap: number;
  /** The 1-based line the `summary:` key sits on, so a finding can point at it. */
  readonly line: number;
  /** A sentence naming what was measured and what to do about it. */
  readonly message: string;
}

/**
 * The 1-based line the front-matter's `summary:` key sits on.
 *
 * Falls back to line 1 rather than reporting an absence: a caller only asks once it already has a summary to
 * measure, so the key is present by construction and a wrong line number would be a worse answer than the top
 * of the file.
 *
 * @param text the doc's whole text
 * @returns the line the key is written on, or 1 when no line in the text starts with it
 */
export function summaryKeyLine({ text }: { text: string }): number {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.startsWith("summary:"));
  return index === -1 ? 1 : index + 1;
}

/**
 * Judge one doc's `summary:` against the cap.
 *
 * @param summary the doc's parsed `summary:` value, or `undefined` when it declared none
 * @param docPath the doc's path, so the message is actionable without a second lookup
 * @param text the doc's whole text, for the key's line number
 * @returns the offence, or `undefined` when the summary is absent or within the cap
 */
export function summaryCapOffence({
  summary,
  docPath,
  text,
}: {
  summary: string | undefined;
  docPath: string;
  text: string;
}): SummaryCapOffence | undefined {
  if (summary === undefined) {
    return undefined;
  }
  const bytes = Buffer.byteLength(summary, "utf8");
  if (bytes <= MAX_SUMMARY_BYTES) {
    return undefined;
  }
  const line = summaryKeyLine({ text });
  return {
    bytes,
    cap: MAX_SUMMARY_BYTES,
    line,
    message:
      `${docPath}:${String(line)} has a ${String(bytes)}-byte \`summary:\`, over the ${String(MAX_SUMMARY_BYTES)}-byte cap ` +
      "— cut it back to the one line it is for, saying what THIS shift is picking up, and archive the predecessor " +
      "text it has accumulated rather than carrying it forward again. Whatever a successor genuinely has to keep " +
      "reading is a standing rule and belongs in a file, not in a field nothing checks",
  };
}

/**
 * The refusal `handover start` prints for a doc whose `summary:` has outgrown the cap.
 *
 * Separate from {@link summaryCapOffence} because a refusal is a different act from a measurement: the
 * `handover check` verb reports, while this one blocks a run from opening and therefore has to say what
 * unblocks it.
 *
 * The seat this stops is the one that was about to boot from the oversized doc, which is the same seat that
 * fixes it in one edit — deliberately unlike a push gate, which would stop a stranger in this repository for a
 * doc written by somebody else's session.
 *
 * @param offence what was measured, from {@link summaryCapOffence}
 * @returns the lines to print, empty when there is nothing to refuse
 */
export function summaryCapRefusalLines({ offence }: { offence: SummaryCapOffence | undefined }): readonly string[] {
  if (offence === undefined) {
    return [];
  }
  return [
    "handover start: this doc's `summary:` breaks its size contract:",
    `  - ${offence.message}`,
    "  Fix the doc first, then re-run. `slopweaver handover check <path>` re-checks.",
    "  Why this cap exists and the measurement behind it: skills/handover/reference/verifying-a-doc.md",
  ];
}
