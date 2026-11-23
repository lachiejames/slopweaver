/**
 * CHECK 5 — a memory restating something already ENFORCED. Pure: leaves and enforcers in, matches out.
 *
 * This is the check the owner's own spot checks were all about, and it is the one that operates
 * the sharpened test: **a memory earns its place ONLY if its presence changes agent
 * behaviour.** A memory restating a gate, a schema, a skill or an always-on doc cannot, because the thing it
 * restates is already in front of every session — or already refuses the mistake outright.
 *
 * The official guidance agrees, which is worth recording because it means this is not a house eccentricity.
 * code.claude.com/docs/en/memory: _"Claude skips anything it can derive from the codebase, such as
 * architecture, file paths, or debugging fixes. It also skips anything your CLAUDE.md files already say."_
 * This check is that instruction, applied after the fact to a corpus that grew before it was followed.
 *
 * ## The three classes of enforcer, and why a `paths:`-scoped rule is NOT one
 *
 * An enforcer only counts when it reaches the session ANYWAY:
 *
 * - an **always-on doc** — `AGENTS.md`, `CLAUDE.md`, and a `.claude/rules/*.md` with no `paths:` frontmatter;
 * - a **lint gate**, which does not need to reach a session at all, because it refuses the mistake;
 * - a **skill**, which is loaded on demand — so it is an enforcer for a TECHNIQUE, which the strictness bar
 *   already says belongs in a skill rather than a memory.
 *
 * A `paths:`-scoped rule is deliberately excluded. It loads only when a session touches matching files, so a
 * memory covering the same ground genuinely does change behaviour everywhere else — proposing its removal
 * would be acting on a premise that is false. `./refute.ts` also refutes a match against one, as a second
 * line of defence, because this classification depends on reading frontmatter correctly.
 *
 * ## Matching is RARE-token overlap and it NOMINATES; it never concludes
 *
 * `#lib/rareTokens.js` carries the measurement. What matters here is the standing on it, which the owner has
 * already given in another context, recorded in `docs/corpus-intent/04-citations-and-proof.md`: similarity can
 * nominate, never conclude, because false positives kill trust immediately. So a match here produces a DROP CANDIDATE that the adversarial arm then tries to refute, and
 * the card prints what the arm found either way.
 */
import { COVERAGE_TOKEN_MATCHES, type CoverageSource, distinctiveTokens, indexSources } from "#lib/rareTokens.js";
import type { MemoryLeaf } from "../types.js";
import { memorySubjectText } from "./subjectText.js";

/** What kind of thing already enforces a memory's content. Printed, because the three argue differently. */
export type EnforcerKind = "always-on-doc" | "lint-gate" | "skill" | "scoped-rule";

/** One thing that may already enforce what a memory says. */
export interface Enforcer {
  readonly kind: EnforcerKind;
  /** What to print — a doc path, a gate name, a skill name. */
  readonly id: string;
  /** The text to match against. */
  readonly text: string;
}

/**
 * How much of a memory's own distinctive vocabulary an enforcer must already carry.
 *
 * MEASURED, and the measurement is why this is a SHARE rather than a count. An absolute threshold of two shared
 * rare tokens nominated 12 of the 19 memories in the live corpus on the first run of this check — because
 * `AGENTS.md` is thousands of words, so almost any memory shares two uncommon words with it. That is exactly the
 * failure the owner named on a different similarity surface: _"The false positives will kill trust
 * immediately."_ A share asks the question the check actually means — is nearly everything this memory
 * distinctively says already in that doc — and it is scale-free, so a long enforcer earns no advantage.
 *
 * Re-measure with:
 *
 * ```bash
 * slopweaver memory hygiene --dir "$HOME/.claude/projects/<project>/memory" --repo "$PWD" --json \
 *   --home "$(mktemp -d)" | jq '[.proposals[] | select(.check == "enforcement")] | length'
 * ```
 *
 * @internal
 */
export const ENFORCEMENT_COVERAGE_SHARE = 0.6;

/** One memory found to restate something already enforced. */
export interface EnforcementMatch {
  readonly file: string;
  /** Every enforcer that matched, strongest coverage first, so a card can name one and count the rest. */
  readonly enforcers: readonly Enforcer[];
  /** The rare tokens the memory shares with the strongest match — the evidence a reader checks. */
  readonly sharedTokens: readonly string[];
  /** What share of the memory's distinctive vocabulary that strongest enforcer already carries. */
  readonly coverage: number;
}

/**
 * Which memories restate something already enforced.
 *
 * The document-frequency index is built over the ENFORCERS, not over the memories: the question asked of each
 * memory is "is this already covered by one of these", so rarity has to be measured across the things being
 * matched against. Indexing the memories instead would rule out a token for being common among memories,
 * which is the opposite of the signal wanted.
 *
 * A memory with too few distinctive tokens to measure a share over is never nominated. That is not a gap: a
 * description of three words gives this check nothing to be right about, and a 100% share of two tokens would
 * nominate it on the flimsiest evidence in the corpus.
 *
 * @param leaves the corpus's leaves
 * @param enforcers everything that already reaches a session or refuses a mistake
 * @param share how much of the memory's own distinctive vocabulary an enforcer must carry
 * @param minimum how many shared rare tokens are needed before a share means anything
 * @returns one entry per matched memory, in leaf order, each enforcer list strongest-first
 */
export function findEnforcedMemories({
  leaves,
  enforcers,
  share = ENFORCEMENT_COVERAGE_SHARE,
  minimum = COVERAGE_TOKEN_MATCHES,
}: {
  leaves: readonly MemoryLeaf[];
  enforcers: readonly Enforcer[];
  share?: number;
  minimum?: number;
}): readonly EnforcementMatch[] {
  const sources: readonly CoverageSource[] = enforcers.map((enforcer) => ({
    id: enforcer.id,
    text: enforcer.text,
  }));
  const index = indexSources({ sources });
  const matches: EnforcementMatch[] = [];
  for (const leaf of leaves) {
    const subject = [...distinctiveTokens({ text: memorySubjectText({ leaf }) })].filter(
      (token) => !index.tooCommon.has(token),
    );
    if (subject.length < minimum) {
      continue;
    }
    const scored = enforcers.flatMap((enforcer, position) => {
      // Safe: `indexSources` returns one token set per source, index-aligned with the enforcers.
      const theirs = index.tokens[position]!;
      const shared = subject.filter((token) => theirs.has(token));
      const coverage = shared.length / subject.length;
      if (shared.length < minimum || coverage < share) {
        return [];
      }
      return [{ coverage, enforcer, shared: shared.toSorted() }];
    });
    if (scored.length === 0) {
      continue;
    }
    // Coverage first, then the enforcer id. Without the second key a tie is decided by whichever enforcer
    // happens to sit earlier in the array, because `toSorted` is stable — so moving a lint-gate row from one
    // source file to another silently changed which enforcer this reported as the best match. A review
    // found it that way on the registration-table split; the id makes the answer a property of the data.
    const ranked = scored.toSorted((left, right) => {
      const byCoverage = right.coverage - left.coverage;
      if (byCoverage !== 0) {
        return byCoverage;
      }
      return left.enforcer.id.localeCompare(right.enforcer.id);
    });
    // Safe: `ranked` is non-empty — `scored.length === 0` returned above.
    const best = ranked[0]!;
    matches.push({
      coverage: Math.round(best.coverage * 100) / 100,
      enforcers: ranked.map((entry) => entry.enforcer),
      file: leaf.file,
      sharedTokens: best.shared,
    });
  }
  return matches;
}
