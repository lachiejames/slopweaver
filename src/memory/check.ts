/**
 * The rules. One pure function per finding id, plus a facade that runs them in registry order. No filesystem,
 * no logging, no clock — hand it a corpus and it returns findings.
 *
 * ## Exact matching, everywhere
 *
 * Both link kinds resolve by EXACT string comparison, and that is a correction rather than an oversight. An
 * earlier design folded `_` to `-` when resolving wikilinks, reasoning that Claude Code writes
 * `build_command.md` carrying `name: build-command`. But that pair proves the FILENAME and the NAME are
 * different fields — not that two names differing by separator are aliases. Claude Code's slug grammar admits
 * both characters, so `build_command` and `build-command` are two legitimately distinct memories, and folding
 * them would invent a `collision` that does not exist. Measured against a real corpus, exact matching left
 * zero wikilinks unresolved, so the folding bought nothing and risked a false finding.
 */

import { addInto } from "#lib/collections.js";
import { datedAddendumFindings } from "./addendum.js";
import { corpusIndexes } from "./corpus.js";
import { indexLineDriftFindings } from "./indexDrift.js";
import { nameFormatFindings } from "./nameFormat.js";
import { amendsCanonRowFindings, whyAlwaysLoadedFindings } from "./placement.js";
import { MEMORY_CHECK_IDS, type MemoryCorpus, type MemoryFinding, type MemoryLeaf, ROOT_INDEX_FILE } from "./types.js";

/**
 * Which index files point at each leaf stem. Outside pointers are excluded: they are links, not routes.
 *
 * Exported for the SWEEP, which shows the owner where each memory sits in the hierarchy. Sharing this function
 * rather than re-deriving routing is the whole reason the two verbs cannot disagree about which index owns a
 * memory — a disagreement between them would be a finding about the tooling, not about the corpus.
 *
 * @param corpus the classified corpus
 * @returns leaf stem → the index filenames routing it; a stem absent from the map is routed by nothing
 */
export function routingTable({ corpus }: { corpus: MemoryCorpus }): ReadonlyMap<string, ReadonlySet<string>> {
  const table = new Map<string, Set<string>>();
  for (const index of corpusIndexes({ corpus })) {
    for (const pointer of index.pointers) {
      if (pointer.outside) {
        continue;
      }
      // A set, so two links to the same leaf from ONE index is not double-routing — that is a duplicate
      // listing within a file, not an ambiguous route.
      addInto({ key: pointer.target, sets: table, value: index.file });
    }
  }
  return table;
}

/** Every filename stem that exists in the corpus, for deciding whether a pointer is dead. */
function existingStems({ corpus }: { corpus: MemoryCorpus }): ReadonlySet<string> {
  const stems = new Set(corpus.leaves.map((leaf) => leaf.stem));
  for (const index of corpusIndexes({ corpus })) {
    stems.add(index.file.replace(/\.md$/, ""));
  }
  return stems;
}

/** Every identity a wikilink may address: a leaf's filename stem, its declared name, or an index's stem. */
function resolvableIdentities({ corpus }: { corpus: MemoryCorpus }): ReadonlySet<string> {
  const identities = existingStems({ corpus });
  const all = new Set(identities);
  for (const leaf of corpus.leaves) {
    if (leaf.declaredName !== null) {
      all.add(leaf.declaredName);
    }
  }
  return all;
}

function missingRootIndexFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  return corpus.root === null
    ? [
        {
          check: "missing-root-index",
          file: ROOT_INDEX_FILE,
          line: null,
          message: `no ${ROOT_INDEX_FILE} in this directory — it is not a memory corpus, so nothing else could be checked meaningfully`,
        },
      ]
    : [];
}

function orphanFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const routed = routingTable({ corpus });
  return corpus.leaves
    .filter((leaf) => routed.get(leaf.stem) === undefined)
    .map((leaf) => ({
      check: "orphan" as const,
      file: leaf.file,
      line: null,
      message: "no index points at this memory — it is only reachable if its description happens to match",
    }));
}

/**
 * Pointers that lead nowhere — whether they name a file in this directory or one outside it.
 *
 * Covering outside pointers is the point of this check rather than an extra. The prototype's pattern could not
 * match a destination containing `/`, so it silently skipped them — and on a real corpus the skipped ones
 * included the single most load-bearing line in the index. A link is either verifiable or it is not; where it
 * happens to live is not a reason to stop checking it.
 */
function deadPointerFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const stems = existingStems({ corpus });
  const findings: MemoryFinding[] = [];
  for (const index of corpusIndexes({ corpus })) {
    for (const pointer of index.pointers) {
      const missing = pointer.outside ? !pointer.resolves : !stems.has(pointer.target);
      if (missing) {
        findings.push({
          check: "dead-pointer",
          file: index.file,
          line: pointer.line,
          message: `points at \`${pointer.raw}\`, which does not exist`,
        });
      }
    }
  }
  return findings;
}

function doubleRoutedFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const routed = routingTable({ corpus });
  return corpus.leaves
    .filter((leaf) => {
      // A leaf no index lists is absent from the routing table, and so routed by none — never double-routed.
      const owners = routed.get(leaf.stem);
      return owners !== undefined && owners.size > 1;
    })
    .map((leaf) => ({
      check: "double-routed" as const,
      file: leaf.file,
      line: null,
      message: `listed in more than one index (${[...routed.get(leaf.stem)!].toSorted().join(", ")}) — pick one`,
    }));
}

function collisionFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const claims = new Map<string, Set<string>>();
  for (const leaf of corpus.leaves) {
    for (const identity of leaf.declaredName === null ? [leaf.stem] : [leaf.stem, leaf.declaredName]) {
      addInto({ key: identity, sets: claims, value: leaf.file });
    }
  }
  const findings: MemoryFinding[] = [];
  for (const [identity, claimants] of [...claims.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))) {
    if (claimants.size > 1) {
      findings.push({
        check: "collision",
        file: [...claimants].toSorted()[0]!,
        line: null,
        message: `\`${identity}\` is claimed by ${[...claimants].toSorted().join(" and ")} — a wikilink to it resolves arbitrarily`,
      });
    }
  }
  return findings;
}

function unreachableFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  if (corpus.root === null) {
    return [];
  }
  const linkedFromRoot = new Set(corpus.root.pointers.filter((p) => !p.outside).map((p) => p.target));
  const reachable = new Set<string>([corpus.root.file]);
  for (const index of corpus.topicIndexes) {
    if (linkedFromRoot.has(index.file.replace(/\.md$/, ""))) {
      reachable.add(index.file);
    }
  }
  const routed = routingTable({ corpus });
  return corpus.leaves
    .filter((leaf) => {
      const owners = routed.get(leaf.stem);
      return owners !== undefined && ![...owners].some((owner) => reachable.has(owner));
    })
    .map((leaf) => ({
      check: "unreachable" as const,
      file: leaf.file,
      line: null,
      message: `routed only from an index that ${ROOT_INDEX_FILE} does not link, so nothing reaches it`,
    }));
}

function danglingWikilinkFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const identities = resolvableIdentities({ corpus });
  const findings: MemoryFinding[] = [];
  for (const leaf of corpus.leaves) {
    for (const link of leaf.wikilinks) {
      if (!identities.has(link.target)) {
        findings.push({
          check: "dangling-wikilink",
          file: leaf.file,
          line: link.line,
          message: `\`[[${link.target}]]\` matches no memory — nothing ever revisits a link like this, so it stays dead`,
        });
      }
    }
  }
  return findings;
}

/**
 * A memory that says it SUPERSEDES another, while the other is still in the corpus.
 *
 * `supersedes` is the write gate's answer for a conflict one side wins (`./overlapNomination.ts`), and the
 * answer is only half the act: the loser has to go, or two always-loaded memories keep giving opposite
 * instructions — exactly the defect the answer was written to end. The gate cannot see the deletion that
 * follows its refusal, so this is where a forgotten one surfaces. A corpus-graph rule, because the loser's
 * deletion is a second write the gate never judges.
 */
function supersededStillPresentFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  for (const leaf of corpus.leaves) {
    for (const overlap of leaf.overlaps) {
      if (overlap.answer !== "supersedes") {
        continue;
      }
      const loser = corpus.leaves.find(
        (other) => other.file !== leaf.file && (other.stem === overlap.target || other.declaredName === overlap.target),
      );
      if (loser !== undefined) {
        findings.push({
          check: "superseded-still-present",
          file: leaf.file,
          line: null,
          message: `supersedes \`${overlap.target}\`, but ${loser.file} is still here — delete it, or answer \`compatible\` if both stand`,
        });
      }
    }
  }
  return findings;
}

/**
 * Every schema finding across the corpus. Each leaf carries its own, computed at parse time, so the whole-corpus
 * run and the hook's single-file run can never disagree about whether a file is valid.
 */
function schemaFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  for (const leaf of corpus.leaves) {
    for (const finding of leaf.schemaFindings) {
      findings.push(finding);
    }
  }
  return findings;
}

/**
 * Every name-format finding across the corpus. Computed here rather than at parse time so it carries its own
 * check id: `leaf.schemaFindings` is the `schema` id’s field, and a name defect filed under it would make
 * the registry test’s exact arrays lie about which rule fired.
 */
function corpusNameFormatFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  const findings: MemoryFinding[] = [];
  for (const leaf of corpus.leaves) {
    for (const finding of nameFormatFindings({ leaf })) {
      findings.push(finding);
    }
  }
  return findings;
}

/** Every dated-addendum finding across the corpus — file-local, so the same reading `checkMemoryLeaf` gives. */
function corpusDatedAddendumFindings({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  return corpus.leaves.flatMap((leaf) => datedAddendumFindings({ leaf }));
}

/**
 * Where a finding sits within its file. A finding about the WHOLE file — no index points at it, two memories
 * claim one name — carries no line, and ranks ahead of every finding anchored to a line.
 */
function positionInFile({ finding }: { finding: MemoryFinding }): number {
  const { line } = finding;
  if (line === null) {
    return -1;
  }
  return line;
}

/** Sort into one canonical order: registry order, then file, then line, then message. */
function sortFindings({ findings }: { findings: readonly MemoryFinding[] }): readonly MemoryFinding[] {
  const rank = ({ check }: { check: MemoryFinding["check"] }): number => MEMORY_CHECK_IDS.indexOf(check);
  return [...findings].toSorted(
    (a, b) =>
      rank({ check: a.check }) - rank({ check: b.check }) ||
      a.file.localeCompare(b.file) ||
      positionInFile({ finding: a }) - positionInFile({ finding: b }) ||
      a.message.localeCompare(b.message),
  );
}

/**
 * Check one leaf in isolation — everything true of a file regardless of the rest of the corpus.
 *
 * This is what the write-triggered hook runs, and the isolation is the whole point: a file's own frontmatter
 * cannot be changed by a write that has not happened yet, so this answer is never transient.
 *
 * @param leaf the parsed leaf
 * @returns its schema, name-format and dated-addendum findings, in canonical order
 */
export function checkMemoryLeaf({ leaf }: { leaf: MemoryLeaf }): readonly MemoryFinding[] {
  return sortFindings({
    findings: [...leaf.schemaFindings, ...nameFormatFindings({ leaf }), ...datedAddendumFindings({ leaf })],
  });
}

/**
 * Check a whole corpus — every rule, including the graph.
 *
 * Only safe when no write is in flight, because most graph rules have a transient false-positive window during
 * a multi-file save: a route written before its leaf reads as a dead pointer, a leaf before its route reads as
 * an orphan, and a memory mid-move between indexes reads as double-routed.
 *
 * It does no I/O, so `amends-canon-without-row` judges whatever row state the leaves already carry: a verb
 * resolves it first (`src/cli/commands/memory/judgedCorpus.ts`), and an unresolved corpus can only fire that
 * rule's "names no row at all" half.
 *
 * @param corpus the classified corpus
 * @returns every finding, in canonical order; empty when the corpus is sound
 */
export function checkMemoryCorpus({ corpus }: { corpus: MemoryCorpus }): readonly MemoryFinding[] {
  // With no root index there is no graph to judge and no reason to believe these files are memories at all, so
  // this is the ONLY finding. Running the rest would bury the one useful sentence — "you are pointed at the
  // wrong directory" — under an orphan and a schema complaint for every unrelated markdown file in it.
  if (corpus.root === null) {
    return missingRootIndexFindings({ corpus });
  }
  const findings: MemoryFinding[] = [];
  for (const group of [
    schemaFindings({ corpus }),
    corpusNameFormatFindings({ corpus }),
    corpusDatedAddendumFindings({ corpus }),
    missingRootIndexFindings({ corpus }),
    orphanFindings({ corpus }),
    deadPointerFindings({ corpus }),
    doubleRoutedFindings({ corpus }),
    collisionFindings({ corpus }),
    unreachableFindings({ corpus }),
    danglingWikilinkFindings({ corpus }),
    supersededStillPresentFindings({ corpus }),
    whyAlwaysLoadedFindings({ corpus, routes: routingTable({ corpus }) }),
    indexLineDriftFindings({ corpus }),
    amendsCanonRowFindings({ corpus }),
  ]) {
    for (const finding of group) {
      findings.push(finding);
    }
  }
  return sortFindings({ findings });
}
