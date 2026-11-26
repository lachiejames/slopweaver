/**
 * The whole-file-JSON gate — a ratchet against the defect class this repository found five separate times,
 * one instance at a time, over three weeks, and never once as a class.
 *
 * ## The criterion, in one sentence
 *
 * **A payload whose size is set by DATA rather than by code may not pass through one JS string.**
 *
 * That is the whole rule. `JSON.stringify` and `JSON.parse` are not banned and could not usefully be — this
 * tree makes 585 `JSON.stringify` calls outside tests, and almost all of them serialise one record, one log
 * line or one `--json` report, each bounded by the code that shapes it. Banning the CALL would bury the
 * three shapes that actually hurt under several hundred that never can. So the gate names the three shapes,
 * and each carries its own signal for "this one is sized by data".
 *
 * ## What it refuses, and the signal for each
 *
 * **A · A `.jsonl` read whole.** `readFileSync` / `readFile` on a path that resolves to a `.jsonl`. In this
 * repository a `.jsonl` is an append-only record stream with no ceiling — a bronze window, a door ledger, an
 * ask lifecycle, a grant journal, a transcript. Its size is the org's history, never the code's. There is no
 * legitimate exception, which is why this shape carries no baseline entry it can hide behind. Measured: the
 * largest bronze window on this install is 2.34 GB, read as one `utf8` string that is up to 4.7 GB of
 * transient heap, and anything past 512 MiB does not read at all — V8 throws `Cannot create a string longer
 * than 0x1fffffe8 characters`. The refusal names `readJsonlLines` (`src/corpus/corpusStore.ts`), whose own
 * doc already declares it "the only way any Slopweaver code may read a data-scale `.jsonl`" — a categorical
 * rule that, until this gate, nothing enforced.
 *
 * **B · A `.jsonl` written whole.** `writeFileSync` / `writeFileAtomic` on a `.jsonl` path: every record
 * joined into one string before a byte reaches disk. The refusal names `writeFileAtomicStream`
 * (`src/lib/writeAtomic.ts`), which exists precisely so a file's bytes can be produced rather than held.
 *
 * **C · A corpus-derived value serialised whole.** `writeJsonFile` in a module that also READS the corpus.
 * This is the `unbounded-spread` gate's signal reused, and for the same reason: the dangerous and the safe
 * call are syntactically identical, and what separates them is where the value came from. A module that
 * calls `readCorpusDir` / `readJsonlLines` / `readAll{Members,Structures,History}` derives its values from
 * every record in the corpus, so what it writes is sized by the corpus too. This is the shape that wrote
 * `silver/graph/graph.json`: one `JSON.stringify` of 282 MiB of edges producing a 295,700,000-character
 * string, copied three times, 3,982 MiB RSS — 55% of the way to the same string wall.
 *
 * ## The false-positive criterion, stated rather than allowlisted
 *
 * A payload is OUT OF SCOPE when its size is fixed by the code that declares it — a config object, a
 * watermark, a per-ask dispatch record, a `--json` report of one bounded page, a test fixture. The gate
 * never has to ask how big those are, because none of the three signals above can reach them: they are not
 * `.jsonl`, and they are not written by a module that reads the corpus. That is the stated criterion, and it
 * is why this file holds no list of blessed call sites.
 *
 * ## Resolving a path to a `.jsonl` without a type checker
 *
 * A first pass indexes the repo's own path helpers by NAME: a function whose returned expression IS a
 * `.jsonl` path, and an object property whose initializer is. A name qualifies only when it is
 * UNAMBIGUOUS — every assignment to it in the tree names a `.jsonl`. That criterion is what keeps `path`,
 * `from` and `source` out of the index while keeping `asksJsonl`, `doorLedger` and `bronzeFile` in: a name
 * used for both proves nothing, so it proves nothing here either. A first, coarser version of this pass
 * matched any name whose declaration merely MENTIONED a `.jsonl` anywhere in its body and reported 176 hits,
 * almost all of them a local called `path`; the unambiguity criterion took the same tree to 22.
 *
 * **The pass follows a helper, not only a literal.** A path helper in this repository rarely spells its
 * `.jsonl`: `askLifecyclePath()` returns `stateHomePaths(…).live.slack.asksJsonl`, `queueLogPath()` returns
 * `join(dir, QUEUE_FILE)`, and only the name each reaches THROUGH carries the literal. So the pass runs to a
 * fixpoint ({@link indexJsonlNames}): round one indexes what is spelled, every later round re-judges each
 * declaration against the names the round before proved, and it stops when a round adds none. What a
 * declaration must be to qualify is `resolvesToJsonl` (`jsonlPathResolution.ts`) — a literal, an indexed
 * property's last segment, a call to an indexed helper, a `join`/`resolve` over one of those, or either arm
 * of a conditional — and deliberately NOT "mentions one somewhere", which at the index would admit every reader
 * that touches a ledger and feed itself with them. Before this, the gate recorded 9 of the 26 whole-file
 * `.jsonl` reads on this tree and reported itself clean; the sharpest
 * miss was one file read two ways, `turn/freeze.ts` caught reading `asks.jsonl` as a property access while
 * the listener's own `live/ask/store.ts` read the same file invisibly behind `askLifecyclePath`. Closing
 * it took the `jsonl-read-whole` DEBT from 12 files to 29, and every newly-visible site is a helper-hidden
 * read of a real ledger.
 *
 * A property access is judged on its LAST segment rather than its root, so
 * `stateHomePaths({ home }).corpus.gmailHistory` is judged on `gmailHistory` — which names a `.json` — and
 * not on `stateHomePaths`, whose body necessarily mentions every `.jsonl` path in the home.
 *
 * A path parked in a local before the read (`const p = asksJsonl(); readFileSync(p)`) used to be invisible
 * here, and it is not any more — {@link indexLocalJsonlPaths} indexes one file's own unambiguous path
 * locals and the argument pass answers for them. That limit was not hypothetical while it stood: it is
 * exactly the shape `src/atlas/jumpcloud/resume.ts` used to read a 2,024,469,872-byte resume journal past
 * V8's 512 MiB string wall on every sync, catching the throw and reporting zero completed calls, so the
 * atlas re-walked 85,839 calls it had already made and never published a generation at all. Closing it took
 * this tree from 14 recorded hits to 17 across 13 DEBT entries; all three newly-visible sites are the same
 * real defect and none is a shape the criterion should not have matched. A parameter or destructured
 * binding of the same name counts as a declaration that does NOT name a `.jsonl`, so a file whose `path`
 * local holds a ledger and whose `({ path, html })` page-writing callback binds the same word has an
 * ambiguous `path` rather than a phantom `.jsonl` write — the one false positive following a helper
 * produced, in `src/cli/commands/briefing/renderRun.ts`, and it was fixed by sharpening the criterion.
 *
 * One limit remains, stated rather than discovered: a helper reached through an injected dependency is
 * still invisible, and so is a local initialised from another local. This is a tripwire rather than a
 * fence, the same posture AGENTS.md rule 3 states for its own gates: **a block confirms you were wrong, its
 * absence means nothing.**
 *
 * ## Why no `ts.Program`
 *
 * `devLint.ts`'s header is explicit that a second whole-repo `ts.Program` pays the ~2 GB `named-object-params`
 * already pays. Every signal above is syntactic, so this gate builds none — it is one
 * `withSourceFile` per file, once per index round plus once for the scan. Re-parsing per round is
 * deliberate: MEASURED, holding every parsed source across rounds would keep 546 MiB of heap
 * (908 MiB RSS) for 3,442 files, against roughly 1.4 s per parse pass and three rounds on this tree. A
 * gate against holding too much in memory has no business being the gate that costs the most of it.
 *
 * Pure {@link indexJsonlNames} + {@link scanWholeFileJson} (unit-tested on inline fixtures, so this file
 * never scans itself); the effectful {@link runWholeFileJson} edge reads every source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Result } from "#lib/result.js";
import type { NodeVisitor } from "#lib/tsSyntax.js";
import { forEachChild, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { decodeDebtList, identitiesAreUnique, readCommittedInput } from "./decodeDebtList.js";
import type { DevLintInputError } from "./errors.js";
import { calleeName, indexLocalJsonlPaths, type JsonlNameIndex, pathNamesJsonl } from "./jsonlPathResolution.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";
import { indexJsonlNames } from "./wholeFileJsonIndex.js";

/**
 * Which of the three shapes a hit is.
 *
 * @internal — the scanner's and the debt list's own shape name; nothing outside this gate names it.
 */
