/**
 * The transient-references gate: the repository carries no reference that only means something to one
 * installation's history, and speaks of whoever runs it as "the owner", then they.
 *
 * ## Why this is a gate
 *
 * Slopweaver is generic to any checkout (`AGENTS.md` § Non-negotiable). A rule reads as the rule and its reason, in
 * the present tense; a measurement keeps its number and its repro command. What it does not keep is WHEN somebody
 * said it, WHICH turn, call or session it came from, which commit or pull request carried it, which knowledge row
 * or handover run recorded it, or the speaker's verbatim words: none of that is checkable from another checkout,
 * an id into one installation's store makes the repository depend on that store, and every one of them rots. The
 * text grew
 * from one installation, so the debt is large, and it is cleaned ONE FILE AT A TIME against every class at once,
 * so no file is opened twice. The debt list is what stops new text adding one behind the rewrite.
 *
 * ## The criterion, not a count
 *
 * Fifteen classes, declared in `transientReferencePatterns.ts` with the regions each reads
 * (`transientReferenceRegions.ts`): a human-written date in a plausible installation year, an ISO date, a time of
 * day, a commit hash, a pull request or issue number, an owner turn or ruling id, a session or transcript UUID, a
 * talk, call, artifact, relay or Codex pass id, a quotation attributed to a person, a masculine pronoun for the
 * owner (`ownerPronouns.ts`'s scanner, regex literals excluded), and five ids into one installation's state: a
 * knowledge or proposal row, a talk, call, transcript or session pointer by UUID (named, or held under a
 * session-like key such as `sessionId`, `callId`, `turnId` or `conversation_id`), a voice turn, a supervisor
 * chair by its counter (`handoff-<n>`, and the directory or fixture named for it), and a handover run or board row
 * cited as provenance. The regions: Markdown, YAML and shell whole; JSON and JSONL whole, as data;
 * CSS comments; TypeScript comments, strings, templates and JSX text, where under a `__tests__` segment only a
 * test's name is a string and every other literal is a fixture. A class whose shape a program also uses as data
 * (an ISO instant, a clock time, a hex digest, a UUID) reads TypeScript comments only, so a fixture or a schedule
 * is never counted. Only the state-row, state-pointer, voice-turn and chair-counter classes read fixtures and data,
 * and each allows the repository's reserved synthetic forms (a row tail of twelve zeroes and a four-digit number, or
 * the documented format example, `turn_` and eighteen zeroes and three digits, a UUID whose second group is `0000`,
 * a chair counter of 9000 or more), so a
 * test names a synthetic id, never a real one. Where two token
 * classes would match the same characters the earlier class in priority order is the finding, so one reference is
 * one finding: a call id whose tail is hex is a call id, never also a commit hash.
 *
 * ## A per-file, per-class debt list, held by a ratchet
 *
 * `.baselines/transient-references-baseline.json` names every file still carrying a reference, one entry per
 * class, at its count. The identity is `(path, kind)`, so a date removed never pays for a pull request number added
 * in the same file. The list is EXACT (`slackRefusalId: "transient-references-slack"`): an entry above what its
 * file now holds is refused as well as one below it, so a rewrite that removes a reference commits the tightened
 * list in the same change, and a cleaned file can never regain references up to its old count unseen. Tighten it
 * with `yarn devlint:transient-references-rebaseline`. When the list is empty the rule is absolute.
 *
 * ## Blind spots, stated rather than discovered
 *
 * - A history reference written in words ("the week the board was rebuilt", "last Tuesday") is invisible.
 * - A quotation the criterion cannot see attributed (no `owner` beside it) is invisible; one a person did not say
 *   but is attributed anyway is counted.
 * - A pull request number written bare (`3774` with no `#`, `PR` or URL) is invisible.
 * - A seven-character hex word with a digit (an example id) is counted as a hash; its rewrite uses a placeholder.
 * - A date or id built at runtime, or arriving as data, is invisible. So is a chair named by its bare counter
 *   (`--handoff 8`, "chair 8") without `handoff-` before it.
 * - A pull request number, hash or bare UUID in a test's fixture string, or in a code string for the hash and UUID
 *   classes, is data, and none but the identifier classes reads a JSON or JSONL file. Syntax cannot tell a real
 *   installation's id there from a synthetic one, and counting the shape would charge every parser test its own
 *   input. The identifier classes can, only because the repository RESERVES its synthetic forms: an id in another
 *   shape is taken as real, so a fixture spells a reserved one. A bare UUID in a fixture or JSON is data too:
 *   message, provider and object ids are random UUIDs, so only one under a session-like key is a pointer.
 * - A handover run or board row in a fixture literal or JSON is the NAMED RESIDUE: `handover-id` reads prose,
 *   comments and strings only. Run names have no reserved synthetic form the way ids do, and a test names the run
 *   it builds as a plain slug literal, so reading fixtures would charge every synthetic fixture slug.
 *   A real run's name in a fixture is caught by review, and the repository's are `acme-…` or plainly made up.
 * - A short hex head (`transcript:<8-hex>`) or a truncated turn id is outside the identifier classes, which want
 *   the whole id: `call-id` counts one in prose, a comment or a test name, but never in a fixture literal or JSON,
 *   since reading fixtures would charge every short parser fixture. A handover run named without backticks,
 *   `handover` beside it or `resume` is invisible too.
 * - A committed bump manifest is read like any other JSON. Main refuses a rewrite of one it holds, but deleting a
 *   landed one is allowed (`baselineComparison.ts`), so one that cites an install's id is deleted rather than kept.
 *   A new one is authored without the id in its `reason`.
 * - A word that refers to somebody other than the owner is counted by the pronoun class the same. Its rewrite
 *   names the person, which is clearer anyway.
 */

