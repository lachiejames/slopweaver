/**
 * The hygiene gate, pointed at the CORPUS instead of at the repository.
 *
 * ## Why the existing gate does not already cover this
 *
 * {@link ./repoScan.runScan} enumerates `git ls-files`, so it checks what is about to leave the machine in a
 * commit and never looks at `$SLOPWEAVER_HOME` at all. That is right for its job and leaves a real question
 * unanswered for a mailbox: bronze is written by a redaction pass, and nothing until now ever CHECKED that
 * pass's output. Mail is the most secret-shaped source this program reads — a signature block, a password
 * reset, a shared API key pasted into a thread — so "the scrub handles it" was a claim resting on the
 * scrub's own tests rather than on the bytes that were actually written.
 *
 * This runs the SAME patterns and the SAME private denylist over the bronze JSONL, so a leak class the repo
 * gate flags in a commit is one the corpus gate can find on disk.
 *
 * ## Two arms, and only ONE of them fails
 *
 * A credential shape and an identifier shape mean different things on a corpus, and collapsing them is how
 * this verb shipped red on the only corpus it had. The split is shared with `./scan.ts` rather than invented
 * here — {@link ./scan.isSecretHit} is this gate's decision, and the repository gate's `isRefusedHit` is the
 * same one plus a real workspace id or a forbidden identifier wherever `IDENTIFIER_VERDICT` reads `refuse`.
 *
 * **Credential shapes FAIL.** An `xoxb-` token, a `sk-` key, a `github_pat_` in bronze is a secret that
 * survived the redaction pass, and it is exactly what a mailbox adds to the risk surface that Slack and
 * Linear do not. Disclosure is itself the harm, so there is no reading on which one belongs here. An
 * unreadable bronze file fails too, because a file the gate did not check is not a file it found clean.
 *
 * **Identifiers are REPORTED.** A raw workspace id or an absolute home path says who or where something is;
 * it is not a secret, and a world model of the owner's own activity is full of both. Measured on the first
 * whole-mailbox bronze this verb ever scanned — 1,907 records, `slopweaver audit hygiene --source gmail
 * --json` — the failing arm produced **262 hits: 261 `raw-workspace-id` and 1 `absolute-home-path`, and not
 * one of them was a credential.**
 *
 * The 261 resolve to 40 distinct tokens, and the interesting half is that MOST OF THEM ARE REAL. Eight are
 * genuine Slack channel and user ids, riding inside the notification URLs Slack's own emails carry — and
 * the gmail projection writes those same URLs into a record's `refs`, which is the corpus cross-referencing
 * itself, the exact behaviour `derive` builds its graph out of. The other 32 are ~168-character uppercase
 * link tokens sitting in URL path segments, matched only because the pattern has no upper length bound.
 * So the pattern is not malfunctioning; it is answering a question the corpus never asked it. The single
 * `absolute-home-path` was a `/home/<name>` inside an email BODY — a correspondent's own path, not this
 * machine's user, and not a redaction miss.
 *
 * That is the argument in one line: gating on an identifier would mean a corpus FAILS ITS OWN HYGIENE CHECK
 * for successfully recording who said something and where.
 *
 * **A private-denylist word FAILS, with the credentials.** It used to be a third, report-only arm, on the
 * reasoning that a world model of an organisation's own activity is SUPPOSED to contain that organisation's
 * private words — a team name, an internal domain, a project slug; the same scan found 766 of them. That was
 * right for the mandate the denylist had then. That mandate is retired: an internal name is a
 * corpus's own subject, not a secret, so the list no longer holds one, and what it holds instead is a literal
 * SECRET no pattern here can express. A secret in bronze is a redaction miss whether a regex or a word found it, and an arm that
 * reported one and passed would be a hole in the only line left.
 *
 * A gate that is red on every corpus that has ever ingested anything is not a gate — it is a line of output
 * nobody reads, and the moment it is routinely overridden it stops catching the credential it exists for.
 * So the identifier arm carries its locations and never gates.
 *
 * ## It reports a LOCATION, never an excerpt
 *
 * {@link ./repoScan.runScan} prints the matched text, which is right for a repository: the reader owns the file
 * and needs to see what tripped. Printing the match here would take mail content — the exact thing being
 * guarded — and put it in a terminal, a transcript and quite possibly a pull request. So a corpus hit
 * carries its leak class, its file, its line and the record's `sourceId`, and the operator opens the record
 * themselves with `slopweaver gmail read`. A denylist hit does not even name the word it matched, for the
 * same reason the scanner does not contain the words.
 *
 * Effectful only through the injected reader, so the whole classification is exercised on synthetic JSONL.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { absentAs } from "#lib/absent.js";
import { type OwnerProtectionResolver, type ProtectedSkip, protectedSkipLine } from "../corpus/bronzeProtection.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import type { CorpusSource } from "../corpus/types.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { judgedBronzeFiles } from "./corpusScanFiles.js";
import { isSecretHit, loadDenylistResult, scanContent } from "./scan.js";

/**
 * One leak found in the corpus, located but never quoted.
 *
 * @internal — an element of {@link CorpusScanResult}; callers read the whole result.
 */