export type WholeFileJsonShape = "jsonl-read-whole" | "jsonl-write-whole" | "corpus-payload-whole";

/** One whole-file-JSON hit. */
export interface WholeFileJsonHit {
  readonly path: string;
  readonly line: number;
  readonly shape: WholeFileJsonShape;
  readonly excerpt: string;
}

/** Reads that pull a whole file into one string. `readJsonlLines` is deliberately absent — it is the fix. */
const WHOLE_FILE_READS: ReadonlySet<string> = new Set(["readFileSync", "readFile"]);

/** Writes that push a whole file out of one string. `writeFileAtomicStream` is absent for the same reason. */
const WHOLE_FILE_WRITES: ReadonlySet<string> = new Set(["writeFileSync", "writeFileAtomic"]);

/** The corpus readers whose presence makes a module's values corpus-scale — `unbounded-spread`'s signal. */
const CORPUS_READS: ReadonlySet<string> = new Set([
  "readCorpusDir",
  "readJsonlLines",
  "readAllMembers",
  "readAllStructures",
  "readAllHistory",
]);

/** The whole-payload JSON file write. */
const WHOLE_PAYLOAD_JSON_WRITE = "writeJsonFile";

/**
 * Whether a write call is an APPEND — `{ flag: "a" }` in its options. An append's payload is the batch it
 * hands over, never the file it lands in, so its size is set by the code that built the batch: `dev lint`
 * appending one line per gate result is bounded by the number of gates, however long the ledger grows. This
 * is the false-positive criterion for shape B, and it is a property of the call rather than a list of sites.
 *
 * @param call the write call
 * @param source the file being scanned, for text
 * @returns true when the call appends rather than replaces
 */