import { type CountEntry, type CountFinding, runCountRatchet } from "./countRatchet.js";
import { countEntryKey } from "./countRatchetCore.js";
import { scanOwnerPronouns } from "./ownerPronouns.js";
import { type ScanScope, isScannablePath as scopeIsScannablePath } from "./scanScope.js";
import { lineAt, lineTable } from "./transientReferenceLines.js";
import {
  type ClassMatch,
  candidateMatches,
  classMatches,
  dataCandidateMatches,
  TRANSIENT_CLASSES,
  type TransientClass,
} from "./transientReferencePatterns.js";
import { isDataPath, regionsOf } from "./transientReferenceRegions.js";

/** The committed debt list, repo-relative. */
const BASELINE_FILE = ".baselines/transient-references-baseline.json";

/**
 * The token pattern module and this gate's own test, which spell a date, a hash or a turn id as the example or the
 * fixture of what each class detects. Only the token classes skip them: a pronoun in either is counted like
 * anywhere else, which is why the test assembles the pronoun it feeds rather than spelling one.
 */
const TOKEN_SELF_FILES: ReadonlySet<string> = new Set([
  "src/devLint/transientReferencePatterns.ts",
  "src/__tests__/unit/devLint/transientReferences.test.ts",
]);

/**
 * The dev-gate handoff check and its test, whose `handoff-<n>` ids are a partition's own shard record ids
 * (`c-alpha/handoff-<n>`), never a supervisor chair. Only the `chair-counter` class skips them, by exact path; the same
 * literal anywhere else is counted.
 */
const CHAIR_COUNTER_GENERIC_FILES: ReadonlySet<string> = new Set([
  "src/devGate/handoffCheck.ts",
  "src/__tests__/unit/devGate/handoffCheck.test.ts",
]);

/**
 * The token candidates one file is judged on: none in a token self file, no chair counter in a file whose
 * `handoff-<n>` is a generic record id, only the data-reading classes in data.
 */