export interface CorpusHit {
  /** The bronze file as `<source>/<window>.jsonl`, relative to the bronze root. */
  readonly file: string;
  /** The 1-based line within that file, which is one JSONL record. */
  readonly line: number;
  /** The leak class the scanner recognised — or `denylist` for a private-denylist word. */
  readonly label: string;
  /** The record's own id, so the operator can open it at the source. Absent when the line would not parse. */
  readonly sourceId: string | undefined;
}

/**
 * How many locations a REPORT-ONLY arm carries into the result.
 *
 * The two report-only arms are unbounded in the DATA, which is the property that makes them report-only in
 * the first place: MEASURED over the whole corpus (12 bronze files, 2,226,826 records,
 * `slopweaver audit hygiene --json`), they held **2,369,805 identifiers and 106,140 org words** — more hits
 * than there are records, because one record can carry several. Carried whole they made the `--json`
 * document 406 MB and the human report 2.4 million lines, which is the data-sized-payload class AGENTS.md
 * bans rather than a verbose report. A sample plus an exact total answers every question either arm is for:
 * the counts say how much there is, and the sample says what one looks like.
 *
 * The FAILING arm is deliberately NOT capped — a credential is actionable one row at a time, and an operator
 * cannot scrub what the report declined to name.
 */
const REPORTED_LOCATION_CAP = 50;

/**
 * A report-only arm: its exact size, its shape breakdown, and a bounded sample of where to look.
 *
 * @internal — a member of {@link CorpusScanResult}.
 */
export interface ReportedArm {
  /** Every hit in this arm, counted — never capped, so the number is the truth about the corpus. */
  readonly total: number;
  /** How many hits each leak class contributed, counted over ALL of them rather than over the sample. */
  readonly byLabel: Readonly<Record<string, number>>;
  /** The first {@link REPORTED_LOCATION_CAP} locations, in scan order. */
  readonly sample: readonly CorpusHit[];
}

/**
 * What one corpus scan established.
 *
 * @internal — the declared shape of `scanCorpusHygiene`'s return; the CLI shell destructures it.
 */
export interface CorpusScanResult {
  /**
   * SECRET hits — a token or key shape, or a private-denylist word, that survived the redaction pass. These,
   * alone, FAIL.
   */
  readonly leaks: readonly CorpusHit[];
  /**
   * IDENTIFIER hits: a raw workspace id or an absolute home path. Located so a reader can check one, and
   * never a failure — a corpus of the owner's own activity is made of these. See the module note for the
   * 262-hit measurement, none of them a credential, that moved this arm out of the failing one.
   */
  readonly identifiers: ReportedArm;
  /** How many bronze files were read. */
  readonly filesScanned: number;
  /** How many JSONL lines were checked. */
  readonly linesScanned: number;
  /** Whether the private denylist was actually loaded, so a clean result cannot hide an unloaded one. */
  readonly denylistLoaded: boolean;
  /** How many words the private denylist contributed. */
  readonly denylistWords: number;
  /** Files the scan enumerated and could not read — never checked, and never reported as clean. */
  readonly unreadable: readonly string[];
  /**
   * What the owner's protect list put out of the scan's reach: never listed or opened, so NOT CHECKED, and named on
   * every run. Not a failure, because the owner's own ruling narrowed the scan, and failing on it would make the gate
   * and the protect list permanently incompatible.
   */
  readonly protectedSkipped: readonly ProtectedSkip[];
}

