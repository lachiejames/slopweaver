/**
 * The most a line typed into a cmux shell can carry before the terminal silently cuts it.
 *
 * A boot line is TYPED, so it passes through the terminal's canonical-mode line discipline, which keeps at
 * most `MAX_CANON` bytes of one line (1,024 on macOS) and drops the rest with nothing but a bell. MEASURED
 * Measured: a bot seat's 1,100-byte boot line arrived as exactly 1,024 bytes, its JSON's closing quote
 * among the lost ones, so the shell sat at `quote>` and `cmux spawn` waited out its boot witness on a seat
 * that could never start. Refusing a line that will not fit names that failure before it is typed.
 * Repro: `slopweaver cmux read-screen --workspace <ref>` on such a seat, then count the echoed line.
 */

/** `MAX_CANON` on macOS, less the newline that submits the line. */
export const TTY_LINE_LIMIT_BYTES = 1023;

/**
 * Why a line would be cut if typed, or `null` when it fits.
 *
 * @param line the exact text about to be typed, without its submitting newline
 * @returns the refusal reason, naming both sizes, or `null`
 */
export function ttyLineOverflow({ line }: { line: string }): string | null {
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes <= TTY_LINE_LIMIT_BYTES) {
    return null;
  }
  return (
    `the line is ${String(bytes)} bytes and a terminal keeps at most ${String(TTY_LINE_LIMIT_BYTES)} of one ` +
    "typed line (MAX_CANON), so the rest would be dropped and the shell left waiting on an unclosed quote"
  );
}
