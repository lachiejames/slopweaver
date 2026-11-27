/**
 * Every committed ratchet baseline, named once with its shape, and the one pure question asked of each: what
 * did this change LOOSEN against main's copy?
 *
 * ## Why the question is asked against main and not against the tree
 *
 * A ratchet that judged the tree against a baseline file in the SAME tree would let one pull request add a
 * violation and raise its own baseline, and CI would never compare the file against main's copy. The change
 * implementing a pull request must not be the one deciding to bump the ratchet. Each gate's own check still holds the tree to the committed file; this module holds
 * the committed file to main's, so the two together hold the tree to main — and a rise is a separate act
 * with its own witness (`./baselineBump.ts`, `src/codex/baselineBumpWitness.ts`).
 *
 * ## One row per file, one shape per row
 *
 * The files do not share a shape, and a single "bigger number is looser" rule would misjudge most of them:
 * file-size holds two arrays judged separately, no-silent-fallback keys on a pair, internal-exports and
 * untested-modules hold measureless sets, the clone ratchet a scalar and the CI job ratchet a map. So each
 * row declares its shape and {@link loosenings} reads it, failing closed on anything it cannot read.
 *
 * Two files are out BY NAME, in {@link UNRATCHETED_BASELINES}, each for a stated reason — and any file under
 * `.baselines/`, whatever its extension, that is in neither list and is not a bump manifest is refused at run
 * time ({@link strayBaselinesOf}), so a new ratchet cannot arrive unjudged.
 */

import { z } from "zod";
import { parseJson } from "../lib/jsonParse.js";
import { err, ok, type Result } from "../lib/result.js";

/** An array of rows, each identified by one or more string fields and optionally measured by one number. */
interface KeyedArrayShape {
  readonly kind: "keyed-array";
  /** The top-level array key. */
  readonly key: string;
  /** The fields that together identify a row. */
  readonly identity: readonly string[];
  /** The numeric field whose growth is a loosening; absent for a set, where only a NEW row loosens. */
  readonly measure?: string;
}

/** A shape a committed baseline can take. */
type BaselineShape =
  | KeyedArrayShape
  | { readonly kind: "string-set"; readonly key: string }
  | { readonly kind: "scalar"; readonly key: string }
  | { readonly kind: "numeric-map"; readonly key?: string };

/** One committed ratchet baseline: the file, and every part of it a loosening can live in. */
export interface RatchetBaseline {
  /** Repo-relative path. */
  readonly file: string;
  /** The parts judged, each on its own — a path moving between two arrays is NEW in the one it entered. */
  readonly shapes: readonly BaselineShape[];
}

const counted = ({ key }: { key: string }): KeyedArrayShape => ({
  identity: ["path"],
  key,
  kind: "keyed-array",
  measure: "count",
});

