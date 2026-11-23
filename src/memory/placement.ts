/**
 * Two of `skills/knowledge/reference/placement.md`'s rules for the always-loaded set, as findings. Pure — the
 * corpus and its routing in, findings out.
 *
 * - **`why-always-loaded-missing`**: a memory routed from `MEMORY.md` loads every session, so it opens with a
 *   `**Why always-loaded:**` paragraph naming the first act that would already be wrong if retrieval waited. The
 *   a hygiene pass found 31 root-routed leaves without one while `memory check` printed clean.
 * - **`amends-canon-without-row`**: a memory declaring `metadata.slopweaver.amendsCanon` bridges the sessions
 *   that boot before a canon edit lands, and is deleted when the row landing it settles. It fires when the
 *   declaration names no row, names a row the board does not carry, or names one that has closed.
 *
 * The first reads only the corpus. The second reads the row state the verb edge resolved onto the leaf — a
 * corpus nobody resolved carries `unresolved`, and only the "names no row at all" half can fire on it.
 */
import { maskNonContent, splitFrontmatter } from "./parse.js";
import { type MemoryCorpus, type MemoryFinding, type MemoryLeaf, ROOT_INDEX_FILE } from "./types.js";

/** The paragraph an always-loaded memory opens with. */
const WHY_ALWAYS_LOADED = "**Why always-loaded:**";

/**
 * Whether a leaf's body opens with the {@link WHY_ALWAYS_LOADED} paragraph. An HTML comment or fenced block
 * ahead of it is not content, so it is masked rather than read as the opener.
 */
function opensWithWhy({ leaf }: { leaf: MemoryLeaf }): boolean {
  const { bodyOffset } = splitFrontmatter({ text: leaf.text });
  const first = maskNonContent({ text: leaf.text })
    .split("\n")
    .slice(bodyOffset)
    .find((line) => line.trim() !== "");
  if (first === undefined) {
    return false;
  }
  return first.trimStart().startsWith(WHY_ALWAYS_LOADED);
}

/**
 * `why-always-loaded-missing`: every leaf `MEMORY.md` routes whose body does not open with the paragraph.
 * A leaf routed only from a topic index is not boot-loaded, and an unrouted one is `orphan`'s business.
 *
 * @param corpus the classified corpus
 * @param routes leaf stem → the index files routing it, from `routingTable`
 * @returns one finding per root-routed leaf that does not open with the paragraph
 */
export function whyAlwaysLoadedFindings({
  corpus,
  routes,
}: {
  corpus: MemoryCorpus;
  routes: ReadonlyMap<string, ReadonlySet<string>>;
}): readonly MemoryFinding[] {
  return corpus.leaves
    .filter((leaf) => routes.get(leaf.stem)?.has(ROOT_INDEX_FILE) === true && !opensWithWhy({ leaf }))
    .map((leaf) => ({
      check: "why-always-loaded-missing" as const,
      file: leaf.file,
      line: null,
      message: `routed from ${ROOT_INDEX_FILE}, so it loads every session, but its body does not open with a ${WHY_ALWAYS_LOADED} paragraph naming the first act that would already be wrong if retrieval waited`,
    }));
}

/** The message for one declared amendment, or `null` when the row state says nothing is wrong. */
function amendsMessage({ leaf }: { leaf: MemoryLeaf }): string | null {
  const amends = leaf.amendsCanon;
  if (amends === null) {
    return null;
  }
  if (amends.row === null) {
    return `declares \`amendsCanon\` on \`${amends.target}\` but names no board row landing the change — add \`row: <slug>\`, or nothing ever retires this memory`;
  }
  const state = amends.rowState;
  switch (state.kind) {
    case "missing":
      return `\`amendsCanon.row\` names \`${amends.row}\`, which no board doc carries, live or archived`;
    case "landed":
      return `amends \`${amends.target}\` through \`${amends.row}\`, which is done — confirm \`${amends.target}\` carries the change, then delete this memory`;
    case "closed-unlanded":
      return `amends \`${amends.target}\` through \`${amends.row}\`, which closed \`${state.status}\` without landing — the amendment is void unless a new row carries it`;
    case "live":
    case "unreadable":
    case "unresolved":
      return null;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/**
 * `amends-canon-without-row`: every declared canon amendment whose row is absent, unknown to the board, or
 * closed. An unreadable row judges nothing — a status read from half a journal is not evidence.
 *
 * @param corpus the classified corpus, its amendment rows resolved at the verb edge where a verb asked
 * @returns one finding per amendment that should be retired or repaired
 */
export function amendsCanonRowFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  for (const leaf of corpus.leaves) {
    const message = amendsMessage({ leaf });
    if (message !== null) {
      findings.push({ check: "amends-canon-without-row", file: leaf.file, line: null, message });
    }
  }
  return findings;
}
