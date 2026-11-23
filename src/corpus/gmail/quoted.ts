/**
 * PURE reduction of a mail body to the part its sender actually wrote — the projection decision this
 * connector exists to make, and the one that decides what bronze costs.
 *
 * ## Why the raw body is the wrong thing to store
 *
 * Embedding cost tracks CHARACTERS, not records (measured — see `docs/what-slopweaver-is.md` on the
 * embedding leg), and a mail body is mostly not the message. A three-line reply carries the whole thread
 * beneath it, so a ten-message thread stores its first message ten times, and every one of those copies is
 * indexed, ranked and pasted into a visible session as if it were new prose. Retrieval gets worse as well
 * as dearer: the quoted tail is the strongest lexical match for the thread's own subject, so a stale copy
 * outranks the reply that supersedes it.
 *
 * So the stored text is the top of the body and the dropped tail is COUNTED rather than silently discarded
 * — `attrs.quotedCharsDropped` on every record, so the trade is visible in the corpus rather than only in
 * this comment.
 *
 * ## The rule, and the one case it refuses to apply
 *
 * Find the EARLIEST tail marker and keep everything above it. Every marker below is a form real mail
 * actually emits; none is a guess about intent.
 *
 * The refusal matters more than the markers. A body that is ENTIRELY quoted — a bare forward, a
 * notification whose whole content sits under a separator — reduces to nothing, and storing nothing loses
 * a record that had something. So when the kept part is empty, the ORIGINAL body is kept whole and the
 * drop is reported as zero. A body this cannot split is better stored intact than stored empty.
 *
 * ## What it cannot do, stated rather than discovered
 *
 * A body flattened from HTML ({@link ../../live/gmail/htmlToText.htmlToText}) has already lost the markers: a
 * `<blockquote>` becomes a paragraph break, not a `>` prefix. Those bodies pass through nearly untouched,
 * and that is a known limit rather than a bug to file — recovering quote structure from flattened HTML
 * needs the tree, and the tree is gone by the time this runs. Measured on a real sample, most of what
 * flattens from HTML is machine-generated notification mail carrying no quoted history at all, so the
 * limit costs far less than the paragraph of parser it would take to close.
 *
 * No I/O, no clock, no SDK types.
 */

/**
 * A line that introduces a quoted reply — `On <something>, <someone> wrote:`, possibly wrapped across two
 * lines by the sending client.
 *
 * Anchored at the line start and required to END in `wrote:` so an ordinary sentence beginning "On Monday"
 * cannot trip it. The `[\s\S]` body is bounded by the anchors either side, so there is no ambiguity for a
 * backtracking engine to explore.
 */
const ATTRIBUTION = /^on\b[\s\S]{0,200}\bwrote:\s*$/i;

/**
 * Separator lines that begin an included original message. Each is matched on a TRIMMED line, so leading
 * whitespace a client added does not hide one.
 */
const SEPARATORS: readonly RegExp[] = [
  // Outlook's included original, in the two spellings it emits.
  /^-{2,}\s*original message\s*-{2,}$/i,
  // Gmail's and Apple Mail's forward banner.
  /^-{2,}\s*forwarded message\s*-{2,}$/i,
  // Outlook's horizontal rule above an inlined reply header block — a run of underscores and nothing else.
  /^_{10,}$/,
  // Some clients emit a "begin forwarded message:" line with no rule at all.
  /^begin forwarded message:$/i,
];

/**
 * The RFC 3676 signature delimiter: a line that is exactly two hyphens, optionally with the trailing space
 * the standard asks for and many clients drop.
 */
const SIGNATURE_DELIMITER = /^--\s?$/;

/**
 * The inlined header block Outlook writes above a quoted reply, recognised by its FIRST line.
 *
 * Only `From:` starts a block, and only when a `Sent:`/`Date:` line follows within the next few lines —
 * without that second condition an ordinary sentence like `From: the design review` would truncate a
 * message at its first paragraph.
 */
const INLINE_HEADER_START = /^from:\s*\S/i;

/** The header that must follow {@link INLINE_HEADER_START} for the block to be a real quoted header. */
const INLINE_HEADER_FOLLOW = /^(?:sent|date|to):\s*\S/i;

/** How many lines after a `From:` line the confirming `Sent:`/`Date:` may appear. */
const INLINE_HEADER_WINDOW = 4;

/**
 * What the reduction kept, and what it cost.
 *
 * @internal — the declared return shape of {@link stripQuotedTail}; callers destructure it rather than
 * naming it.
 */
export interface StrippedBody {
  /** The text to store — the part the sender wrote, or the whole body when it could not be split. */
  readonly text: string;
  /**
   * How many characters the tail removed. ZERO when nothing was stripped AND zero when the split was
   * refused, so the field never claims a reduction that did not happen.
   */
  readonly droppedChars: number;
}

/**
 * Whether the line at `index` starts an inlined quoted-header block.
 *
 * @param lines every line of the body
 * @param index the line to test
 * @returns true when this is a `From:` line confirmed by a `Sent:`/`Date:`/`To:` line just below it
 */
function startsInlineHeaderBlock({ lines, index }: { lines: readonly string[]; index: number }): boolean {
  if (!INLINE_HEADER_START.test(lines[index]!.trim())) {
    return false;
  }
  return lines
    .slice(index + 1, index + 1 + INLINE_HEADER_WINDOW)
    .some((line) => INLINE_HEADER_FOLLOW.test(line.trim()));
}

/**
 * Whether the line at `index` begins the quoted tail.
 *
 * @param lines every line of the body
 * @param index the line to test
 * @returns true when everything from this line down is quoted history, a signature, or an included message
 */
function startsTail({ lines, index }: { lines: readonly string[]; index: number }): boolean {
  const line = lines[index]!;
  const trimmed = line.trim();
  if (trimmed.startsWith(">")) {
    return true;
  }
  if (SIGNATURE_DELIMITER.test(trimmed)) {
    return true;
  }
  if (SEPARATORS.some((separator) => separator.test(trimmed))) {
    return true;
  }
  if (ATTRIBUTION.test(trimmed)) {
    return true;
  }
  return startsInlineHeaderBlock({ index, lines });
}

/**
 * Reduce a mail body to what its sender wrote, reporting what that cost.
 *
 * @param body the parsed body text, exactly as {@link ../../live/gmail/parse.parseGmailMessage} produced it
 * @returns the text to store and the number of characters the tail removed
 */
export function stripQuotedTail({ body }: { body: string }): StrippedBody {
  const lines = body.split("\n");
  const cut = lines.findIndex((_line, index) => startsTail({ index, lines }));
  if (cut === -1) {
    return { droppedChars: 0, text: body };
  }
  const kept = lines.slice(0, cut).join("\n").trim();
  // The refusal: a body that is entirely quoted still held something, and an empty record holds nothing.
  if (kept.length === 0) {
    return { droppedChars: 0, text: body };
  }
  return { droppedChars: body.length - kept.length, text: kept };
}