function isAppend({ call, source }: { call: ts.CallExpression; source: ts.SourceFile }): boolean {
  return call.arguments.some(
    (argument) => ts.isObjectLiteralExpression(argument) && /\bflag\s*:\s*["']a["']/.test(argument.getText(source)),
  );
}

/** The `path:` property of a single object-literal argument, which is how this repo's writers take one. */
function optionsPath({ call }: { call: ts.CallExpression }): ts.Expression | undefined {
  const first = call.arguments[0];
  if (first === undefined || !ts.isObjectLiteralExpression(first)) {
    return undefined;
  }
  for (const property of first.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === "path") {
      return property.initializer;
    }
  }
  return undefined;
}

/**
 * Pure: every whole-file-JSON hit in one file. A module that never reads the corpus yields no shape-C hit
 * however many JSON files it writes, and a file that touches no `.jsonl` yields no A or B hit at all.
 *
 * @param path the file's repo-relative path (for reporting)
 * @param content the file's text
 * @param index the tree-wide `.jsonl` name index from {@link indexJsonlNames}
 * @returns each hit, in source order (empty when clean)
 */
export function scanWholeFileJson({
  path,
  content,
  index,
}: {
  path: string;
  content: string;
  index: JsonlNameIndex;
}): readonly WholeFileJsonHit[] {
  const readsCorpus = [...CORPUS_READS].some((name) => new RegExp(`\\b${name}\\b`).test(content));
  return withSourceFile({
    fileName: path,
    text: content,
    use: (source): readonly WholeFileJsonHit[] => {
      const locals = indexLocalJsonlPaths({ index, source });
      const hits: WholeFileJsonHit[] = [];
      const record = ({ node, shape }: { node: ts.Node; shape: WholeFileJsonShape }): void => {
        hits.push({
          excerpt: node.getText(source).replace(/\s+/g, " ").slice(0, 120),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          path,
          shape,
        });
      };
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node)) {
          const shape = shapeOfCall({ call: node, index, locals, readsCorpus, source });
          if (shape !== undefined) {
            record({ node, shape });
          }
        }
        forEachChild({ node, visit });
      };
      visit(source);
      return hits;
    },
  });
}

/**
 * Which shape one call expression is, or undefined when it is none of them. The three tests are mutually
 * exclusive by construction — a read is not a write, and neither is `writeJsonFile` — so this returns the
 * first that matches rather than a set.
 *
 * @param call the call to classify
 * @param index the tree-wide `.jsonl` name index
 * @param locals this file's own names bound to a `.jsonl` path, from {@link indexLocalJsonlPaths}
 * @param readsCorpus whether the enclosing module reads the corpus, which is shape C's whole signal
 * @param source the file being scanned, for text
 * @returns the shape, or undefined when the call is bounded
 */