/** The `sourceId` of one JSONL line, when the line parses and carries one. */
function sourceIdOf({ line }: { line: string }): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const id = isRecord(parsed) ? parsed["sourceId"] : undefined;
  return typeof id === "string" ? id : undefined;
}

/** A report-only arm mid-scan: counted in full, sampled up to the cap. */
interface ArmTally {
  total: number;
  readonly byLabel: Map<string, number>;
  readonly sample: CorpusHit[];
}

/** An empty tally. */
function emptyTally(): ArmTally {
  return { byLabel: new Map<string, number>(), sample: [], total: 0 };
}

/** Count one hit into a tally, keeping its location only while the sample is under the cap. */
function tally({ arm, hit }: { arm: ArmTally; hit: CorpusHit }): void {
  arm.total += 1;
  // A leak class's first hit opens its count; the `get` below then reads the entry this line just proved.
  if (!arm.byLabel.has(hit.label)) {
    arm.byLabel.set(hit.label, 0);
  }
  arm.byLabel.set(hit.label, arm.byLabel.get(hit.label)! + 1);
  if (arm.sample.length < REPORTED_LOCATION_CAP) {
    arm.sample.push(hit);
  }
}

/** Freeze a tally into the shape the result declares. */
function reportedArm({ arm }: { arm: ArmTally }): ReportedArm {
  return {
    byLabel: Object.fromEntries([...arm.byLabel.entries()].toSorted(([a], [b]) => a.localeCompare(b))),
    sample: arm.sample,
    total: arm.total,
  };
}

/**
 * Record one hit in whichever of the two arms it belongs to.
 *
 * Dispatching here rather than returning a verdict string keeps the arms exhaustive by construction: there
 * is nowhere for a label to go except one of them, so a pattern added to `./scan.ts` cannot fall through and
 * be silently dropped from every report.
 *
 * @param hit the located hit, already stripped of its excerpt
 * @param credentials the FAILING arm, kept in full
 * @param identifiers the report-only arm for ids and paths
 */
function recordHit({
  hit,
  credentials,
  identifiers,
}: {
  hit: CorpusHit;
  credentials: CorpusHit[];
  identifiers: ArmTally;
}): void {
  if (isSecretHit({ label: hit.label })) {
    credentials.push(hit);
    return;
  }
  tally({ arm: identifiers, hit });
}

/**
 * Scan ONE bronze file, line by line, recording every hit into the arms.
 *
 * Returns `undefined` rather than throwing on an unreadable file, because the caller's answer to that is a
 * name in the `unreadable` list, not an aborted scan — and a count of zero would be indistinguishable from a
 * file that genuinely held nothing.
 *
 * @param file the bronze path, relative to the bronze root
 * @param bronze the bronze root
 * @param denylist the local secret strings, loaded once by the caller
 * @param arms the two destinations a hit can land in
 * @param readLines the injected line reader
 * @returns how many non-empty lines were checked, or undefined when the file could not be read through
 */
function scanOneFile({
  file,
  bronze,
  denylist,
  arms,
  readLines,
}: {
  file: string;
  bronze: string;
  denylist: readonly string[];
  arms: { credentials: CorpusHit[]; identifiers: ArmTally };
  readLines: (args: { path: string; onLine: (args: { line: string; index: number }) => void }) => void;
}): number | undefined {
  let scanned = 0;
  try {
    readLines({
      onLine: ({ line, index }) => {
        if (line.length === 0) {
          return;
        }
        scanned += 1;
        for (const hit of scanContent({ content: line, denylist, path: file })) {
          const located: CorpusHit = {
            file,
            label: hit.label,
            // `scanContent` saw ONE line, so every hit it reports is on its line 1; the file-relative
            // number is the reader's own 0-based index.
            line: index + 1,
            // The excerpt is deliberately DROPPED here rather than carried — see the module note.
            sourceId: sourceIdOf({ line }),
          };
          recordHit({ ...arms, hit: located });
        }
      },
      path: join(bronze, file),
    });
  } catch {
    return undefined;
  }
  return scanned;
}

/** The production line reader: {@link readJsonlLines}, handing each line on as its index and text. */
const streamBronzeLines = ({
  path,
  onLine,
}: {
  path: string;
  onLine: (args: { line: string; index: number }) => void;
}): void => {
  readJsonlLines({
    onLine: ({ line, index }) => {
      onLine({ index, line });
    },
    path,
  });
};

