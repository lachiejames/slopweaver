/**
 * The ratchet-gate class, bound to the canon paragraph that tells a session how to rebaseline one.
 *
 * ## The defect this exists for
 *
 * MEASURED on one branch. `yarn tsx src/devLint/errorShapeThreshold.entry.ts --rebaseline` tightened
 * two debt entries: `src/store/backup` (22 to 15), which that branch earned, and `src/cli/commands/briefing`
 * (31 to 28), which it did not. Main then landed work returning briefing to 31, so the gate passed on the
 * entry alone and refused on base-plus-entry — and GitHub's merge queue, which tests exactly that merged ref
 * under `merge_group`, dropped the entry TWICE in silence while the pull request's own rollup read 10/10.
 * No check on a pull request can report this, by construction.
 *
 * The remedy is one sentence of canon — after a rebaseline, keep only the entries your own branch moved —
 * and the finding that carried it to the board named **five** of the seven gates it applies to. That is what
 * this module is for: the paragraph in `docs/toolchain/rebaseline-and-lanes.md` has to name the class, and a
 * hand-typed class list is the thing that rots. The test drives both directions off
 * {@link ../devLint/refusal/registry.js}'s declarations, so a gate that gains a `--rebaseline` fails the
 * unit lane until canon covers it, and a gate that is renamed or removed fails it too.
 *
 * ## The criterion, and what it deliberately misses
 *
 * A gate is in the REFUSING class when the refusal registry carries a declaration whose id ends
 * `-rebaseline` — that declaration is exactly the copy a rebaseline prints when it is asked to move a bar
 * rather than measure against it, so its presence is what makes the gate a ratchet with a committed debt
 * list. It is machine-enumerated and already held by `gate-registration`.
 *
 * It misses `internal-exports`, whose `--rebaseline` writes the current unresolved set wholesale and carries
 * no refusal row, and which is therefore in the DEFECT class without being in the refusing one. That is why
 * the second direction checks {@link gateListIn}'s names against the whole gate registry rather than against
 * this subset: canon must be able to name a member the criterion cannot compute, and a name that is not a
 * real gate at all must still fail.
 *
 * Pure throughout — declarations and document text in, gate names out. The test that reads the real
 * `docs/toolchain/rebaseline-and-lanes.md` does the filesystem work.
 */

/** The refusal-id suffix that marks a gate's rebaseline copy. */
const REBASELINE_ID_SUFFIX = "-rebaseline";

/**
 * Every gate whose `--rebaseline` can refuse, derived from the refusal registry rather than restated.
 *
 * @param declarations each refusal id with the gate it belongs to, as `LINT_GATE_DECLARATIONS` carries them
 * @returns the gate names, deduplicated and sorted
 */
export function rebaselineGatesOf({ declarations }: { declarations: ReadonlyMap<string, string> }): readonly string[] {
  const gates = new Set<string>();
  for (const [id, gate] of declarations) {
    if (id.endsWith(REBASELINE_ID_SUFFIX)) {
      gates.add(gate);
    }
  }
  return [...gates].toSorted();
}

/**
 * The body of one `#` or `##` section of a markdown document, located by its exact heading line.
 *
 * A missing heading answers `undefined` rather than an empty string, so a caller can tell "the canon
 * paragraph was renamed or deleted" from "the paragraph is there and names nothing" — collapsing those two
 * would let a deletion pass as an empty-but-present section.
 *
 * It tracks FENCES, and that is not a nicety: `# a comment` inside a fenced `text` block is a heading to a
 * line-prefix check and nothing at all to a markdown reader. Measured while writing this module — the class
 * block below opens with exactly such a comment, and a fence-blind scan truncated the section at it and
 * reported canon naming no gates at all.
 *
 * @param content the whole document
 * @param heading the exact heading line, including its `#` or `##` marker
 * @returns the lines under it up to the next `#` or `##` heading outside a fence, or `undefined`
 */
export function sectionBody({ content, heading }: { content: string; heading: string }): string | undefined {
  const lines = content.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) {
    return undefined;
  }
  const body: string[] = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) {
      fenced = !fenced;
    } else if (!fenced && (line.startsWith("## ") || line.startsWith("# "))) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

/**
 * Every gate name the section's fenced class block declares, one per line.
 *
 * A FENCE rather than the prose around it, and that is the whole design: a backticked code span in a
 * paragraph cannot be told apart from an ordinary hyphenated word or an id, so a span-matching check has to
 * guess — and a check that guesses either misses a stale name or invents a failure out of the word
 * `pre-push`. Inside the fence every non-blank, non-`#` line IS a claim, so both directions are exact.
 *
 * @param body the section's text
 * @returns the names in the first `text` fence, in the order written, or an empty list when there is none
 */
export function gateListIn({ body }: { body: string }): readonly string[] {
  const lines = body.split("\n");
  const open = lines.indexOf("```text");
  if (open === -1) {
    return [];
  }
  const rest = lines.slice(open + 1);
  const close = rest.indexOf("```");
  const fenced = close === -1 ? rest : rest.slice(0, close);
  return fenced.map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Set difference, kept here because BOTH directions of the binding are one: the class block missing a gate
 * the registry declares, and the registry missing a gate the class block names.
 *
 * @param expected the names that must all appear
 * @param present the names that do appear
 * @returns the missing names, in the order `expected` gave them
 */
export function missingFrom({
  expected,
  present,
}: {
  expected: readonly string[];
  present: readonly string[];
}): readonly string[] {
  const have = new Set(present);
  return expected.filter((name) => !have.has(name));
}
