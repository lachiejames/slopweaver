/**
 * The repair half of the corpus hygiene gate: rewrite the bronze lines whose CREDENTIAL shapes survived the
 * redaction pass, using the redactor that ships today.
 *
 * ## Why a repair verb exists at all, rather than "re-ingest"
 *
 * `../corpus/redact.ts` was unanchored after the anchoring hole was found — a `\b` before each token shape
 * needs a word/non-word transition, so `<name>_client_secret=<prefix>_secret_<hash>` and a flattened
 * `x` + `sk-<key>` both walked straight past it. That fix governs the NEXT write and nothing else. Bronze
 * already on disk still carries whatever the anchored redactor let through, and compaction copies those rows
 * forward rather than re-scrubbing them, so the residue is permanent until something rewrites it.
 *
 * So older rows written by the anchored redactor can still hold client-secret-shaped values — a URL query
 * parameter pasted into a ticket or a message is the usual carrier — and `slopweaver audit hygiene --json`
 * reports each as a `client-secret` hit. A compacted file past V8's 512 MiB string ceiling hides them from any
 * scanner that reads a file whole, which is why the scan streams.
 *
 * ## It rewrites the LINE, never the record
 *
 * A parse-and-re-serialise repair would round-trip every field through whatever shape the reader models, so
 * a field it does not model is silently dropped from bronze. This applies {@link redactTokens} — the token
 * passes ALONE — to the raw JSONL line instead. No token pattern admits a `"`, a `\` or a brace, so a match
 * is always inside one JSON string value and `[token]` needs no escaping: every other byte of the line
 * survives byte for byte, including the timestamps `redactText`'s digit pass would have carved up.
 *
 * Only files that actually carry a credential hit are rewritten, and within them only the flagged lines are
 * touched. A file with nothing to repair is never opened for writing at all.
 */
import { join } from "node:path";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { redactTokens } from "../corpus/redact.js";
import { writeFileAtomicStream } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import type { CorpusHit } from "./corpusScan.js";

/**
 * What one file's repair changed.
 *
 * @internal — an element of {@link CorpusScrubResult}.
 */
export interface ScrubbedFile {
  /** The bronze file as `<source>/<window>.jsonl`, relative to the bronze root. */
  readonly file: string;
  /** How many lines this repair rewrote. */
  readonly linesRewritten: number;
  /** Lines the repair visited and left ALONE because the redactor changed nothing — never silently counted. */
  readonly linesUnchanged: number;
}

/**
 * What the whole repair changed.
 *
 * @internal — the declared shape of {@link scrubCorpusCredentials}'s return.
 */
export interface CorpusScrubResult {
  /** Every file the repair rewrote, in path order. */
  readonly files: readonly ScrubbedFile[];
  /** Every line the repair rewrote, across every file. */
  readonly linesRewritten: number;
  /** Files the repair could not read or write, named rather than skipped in silence. */
  readonly failed: readonly { readonly file: string; readonly reason: string }[];
}

/** The flagged 1-based line numbers, per bronze file, from a scan's failing arm. */
function linesByFile({ leaks }: { leaks: readonly CorpusHit[] }): ReadonlyMap<string, ReadonlySet<number>> {
  const byFile = new Map<string, Set<number>>();
  for (const hit of leaks) {
    const lines = byFile.get(hit.file);
    if (lines === undefined) {
      byFile.set(hit.file, new Set([hit.line]));
      continue;
    }
    lines.add(hit.line);
  }
  return byFile;
}

/**
 * Rewrite every bronze line a scan flagged as carrying a credential, scrubbing the token shapes out of it.
 *
 * @param home the Slopweaver home whose bronze is repaired
 * @param leaks the scan's FAILING arm — the only lines this touches
 * @param readLines the line reader, injected so the walk is testable without a corpus on disk
 * @param writeFile the atomic writer, injected for the same reason
 * @returns which files were rewritten, how many lines each gave up, and every file that could not be repaired
 */
export function scrubCorpusCredentials({
  home,
  leaks,
  readLines = ({ path, onLine }) => {
    readJsonlLines({
      onLine: ({ line, index }) => {
        onLine({ index, line });
      },
      path,
    });
  },
  writeFile = writeFileAtomicStream,
}: {
  home: string;
  leaks: readonly CorpusHit[];
  readLines?: (args: { path: string; onLine: (args: { line: string; index: number }) => void }) => void;
  writeFile?: (args: { path: string; produce: (args: { write: (args: { text: string }) => void }) => void }) => void;
}): CorpusScrubResult {
  const bronze = stateHomePaths({ home }).corpus.bronze;
  const files: ScrubbedFile[] = [];
  const failed: { file: string; reason: string }[] = [];
  for (const [file, flagged] of [...linesByFile({ leaks }).entries()].toSorted(([a], [b]) => a.localeCompare(b))) {
    const path = join(bronze, file);
    const counts = { rewritten: 0, unchanged: 0 };
    try {
      writeFile({
        path,
        produce: ({ write }) => {
          readLines({ onLine: rewriteLine({ counts, flagged, write }), path });
        },
      });
    } catch (error) {
      failed.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    files.push({ file, linesRewritten: counts.rewritten, linesUnchanged: counts.unchanged });
  }
  return { failed, files, linesRewritten: files.reduce((sum, one) => sum + one.linesRewritten, 0) };
}

/**
 * The per-line handler one file's rewrite runs: copy an unflagged line verbatim, scrub a flagged one.
 *
 * `readJsonlLines` delivers the trailing empty slice after a final newline exactly as `split("\n")` did, so
 * writing the separator BEFORE each line after the first reproduces the original byte layout — trailing
 * newline included — rather than adding or dropping one.
 *
 * @param flagged the 1-based line numbers the scan failed on
 * @param counts the running tally this handler advances
 * @param write the atomic writer's sink
 * @returns the handler to hand to the line reader
 */
function rewriteLine({
  flagged,
  counts,
  write,
}: {
  flagged: ReadonlySet<number>;
  counts: { rewritten: number; unchanged: number };
  write: (args: { text: string }) => void;
}): (args: { line: string; index: number }) => void {
  let first = true;
  return ({ line, index }) => {
    if (!first) {
      write({ text: "\n" });
    }
    first = false;
    if (!flagged.has(index + 1)) {
      write({ text: line });
      return;
    }
    const scrubbed = redactTokens({ text: line }).text;
    if (scrubbed === line) {
      counts.unchanged += 1;
    } else {
      counts.rewritten += 1;
    }
    write({ text: scrubbed });
  };
}

/**
 * Render a repair for a human.
 *
 * @param result what the repair changed
 * @returns the lines to print, in order
 */
export function renderCorpusScrub({ result }: { result: CorpusScrubResult }): readonly string[] {
  if (result.files.length === 0 && result.failed.length === 0) {
    return ["corpus hygiene --scrub: nothing to repair — no credential shape was found"];
  }
  return [
    `corpus hygiene --scrub: rewrote ${String(result.linesRewritten)} line(s) in ${String(result.files.length)} file(s)`,
    ...result.files.map(
      (one) =>
        `    ${one.file}: ${String(one.linesRewritten)} rewritten` +
        (one.linesUnchanged === 0
          ? ""
          : `, ${String(one.linesUnchanged)} flagged line(s) the redactor did not change — re-run the scan`),
    ),
    ...result.failed.map((one) => `    FAILED ${one.file}: ${one.reason}`),
    "  Re-run `slopweaver audit hygiene` to confirm the failing arm is empty. The vector and lexical indexes",
    "  are built from these files, so rebuild them if a rewritten record is one you query.",
  ];
}