function candidatesFor({
  content,
  data,
  path,
}: {
  content: string;
  data: boolean;
  path: string;
}): readonly ClassMatch[] {
  if (TOKEN_SELF_FILES.has(path)) {
    return [];
  }
  const candidates = data ? dataCandidateMatches({ content }) : candidateMatches({ content });
  if (CHAIR_COUNTER_GENERIC_FILES.has(path)) {
    return candidates.filter((candidate) => candidate.name !== "chair-counter");
  }
  return candidates;
}

/** One counted reference: where it is, which class, the text it matched and the line it sits on. */
export interface TransientHit {
  readonly path: string;
  readonly line: number;
  /** The match's start offset, so two references on one line stay two findings. */
  readonly offset: number;
  readonly kind: TransientClass;
  readonly match: string;
  readonly preview: string;
}

/**
 * One file sorted into its counted references and its data-shaped tokens, each in source order. Pure: a TypeScript
 * or TSX file is parsed in memory, and only when a token class could match anywhere in its text at all.
 *
 * The data bucket is a token class's shape where that class does not read (a test's fixture string, a code string
 * a comment-only class skips): a date that exercises date logic, a digest a test compares. It is reported so a
 * final count says what was left as data, and is never debt. The pronoun class has no data bucket; its criterion is
 * `ownerPronouns.ts`'s own.
 *
 * @param path the file's repo-relative path, carried onto each hit and deciding which regions are read
 * @param content the file's text
 * @returns the counted references and the data-shaped tokens
 */
export function scanTransientFile({ path, content }: { path: string; content: string }): {
  readonly counted: readonly TransientHit[];
  readonly data: readonly TransientHit[];
} {
  const data = isDataPath({ path });
  // A data file is never read for a pronoun: JSON joined the scope for the identifier classes alone.
  const pronouns = data
    ? []
    : scanOwnerPronouns({ content, path }).map((hit): TransientHit => ({
        ...hit,
        kind: "owner-pronoun",
        match: hit.word,
      }));
  const candidates = candidatesFor({ content, data, path });
  if (candidates.length === 0) {
    return { counted: pronouns, data: [] };
  }
  const table = lineTable({ content });
  const hitOf = (found: ClassMatch): TransientHit => ({
    ...lineAt({ offset: found.start, table }),
    kind: found.name,
    match: content.slice(found.start, found.end),
    offset: found.start,
    path,
  });
  const sorted = classMatches({ candidates, regions: regionsOf({ content, path }) });
  return {
    counted: [...pronouns, ...sorted.counted.map(hitOf)].toSorted((a, b) => a.offset - b.offset),
    data: sorted.data.map(hitOf),
  };
}

/**
 * Every counted reference in one file, in source order. Pure.
 *
 * @param path the file's repo-relative path, carried onto each hit and deciding which regions are read
 * @param content the file's text
 * @returns each counted reference
 */
export function scanTransientReferences({ path, content }: { path: string; content: string }): readonly TransientHit[] {
  return scanTransientFile({ content, path }).counted;
}

/** A class's place in {@link TRANSIENT_CLASSES}, the order every report and the debt list use. */
const classRank = ({ kind }: { kind: string }): number => TRANSIENT_CLASSES.findIndex((one) => one === kind);

/**
 * Collapse a scan into one debt entry per file and class, in path then class order. Pure.
 *
 * @param hits every counted reference
 * @returns the counted entries, in the debt list's own order
 */
export function countsOf({ hits }: { hits: readonly TransientHit[] }): readonly CountEntry[] {
  const tally = new Map<string, { path: string; kind: TransientClass; count: number }>();
  for (const hit of hits) {
    const key = countEntryKey({ entry: hit });
    const standing = tally.get(key);
    tally.set(key, { count: standing === undefined ? 1 : standing.count + 1, kind: hit.kind, path: hit.path });
  }
  return [...tally.values()]
    .map(({ path, kind, count }) => ({ count, kind, path }))
    .toSorted((a, b) => a.path.localeCompare(b.path) || classRank(a) - classRank(b));
}

