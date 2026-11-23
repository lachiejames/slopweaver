/**
 * One published briefing read for the console voice, server side: the page's current document out of the store,
 * through `slopweaver talk file read --words` on the page's address (`src/talk/heldPage.ts`), which turns the markup into words and THEN masks every credential shape, so nothing here touches
 * the text after the mask. Decoding entities here, after the verb masked raw markup,
 * would return `ghp&#95;AAAA…` as an unmasked `ghp_AAAA…` (`src/talk/pageWordsRead.ts`).
 *
 * Through the verb rather than the page route (`../app/api/page/[slug]/[...file]/route.ts`), because that route serves
 * a page UNMASKED for the owner's own browser and `page publish` runs no secret scan, while what is read here is handed to a
 * hosted model. One window at a budget no briefing reaches: the voice used to page through 10 KiB windows of raw
 * markup itself, and skipped or stopped partway through 15 of 20 (`./cardBriefings.ts`). What one card answer cannot
 * carry it reads on to through `file_read`'s words mode, from the offset this read hands back.
 *
 * Pure: the route (`../app/api/talk/briefing/[slug]/route.ts`) runs the verb and hands its outcome here.
 */
import type { SpawnOutcome } from "./spawnVerb";

/** Bytes of words read in the one window; a page past it is read as its first part, carrying where the rest starts. */
export const BRIEFING_READ_BUDGET = 512 * 1024;

/** The verb line, as a failure names it — never the path. */
export const BRIEFING_READ_TITLE = "slopweaver talk file read --path <briefing> --words --json";

/**
 * What reading one briefing came to: its words, whether all of them, and where a read of the rest starts — or why it
 * could not be read. `path` is the page's address, `nextFrom` the verb's own byte offset into the WORDS (null when
 * whole), and `masked` whether either masking pass replaced anything, since a replacement changes the words' length
 * and so makes an offset counted over the masked text no offset into the verb's words (`src/talk/pageWordsRead.ts`).
 */
export type BriefingRead =
  | {
      readonly ok: true;
      readonly text: string;
      readonly whole: boolean;
      readonly path: string;
      readonly masked: boolean;
      readonly nextFrom: number | null;
    }
  | { readonly ok: false; readonly why: string };

/**
 * The verb's arguments for one briefing's file.
 *
 * @param file the briefing's address, `<pages>/<slug>/index.html`, which the verb reads out of the store
 * @returns the argv after `slopweaver`
 */
export function briefingReadArgv({ file }: { file: string }): readonly string[] {
  return ["talk", "file", "read", "--path", file, "--words", "--budget", String(BRIEFING_READ_BUDGET), "--json"];
}

/**
 * Whether a value is a plain object, narrowed so its fields can be read.
 *
 * @returns true for a non-array object
 */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Each failure the verb names (`src/talk/localFileErrors.ts`), recognised in its stderr and said in fixed words. */
const FAILURE_KINDS: readonly { readonly marker: RegExp; readonly why: string }[] = [
  // The store's two first: an unreadable store's message carries the store's own words, which can say anything.
  {
    marker: /the store holds no published page under it/u,
    why: "the store holds no published page by the briefing's name",
  },
  { marker: /could not be read from the store: /u, why: "the store holding the briefing's page could not be read" },
  { marker: /does not exist/u, why: "the briefing's page does not exist" },
  { marker: /still looked like it held a credential/u, why: "a credential survived masking, so none was returned" },
  { marker: /cannot be read as a page's words/u, why: "the briefing's file is not a page one read takes whole" },
  { marker: /permission denied/u, why: "permission to read the briefing's page was denied" },
  { marker: /is not read: /u, why: "the briefing's page is a path that is never read" },
];

/**
 * A failed read in fixed words: which known failure the stderr names, or only the exit code — never the stderr.
 *
 * @param err the verb's stderr, read for a known failure and never repeated
 * @param exitCode the verb's exit code, absent when it never finished
 * @returns the sentence
 */
function failureWhy({ err, exitCode }: { err: string; exitCode: number | undefined }): string {
  if (exitCode === undefined) {
    return `${BRIEFING_READ_TITLE} did not finish`;
  }
  const said = `${BRIEFING_READ_TITLE} exited ${String(exitCode)}`;
  const known = FAILURE_KINDS.find(({ marker }) => marker.test(err));
  if (known === undefined) {
    return said;
  }
  return `${said}: ${known.why}`;
}

/**
 * What one run of the verb came to, as a briefing: its words, or the reason it could not be read. A read whose
 * `resolvedPath` is not `expectedPath` is refused, words and all: the verb answers a page's address with that same
 * address when it reads the page out of the store (`src/talk/heldPage.ts`), which it does for the home it inherits
 * from this console, so any other answer is some file read in place of the page.
 *
 * A failure's `why` is one of {@link FAILURE_KINDS}' fixed sentences, NEVER the verb's stderr: that names the
 * path asked, so a credential-shaped slug or home directory reached the hosted model unmasked.
 *
 * @param outcome the verb's run
 * @param expectedPath the page's address, `<pages>/<slug>/index.html`, exactly as the verb was asked for it
 * @returns the read
 */
export function briefingReadOf({
  outcome,
  expectedPath,
}: {
  outcome: SpawnOutcome;
  expectedPath: string;
}): BriefingRead {
  if (!outcome.ok) {
    return { ok: false, why: failureWhy({ err: outcome.err, exitCode: outcome.exitCode }) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.out);
  } catch {
    return { ok: false, why: `${BRIEFING_READ_TITLE} printed something that is not JSON` };
  }
  if (!isObject(parsed) || parsed["kind"] !== "text" || typeof parsed["text"] !== "string") {
    return { ok: false, why: "the briefing's file is not text" };
  }
  if (parsed["resolvedPath"] !== expectedPath) {
    return { ok: false, why: "the briefing's page was not read out of this console's store" };
  }
  const text = parsed["text"];
  if (text === "") {
    return { ok: false, why: "the briefing's page carries no words" };
  }
  const nextFrom = parsed["nextFrom"];
  const redactions = parsed["redactions"];
  const offsetValid = nextFrom === null || (Number.isSafeInteger(nextFrom) && Number(nextFrom) > 0);
  if (!offsetValid || !Array.isArray(redactions)) {
    return { ok: false, why: "the briefing's read named no offset to read the rest from" };
  }
  return {
    masked: redactions.length > 0,
    nextFrom: nextFrom === null ? null : Number(nextFrom),
    ok: true,
    path: expectedPath,
    text,
    whole: nextFrom === null,
  };
}