/**
 * Scan one source's bronze — or all of it — for the same leak classes the repository gate scans for.
 *
 * Bronze is read ONE LINE AT A TIME through {@link readJsonlLines}, never as one string. That is the house
 * rule for a data-scale `.jsonl` (AGENTS.md § "Never let a data-sized payload through one JS string"), and
 * here it was also the difference between a gate and a gap: MEASURED on this install, a
 * whole-file `readFileSync` threw `Cannot create a string longer than 0x1fffffe8 characters` on
 * `linear/compact.jsonl` (630 MB) and `slack/compact.jsonl` (6.4 GB), so the two largest sources in the
 * corpus were reported as `unreadable` — enumerated, failing the run, and never actually checked for a
 * credential. Reproduce the sizes with
 * `find "$SLOPWEAVER_HOME/corpus/bronze" -name '*.jsonl' -exec du -h {} +`.
 *
 * @param home the Slopweaver home whose bronze is scanned
 * @param source the source to scan, or undefined for every source
 * @param readLines the line reader, injected so the unreadable branch is testable without chmod
 * The owner's protect list refuses the scan when an entry covers the bronze root itself, and an `Err` is never a clean
 * scan. Below the root a covered source or file, a symlink resolving into a protected tree included, is skipped
 * unlisted and unopened, and named in `protectedSkipped`.
 *
 * @param listFiles the directory lister, injected for the same reason
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns what the scan found, and what it could not read — or the protect list's refusal
 */
export function scanCorpusHygiene({
  home,
  source,
  readLines = streamBronzeLines,
  listFiles = ({ dir }) => readdirSync(dir),
  protection,
}: {
  home: string;
  source: CorpusSource | undefined;
  readLines?: (args: { path: string; onLine: (args: { line: string; index: number }) => void }) => void;
  listFiles?: (args: { dir: string }) => readonly string[];
  protection?: OwnerProtectionResolver | undefined;
}): Result<CorpusScanResult> {
  const bronze = stateHomePaths({ home }).corpus.bronze;
  const judged = judgedBronzeFiles({ bronze, home, listFiles, protection, source });
  if (judged.isErr()) {
    return err(judged.error);
  }
  const { files: wanted, protectedSkipped } = judged.value;
  const loaded = loadDenylistResult({ home });
  const denylist = loaded.kind === "loaded" ? loaded.lines : [];
  const leaks: CorpusHit[] = [];
  const identifiers = emptyTally();
  const unreadable: string[] = [];
  let linesScanned = 0;
  let filesScanned = 0;
  for (const file of wanted) {
    const scanned = scanOneFile({
      arms: { credentials: leaks, identifiers },
      bronze,
      denylist,
      file,
      readLines,
    });
    if (scanned === undefined) {
      // The same rule the repository gate applies: a file the gate could not read is a file it did not
      // check, and reporting clean over it is the silent failure the gate exists to prevent. A partial
      // read counts as unreadable too — the hits found before the throw stay reported, and the file is
      // still named as NOT CHECKED rather than silently half-covered.
      unreadable.push(file);
      continue;
    }
    filesScanned += 1;
    linesScanned += scanned;
  }
  return ok({
    denylistLoaded: loaded.kind === "loaded",
    denylistWords: denylist.length,
    filesScanned,
    identifiers: reportedArm({ arm: identifiers }),
    leaks,
    linesScanned,
    protectedSkipped,
    unreadable,
  });
}

/**
 * The one line every rendering of a scan names its protected skips with, or none when nothing was skipped.
 *
 * @param result what the scan established
 * @returns the line, as both the gate and the operator report print it
 */
export function protectedSkipLines({ result }: { result: CorpusScanResult }): readonly string[] {
  if (result.protectedSkipped.length === 0) {
    return [];
  }
  const named = result.protectedSkipped.map((skip) => protectedSkipLine({ skip })).join(", ");
  return [`  NOT CHECKED, protected by the owner's list: ${named}`];
}

/** One hit as `<file>:<line>  <label>  <sourceId>`, indented for a report section. */
function locationLine({ hit, withLabel }: { hit: CorpusHit; withLabel: boolean }): string {
  const label = withLabel ? `${hit.label}  ` : "";
  return `    ${hit.file}:${String(hit.line)}  ${label}${absentAs({ value: hit.sourceId, whenAbsent: "(unparsed)" })}`;
}

