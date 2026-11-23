/**
 * GitHub's patch and a file's text as the logical lines `./diffOnBaseJudge.ts` compares — the parsing half of the
 * current-base check, kept apart from the judging so each can be held in the head at once.
 *
 * A patch parses only when every line is the shape git writes and its hunk headers describe one edit of one file; a
 * file's last line carries {@link NO_NEWLINE} when the file ends without a newline, on both sides alike, so a line
 * that gained or lost its final newline never compares equal to its old self. Only the line ending (CRLF or LF) is
 * normalised; whether the two sides end their lines the same way is {@link lineEndingOf}'s to say.
 */

/** A line's text, with this suffix when it is the last line of a file that ends without a newline. */
const NO_NEWLINE = "\u0000no-newline-at-end";

/** One parsed hunk: the lines it expects before, the lines it leaves after, and where it said it sat. */
export interface Hunk {
  readonly oldStart: number;
  /** Where its post-image starts in the head's own copy, one-based: GitHub draws the new side from the head. */
  readonly newStart: number;
  readonly pre: readonly string[];
  readonly post: readonly string[];
  /** The lines it deletes, as the pre-image carries them (a no-newline marker included). */
  readonly removed: readonly string[];
}

/** The line git writes after a patch line whose file ends without a newline. */
const NO_NEWLINE_MARKER = "\\ No newline at end of file";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

/** A header's count, which GitHub omits when it is one. */
function countOf({ raw }: { raw: string | undefined }): number {
  if (raw === undefined) {
    return 1;
  }
  return Number(raw);
}

/** A hunk being parsed, with the counts its header promised. */
interface OpenHunk {
  readonly oldStart: number;
  readonly newStart: number;
  readonly oldCount: number;
  readonly newCount: number;
  readonly pre: string[];
  readonly post: string[];
  /** Where in `pre` each deleted line sits, read back once a no-newline marker may have changed one. */
  readonly removedAt: number[];
  /** Which side(s) the last body line belonged to, so a no-newline marker knows what to mark. */
  last: "pre" | "post" | "both" | undefined;
}

/** True when a parsed hunk carries exactly the line counts its header promised. */
function complete({ hunk }: { hunk: OpenHunk }): boolean {
  return hunk.pre.length === hunk.oldCount && hunk.post.length === hunk.newCount;
}

/** How many lines precede a range, by git's convention that an empty range's start names the line it follows. */
function linesBefore({ start, count }: { start: number; count: number }): number | undefined {
  if (count === 0) {
    return start;
  }
  if (start === 0) {
    return undefined;
  }
  return start - 1;
}

/**
 * True when the headers describe one edit of one file: every range is well formed, the hunks run in order without
 * overlapping, and the unchanged stretch before each hunk is the same length on both sides.
 */
function headersAgree({ hunks }: { hunks: readonly OpenHunk[] }): boolean {
  let oldEnd = 0;
  let newEnd = 0;
  for (const hunk of hunks) {
    const oldBefore = linesBefore({ count: hunk.oldCount, start: hunk.oldStart });
    const newBefore = linesBefore({ count: hunk.newCount, start: hunk.newStart });
    if (oldBefore === undefined || newBefore === undefined) {
      return false;
    }
    const gap = oldBefore - oldEnd;
    if (gap < 0 || newBefore - newEnd !== gap) {
      return false;
    }
    oldEnd = oldBefore + hunk.oldCount;
    newEnd = newBefore + hunk.newCount;
  }
  return true;
}

/** Mark the last line of one side as ending without a newline. */
function markNoNewline({ lines }: { lines: string[] }): void {
  const index = lines.length - 1;
  if (index >= 0) {
    lines[index] = `${lines[index]!}${NO_NEWLINE}`;
  }
}

/** Which sides of the file a no-newline marker has already ended. */
interface EndedSides {
  pre: boolean;
  post: boolean;
}

/** A hunk opened by its header, with nothing in it yet. */
function openHunk({ header }: { header: RegExpExecArray }): OpenHunk {
  return {
    last: undefined,
    newCount: countOf({ raw: header[4] }),
    newStart: Number(header[3]),
    oldCount: countOf({ raw: header[2] }),
    oldStart: Number(header[1]),
    post: [],
    pre: [],
    removedAt: [],
  };
}

/** True when a body line would carry on a side of the file a no-newline marker already ended. */
function continuesEndedSide({ line, ended }: { line: string; ended: EndedSides }): boolean {
  const onPre = line.startsWith(" ") || line.startsWith("-");
  const onPost = line.startsWith(" ") || line.startsWith("+");
  return (ended.pre && onPre) || (ended.post && onPost);
}

