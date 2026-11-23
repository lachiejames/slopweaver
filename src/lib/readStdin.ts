/**
 * Reading a piped payload off stdin — the one implementation.
 *
 * There were four. Three were byte-identical `readAllStdin` copies in the Slack commands, and the fourth lived
 * inside `src/admit/pretooluseAdmit.ts`, invisible to anything that was not the PreToolUse door. Reading stdin
 * is a transport primitive rather than a door or Slack concern, so it lives here and every caller imports it.
 *
 * The fourth implementation also behaved DIFFERENTLY: it resolved with whatever had arrived when the stream
 * errored, so a truncated read looked like a complete one. This version lets the error propagate. Every caller
 * already parses what it gets, and a caller that wants to fail soft can catch — but a caller cannot recover a
 * distinction the reader has already thrown away. Concretely, the door now treats a broken read as a malformed
 * payload and fails closed, and `secrets` refuses a half-read secret instead of storing it.
 *
 * Buffers are concatenated rather than string-appended so a multi-byte character split across a chunk boundary
 * decodes once, at the end, instead of producing a replacement character mid-stream.
 */

/**
 * Read the whole of stdin.
 *
 * @param input the chunk stream to drain; production reads `process.stdin`, a test passes an async generator
 * @returns the complete payload, decoded as UTF-8
 * @throws whatever the stream raises — a partial read is never presented as a complete one
 */
export async function readStdin({
  input = process.stdin,
}: {
  input?: AsyncIterable<string | Uint8Array>;
} = {}): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