function shapeOfCall({
  call,
  index,
  locals,
  readsCorpus,
  source,
}: {
  call: ts.CallExpression;
  index: JsonlNameIndex;
  locals: ReadonlySet<string>;
  readsCorpus: boolean;
  source: ts.SourceFile;
}): WholeFileJsonShape | undefined {
  const name = calleeName({ call });
  const positional = call.arguments[0];
  if (WHOLE_FILE_READS.has(name) && positional !== undefined) {
    return pathNamesJsonl({ expression: positional, index, locals, source }) ? "jsonl-read-whole" : undefined;
  }
  if (WHOLE_FILE_WRITES.has(name) && !isAppend({ call, source })) {
    const target = optionsPath({ call }) ?? positional;
    if (target !== undefined && pathNamesJsonl({ expression: target, index, locals, source })) {
      return "jsonl-write-whole";
    }
    return undefined;
  }
  if (readsCorpus && name === WHOLE_PAYLOAD_JSON_WRITE) {
    return "corpus-payload-whole";
  }
  return undefined;
}

/**
 * The committed DEBT, in `.baselines/whole-file-json-baseline.json` — every site the criterion above already
 * refuses on this tree, measured by running this gate (`yarn tsx src/devLint/wholeFileJson.entry.ts`).
 * Reproduce it on any branch with that command against an empty baseline.
 *
 * **This is a debt list, not an allowlist, and the distinction is the whole point.** Every entry there is a
 * real defect the criterion correctly names; none is a shape the criterion should not have matched. A false
 * positive is fixed by sharpening the criterion (see {@link isAppend}, which retired the one shape B found
 * that was genuinely bounded), never by adding a line here. `owes` names the handover run that owns the
 * fix, so a reader can see who is holding it rather than inferring that nobody is.
 *
 * The seven `silver/derive/pipeline.ts` entries are `stream-the-dense-vector-leg-off-a-flat`'s work, which
 * has measured its fix (derive write 5,701 -> ~3,200 MiB) and has not raised its PR yet. Carrying those in the
 * baseline is what lets this gate land WITH that run rather than in front of it.
 *
 * Three more — `src/footprint/ledger.ts`, `src/handover/runStore.ts` and
 * `src/outbound/proposal/register/store.ts` — are what the path-local sharpening made visible. Each parks
 * its path in a local and then hands the whole text to a pure `parse*Journal({ text })`, so fixing one
 * means restructuring that parser to take a line at a time rather than editing the read. MEASURED on this
 * install when they were recorded, none is near the wall yet: the largest run journal is 130,332 bytes,
 * the footprint ledger 6,873, the largest register journal 2,335. That is why they are recorded as debt
 * rather than fixed inside the run that found them — the gate is now watching all three, which is the
 * property that was missing.
 *
 * Sixteen more — every `*Store.ts` from `src/admit/queueStore.ts` to
 * `src/supervisor/intakeStore.ts` in that file — are what following a helper made visible: each reads its ledger
 * through a `<name>Path()` that returns `stateHomePaths(…).<x>Jsonl` or `join(dir, <CONST>)`, and not one of
 * them spells `.jsonl` at the read. Before them 9 of 26
 * whole-file `.jsonl` reads were recorded, and the list roughly tripled: it went from 12
 * `jsonl-read-whole` files to 28. `src/live/ask/store.ts` is the sharpest of them — `turn/freeze.ts` was
 * already recorded for reading `asks.jsonl` as a property access, while the LISTENER's own read of the same
 * file behind `askLifecyclePath` was not. MEASURED on this install when they were recorded, none is near
 * the wall: `sessions/sessions.jsonl` is the largest at 1,440,269 bytes, `live/slack/asks.jsonl` 550,435,
 * `live/recipe/lifecycle.jsonl` 222,319, and eight of the sixteen are under 10 KB or absent. Each returns
 * the whole text as a `read*Text()` or hands it to a pure `parse*({ text })`, so the fix is the parser taking a line
 * at a time, not an edit at the read — the same shape as the three above.
 *
 * `src/live/listen/handoffInboxStore.ts` was a seventeenth, caught on a rebase as the class REGENERATED
 * rather than being discovered. It is GONE: the burst queue it carried survivors for was removed because every
 * tag is judged, so the whole transport went with it and its row went with that. A debt that stops firing because its file no longer exists is the honest way off this list.
 *
 * The gate refuses a STALE entry as loudly as a new hit: once a run lands its fix, its rows must go, or
 * `whole-file-json` fails. That is what makes this a ratchet that tightens on its own rather than a baseline
 * that quietly outlives the debt it records; and being a registered baseline, a row added there is a loosening
 * against main that only a witnessed bump record lands.
 */
