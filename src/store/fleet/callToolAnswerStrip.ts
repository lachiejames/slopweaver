/**
 * A call file as the store keeps it: every line exactly as written, bar the masked tool output a `tool` line carries
 * in its `answer` field (`src/talk/callToolLine.ts`), which is removed before the bytes are hashed and stored.
 *
 * The owner's ruling: the
 * backup keeps their words and the record, and leaves call threads and tool answers out. The store is what the backup dumps,
 * so a tool answer leaves the store. The file on this Mac keeps its answers: the console and `talk fidelity` read them
 * back locally. MEASURED, tool answers were 7.7 MB of the 30 MB of call files on this install.
 *
 * Pure: bytes in, bytes out. A line that does not parse, or parses to anything but a `tool` object carrying an
 * `answer`, keeps its exact bytes, so an unchanged call file converges on one body hash import after import.
 */

/** The home-relative shape of a call file: `talk/calls/<callId>.jsonl`, one segment below `talk/calls`. */
const CALL_FILE_PATH = /^talk\/calls\/[^/]+\.jsonl$/u;

/** The newline byte a JSONL file separates its lines with. */
const NEWLINE = 0x0a;
const NEWLINE_BYTES = Buffer.from([NEWLINE]);

/**
 * Whether a home-relative path is a call file, the one kind of file whose tool answers are stripped.
 *
 * @param relativePath a path under the home, `/`-separated
 * @returns true only for `talk/calls/<name>.jsonl`
 */
export function isCallFilePath({ relativePath }: { relativePath: string }): boolean {
  return CALL_FILE_PATH.test(relativePath);
}

/** Whether a parsed line is a `tool` object that still carries an `answer`. */
function carriesToolAnswer(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "kind" in value &&
    value.kind === "tool" &&
    Object.hasOwn(value, "answer")
  );
}

/**
 * One line with its tool answer removed, or the line exactly as it was.
 *
 * @param line one line of the file, without its newline
 * @returns the line to store
 */
function stripLine({ line }: { line: string }): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line;
  }
  if (!carriesToolAnswer(parsed)) {
    return line;
  }
  const { answer: _answer, ...rest } = parsed;
  // A CRLF line parses with its `\r` as trailing whitespace; it is written back so the line ending is the file's own.
  const ending = line.endsWith("\r") ? "\r" : "";
  return `${JSON.stringify(rest)}${ending}`;
}

/**
 * A call file's bytes with every tool line's `answer` removed.
 *
 * @param bytes the file exactly as read
 * @returns the bytes to store, and how many answers were removed; the input itself when there were none
 */
export function stripCallToolAnswers({ bytes }: { bytes: Uint8Array }): {
  readonly bytes: Uint8Array;
  readonly stripped: number;
} {
  // Every line is parsed, with no shortcut on the literal token: a key JSON spells with an escape (`"answer"`)
  // is still `answer` once parsed, and the import is the one gate every new row passes.
  // Lines are split on the newline BYTE and decoded one at a time, so a line that is not valid UTF-8 keeps its
  // exact bytes even when another line is rewritten.
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const source = Buffer.from(bytes);
  const parts: Buffer[] = [];
  let stripped = 0;
  let start = 0;
  for (;;) {
    const end = source.indexOf(NEWLINE, start);
    const raw = source.subarray(start, end === -1 ? source.length : end);
    parts.push(stripRawLine({ decoder, raw, onStripped: () => (stripped += 1) }));
    if (end === -1) {
      break;
    }
    parts.push(NEWLINE_BYTES);
    start = end + 1;
  }
  if (stripped === 0) {
    return { bytes, stripped: 0 };
  }
  return { bytes: Buffer.concat(parts), stripped };
}

/**
 * One line's bytes with its tool answer removed, or its bytes exactly as they were.
 *
 * @param decoder a fatal UTF-8 decoder, so an invalid line is kept rather than replaced
 * @param raw the line's bytes, without its newline
 * @param onStripped called once when the answer was removed
 * @returns the bytes to store for this line
 */
function stripRawLine({
  decoder,
  raw,
  onStripped,
}: {
  decoder: TextDecoder;
  raw: Buffer;
  onStripped: () => void;
}): Buffer {
  let line: string;
  try {
    line = decoder.decode(raw);
  } catch {
    return raw;
  }
  const kept = stripLine({ line });
  if (kept === line) {
    return raw;
  }
  onStripped();
  return Buffer.from(kept, "utf8");
}
