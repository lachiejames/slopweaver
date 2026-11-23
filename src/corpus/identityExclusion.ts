/**
 * The IDENTITY denylist — which names never reach an answer as though a person were behind them.
 *
 * ## What it is for
 *
 * Nine bad attendee names were already stored in bronze, and the repair is an exclusion mechanism like the
 * one that gates ingestion into the corpus, applied to identities: judge which names are obviously not real
 * people worth knowing about, then exclude exactly those ids.
 *
 * The constraint that shapes every line below: avoid heavy-handed heuristics for the most part. Get the
 * right info, use good judgment about what the owner would want, and avoid a global rule that later
 * proves harmful — exclude only the specific ones that are confidently low value.
 *
 * So this module holds **no rule that infers anything**. There is no comma detector, no "looks composite"
 * test, no length bound, no similarity score. There is a list of exact names somebody judged were not
 * people, and a whole-string comparison against it. That is the entire policy, and the absence of a
 * heuristic here is the ruling rather than an omission.
 *
 * ## Why the match is exact and whole-string, and can never be anything else
 *
 * The defect that produced the list is `bracketedOwners` storing a whole bracket as ONE attendee:
 * `[Ana Diaz, Bo Chen] Provide feedback…` became the single name `"Ana Diaz, Bo Chen"`, standing in a
 * roster **beside both of the real people it had joined**. So the excluded name
 * `"Ada Owner, Tobias Wren"` sits in the same roster as `"Ada Owner"` and as `"Tobias Wren"`, and
 * both of those are real people whose names must survive untouched.
 *
 * A substring match would therefore delete two real people to remove one phantom, and it would do it
 * silently. {@link isExcludedIdentity} compares whole normalised strings for that reason —
 * `unit/corpus/identityExclusion.test.ts` asserts the halves survive, which is the falsifiable witness that
 * this property still holds.
 *
 * ## Where it applies, and where it deliberately does not
 *
 * It applies where a record becomes INDEXED state — {@link ../store/admission.scrubExcludedIdentities},
 * called from the store ingest read. That is the same doctrine
 * {@link ./syncExclusion} runs on and for the same reason: **bronze is the durable capture and is never
 * edited**. The nine names stay on disk exactly as Gemini sent them; what changes is that no answer is
 * built out of them.
 *
 * Bronze is not merely left alone by convention here — editing it at read time would be actively wrong.
 * `compact.ts` reads window files through the BRONZE projection and rewrites them, so a filter applied in
 * {@link ./corpusStore.assembleCorpusRecord} would silently rewrite the operator's capture on the next
 * compaction. That is why this is an ingest-side scrub and not a decode-side one.
 *
 * ## Why the names live off-repo
 *
 * One install's phantom attendees are meaningless to every other install — per-install state, not a secret
 * (`AGENTS.md` § "no organisation names in what you commit"). This module ships the MECHANISM and names
 * nobody; the install supplies the list at `$SLOPWEAVER_HOME/identity-exclusion.txt`. An install with no
 * file excludes nothing, which is the correct default for a fresh home.
 */

import { loadLineListResult } from "../hygiene/scan.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * The resolved identity denylist: the names no indexed answer may present as a person.
 *
 * `names` holds each entry NORMALISED by {@link normaliseIdentityName}, because that is the only form a
 * membership test ever compares — storing the raw spelling as well would invite a caller to match on it.
 */
export interface IdentityExclusion {
  /** Every excluded name, normalised. */
  readonly names: ReadonlySet<string>;
  /** Where the list was read from, so a report can name the file rather than the concept. */
  readonly path: string;
}

/**
 * A denylist that excludes nobody — a fresh home, and the shape a caller with no home injects.
 *
 * @returns an exclusion holding no names, which admits every identity
 */
export function emptyIdentityExclusion(): IdentityExclusion {
  return { names: new Set(), path: "" };
}

