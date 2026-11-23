/**
 * The words a download that could not be handed over says, kept apart from `./actionErrors.ts` so that union
 * file holds shapes and factories rather than prose — and so it stays under its file-size floor while arms
 * are added to it.
 *
 * Its own module rather than a function in `./download.ts`, because `./download.ts` imports the error
 * factories and the factories import this: in there it would be a cycle.
 */

/**
 * What a download that could not be handed over says — one message for three shapes, because all three end
 * the same way: the click happened, the bytes are somewhere, and re-running would download them again.
 *
 * @param candidates how many settled files were seen — `0` for a timeout, `1` when the file was found and
 *   could not be copied, `2` or more for an ambiguity
 * @param directory the directory that was watched
 * @param names the files that settled
 * @param expected the filename the caller said to expect, when they named one — a zero count then means
 *   "nothing under that name", which is a different claim from "nothing at all"
 * @returns the message
 */
export function downloadMessage({
  candidates,
  directory,
  names,
  expected,
}: {
  candidates: number;
  directory: string;
  names: readonly string[];
  expected: string | undefined;
}): string {
  if (candidates === 0) {
    return (
      `the click WAS made and nothing matching arrived in ${directory}${expected === undefined ? "" : ` under the name ${expected}`}. ` +
      (expected === undefined
        ? "That may mean the browser routed it elsewhere or asked you where to put it, or that the page produced no download at all — nothing here can tell those apart."
        : "Other files may well have settled there and been filtered out by that name, so this is not evidence that nothing downloaded.") +
      " Look at the directory and at the page before clicking anything again; a file may also have arrived late."
    );
  }
  if (candidates === 1) {
    return (
      `the click WAS made and ${names.join(", ")} appeared in ${directory} while it ran, and it could not be ` +
      "copied to where you asked — most often because a file is already there. That file is attributed to this " +
      "click by having ARRIVED, never by the browser confirming it, so check it is the one you meant before " +
      "you use it; collect it from that directory, or ask again with a destination that does not exist. Do NOT " +
      "re-run this command."
    );
  }
  return (
    `the click WAS made and ${String(candidates)} new files settled in ${directory} while it ran ` +
    `(${names.join(", ")}). Any of them, or NONE of them, may be this click's — nothing here observed the ` +
    "browser start a download, only files arriving. Look at what is there, and at the page, before you treat " +
    "any of them as the export you asked for. Do NOT simply re-run this command: the click has already been " +
    "made once."
  );
}
