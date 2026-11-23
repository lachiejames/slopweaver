/**
 * The supervisor state doc's size contract — the pure core behind `slopweaver supervisor state-check` and
 * the `handover start` refusal.
 *
 * ## Why a gate rather than a convention
 *
 * The state doc is what a successor supervisor boots from, and it is appended to by hand, forever, by every
 * supervisor in turn. Left uncapped it grows without any reader noticing, because the thing that grows is
 * exactly the part nobody reads. MEASURED over the last ELEVEN handoffs' own transcripts (repro:
 * count each session's `Read` offsets and `sed -n` ranges against the doc): the doc stood at 3,444 lines and
 * the union of every line any of the eleven opened was lines 3000-3444 — 12.9%. Lines 1-2999 were read by
 * nobody. Five of the last six read fewer than 35 lines each, and one never opened the file at all.
 *
 * A doc whose read share falls as it grows is not a memory, it is ballast with a memory at the end of it. The
 * fix is a rolling window plus an archive, and the thing that keeps a rolling window rolling is a refusal.
 *
 * ## The two caps, both ratcheted from that measurement
 *
 * - {@link MAX_BOOT_BLOCK_LINES} = 60. The 38 boot blocks in the doc measured min 9, median 32, p90 48, max
 *   83 (repro: `awk '/^## SUCCESSOR BOOT BLOCK/{if(n)print c;n=1;c=0;next}{if(n)c++}END{if(n)print c}'
 *   <doc> | sort -n`). 60 admits every one of the last twenty-two and refuses the three historical
 *   offenders, so it is a real ratchet on the shape that actually happened rather than a round number.
 * - {@link MAX_STATE_DOC_LINES} = 400. A rolling 24-hour window on the same doc measured 211 lines (repro:
 *   `grep -n '^## ' <doc>` and count from the first heading 24h back), so 400 leaves roughly 2x headroom for
 *   a busy day before the archive step is owed.
 *
 * ## The third check: rulings as anchored rows, never prose
 *
 * See {@link RULINGS_HEADING}. A boot block's current section under that heading must be rows each carrying
 * a URL, because a ruling the next supervisor cannot read back by anchor is a ruling the next ranked list
 * re-asks — measured as the first four rows of the owner's ranked list.
 *
 * Pure: no I/O at all. The CLI edge reads the file and prints; `handover start` reads it and refuses.
 */

/** The heading every successor block opens with. The doc's own convention, not one invented here. */
const BOOT_BLOCK_HEADING = "## SUCCESSOR BOOT BLOCK";

/**
 * The heading under which a boot block lists the owner's rulings, one anchored row each.
 *
 * MEASURED: a handed-over block carried the owner's rulings as shift prose (a stack getting no review asks
 * until its first pull request lands) and told the successor to run a scratchpad script hard-coding
 * thirty-six pull-request numbers before every render. Nothing machine-
 * readable said which rows the owner had ruled on, so the next ranked list led with four of them. A ruling in this
 * doc is therefore a ROW, carrying the URL it was given on, and the gate below refuses a block that keeps
 * one as prose.
 */
export const RULINGS_HEADING = "RULINGS";

/** The one row a rulings section may carry when the owner ruled on nothing this shift. */
const NO_RULINGS_ROW = "- none";

/**
 * The per-block line cap. See this file's header for the measurement and its reproduction command.
 */
export const MAX_BOOT_BLOCK_LINES = 60;

/**
 * The whole-doc line cap — a rolling 24 hours plus the current boot block, with the rest archived. See this
 * file's header for the measurement and its reproduction command.
 */
export const MAX_STATE_DOC_LINES = 400;

/**
 * One successor boot block, located in the doc so a refusal can point at a line rather than at a file.
 *
 * @internal — part of {@link StateDocShape}; no caller names it, they read it off `parseStateDoc`.
 */
export interface BootBlock {
  /** The heading text, verbatim, so a refusal names the block a reader can find. */
  readonly heading: string;
  /** The 1-based line the heading sits on. */
  readonly startLine: number;
  /** Lines from this heading to the next boot block (or EOF) — the shift notes written under it included. */
  readonly lines: number;
}

/**
 * A state doc split into the two things the caps are about.
 *
 * @internal — `parseStateDoc`'s return type; callers destructure it rather than annotate with it.
 */