/**
 * The single form a name is compared in: trimmed, inner whitespace collapsed to one space, lowercased.
 *
 * Only these three, and each earns its place against a name a provider actually emits — a roster line split
 * on `", "` leaves ragged edges, Gemini wraps long brackets so a name can carry a newline, and display-name
 * casing is not stable across providers. Nothing here strips punctuation: the comma in
 * `"Tobias Wren, Rosa Lindqvist"` is the very thing that makes the entry identifiable, and removing it would
 * start collapsing distinct names into one another.
 *
 * @returns the comparable form of this name
 */
export function normaliseIdentityName({ name }: { name: string }): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Parse the denylist's lines into the set a membership test reads.
 *
 * Exported because it is the whole policy contract and the only part worth testing without a file. Every
 * non-blank, non-comment line is one whole name; there is no field separator and no scope, because a name
 * that is not a person is not a person anywhere. A line that normalises to nothing is a malformed entry
 * rather than a silently-dropped one — an operator who typed a stray quote wants to be told.
 *
 * @param lines the non-blank, non-comment lines already read from the file
 * @param path where they came from, carried into the result so a report can name the file
 * @returns the resolved denylist, or every malformed line, since an operator fixing a list wants them all
 */
export function parseIdentityExclusionLines({
  lines,
  path,
}: {
  lines: readonly string[];
  path: string;
}): Result<IdentityExclusion> {
  const names = new Set<string>();
  const problems: string[] = [];

  lines.forEach((line) => {
    const normalised = normaliseIdentityName({ name: line });
    if (normalised.length === 0) {
      problems.push(`${path}: "${line}" normalises to an empty name — an entry must name somebody`);
      return;
    }
    names.add(normalised);
  });

  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ names, path });
}

/**
 * Read the install's identity denylist.
 *
 * An ABSENT file excludes nobody and is not an error: that is a fresh home. An UNREADABLE file IS an error,
 * matching {@link ./syncExclusion.loadSyncExclusion} — a run that shrugged at an unreadable list would index
 * the very names the list exists to keep out and report an ordinary success, which is the silent failure
 * this whole mechanism was asked for to prevent.
 *
 * @param home the Slopweaver home (defaults to the resolved home)
 * @param readText the reader, injected so a test needs no file
 * @returns the resolved denylist, or the reason the existing file could not be used
 */
export function loadIdentityExclusion({
  home,
  readText,
}: {
  home?: string;
  readText?: (args: { path: string }) => string;
} = {}): Result<IdentityExclusion> {
  const path = stateHomePaths(home === undefined ? {} : { home }).identityExclusion;
  const loaded = loadLineListResult({ path, ...(readText === undefined ? {} : { readText }) });
  if (loaded.kind === "unreadable") {
    return err([
      `identity exclusion list at ${path} exists but could not be read (${loaded.reason}). Refusing to ` +
        `index with an empty list — that would silently re-admit every name the list exists to keep out.`,
    ]);
  }
  if (loaded.kind === "absent") {
    return ok({ names: new Set(), path });
  }
  return parseIdentityExclusionLines({ lines: loaded.lines, path });
}

/**
 * Whether one name is on the list.
 *
 * Whole-string, never a substring — see this module's overview for why that is load-bearing rather than a
 * detail of the comparison.
 *
 * @returns true when this exact name was judged not to be a person
 */
export function isExcludedIdentity({ name, exclusion }: { name: string; exclusion: IdentityExclusion }): boolean {
  return exclusion.names.has(normaliseIdentityName({ name }));
}

/**
 * Drop every excluded name from a roster, preserving the order of the survivors.
 *
 * @param names the roster as stored
 * @returns the surviving names, and how many were removed so a caller can report rather than guess
 */
export function excludeIdentities({ names, exclusion }: { names: readonly string[]; exclusion: IdentityExclusion }): {
  readonly names: readonly string[];
  readonly removed: number;
} {
  const kept = names.filter((name) => !isExcludedIdentity({ exclusion, name }));
  return { names: kept, removed: names.length - kept.length };
}