/**
 * How many references each class holds, every class in its fixed order with zeros kept, for the report a rewrite
 * quotes. Pure.
 *
 * @param hits every counted reference
 * @returns every class with its count
 */
export function classTally({
  hits,
}: {
  hits: readonly TransientHit[];
}): readonly { kind: TransientClass; count: number }[] {
  return TRANSIENT_CLASSES.map((kind) => ({ count: hits.filter((hit) => hit.kind === kind).length, kind }));
}

/**
 * This gate's declared scan predicate: every tracked prose, code and JSON or JSONL data file, tests included. A data
 * file, a committed bump manifest included, is read by the installation-state identifier classes alone.
 */
const SCOPE: ScanScope = {
  extensions: [".ts", ".tsx", ".md", ".mdx", ".sh", ".mmd", ".yml", ".yaml", ".css", ".json", ".jsonl"],
  // By exact path, and only the files that spell a pronoun as the thing they detect: the pronoun pattern module and
  // its test, the two the retired owner-pronouns gate already left out. This module, its entry and the region reader
  // are scanned like any other, and the token pattern module and this gate's test are scanned for pronouns
  // ({@link TOKEN_SELF_FILES}).
  selfFiles: new Set(["src/devLint/ownerPronouns.ts", "src/__tests__/unit/devLint/ownerPronouns.test.ts"]),
  trees: [],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/** One counted reference's own finding line. */
function findingOf({ hit }: { hit: TransientHit }): CountFinding {
  return { line: hit.line, path: hit.path, text: `${hit.kind} "${hit.match}": ${hit.preview}` };
}

/**
 * The clean line: the standing total, the entries, the per-class split a rewrite quotes, and per class what was
 * left as data rather than counted. Pure.
 *
 * @param hits every counted reference
 * @param data every data-shaped token the classes deliberately do not read
 * @param current the debt entries now standing
 * @returns one line
 */
export function cleanLineOf({
  hits,
  data,
  current,
}: {
  hits: readonly TransientHit[];
  data: readonly TransientHit[];
  current: readonly CountEntry[];
}): string {
  const split = ({ of }: { of: readonly TransientHit[] }): string =>
    classTally({ hits: of })
      .filter(({ kind }) => of !== data || kind !== "owner-pronoun")
      .map(({ kind, count }) => `${kind} ${String(count)}`)
      .join(", ");
  return (
    `${String(hits.length)} standing reference(s), ${String(current.length)} debt entr(ies): ${split({ of: hits })}; ` +
    `left as data, not counted: ${String(data.length)} (${split({ of: data })})`
  );
}

/**
 * IO edge: scan every in-scope tracked file, judge it against the committed debt list, or (`--rebaseline`) tighten
 * that list to what stands now.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard error)
 */
export function runTransientReferences(): number {
  const data: TransientHit[] = [];
  const scan = ({ path, content }: { path: string; content: string }): readonly TransientHit[] => {
    const sorted = scanTransientFile({ content, path });
    data.push(...sorted.data);
    return sorted.counted;
  };
  return runCountRatchet<TransientHit>({
    gate: {
      baselineFile: BASELINE_FILE,
      baselineKey: "files",
      kinded: true,
      cleanLine: ({ hits, current }) => cleanLineOf({ current, data, hits }),
      counts: countsOf,
      findingKeyOf: ({ hit }) => `${hit.path}:${String(hit.offset)}`,
      findingOf,
      gate: "transient-references",
      keyOf: ({ hit }) => countEntryKey({ entry: hit }),
      rebaselineRefusalId: "transient-references-rebaseline",
      refusalDetail: ({ regressions }) => `${String(regressions.length)} new or worsened debt entr(ies)`,
      refusalId: "transient-references",
      scan,
      scope: SCOPE,
      slackRefusalId: "transient-references-slack",
      unit: "reference(s)",
    },
  });
}
