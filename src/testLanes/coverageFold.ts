/**
 * How a test lane folds its raw V8 coverage dumps into one process coverage, without re-normalising every
 * script it already holds on every dump — and still hands upstream exactly what its own fold would hold.
 *
 * ## What upstream does, and why it is quadratic here
 *
 * `@vitest/coverage-v8` 4.1 folds a lane's dumps one at a time: `merged = mergeProcessCovs([merged, coverage])`,
 * then restores any `startOffset` the merge dropped from the dump just read. `mergeProcessCovs` touches EVERY
 * script it is handed: a script the dump carries is merged with the dump's copy (the multi-input path), and every
 * other script is re-normalised on its own (the single-input path). So each dump pays for the whole merged set
 * so far, not for the ~47 scripts it carries. A non-isolated lane writes one dump per test FILE, which is what
 * makes that bite: a 1/6 shard holds ~1,430 files, and its fold is the largest single block of the
 * single-threaded coverage step that runs after every test has finished.
 *
 * MEASURED on a Mac under fleet load: shard 2/6 spent `Generate coverage total time
 * 109061 ms`, of which reading the 1,427 dumps (the fold) was 06:16:13.9 to 06:17:22.7, about 69s. Replaying a
 * 1/12 slice's 714 snapshotted dumps offline, the upstream fold took 20.3s and a touched-only fold 0.77s.
 * Re-measure the shard with:
 *
 * ```bash
 * DEBUG=vitest:coverage yarn vitest run --config config/vitest/unit.ts --coverage --shard=2/6 --maxWorkers=4 --reporter=dot
 * ```
 *
 * ## Why this is the same answer, not an approximation of it
 *
 * The single-input normalisation is NOT idempotent on a multi-input merge's output: one more pass can join two
 * adjacent ranges of equal count the merge left apart (reproduced against the installed
 * package). So skipping the untouched scripts outright is not exact, and neither is handing a plain folded
 * result to upstream's own fold, which normalises every script once more. This fold EMULATES upstream instead:
 *
 * - each held script counts the single-input passes upstream would have applied to it since its last merge
 *   (`owed`), and pays them, in order, just before its next merge or at the handoff. A pass that changes nothing
 *   ends the payment, since the pass is deterministic and every later one would change nothing either — which
 *   is what keeps it linear: nearly every script is a fixpoint after one pass;
 * - the newest dump is HELD rather than merged, and the handoff places each script it carries beside the dump's
 *   own copy in one process coverage, so upstream's one remaining step takes the multi-input path for those, the
 *   single-input path for the rest, and its `startOffset` restore reads the held dump's value — exactly as its
 *   per-dump step on that last dump would have.
 *
 * `unit/testLanes/coverageFold.test.ts` drives both over Codex's counterexample and forty generated lanes and
 * asserts the results byte-identical.
 */

/** One block range of a function's coverage. */
interface CoverageRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

/** One script's V8 coverage, as far as the fold reads it. */
export interface ScriptCoverage {
  readonly url: string;
  startOffset?: number;
  readonly functions: readonly { readonly functionName: string; readonly ranges: readonly CoverageRange[] }[];
}

/** A process coverage: what one dump holds, and what upstream's fold accumulates. */
export interface ProcessCoverage<Script extends ScriptCoverage> {
  readonly result: Script[];
}

/** One merged script, and how many single-input passes upstream would have applied to it since that merge. */
interface HeldScript<Script> {
  readonly script: Script;
  readonly owed: number;
}

/** The fold's state between the dumps of one project and environment. */
export interface CoverageFold<Script extends ScriptCoverage> {
  /** Every script merged so far, by url. */
  readonly scripts: ReadonlyMap<string, HeldScript<Script>>;
  /** The newest dump, not merged yet: {@link handoffCoverage} gives it to upstream's own step. */
  readonly held: ProcessCoverage<Script> | undefined;
}

/** The two `@bcoe/v8-coverage` operations the fold calls, injected so this module stays pure and imports nothing. */
export interface CoverageOps<Script extends ScriptCoverage> {
  /** `mergeProcessCovs`, the merge upstream's own fold calls. */
  readonly merge: (processCovs: readonly ProcessCoverage<Script>[]) => ProcessCoverage<Script>;
  /** One single-input pass, `mergeScriptCovs([script])`: it normalises the script deeply, in place. */
  readonly normalize: (script: Script) => Script;
}

/**
 * The fold before any dump.
 *
 * @returns a fold holding no script and no dump
 */
export function emptyCoverageFold<Script extends ScriptCoverage>(): CoverageFold<Script> {
  return { held: undefined, scripts: new Map() };
}

