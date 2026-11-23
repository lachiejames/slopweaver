/**
 * What a tag write prints — the receipt `handover tag` and `register --tag` share, and the exact command that
 * finishes a write that failed, judged against the journal as the failure left it, so neither verb words either
 * twice.
 */

import { shellCommandLine } from "#lib/shellCommandLine.js";

import { type RowTag, TAG_LIST_SEPARATOR } from "../../../handover/rowTags.js";
import { readRunJournal, runJournalPath } from "../../../handover/runStore.js";
import type { TagOutcome } from "../../../handover/tagStore.js";
import type { TagRequest } from "../../../handover/tagWrite.js";
import { logger } from "../../../lib/logger.js";

/** One line per receipt line. */
type ReceiptOut = (input: { line: string }) => void;

/** Tags as `key=value`, space-separated, or `none`. */
function spelt({ tags }: { tags: readonly RowTag[] }): string {
  if (tags.length === 0) {
    return "none";
  }
  return tags.map((tag) => `${tag.key}=${tag.value}`).join(" ");
}

/**
 * Print what one tag write did. The tag lines are labelled DECLARED because that is all a write can see: derived
 * tags are read off the row by `handover list`, so calling this the row's whole tag set would be false.
 *
 * @param slug the row
 * @param outcome what the write did
 * @param out where the lines go
 */
export function printTagOutcome({ slug, outcome, out }: { slug: string; outcome: TagOutcome; out: ReceiptOut }): void {
  out({
    line: `handover tag: ${slug} ${outcome.written ? "tagged" : "unchanged — it already holds every tag asked for"}`,
  });
  if (outcome.written && outcome.satisfied.length > 0) {
    out({ line: `  already so: ${outcome.satisfied.join(", ")}` });
  }
  if (outcome.redundant.length > 0) {
    out({ line: `  --new-value not needed, a row already carries: ${outcome.redundant.join(", ")}` });
  }
  out({ line: `  declared: ${spelt({ tags: outcome.tags.filter((tag) => tag.source === "declared") })}` });
  const unrecognised = outcome.tags.filter((tag) => tag.source === "unrecognised");
  if (unrecognised.length > 0) {
    out({ line: `  unrecognised (kept, never matched by a filter): ${spelt({ tags: unrecognised })}` });
  }
}

/**
 * The `handover tag` command that writes this request, every argument quoted. Safe to run whether or not an
 * ambiguous attempt committed: the verb writes a desired state, so a second run changes nothing already so.
 *
 * @param slug the row
 * @param request the request to repeat
 * @param why the reason it records
 * @param home the state home, named only when it is not the default
 * @returns one runnable command line
 */
export function tagRecoveryCommand({
  slug,
  request,
  why,
  home,
}: {
  slug: string;
  request: TagRequest;
  why: string;
  home: string | undefined;
}): string {
  const argv = ["slopweaver", "handover", "tag", slug, ...request.set.map((each) => `${each.key}=${each.value}`)];
  if (request.drop.length > 0) {
    argv.push("--drop", request.drop.join(TAG_LIST_SEPARATOR));
  }
  if (request.newValues.length > 0) {
    argv.push("--new-value", request.newValues.map((each) => `${each.key}=${each.value}`).join(TAG_LIST_SEPARATOR));
  }
  argv.push("--why", why);
  if (home !== undefined) {
    argv.push("--home", home);
  }
  return shellCommandLine({ command: argv });
}

/**
 * The one line that tells a caller how to finish a tag write whose append failed, read off the journal AS IT NOW
 * IS. The recovery command converges only over a journal every line of which decodes: the tag verb refuses any
 * other. So when the failure left an undecodable line beside the append — a writer outside
 * the lock, or a hand edit — the line says to repair that first, naming it, rather than promising a command
 * that can only exit 1. Even over a clean journal the command converges only once the failure's own cause is gone
 * — a read-only journal fails the retry exactly as it failed the write — so it says so.
 *
 * @param command the recovery command {@link tagRecoveryCommand} built
 * @param journalPath the row's journal
 * @param unreadableLines the journal's undecodable line numbers now, or undefined when it could not be read at all
 * @returns the advice line, indented under the refusal
 */
export function tagRecoveryAdvice({
  command,
  journalPath,
  unreadableLines,
}: {
  command: string;
  journalPath: string;
  unreadableLines: readonly number[] | undefined;
}): string {
  if (unreadableLines === undefined) {
    return `  ${journalPath} could not be read back, so whether the tag landed is unknown — once it reads, run: ${command}`;
  }
  if (unreadableLines.length > 0) {
    return (
      `  ${journalPath} now holds undecodable line(s) ${unreadableLines.join(", ")}, and the tag may sit beside ` +
      `them — repair or remove those lines, then run: ${command}`
    );
  }
  return `  the append may have landed; once what stopped it above is fixed, this finishes it either way: ${command}`;
}

/**
 * Print how to finish a tag write whose append failed, judged against the journal after the failure.
 *
 * @param runsDir the runs directory the journal lives in
 * @param slug the row
 * @param request the request the command repeats
 * @param why the reason it records
 * @param home the state home, named only when it is not the default
 */
export function printTagRecovery({
  runsDir,
  slug,
  request,
  why,
  home,
}: {
  runsDir: string;
  slug: string;
  request: TagRequest;
  why: string;
  home: string | undefined;
}): void {
  const journal = readRunJournal({ runsDir, slug });
  const advice = tagRecoveryAdvice({
    command: tagRecoveryCommand({ home, request, slug, why }),
    journalPath: runJournalPath({ runsDir, slug }),
    unreadableLines: journal.isOk() ? journal.value.unreadable : undefined,
  });
  logger.error({ msg: advice });
}
