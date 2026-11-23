/**
 * The error-shape-threshold gate — machine-enforces the verb house shape: **a domain past N distinct error
 * message shapes must declare a typed union**, mechanical so it holds without review. The audit's own
 * measurement was the defect it named — twelve verb directories carrying five or more distinct error
 * message shapes with no typed union — and it was the one axis of the verb house shape no gate measured.
 *
 * The rule it enforces is `.claude/rules/error-handling.md` § When NOT to introduce a union, read from the
 * other side: one or two only-ever-displayed messages stay on the default `readonly string[]`, and a domain
 * whose failures have multiplied past that is the case the `<Domain>Error` union + `<Domain>Errors` factory
 * exists for. Nothing enforced the boundary between those two, so the string list grew by one message at a
 * time in every busy directory, each addition locally reasonable.
 *
 * ## The criterion — no allowlist, no exemption marker
 *
 * A **plain error shape** is a string statically supplied to a one-argument bare `err(...)` or `errAsync(...)`
 * — each element of an array-literal argument, or the bare argument — read as: a string literal, a template or
 * a `+` chain of them, with every `${...}` hole and every non-literal operand normalised to one placeholder and
 * a shape with no literal text of its own discarded; each ARM of a conditional; each ITEM of an array, written
 * inline or bound to a name, a `...spread` item read as the expression it spreads; and a bare NAME followed to a fixed point through a `const` (in any enclosing block,
 * a `for` header or the module), a named or default import from a relative or `#lib/…` specifier, and a named
 * re-export. The callee must be the file's own value import of
 * `err`/`errAsync` from the result module (`#lib/result.js`, `…/lib/result.js`, `neverthrow`), renames included. A wrapper that changes only the TYPE (parentheses, `as`,
 * `satisfies`, `!`) is stripped first. Every shape is charged to the directory of the file whose `err` call it
 * entered, and reported at the line where the expression it read starts inside that call (an array item's own line). A **domain** is a directory (`dirname` — the bounded module
 * `error-handling.md` scopes a union to), and its count is the number of DISTINCT shapes across its non-test
 * files. A domain whose count exceeds {@link MAX_PLAIN_SHAPES} is refused unless the committed debt list
 * carries it at a count no smaller.
 *
 * State that criterion whenever you quote this class, never a count — a count is only ever this matcher's
 * output on one commit. There is no exemption marker and no allowlist, on purpose: a false positive is
 * retired by SHARPENING the criterion, the same discipline `no-silent-fallback` and `epoch-arithmetic` carry.
 *
 * ### What is deliberately NOT a shape, and why
 *
 * - **A forwarded value** — `err([read.error.message])`, `err(text.error)`, a parameter, a `let`, a
 *   destructured binding, a call's result, `ns.USAGE` — is computed at run time or authored by another domain
 *   that answers for it. Counting the forwarder would refuse the honest `return err(inner.error)` every layered
 *   verb writes. A `const` bound to a STRING is not forwarded: it is the same words typed one line up, and the
 *   domain whose `err` it enters is the one whose failures it names.
 * - **A typed-union site** — `err(GithubFetchErrors.repoNotFound({ owner, repo }))` — is the compliant
 *   form. That is what makes this a threshold and not a ban: routing a directory's failures through its own
 *   union is exactly what lowers its count, so the gate points at the fix rather than merely at the file.
 * - **A template with no literal text** — `` err([`${reason}`]) `` — carries no authored words. A `+` chain is
 *   read the same way: `"could not read " + path` is the shape `could not read {}`, and Prettier splits a long
 *   message into such a chain — MEASURED on the r1 fallback review of the first cut: reading the chain moved 27
 *   directories' counts. A name INSIDE a hole or an operand stays a hole; only a whole-expression name is
 *   followed.
 * - **A thrown `Error`** is a different class — this gate judges the `Result` channel `error-handling.md`
 *   governs, never the exception channel.
 *
 * **Its residue, stated rather than discovered**: `export *` is not followed, nor an import that does not end in
 * `.js`, nor one whose target is outside the scanned pool, nor a property read (`USAGES.drive`), nor a value the
 * syntax cannot pin (`let`, a call, a `const` array mutated after it is bound — a `push` or an index write, read as
 * its initializer); a spread of any of those (`...parsed.error`) is the same forwarded value. The first cut called
 * the whole name family its blind spot; MEASURED with name following, nine directories it had
 * passed stood over four (`src/cli/commands/drive` at 7, the rest at 5 or 6), each one a usage string, a shared
 * trailer, a named problem list or a conditional's fallback the old matcher could not see. Reading a `...spread`
 * item then put seven more past four (`src/cli/commands/claude` at 11, `store` 10, the rest 5 to 7)
 * — the `...(ok ? [] : ["text"])` problem list. Repro: run this gate on a tree without the name-following and spread-reading halves.
 *
 * The scan is two halves because a name imported from another module cannot be settled by reading one file:
 * `./errorShapeThresholdFacts.ts` reads each file into plain data, and `./errorShapeThresholdResolve.ts`
 * follows names across the whole pool. Syntax only — no `ts.Program`, which `named-object-params` alone builds.
 *
 * ### Why N is four
 *
 * `error-handling.md` says "one or two simple messages" stay plain, and the audit drew its own line at
 * "five or more". Four is the largest count the rule's prose still tolerates: a domain at five has, by the
 * rule's own words, stopped being the exception the plain list was kept for. The number is one constant,
 * {@link MAX_PLAIN_SHAPES}, and a change to it is a change to the rule, made in `error-handling.md` and
 * here together.
 *
 * ## The debt list is a committed baseline, and it can only tighten
 *
 * Every directory over the threshold on the day this landed was a standing site, and the rule for
 * exactly that situation (no allowlist, a debt list for standing sites) is the shape here:
 * {@link BASELINE_FILE} names each over-threshold directory by `{ path, count }`, the gate REFUSES a
 * directory that is new or whose distinct-shape count grew, and `--rebaseline` tightens the committed set
 * while refusing to raise any entry. A list that cannot be widened by hand is not an allowlist: nothing an
 * author writes can excuse a fifth shape in a clean directory.
 *
 * **Its residue, stated rather than discovered**: the unit is a count of DISTINCT shapes, so a directory
 * can retire one message and mint another and stay green, and a directory under the threshold can add
 * shapes up to it without an entry. Keying on each shape's own text would trip on every reworded message,
 * which is how a ratchet stops being read. What was bought is that a domain's plain-string surface can only
 * fall, and a new domain cannot grow one past four.
 *
 * The ratchet itself is `./countRatchet.ts`, shared with `unnamed-failure-assertion`. Its pure cores
 * ({@link countsOf}, {@link overThreshold}, and the two scan halves) are unit-tested; the ratchet is tested
 * with the ratchet.
 */