const BASELINE_FILE = ".baselines/whole-file-json-baseline.json";

/** One recorded site: a module's relationship to one shape, and the run that owns its fix. */
interface WholeFileJsonDebt {
  readonly path: string;
  readonly shape: WholeFileJsonShape;
  readonly owes: string;
}

/**
 * One row of the committed list: a shape this gate names, and a non-blank owner. Strict, and one row per path and
 * shape, so an unread field or a second row for one identity is refused rather than dropped or folded into the first.
 */
const BaselineSchema = z.strictObject({
  sites: z
    .array(
      z.strictObject({
        owes: z.string().trim().min(1),
        path: z.string().min(1),
        shape: z.enum(["jsonl-read-whole", "jsonl-write-whole", "corpus-payload-whole"]),
      }),
    )
    .refine((rows) => identitiesAreUnique({ identity: (row) => `${row.path} ${row.shape}`, rows })),
});

/**
 * Decode the committed debt list's text. Pure.
 *
 * @param text the contents of `.baselines/whole-file-json-baseline.json`
 * @returns the recorded sites, or which half of the decode failed
 */
export function parseWholeFileJsonBaseline({
  text,
}: {
  text: string;
}): Result<readonly WholeFileJsonDebt[], DevLintInputError> {
  return decodeDebtList({
    label: "whole-file-json baseline",
    schema: BaselineSchema,
    shape: "{ sites: [{ path, shape, owes }, …] }, one row per path and shape",
    text,
  }).map((baseline) => baseline.sites);
}

/**
 * Split a scan's hits into the ones the committed list already records and the ones it does not, plus the
 * debt entries nothing matched any more. Keyed on `path` + `shape` rather than a line number, so moving a
 * call within its file is not a gate failure and adding a second one in the same file and shape is not
 * either — the unit of debt is a module's relationship to a class, not a coordinate.
 *
 * @param hits every hit the scan produced
 * @param debt the recorded debt
 * @returns the unrecorded hits and the stale debt entries, both in report order
 */
export function partitionAgainstDebt({
  hits,
  debt,
}: {
  hits: readonly WholeFileJsonHit[];
  debt: readonly WholeFileJsonDebt[];
}): { readonly fresh: readonly WholeFileJsonHit[]; readonly stale: readonly string[] } {
  const keyOf = ({ path, shape }: { path: string; shape: WholeFileJsonShape }): string => `${path} ${shape}`;
  const recorded = new Set(debt.map((entry) => keyOf(entry)));
  const seen = new Set(hits.map((hit) => keyOf(hit)));
  return {
    fresh: hits.filter((hit) => !recorded.has(keyOf(hit))),
    stale: debt.filter((entry) => !seen.has(keyOf(entry))).map((entry) => `${entry.path} (${entry.shape})`),
  };
}

/**
 * This gate's declared scan predicate: a `.ts` file under `src/`, `eval/` or `hooks/`, excluding tests (a
 * fixture builds its own bounded payloads and a replay fixture is deliberately read whole) and this gate's
 * own files, whose text necessarily contains the shapes it names.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "wholeFileJson" }),
  trees: ["src/", "eval/", "hooks/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the file should be scanned
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/** The refusal each shape prints — the streaming alternative this repo already has, named at the hit. */
const REMEDY: Readonly<Record<WholeFileJsonShape, string>> = {
  "corpus-payload-whole":
    "This module reads the corpus, so what it writes is sized by the corpus. One `JSON.stringify` of it is\n" +
    "one string the size of the whole payload — 295,700,000 characters for silver/graph/graph.json, copied\n" +
    "three times, at 3,982 MiB RSS. Write the records as `.jsonl` through `writeFileAtomicStream`\n" +
    "(src/lib/writeAtomic.ts), one line per record, or prove the payload is bounded and move it out of this\n" +
    "module.",
  "jsonl-read-whole":
    "A `.jsonl` is an append-only record stream with no ceiling, so this reads the whole of it into one JS\n" +
    "string — 4.7 GB of transient heap for the largest bronze window on this install, and a hard throw past\n" +
    "512 MiB (`Cannot create a string longer than 0x1fffffe8 characters`). Use `readJsonlLines`\n" +
    "(src/corpus/corpusStore.ts), which delivers one line at a time behind a bounded chunk.",
  "jsonl-write-whole":
    "This joins every record into one string before a byte reaches disk, so the peak is the whole file.\n" +
    "Use `writeFileAtomicStream` (src/lib/writeAtomic.ts): it hands you a `write` you may call per record,\n" +
    "and still replaces the target atomically and durably.",
};