/**
 * Apply a no-newline marker to the side(s) the last body line belonged to. A marker is git's one fixed line, only ever
 * after a body line and only once; anything else is not a patch.
 */
function applyMarker({ line, open, ended }: { line: string; open: OpenHunk; ended: EndedSides }): boolean {
  if (line !== NO_NEWLINE_MARKER || open.last === undefined) {
    return false;
  }
  if (open.last === "pre" || open.last === "both") {
    markNoNewline({ lines: open.pre });
    ended.pre = true;
  }
  if (open.last === "post" || open.last === "both") {
    markNoNewline({ lines: open.post });
    ended.post = true;
  }
  open.last = undefined;
  return true;
}

/** Add one body line to the open hunk, false when it is not a shape a patch line has. */
function applyBodyLine({ line, open, ended }: { line: string; open: OpenHunk; ended: EndedSides }): boolean {
  if (continuesEndedSide({ ended, line })) {
    return false;
  }
  const body = line.slice(1);
  const kind = line[0];
  if (kind === undefined) {
    return false;
  }
  switch (kind) {
    case " ":
      open.pre.push(body);
      open.post.push(body);
      open.last = "both";
      return true;
    case "-":
      open.removedAt.push(open.pre.length);
      open.pre.push(body);
      open.last = "pre";
      return true;
    case "+":
      open.post.push(body);
      open.last = "post";
      return true;
    case "\\":
      return applyMarker({ ended, line, open });
    default:
      return false;
  }
}

/** Read one patch line into the hunks, false when it is not a shape a patch has: a body before a header included. */
function readPatchLine({ line, hunks, ended }: { line: string; hunks: OpenHunk[]; ended: EndedSides }): boolean {
  const header = HUNK_HEADER.exec(line);
  if (header !== null) {
    // A no-newline marker says its side of the FILE ended there, so no other hunk may follow it.
    if (ended.pre || ended.post) {
      return false;
    }
    hunks.push(openHunk({ header }));
    return true;
  }
  const open = hunks.at(-1);
  return open !== undefined && applyBodyLine({ ended, line, open });
}

/**
 * Parse GitHub's headerless unified patch into hunks, or `undefined` when any line is not the shape a patch has —
 * an unknown prefix, a body before a header, or a hunk whose lines do not add up to its header's counts.
 *
 * @param patch the `patch` field of one entry in GitHub's REST file list
 * @returns each hunk in the patch's order, or `undefined` when it is not one file's patch
 */
export function parsePatch({ patch }: { patch: string }): readonly Hunk[] | undefined {
  const hunks: OpenHunk[] = [];
  const lines = patch.replace(/\r\n/gu, "\n").split("\n");
  // GitHub ends a patch without a trailing newline; a final empty line would otherwise read as a blank context line.
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const ended: EndedSides = { post: false, pre: false };
  if (!lines.every((line) => readPatchLine({ ended, hunks, line }))) {
    return undefined;
  }
  if (!hunks.every((hunk) => complete({ hunk })) || !headersAgree({ hunks })) {
    return undefined;
  }
  return hunks.map((hunk) => ({
    newStart: hunk.newStart,
    oldStart: hunk.oldStart,
    post: hunk.post,
    pre: hunk.pre,
    removed: hunk.removedAt.map((index) => hunk.pre[index]!),
  }));
}

/**
 * A file's text as logical lines, the last one marked when the file ends without a newline.
 *
 * @param text a blob's whole text, as GitHub served it
 * @returns its lines, CRLF read as LF, with no trailing empty line for a final newline
 */
export function linesOf({ text }: { text: string }): readonly string[] {
  if (text === "") {
    return [];
  }
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
    return lines;
  }
  markNoNewline({ lines });
  return lines;
}

/**
 * A line's text without the no-newline marker, for asking whether a line survives wherever it now sits.
 *
 * @returns the line's own text, with any end-of-file marker removed
 */
export function bareLine({ line }: { line: string }): string {
  return line.endsWith(NO_NEWLINE) ? line.slice(0, -NO_NEWLINE.length) : line;
}

/**
 * How a text ends its lines: every one LF, every one CRLF, both, or no line break at all.
 *
 * @returns `none` for a text with no line break, else the one ending every break uses, or `mixed`
 */
export function lineEndingOf({ text }: { text: string }): "lf" | "crlf" | "mixed" | "none" {
  const crlf = text.includes("\r\n");
  const lf = /(?:^|[^\r])\n/u.test(text);
  if (crlf && lf) {
    return "mixed";
  }
  if (crlf) {
    return "crlf";
  }
  return lf ? "lf" : "none";
}