import { dirname } from "node:path";
import { type CountEntry, type CountFinding, runCountRatchet } from "./countRatchet.js";
import { type ErrorShapeFileFacts, scanErrorShapeFacts } from "./errorShapeThresholdFacts.js";
import { resolveErrorShapeFacts, type ShapeSite } from "./errorShapeThresholdResolve.js";
import { gateSelfFiles, type ScanScope, isScannablePath as scopeIsScannablePath } from "./scanScope.js";

export type { ShapeSite } from "./errorShapeThresholdResolve.js";

/** The committed debt list, repo-relative. */
const BASELINE_FILE = ".baselines/error-shape-threshold-baseline.json";

/**
 * The most distinct plain error shapes a directory may author before it must declare a typed union. The
 * file header says why it is four and not another number.
 */
export const MAX_PLAIN_SHAPES = 4;

/** One directory and how many DISTINCT plain shapes its files author — the debt list's own entry shape. */
export type DirectoryCount = CountEntry;

/**
 * Collapse resolved sites into one entry per directory, counting distinct normalised shapes, sorted by path.
 * Pure. Every directory that authors at least one shape is listed; {@link overThreshold} applies the number.
 *
 * @param sites every resolved shape
 * @returns the counted directories, in the debt list's own order
 */
export function countsOf({ sites }: { sites: readonly ShapeSite[] }): readonly DirectoryCount[] {
  const tally = new Map<string, Set<string>>();
  for (const site of sites) {
    const directory = dirname(site.path);
    const standing = tally.get(directory);
    if (standing === undefined) {
      tally.set(directory, new Set([site.shape]));
    } else {
      standing.add(site.shape);
    }
  }
  return [...tally.entries()]
    .map(([path, shapes]) => ({ count: shapes.size, path }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * The directories whose distinct-shape count exceeds the threshold — the only ones the debt list judges.
 * Pure.
 *
 * @param counts every counted directory
 * @param max the most shapes a directory may author without a union
 * @returns the directories past `max`, in `counts`'s order
 */
export function overThreshold({
  counts,
  max,
}: {
  counts: readonly DirectoryCount[];
  max: number;
}): readonly DirectoryCount[] {
  return counts.filter((one) => one.count > max);
}

/**
 * This gate's declared scan predicate: every non-test `.ts` under the source trees. A test's
 * `err(["x"])` is a fixture, not a domain's failure, so the test tree is out.
 */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "errorShapeThreshold" }),
  trees: ["src/", "eval/", "hooks/"],
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

/** One resolved shape's finding line — the `err` use it entered, and the normalised text. */
function findingOf({ hit }: { hit: ShapeSite }): CountFinding {
  return { line: hit.line, path: hit.path, text: hit.shape };
}

/**
 * IO edge: scan every non-test source file, resolve names across the whole pool, judge each directory
 * against the threshold and the committed debt list, or (`--rebaseline`) tighten that list to what stands now.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard
 *   error)
 */
export function runErrorShapeThreshold(): number {
  return runCountRatchet<ShapeSite, ErrorShapeFileFacts>({
    gate: {
      baselineFile: BASELINE_FILE,
      baselineKey: "directories",
      cleanLine: ({ current, hits }) =>
        `${String(hits.length)} resolved plain site(s), ${String(current.length)} debt entr(ies)`,
      counts: ({ hits }) => overThreshold({ counts: countsOf({ sites: hits }), max: MAX_PLAIN_SHAPES }),
      findingKeyOf: ({ hit }) => `${dirname(hit.path)}\t${hit.shape}`,
      findingOf,
      gate: "error-shape-threshold",
      keyOf: ({ hit }) => dirname(hit.path),
      rebaselineRefusalId: "error-shape-threshold-rebaseline",
      refusalDetail: ({ regressions }) =>
        `${String(regressions.length)} director(ies) past ${String(MAX_PLAIN_SHAPES)} distinct shapes, new or worsened`,
      refusalId: "error-shape-threshold",
      resolve: resolveErrorShapeFacts,
      scan: scanErrorShapeFacts,
      scope: SCOPE,
      unit: "distinct shape(s)",
    },
  });
}