/** Every ratchet baseline this repository commits. Bound to `.baselines/` in both directions by its test. */
export const RATCHET_BASELINES: readonly RatchetBaseline[] = [
  { file: ".baselines/agent-doc-size-baseline.json", shapes: [{ ...counted({ key: "offenders" }), measure: "lines" }] },
  { file: ".baselines/app-copy-voice-baseline.json", shapes: [counted({ key: "files" })] },
  { file: ".baselines/ci-job-seconds.json", shapes: [{ kind: "numeric-map" }] },
  // The owner's approval, but a lap is judged against min(committed, approved) (`lapJudgedBaseline`), so raising an
  // approved number alone loosens the ratchet with the operational file untouched. A rise
  // here needs a manifest and a witness, and the witness reads the rise against the anchor the file names.
  { file: ".baselines/ci-job-seconds-approved.json", shapes: [{ key: "baseline", kind: "numeric-map" }] },
  { file: ".baselines/clone-baseline.json", shapes: [{ key: "filePairs", kind: "scalar" }] },
  { file: ".baselines/error-shape-threshold-baseline.json", shapes: [counted({ key: "directories" })] },
  // Its gate is folded into transient-references, which counts the same words as its owner-pronoun class. The row
  // stays while main still holds the file, so deleting it reads as one declared whole-file loosening, never a stray.
  { file: ".baselines/owner-pronouns-baseline.json", shapes: [counted({ key: "files" })] },
  // Its own gate wants an appended raise record too, but that record is self-attested: CI cannot resolve its
  // anchor, so a rise here needs a manifest and a witness like any other.
  { file: ".baselines/heap-ceilings.json", shapes: [{ key: "ceilingsMiB", kind: "numeric-map" }] },
  {
    file: ".baselines/file-size-baseline.json",
    shapes: [
      { ...counted({ key: "offenders" }), measure: "codeLines" },
      { ...counted({ key: "exempt" }), measure: "codeLines" },
    ],
  },
  // Authority rather than measurement: a row is a signed exception to the file-size cap, so a NEW row is the
  // loosening, and it needs a manifest and a witness like a raised floor row.
  {
    file: ".baselines/file-size-tradeoffs.json",
    shapes: [{ identity: ["path"], key: "tradeoffs", kind: "keyed-array" }],
  },
  {
    file: ".baselines/internal-exports-baseline.json",
    shapes: [{ identity: ["path", "name"], key: "symbols", kind: "keyed-array" }],
  },
  {
    file: ".baselines/naming-vocabulary-baseline.json",
    shapes: [{ ...counted({ key: "identifiers" }), identity: ["path", "name"] }],
  },
  // One row per instruction: the exact path and trimmed line, counted, so a second identical line is a rise.
  {
    file: ".baselines/no-python-baseline.json",
    shapes: [{ ...counted({ key: "instructions" }), identity: ["path", "matchedLine"] }],
  },
  {
    file: ".baselines/no-silent-fallback-baseline.json",
    shapes: [{ ...counted({ key: "sites" }), identity: ["path", "operator"] }],
  },
  { file: ".baselines/sync-child-timeout-baseline.json", shapes: [counted({ key: "files" })] },
  {
    file: ".baselines/torn-tail-append-baseline.json",
    shapes: [{ ...counted({ key: "appends" }), identity: ["path", "shape"] }],
  },
  // One entry per file AND class, so a class's row moving is judged on its own and a cut in one never pays for a
  // rise in another.
  {
    file: ".baselines/transient-references-baseline.json",
    shapes: [{ ...counted({ key: "files" }), identity: ["path", "kind"] }],
  },
  { file: ".baselines/unnamed-failure-assertion-baseline.json", shapes: [counted({ key: "sites" })] },
  { file: ".baselines/untested-modules-baseline.json", shapes: [{ key: "modules", kind: "string-set" }] },
  // A set: a second hit in a recorded file and shape is covered by its row, so only a NEW row loosens it.
  {
    file: ".baselines/whole-file-json-baseline.json",
    shapes: [{ identity: ["path", "shape"], key: "sites", kind: "keyed-array" }],
  },
];

/**
 * The parts whose identities are NAMES, never files — every keyed numeric map's key. `ceilingsMiB:package-script.build`
 * holds a dot and must still never read as a file a `widening` row could prove untouched. Derived, never listed.
 */
export const NAME_KEYED_PARTS: ReadonlySet<string> = new Set(
  RATCHET_BASELINES.flatMap((row) =>
    row.shapes.flatMap((shape) => (shape.kind === "numeric-map" && shape.key !== undefined ? [shape.key] : [])),
  ),
);

/**
 * The committed baselines that are NOT judged here, each with why. Named rather than silently skipped, so the
 * test binding the registry to `.baselines/` can tell a decision from an omission.
 */
const UNRATCHETED_BASELINES: Readonly<Record<string, string>> = {
  ".baselines/perf-baseline.json":
    "a profiler record `dev profile --record` writes, not a ratchet any gate refuses against",
  "coverage-baseline.json":
    "judged against the base commit already, by `coverage-ratchet`'s own history half, in the reverse direction",
};

/**
 * The source that decides what counts as a loosening and what witnesses one. A change to any of these, once
 * main holds it, is itself a loosening row (entry `policy`): otherwise a pull request could raise a baseline
 * and, in the same diff, move its file to {@link UNRATCHETED_BASELINES} or soften the comparator, and judge
 * itself by its own rules — the self-judging the against-main comparison closes, moved one layer up. Each gate's OWN measuring code
 * is not listed: weakening a gate in its own diff falls outside this comparison and is what the pairing floor's review reads.
 */