/** The report heading's scope: a scan run without a source filter reads every bronze source, so it says so. */
function scanScope({ source }: { source: CorpusSource | undefined }): string {
  if (source === undefined) {
    return "every source";
  }
  return source;
}

/**
 * A report-only arm's sample locations, saying so when the arm holds more than the sample shows.
 *
 * The "and N more" line is the point rather than a nicety: a truncated list that does not announce its own
 * truncation is a report that reads as complete, which is the same false-completeness this whole file is
 * about.
 *
 * @param arm the counted arm
 * @param withLabel whether each line names the leak class (org words never do — see the module note)
 * @returns the sample lines, plus a remainder line when one is owed
 */
function sampleLines({ arm, withLabel }: { arm: ReportedArm; withLabel: boolean }): readonly string[] {
  const remaining = arm.total - arm.sample.length;
  return [
    ...arm.sample.map((hit) => locationLine({ hit, withLabel })),
    ...(remaining === 0 ? [] : [`    … and ${String(remaining)} more (use --json for the counts, not the list)`]),
  ];
}

/**
 * Render a corpus scan for a human — locations only, never the matched text.
 *
 * Each arm says in its own heading whether it fails and WHY, rather than leaving a reader to infer it from
 * the exit code. A report whose sections all look alike is what made the identifier arm read as a leak for
 * as long as it did.
 *
 * @param result what the scan established
 * @param source the source it was bounded to, for the heading
 * @returns the lines to print, in order
 */
export function renderCorpusScan({
  result,
  source,
}: {
  result: CorpusScanResult;
  source: CorpusSource | undefined;
}): readonly string[] {
  const scope = scanScope({ source });
  const byLabel = new Map<string, number>();
  for (const hit of result.leaks) {
    // A leak class's first hit opens its count; the `get` below then reads the entry this loop just proved.
    if (!byLabel.has(hit.label)) {
      byLabel.set(hit.label, 0);
    }
    byLabel.set(hit.label, byLabel.get(hit.label)! + 1);
  }
  return [
    `corpus hygiene — ${scope}`,
    `  scanned: ${String(result.filesScanned)} bronze file(s), ${String(result.linesScanned)} record(s)`,
    // Stated ALWAYS, not only on a failure: a clean report from a gate that never loaded the private words
    // is the exact false green this whole family of checks exists to avoid.
    result.denylistLoaded
      ? `  private denylist: LOADED, ${String(result.denylistWords)} word(s) applied`
      : "  private denylist: NOT LOADED — this scan checked leak CLASSES only, not local secret strings " +
        "(create $SLOPWEAVER_HOME/hygiene-denylist.txt)",
    ...(result.unreadable.length === 0 ? [] : [`  FAIL — NOT CHECKED, unreadable: ${result.unreadable.join(", ")}`]),
    ...protectedSkipLines({ result }),
    ...(result.leaks.length === 0
      ? ["  secrets: none — no token, key shape or denylist word survived the redaction pass. The FAILING arm."]
      : [
          `  FAIL — secrets: ${String(result.leaks.length)}. A secret in bronze is the one thing here that`,
          "    is harmful merely by existing, so this arm and an unreadable file are all that gate the run.",
          ...[...byLabel.entries()]
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([label, count]) => `    ${label}: ${String(count)}`),
          "  locations (the matched text is deliberately NOT printed — open the record at its source):",
          ...result.leaks.map((hit) => locationLine({ hit, withLabel: true })),
        ]),
    ...(result.identifiers.total === 0
      ? []
      : [
          `  identifiers: ${String(result.identifiers.total)} hit(s) — reported, NOT a failure.`,
          "    An id or a path says who or where something is; it is not a secret, and a world model of your",
          "    own activity is made of them — a Slack id in a notification email is the corpus cross-",
          "    referencing itself, and the same shape also matches long link tokens in a URL. Worth a look",
          "    before one reaches a PR or a post, never a gate — read the label to see which shape matched.",
          ...Object.entries(result.identifiers.byLabel).map(([label, count]) => `    ${label}: ${String(count)}`),
          ...sampleLines({ arm: result.identifiers, withLabel: true }),
        ]),
  ];
}