/** A script's ranges as plain numbers, taken BEFORE a pass that rewrites them in place. */
function rangesOf({ script }: { script: ScriptCoverage }): string[] {
  return script.functions.map(
    (fn) =>
      `${fn.functionName}:${fn.ranges.map((range) => `${String(range.startOffset)},${String(range.endOffset)},${String(range.count)}`).join(";")}`,
  );
}

/**
 * Pay a script the single-input passes upstream would have applied to it, stopping at the first that changes nothing.
 *
 * @param held the script and its owed passes
 * @param ops the injected normalisation
 * @returns the script with every owed pass applied
 */
function settle<Script extends ScriptCoverage>({
  held,
  ops,
}: {
  held: HeldScript<Script>;
  ops: CoverageOps<Script>;
}): Script {
  let script = held.script;
  for (let pass = 0; pass < held.owed; pass += 1) {
    const before = rangesOf({ script }).join("\n");
    script = ops.normalize(script);
    if (rangesOf({ script }).join("\n") === before) {
      break;
    }
  }
  return script;
}

/**
 * Upstream's per-dump step, paid only for the scripts the dump carries: merge them with it, restore `startOffset`
 * from it, and owe every other script the single-input pass upstream would have applied to it.
 *
 * @param scripts the scripts merged before this dump
 * @param dump the dump being merged
 * @param ops the injected merge and normalisation
 * @returns the scripts after this dump
 */
function mergeDump<Script extends ScriptCoverage>({
  scripts,
  dump,
  ops,
}: {
  scripts: ReadonlyMap<string, HeldScript<Script>>;
  dump: ProcessCoverage<Script>;
  ops: CoverageOps<Script>;
}): ReadonlyMap<string, HeldScript<Script>> {
  const carried = new Set(dump.result.map((script) => script.url));
  const next = new Map<string, HeldScript<Script>>();
  const touched: Script[] = [];
  for (const [url, held] of scripts) {
    if (carried.has(url)) {
      touched.push(settle({ held, ops }));
    } else {
      next.set(url, { owed: held.owed + 1, script: held.script });
    }
  }
  for (const script of ops.merge([{ result: touched }, dump]).result) {
    // Upstream's restore: a multi-input merge drops `startOffset`, and the dump just read supplies it. Zero is
    // what upstream writes when the dump has none.
    if (!script.startOffset) {
      const restored = dump.result.find((candidate) => candidate.url === script.url)?.startOffset;
      script.startOffset = 0;
      if (restored !== undefined) {
        script.startOffset = restored;
      }
    }
    next.set(script.url, { owed: 0, script });
  }
  return next;
}

/**
 * Fold one raw dump in: merge the dump held before it, and hold this one.
 *
 * @param folded the fold of every earlier dump of the same project and environment
 * @param dump the raw coverage one test file produced
 * @param ops the injected merge and normalisation
 * @returns the fold with the previous dump merged and this one held
 */
export function foldCoverageDump<Script extends ScriptCoverage>({
  folded,
  dump,
  ops,
}: {
  folded: CoverageFold<Script>;
  dump: ProcessCoverage<Script>;
  ops: CoverageOps<Script>;
}): CoverageFold<Script> {
  if (folded.held === undefined) {
    return { held: dump, scripts: folded.scripts };
  }
  return { held: dump, scripts: mergeDump({ dump: folded.held, ops, scripts: folded.scripts }) };
}

/**
 * The ONE process coverage to hand upstream's own step, so that it leaves exactly what its per-dump fold would
 * have: every merged script with its owed passes paid, and each one the held dump carries placed BEFORE that
 * dump's copy and carrying the dump's `startOffset`, which is the one upstream's restore finds first.
 *
 * @param folded the fold of every dump of one project and environment
 * @param ops the injected normalisation
 * @returns the coverage to pass to upstream's `onFileRead`, once
 */
export function handoffCoverage<Script extends ScriptCoverage>({
  folded,
  ops,
}: {
  folded: CoverageFold<Script>;
  ops: CoverageOps<Script>;
}): ProcessCoverage<Script> {
  const held = folded.held;
  const result: Script[] = [];
  for (const [url, entry] of folded.scripts) {
    const script = settle({ held: entry, ops });
    const fromHeld = held?.result.find((candidate) => candidate.url === url);
    if (fromHeld !== undefined) {
      delete script.startOffset;
      if (fromHeld.startOffset !== undefined) {
        script.startOffset = fromHeld.startOffset;
      }
    }
    result.push(script);
  }
  if (held !== undefined) {
    result.push(...held.result);
  }
  return { result };
}