/**
 * Print the stale half of a verdict: debt entries nothing matched any more, which must be deleted so the
 * ratchet keeps its new floor.
 *
 * @param stale the debt entries that no longer fire
 */
function reportStale({ stale }: { stale: readonly string[] }): void {
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "whole-file-json-debt" }),
      detail: `${String(stale.length)} DEBT entr(ies) no longer fire`,
    })}\n`,
  );
  for (const entry of stale) {
    process.stderr.write(`  ${entry}\n`);
  }
}

/**
 * Print the fresh half of a verdict: hits the debt does not record, grouped by shape so each group carries
 * the one remedy that answers it rather than repeating three per hit.
 *
 * @param fresh the unrecorded hits
 */
function reportFresh({ fresh }: { fresh: readonly WholeFileJsonHit[] }): void {
  for (const shape of ["jsonl-read-whole", "jsonl-write-whole", "corpus-payload-whole"] as const) {
    const group = fresh.filter((hit) => hit.shape === shape);
    if (group.length === 0) {
      continue;
    }
    process.stderr.write(`\n  ${shape} (${String(group.length)}):\n`);
    for (const hit of group) {
      process.stderr.write(`    ${hit.path}:${String(hit.line)}: ${hit.excerpt}\n`);
    }
    // devlint: not-a-refusal -- a correction body: the per-shape remedy, which genuinely differs by shape
    process.stderr.write(`\n${REMEDY[shape]}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "whole-file-json" }),
      detail: `${String(fresh.length)} NEW whole-in-memory payload(s)`,
    })}\n`,
  );
}

/**
 * Scan every in-scope source once the tree is known: index the `.jsonl` path helpers in a first pass, then
 * classify each file against that index. Split from {@link runWholeFileJson} so the runner is a verdict
 * rather than a scan plus a verdict.
 *
 * @param root the repository root
 * @param scanned every in-scope repo-relative path
 * @returns the hits, whether the scan covered everything it claimed, and how many files it read
 */
function scanTree({ root, scanned }: { root: string; scanned: readonly string[] }): {
  readonly hits: readonly WholeFileJsonHit[];
  readonly complete: boolean;
  readonly readCount: number;
} {
  const readText = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");
  const index = indexJsonlNames({ sources: scanned.map((path) => ({ content: readText({ path }), path })) });
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<WholeFileJsonHit>({
    paths: scanned,
    readText,
    scan: ({ content, path }) => scanWholeFileJson({ content, index, path }),
  });
  const complete = reportScanIntegrity({
    label: "whole-file-json",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  return { complete, hits, readCount };
}

/**
 * IO edge: scan the tree, judge it against the committed debt list, print whichever halves of the verdict have
 * something to say, and return 0 (clean) or 1 (a new hit, a stale debt entry, or an incomplete scan).
 *
 * @returns the process exit code
 */
export function runWholeFileJson(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("whole-file-json: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const debt = readCommittedInput({ kind: "debt list", path: join(root, BASELINE_FILE) }).andThen((text) =>
    parseWholeFileJsonBaseline({ text }),
  );
  if (debt.isErr()) {
    // devlint: not-a-refusal -- the committed debt list could not be READ, so the gate has nothing to judge against
    process.stderr.write(`whole-file-json: ${debt.error.message}\n`);
    return 1;
  }
  const { hits, complete, readCount } = scanTree({ root, scanned });
  const { fresh, stale } = partitionAgainstDebt({ debt: debt.value, hits });
  if (stale.length > 0) {
    reportStale({ stale });
  }
  if (fresh.length > 0) {
    reportFresh({ fresh });
  }
  if (fresh.length > 0 || stale.length > 0 || !complete) {
    return 1;
  }
  process.stdout.write(
    `whole-file-json: clean (${String(readCount)} sources scanned, ${String(hits.length)} recorded in ${BASELINE_FILE})\n`,
  );
  return 0;
}