export const BASELINE_POLICY_FILES: readonly string[] = [
  "src/cli/commands/github/baselineBumpGate.ts",
  "src/codex/baselineBumpCheckouts.ts",
  "src/codex/baselineBumpCoverage.ts",
  "src/codex/baselineBumpFloor.ts",
  "src/codex/baselineBumpLanding.ts",
  "src/codex/baselineBumpPlacement.ts",
  "src/codex/baselineBumpWitness.ts",
  "src/codex/baselineBumpWitnessRun.ts",
  "src/codex/branchEvidenceRoots.ts",
  "src/codex/bumpRecordStore.ts",
  "src/codex/committedBumpManifests.ts",
  "src/codex/ledgerUnion.ts",
  "src/codex/originBinding.ts",
  "src/codex/orphanedEvidence.ts",
  "src/codex/orphanedEvidenceProbes.ts",
  "src/devLint/baselineAgainstMain.ts",
  "src/devLint/baselineBump.ts",
  "src/devLint/baselineComparison.ts",
  "src/devLint/baselineRegistry.ts",
];

/** The entry a policy-file row carries. */
export const POLICY_ENTRY = "policy";

/**
 * Where bump manifests are COMMITTED, beside the records in the state home (`src/codex/bumpRecordStore.ts`). A
 * landing CLI that predates the home reads a declaration only here, so a pull request may still add one, and the
 * current landing verbs read it too (`src/codex/committedBumpManifests.ts`). The stray check passes over a file
 * here a change adds, leaves byte-identical or deletes, and refuses one of main's it rewrites.
 */
export const COMMITTED_BUMP_DIR = ".baselines/bumps/";

/**
 * Whether a path sits where bump records used to be committed. Pure.
 *
 * @param path a repo-relative path
 * @returns `true` for anything under {@link COMMITTED_BUMP_DIR}, at any depth
 */
export function isCommittedBumpPath({ path }: { path: string }): boolean {
  return path.startsWith(COMMITTED_BUMP_DIR);
}

/**
 * The committed files under `.baselines/`, at any depth and of any extension, that are neither a judged
 * baseline nor one excluded by name. Pure.
 *
 * Every extension, because a gate repointed at `file-size-baseline.yaml` would otherwise read a raised file
 * the comparison never listed; every depth, because a file under `.baselines/` nothing reads is a file nothing
 * judges. A bump record is a stray here like any other: it lives in the state home.
 *
 * @param paths every repo-relative file path under `.baselines/` at one commit
 * @returns the strays, in the order given
 */
export function strayBaselinesOf({ paths }: { paths: readonly string[] }): readonly string[] {
  const known = new Set([...RATCHET_BASELINES.map((row) => row.file), ...Object.keys(UNRATCHETED_BASELINES)]);
  return paths.filter((path) => !known.has(path));
}

/** One thing a change loosened: a row that is new, larger, or gone from a file that held it. */
export interface Loosening {
  readonly file: string;
  /** `<part>:<identity>`, or `*` for the whole file. */
  readonly entry: string;
  /** The measure at main; `null` when the row is new there. */
  readonly from: number | null;
  /** The measure now; `null` when the file is gone. */
  readonly to: number | null;
}

/** A baseline that could not be read as its declared shape. */
export interface BaselineShapeError {
  readonly code: "BASELINE_SHAPE";
  readonly message: string;
  readonly file: string;
}

const shapeError = ({ file, detail }: { file: string; detail: string }): BaselineShapeError => ({
  code: "BASELINE_SHAPE",
  file,
  message: `${file}: ${detail}`,
});

/** One part of a file flattened to identity → measure (a set's rows measure 1). */
type Flat = ReadonlyMap<string, number>;

/**
 * Flatten one keyed array, refusing a duplicate identity and an ambiguous one. A compound identity is joined
 * with `#`, so a `#` in any part but the last would let two different rows share one key — `src/a.ts#b.ts`+`c`
 * and `src/a.ts`+`b.ts#c` — and a row swapped for another read as unchanged. Refusing it
 * keeps the join one-to-one, and keeps `pathOfEntry`'s split at the first `#` exact.
 */
function flattenKeyed({ value, shape }: { value: unknown; shape: KeyedArrayShape }): Flat | string {
  const rows = z.array(z.record(z.string(), z.unknown())).safeParse(value);
  if (!rows.success) {
    return `\`${shape.key}\` is not an array of rows`;
  }
  const flat = new Map<string, number>();
  for (const row of rows.data) {
    const parts = shape.identity.map((field) => row[field]);
    const measured = shape.measure === undefined ? 1 : row[shape.measure];
    if (parts.some((part) => typeof part !== "string") || typeof measured !== "number") {
      return `a \`${shape.key}\` row lacks its identity or its number`;
    }
    if (parts.slice(0, -1).some((part) => String(part).includes("#"))) {
      return `a \`${shape.key}\` row's ${shape.identity.slice(0, -1).join("/")} holds "#", so its identity is ambiguous`;
    }
    const id = `${shape.key}:${parts.join("#")}`;
    if (flat.has(id)) {
      return `duplicate row ${id}`;
    }
    flat.set(id, measured);
  }
  return flat;
}