export interface StateDocShape {
  /** Total lines, counted the way `wc -l` counts them. */
  readonly totalLines: number;
  /** Every successor boot block, in document order. */
  readonly blocks: readonly BootBlock[];
  /** The last block in the doc — the one a successor actually boots from — or `undefined` when there is none. */
  readonly currentBlock: BootBlock | undefined;
}

/**
 * One way a state doc breaks its contract. A list, because a doc can break both caps at once.
 *
 * @internal — flows from `stateDocOffences` into `stateDocRefusalLines` and the CLI's JSON, unnamed.
 */
export interface StateDocOffence {
  /**
   * What was measured. `doc-too-long` is the whole file; `boot-block-too-long` is one block;
   * `rulings-missing` is a current block with no {@link RULINGS_HEADING} section; `unanchored-ruling` is
   * one row under it that names no URL.
   */
  readonly code: "doc-too-long" | "boot-block-too-long" | "rulings-missing" | "unanchored-ruling";
  /** The measured line count. */
  readonly lines: number;
  /** The cap it exceeded. */
  readonly cap: number;
  /** A sentence naming the offender and what to do about it. */
  readonly message: string;
}

/**
 * Count lines the way `wc -l` does, so a refusal is verifiable in one shell command.
 *
 * @param text the doc's whole text
 * @returns the number of newline-terminated lines
 */
function lineCount({ text }: { text: string }): number {
  const normalised = text.replace(/\r\n/g, "\n");
  if (normalised.length === 0) {
    return 0;
  }
  const newlines = normalised.split("\n").length - 1;
  return normalised.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * Split a state doc into its successor boot blocks.
 *
 * A block runs from its own heading to the line before the NEXT boot-block heading, or to the end of the
 * file — so the shift notes written under a block count as part of it. That is deliberate and it is what the
 * cap was measured against: a successor reads from the current boot block to the end of the file, so that
 * whole span is the thing being capped, not the heading's own bullets.
 *
 * Text before the first heading (front-matter, a title, early prose) belongs to no block and is counted only
 * against the whole-doc cap, because that preamble is not what a successor boots from.
 *
 * @param text the doc's whole text
 * @returns the doc's total length and its blocks, in document order
 */
export function parseStateDoc({ text }: { text: string }): StateDocShape {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const starts: { heading: string; startLine: number }[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith(BOOT_BLOCK_HEADING)) {
      starts.push({ heading: line, startLine: index + 1 });
    }
  });
  const total = lineCount({ text });
  const blocks = starts.map((start, index) => {
    const next = starts[index + 1];
    const endLine = next === undefined ? total : next.startLine - 1;
    return { heading: start.heading, lines: Math.max(0, endLine - start.startLine + 1), startLine: start.startLine };
  });
  return { blocks, currentBlock: blocks.at(-1), totalLines: total };
}

/** A markdown heading of any depth whose text is the rulings heading, case-insensitively. */
const RULINGS_HEADING_LINE = new RegExp(`^#{1,6}\\s*${RULINGS_HEADING}\\b`, "i");

/** Any markdown heading line — where a rulings section ends. */
const ANY_HEADING_LINE = /^#{1,6}\s/;

/** What an anchored row must carry: a URL the owner could open. */
const URL = /https?:\/\/\S+/;

/**
 * The rows under the current block's rulings section that name no anchor, with their 1-based lines.
 *
 * The section runs from its heading to the next heading or the end of the block. Every non-blank line in
 * it must be a row carrying a URL, or the literal `- none`; anything else is a ruling written as prose,
 * which is the thing the next supervisor cannot read back into the list.
 *
 * @param lines the whole doc's lines
 * @param block the current boot block
 * @returns one entry per unanchored row, and whether a rulings heading was found at all
 */
export function rulingsRows({ lines, block }: { lines: readonly string[]; block: BootBlock }): {
  readonly found: boolean;
  readonly unanchored: readonly { readonly line: number; readonly text: string }[];
} {
  const start = block.startLine - 1;
  const end = Math.min(lines.length, start + block.lines);
  const heading = lines.slice(start, end).findIndex((line) => RULINGS_HEADING_LINE.test(line));
  if (heading === -1) {
    return { found: false, unanchored: [] };
  }
  const unanchored: { readonly line: number; readonly text: string }[] = [];
  for (let index = start + heading + 1; index < end; index += 1) {
    const text = lines[index]!;
    if (ANY_HEADING_LINE.test(text)) {
      break;
    }
    if (text.trim().length === 0 || text.trim() === NO_RULINGS_ROW) {
      continue;
    }
    if (!URL.test(text)) {
      unanchored.push({ line: index + 1, text: text.trim() });
    }
  }
  return { found: true, unanchored };
}

