/**
 * Keep the tail of what one in-process run writes to a stream, while every byte still reaches the stream.
 *
 * A run-due leg that calls a verb's own runner in this process (`cli/commands/automation/collectLeg.ts`) writes to
 * this process's stderr, and there is no pipe to read it back from. Some verbs reach stderr through the logger's sink and some through
 * `process.stderr.write` directly, so the one place both pass is the stream's own `write` — which is what
 * this wraps, for exactly the duration of one run, and puts back afterwards whether the run resolved or threw.
 */

/** The one member of a writable stream this touches — `process.stderr` satisfies it. */
export interface TeeableStream {
  write(...args: unknown[]): boolean;
}

/**
 * The text one `write` chunk carries. Bytes go through the run's ONE streaming decoder, so a character whose UTF-8
 * bytes a caller split across two writes decodes whole rather than as replacement characters.
 *
 * @param chunk the first argument a `write` call received
 * @param decoder the run's own decoder, holding the trailing bytes of an unfinished character
 * @returns the chunk as text, or an empty string for a chunk that is neither text nor bytes
 */
export function chunkText({ chunk, decoder }: { chunk: unknown; decoder: TextDecoder }): string {
  if (typeof chunk === "string") {
    // Bytes of an unfinished character held across a STRING write are flushed first, in the order they were written,
    // never joined to bytes that arrive after it.
    return `${decoder.decode()}${chunk}`;
  }
  // Any byte view a stream accepts — a `Buffer`, any typed array, a `DataView` — not only a `Uint8Array`.
  if (ArrayBuffer.isView(chunk)) {
    return decoder.decode(chunk, { stream: true });
  }
  return "";
}

/**
 * The last `keepChars` UTF-16 code units of `text`, less a leading low surrogate whose high half the cut dropped, so
 * the kept tail never opens on half a character.
 *
 * @returns the bounded tail
 */
export function keptTail({ text, keepChars }: { text: string; keepChars: number }): string {
  const tail = text.slice(-keepChars);
  const first = tail.charCodeAt(0);
  const orphanedLowSurrogate = first >= 0xdc00 && first <= 0xdfff;
  return orphanedLowSurrogate ? tail.slice(1) : tail;
}

/**
 * Run `run` with `stream.write` teed: every call still reaches the stream unchanged, and the last
 * `keepChars` characters written are handed back beside the run's own value.
 *
 * Only the TAIL is kept, so a verb that writes a great deal of progress costs a bounded buffer rather than
 * its whole output.
 *
 * @param stream the stream to tee — `process.stderr` in production
 * @param keepChars how many trailing characters of what was written to keep
 * @param run the work whose writes are kept
 * @returns the run's value and the tail of what it wrote
 */
export async function teeWrites<T>({
  stream,
  keepChars,
  run,
}: {
  stream: TeeableStream;
  keepChars: number;
  run: () => Promise<T>;
}): Promise<{ readonly value: T; readonly text: string }> {
  const original = stream.write;
  let kept = "";
  const decoder = new TextDecoder();
  stream.write = (...args: unknown[]): boolean => {
    kept = keptTail({ keepChars, text: `${kept}${chunkText({ chunk: args[0], decoder })}` });
    return original.apply(stream, args);
  };
  try {
    const value = await run();
    return { text: kept, value };
  } finally {
    stream.write = original;
  }
}
