/**
 * Reading the value back out of one `playwright-core` terminal-client `eval` reply.
 *
 * Pure. One function, extracted rather than written twice: `./aim.ts`'s focus probe had this parser inline,
 * and `./aimShot.ts` and `./scrollWalk.ts` each need the same three lines. `.claude/rules/error-handling.md`
 * carries the reason a dedup like this is worth doing at the moment a second caller appears — a
 * refactor can extract shared logic while reproducing the very shape it was
 * extracting, with both files open.
 *
 * **The client's contract, MEASURED.** An `eval` result is put in a `### Result` section as
 * pretty-printed JSON and nothing else: `addResult` files a string with no suggested filename as a text
 * result, and `serialize` renders each section under its own `###` heading. So the section runs to the next
 * heading, and anything that is not readable JSON is reported as unreadable rather than substituted for —
 * every caller here is deciding whether to touch the owner's page, and a reply nobody could read has
 * established nothing.
 */

/**
 * The JSON value one `eval` reply carried, or `undefined` when the reply did not carry a readable one.
 *
 * `undefined` rather than a typed error, because each caller refuses in its own words: a focus probe that
 * cannot be read refuses a keystroke, and an aim shot that cannot be read refuses an interaction, and one
 * shared error would have to be mapped into both unions anyway.
 *
 * @param stdout everything the client printed for that command
 * @returns the parsed value, or `undefined` when there was no readable `### Result` JSON
 */
export function evalReplyValue({ stdout }: { stdout: string }): unknown {
  const lines = stdout.split("\n");
  const start = lines.indexOf("### Result");
  if (start === -1) {
    return undefined;
  }
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("### ")) {
      break;
    }
    body.push(line);
  }
  try {
    return JSON.parse(body.join("\n"));
  } catch {
    return undefined;
  }
}