/**
 * Every way the current block's rulings section breaks its contract.
 *
 * @param text the doc's whole text
 * @param shape the parsed doc
 * @param docPath the path to name in a refusal
 * @returns the offences, empty when the block lists its rulings as anchored rows
 */
export function rulingsOffences({
  text,
  shape,
  docPath,
}: {
  text: string;
  shape: StateDocShape;
  docPath: string;
}): readonly StateDocOffence[] {
  const current = shape.currentBlock;
  if (current === undefined) {
    return [];
  }
  const { found, unanchored } = rulingsRows({ block: current, lines: text.replace(/\r\n/g, "\n").split("\n") });
  if (!found) {
    return [
      {
        cap: 0,
        code: "rulings-missing",
        lines: 0,
        message: `the current boot block at ${docPath}:${current.startLine} has no \`### ${RULINGS_HEADING}\` section — list every ruling the owner gave this shift as a row carrying the URL it was given on (or the one row \`- none\`), and record each through \`slopweaver session-start lock-in --item <url>\` so the next list stops re-asking it`,
      },
    ];
  }
  return unanchored.map((row) => ({
    cap: 0,
    code: "unanchored-ruling",
    lines: row.line,
    message: `${docPath}:${String(row.line)} is a ruling written as prose, with no URL — "${row.text}"; a ruling row names the pull request, thread or ticket it was given on, so the next supervisor's list can read it back`,
  }));
}

/**
 * Judge a state doc against both caps, and its current block against the rulings contract.
 *
 * Only the CURRENT block is judged, not every historical one: an archived block is text nobody boots from,
 * and refusing a supervisor's `handover start` over a predecessor's oversized block would punish the wrong
 * session for something the archive step already removes.
 *
 * @param shape the parsed doc
 * @param docPath the path to name in a refusal, so the message is actionable without a second lookup
 * @param text the doc's whole text, for the rulings section; absent when a caller judges size alone
 * @returns every cap the doc breaks, empty when it breaks none
 */
export function stateDocOffences({
  shape,
  docPath,
  text,
}: {
  shape: StateDocShape;
  docPath: string;
  text?: string;
}): readonly StateDocOffence[] {
  const offences: StateDocOffence[] = [];
  if (shape.totalLines > MAX_STATE_DOC_LINES) {
    offences.push({
      cap: MAX_STATE_DOC_LINES,
      code: "doc-too-long",
      lines: shape.totalLines,
      message: `${docPath} is ${shape.totalLines} lines, over the ${MAX_STATE_DOC_LINES}-line cap — archive everything older than the last 24 hours to handovers/archive/ and truncate, keeping the current boot block`,
    });
  }
  const current = shape.currentBlock;
  if (current !== undefined && current.lines > MAX_BOOT_BLOCK_LINES) {
    offences.push({
      cap: MAX_BOOT_BLOCK_LINES,
      code: "boot-block-too-long",
      lines: current.lines,
      message: `the current boot block at ${docPath}:${current.startLine}, with the shift notes under it, is ${current.lines} lines, over the ${MAX_BOOT_BLOCK_LINES}-line cap — move any standing rule into skills/supervisor/reference/, and cut the shift to what the next supervisor actually needs`,
    });
  }
  if (text !== undefined) {
    offences.push(...rulingsOffences({ docPath, shape, text }));
  }
  return offences;
}

/**
 * The refusal `handover start` prints for a supervisor doc whose state doc has outgrown its caps.
 *
 * Separate from {@link stateDocOffences} because a refusal is a different act from a measurement: the CLI's
 * own `state-check` verb reports, while this one blocks a shift from opening and therefore has to say what
 * unblocks it.
 *
 * @param offences what the doc broke, from {@link stateDocOffences}
 * @returns the lines to print, empty when there is nothing to refuse
 */
export function stateDocRefusalLines({ offences }: { offences: readonly StateDocOffence[] }): readonly string[] {
  if (offences.length === 0) {
    return [];
  }
  return [
    "handover start: this doc declares `supervisorState:`, and that state doc breaks its contract:",
    ...offences.map((offence) => `  - ${offence.message}`),
    "  Fix the doc first, then re-run. `slopweaver supervisor state-check --path <doc>` re-checks.",
    "  Why these caps and the rulings section exist, and the measurements behind them: skills/supervisor/reference/state-doc.md",
  ];
}