/** Flatten one part of a parsed file to identity → measure. */
function flattenPart({ json, shape }: { json: Record<string, unknown>; shape: BaselineShape }): Flat | string {
  if (shape.kind === "keyed-array") {
    return flattenKeyed({ shape, value: json[shape.key] });
  }
  if (shape.kind === "string-set") {
    const set = z.array(z.string()).safeParse(json[shape.key]);
    if (!set.success || new Set(set.data).size !== set.data.length) {
      return `\`${shape.key}\` is not a list of distinct strings`;
    }
    return new Map(set.data.map((item) => [`${shape.key}:${item}`, 1]));
  }
  if (shape.kind === "scalar") {
    const scalar = json[shape.key];
    return typeof scalar === "number" ? new Map([[shape.key, scalar]]) : `\`${shape.key}\` is not a number`;
  }
  if (shape.key === undefined) {
    const map = z.record(z.string(), z.number()).safeParse(json);
    return map.success ? new Map(Object.entries(map.data)) : "not a map of names to numbers";
  }
  const nested = z.record(z.string(), z.number()).safeParse(json[shape.key]);
  if (!nested.success) {
    return `\`${shape.key}\` is not a map of names to numbers`;
  }
  return new Map(Object.entries(nested.data).map(([name, value]) => [`${shape.key}:${name}`, value]));
}

/**
 * Flatten a whole file's text, every declared part, into one identity → measure map. Pure.
 *
 * @param text the file's text
 * @param baseline the registry row naming its shape
 * @returns the flattened rows, or why the file is not its declared shape
 */
export function flattenBaseline({
  text,
  baseline,
}: {
  text: string;
  baseline: RatchetBaseline;
}): Result<Flat, BaselineShapeError> {
  const parsed = parseJson({ text });
  const json = parsed.isOk() ? z.record(z.string(), z.unknown()).safeParse(parsed.value) : undefined;
  if (json === undefined || !json.success) {
    return err(shapeError({ detail: "not a JSON object", file: baseline.file }));
  }
  const flat = new Map<string, number>();
  for (const shape of baseline.shapes) {
    const part = flattenPart({ json: json.data, shape });
    if (typeof part === "string") {
      return err(shapeError({ detail: part, file: baseline.file }));
    }
    for (const [id, measure] of part) {
      flat.set(id, measure);
    }
  }
  return ok(flat);
}

/**
 * Everything the head copy of one baseline loosened against main's copy. Pure.
 *
 * A row is loosened when it is NEW, or when its number GREW. A set's row has no number, so only a new row
 * loosens it. A file present at main and absent now is one `*` row, so deleting a ratchet's baseline cannot
 * pass as tidying. A file absent at both is nothing; absent at main and present now makes every row new.
 *
 * @param baseline the registry row
 * @param base main's text, `undefined` when main has no such file
 * @param head the change's text, `undefined` when the change has no such file
 * @returns each loosening in identity order, or why a copy could not be read
 */
export function loosenings({
  baseline,
  base,
  head,
}: {
  baseline: RatchetBaseline;
  base: string | undefined;
  head: string | undefined;
}): Result<readonly Loosening[], BaselineShapeError> {
  if (head === undefined) {
    return ok(base === undefined ? [] : [{ entry: "*", file: baseline.file, from: null, to: null }]);
  }
  return flattenBaseline({ baseline, text: head }).andThen((headFlat) => {
    if (base === undefined) {
      return ok(grownRows({ base: new Map(), file: baseline.file, head: headFlat }));
    }
    return flattenBaseline({ baseline, text: base }).map((baseFlat) =>
      grownRows({ base: baseFlat, file: baseline.file, head: headFlat }),
    );
  });
}

/**
 * Every row of `head` that is new against `base` or whose number grew, in identity order. Pure.
 *
 * @param file the baseline file the rows belong to
 * @returns the loosenings
 */
function grownRows({ file, base, head }: { file: string; base: Flat; head: Flat }): readonly Loosening[] {
  return [...head]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([entry, to]): Loosening[] => {
      const from = base.get(entry);
      if (from === undefined) {
        return [{ entry, file, from: null, to }];
      }
      return to > from ? [{ entry, file, from, to }] : [];
    });
}
