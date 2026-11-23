/**
 * SKILL ROUTING — putting the skills that own a question's SUBJECT into the dispatched worker's brief, so
 * judgement picks among named candidates instead of recalling that any of them exist.
 *
 * ## The measured gap
 *
 * The public monitor-backtest incident. A worker answered a Datadog-monitor ask with charts it
 * had drawn itself and a hand-rolled API replay, while `.agents/skills/datadog-monitor-pr/SKILL.md` — three
 * of the owner's own rules, written down — sat unloaded. Its footer read `no skills loaded`.
 *
 * That turn was not the exception. MEASURED the same day over every dispatched worker session on this
 * machine, joining two independent records — what each answer REPORTED in
 * `grounding.provenance.skillsLoaded` (read from the reviewer packet the door kept) against what its own
 * transcript OBSERVED it open (a `Skill` tool call, a `Read` whose `file_path` ends `SKILL.md`, or a Bash
 * command naming one):
 *
 * ```sh
 * # reported, per ask: the last provenance block each kept reviewer packet carries
 * grep -rho '"skillsLoaded": \[[^]]*\]' "$SLOPWEAVER_HOME/live/slack/reviews" --include=packet.md | sort | uniq -c
 * # observed, per ask: worker transcripts are the ones whose first user turn is the worker pickup prompt
 * grep -rl 'You are the worker for one dispatched Slack ask' ~/.claude/projects --include='*.jsonl' |
 *   xargs grep -lo 'SKILL\.md' | wc -l
 * ```
 *
 * **43 turns joined. 27 of them (63%) loaded nothing and said so; 12 of 43 (28%) loaded a skill at all.** The
 * footer is unreliable in both directions — 5 turns loaded one and reported none, 4 named one their
 * transcript never opened — but correcting every under-report still leaves **31 of 43 (72%) holding no skill
 * at all.** So the footer is not the defect. Nothing routed.
 *
 * ## Why a keyword table alone was the wrong shape
 *
 * `./localSkillGuidance.ts` was the only thing naming a repo-local skill in a worker brief, and its table has
 * one row (the vulnerability-fix gap). Everything else matched nothing and the brief said NOTHING —
 * not "no skill owns this", simply silence. Meanwhile this machine's declared checkouts carry dozens of
 * skills whose frontmatter already describes exactly what each is for. A hand-written trigger per subject
 * cannot keep up with that and never will; the descriptions can, because their authors wrote them.
 *
 * So there are two mechanisms here on purpose, and they are not redundant:
 *
 * - **This module ranks the whole catalogue** against the question and renders the top candidates. Broad,
 *   self-maintaining, judgement decides.
 * - **`./localSkillGuidance.ts` stays the hand-written escalation** for a subject that has already been got
 *   wrong once, because a ranked line cannot carry "file the Linear ticket FIRST" — and because a hard match
 *   is what `../../admit/localSkillGate.ts` can refuse a send on.
 *
 * ## The ranking, and why it calibrates itself
 *
 * Scoring is token overlap against each skill's own `name` + `description`, calibrated twice against the
 * catalogue in front of it rather than against a table someone maintains:
 *
 * - a question token counts only when it is DISCRIMINATING — carried by at most
 *   {@link DISCRIMINATING_MAX_SHARE} of the entries. That is a stopword list the corpus computes for itself,
 *   so a word that is noise HERE ("slack", where every skill mentions Slack) is dropped without anyone
 *   keeping a list. A stopword list ported from somewhere else is exactly the heuristic that rots silently.
 * - a token that survives is worth `1/frequency`, so one owned by a single skill outweighs one shared by
 *   five. MEASURED on this machine's 79-entry catalogue against the incident's own question: plain
 *   counting TIED the monitor skill with an unrelated post-ship gate at 2 each, because `monitor` and `post`
 *   are both common; weighting by `1/frequency` puts it clear first at 1.33 against 0.48, because `backtest`
 *   is carried by exactly one entry (weight 1) and `post` by seven (weight 1/7). Reproduce by ranking
 *   `availableSkills` against that question — `src/__tests__/unit/live/turn/skillRouting.test.ts` pins the
 *   ordering on a fixture catalogue of the same shape.
 *
 * Pure and total: it reads the catalogue it is handed and nothing else. Discovery — which checkouts, which
 * directories — is `./skillCatalogue.ts`'s job, at the I/O edge.
 */

/** The frontmatter a skill publishes about itself, plus where it was found. */
export interface CatalogueSkill {
  /** The `name:` frontmatter field — the id a worker loads it by. */
  readonly name: string;
  /** The `description:` frontmatter field — what its author says it is for. */
  readonly description: string;
  /** Where to load it from, as a worker would type it. */
  readonly path: string;
}

/**
 * One ranked candidate: the skill, and its score — the sum of `1/frequency` over every discriminating
 * question token it carries, so a token owned by ONE skill outweighs one shared by several.
 *
 * @internal — the row shape {@link rankSkills} returns; exported so a caller can name a score.
 */
export interface RankedSkill {
  readonly skill: CatalogueSkill;
  readonly score: number;
}

/**
 * A question token counts only when it appears in at most this share of the catalogue.
 *
 * A quarter rather than a tenth because the catalogue is small: at ~80 skills a tenth admits only tokens in
 * fewer than eight of them, which discards real subject words ("linear", "slack") that genuinely do select a
 * handful. Measured on this machine's own catalogue, a quarter leaves the incident's own question ranking
 * the monitor skill first.
 *
 * @internal — exported so a test can assert the calibration by name rather than restating a magic number.
 */
export const DISCRIMINATING_MAX_SHARE = 0.25;

/**
 * How many candidates a brief renders. Beyond this the list stops being read; the count of the rest is stated instead.
 *
 * @internal — exported so a test can assert the default cap rather than restating it.
 */
export const RANKED_SKILLS_SHOWN = 6;

/** Tokens shorter than this carry no subject signal and are dropped before anything else looks at them. */
const MIN_TOKEN_LENGTH = 4;

/**
 * Split text into comparable tokens: lower-cased, alphanumeric runs only, short ones dropped, and a trailing
 * `s` stripped so `monitors` and `monitor` are the same token.
 *
 * Crude stemming on purpose — a real stemmer is a dependency and a behaviour to keep calibrated, while the
 * only inflection that actually decides a match here is the plural.
 *
 * @param text any prose — a question, a skill name, a description
 * @returns the distinct tokens, in no particular order
 */
export function subjectTokens({ text }: { text: string }): ReadonlySet<string> {
  const raw = text.toLowerCase().split(/[^a-z0-9]+/);
  const tokens = new Set<string>();
  for (const token of raw) {
    if (token.length < MIN_TOKEN_LENGTH) {
      continue;
    }
    tokens.add(token.endsWith("s") ? token.slice(0, -1) : token);
  }
  return tokens;
}

/** Every token one catalogue entry offers — its name and its description, pooled. */
function skillTokens({ skill }: { skill: CatalogueSkill }): ReadonlySet<string> {
  return subjectTokens({ text: `${skill.name} ${skill.description}` });
}

/**
 * Which of a question's tokens are DISCRIMINATING against this catalogue — present in at most
 * {@link DISCRIMINATING_MAX_SHARE} of its entries.
 *
 * An empty catalogue discriminates nothing: with no corpus to measure against, every token would trivially
 * pass at a document frequency of zero, and ranking against nothing is not a judgement worth rendering.
 *
 * @param question the ask's own question text, tags already stripped
 * @param skills the catalogue to measure document frequency against
 * @returns each token worth scoring on, mapped to how many catalogue entries carry it
 */
export function discriminatingTokens({
  question,
  skills,
}: {
  question: string;
  skills: readonly CatalogueSkill[];
}): ReadonlyMap<string, number> {
  if (skills.length === 0) {
    return new Map<string, number>();
  }
  const perSkill = skills.map((skill) => skillTokens({ skill }));
  const ceiling = skills.length * DISCRIMINATING_MAX_SHARE;
  const kept = new Map<string, number>();
  for (const token of subjectTokens({ text: question })) {
    const frequency = perSkill.filter((tokens) => tokens.has(token)).length;
    if (frequency > 0 && frequency <= ceiling) {
      kept.set(token, frequency);
    }
  }
  return kept;
}

/**
 * Rank a catalogue against one question, best first.
 *
 * Ties break on the skill's own name so the same catalogue and question always render the same bytes — a
 * brief that reorders between runs is one nobody can diff.
 *
 * @param limit how many to return (defaults to {@link RANKED_SKILLS_SHOWN})
 * @param question the ask's own question text, tags already stripped
 * @param skills the catalogue to rank
 * @returns the scoring candidates, highest score first; empty when nothing matched a discriminating token
 */
export function rankSkills({
  limit = RANKED_SKILLS_SHOWN,
  question,
  skills,
}: {
  limit?: number;
  question: string;
  skills: readonly CatalogueSkill[];
}): readonly RankedSkill[] {
  const wanted = discriminatingTokens({ question, skills });
  const scored: RankedSkill[] = [];
  for (const skill of skills) {
    const tokens = skillTokens({ skill });
    let score = 0;
    for (const [token, frequency] of wanted) {
      if (tokens.has(token)) {
        score += 1 / frequency;
      }
    }
    if (score > 0) {
      scored.push({ score, skill });
    }
  }
  return scored.toSorted((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name)).slice(0, limit);
}

/**
 * The brief's skill-routing section — the candidates this question's subject matched, or a stated empty.
 *
 * ALWAYS renders at least one line, which is the whole point: the incident's brief said nothing about
 * skills, and a worker reading nothing concludes nothing. An empty catalogue and a catalogue that matched
 * nothing are told apart, because they mean different things — the first is a discovery failure worth
 * reporting, the second is a genuine "no skill owns this, use your judgement".
 *
 * @param question the ask's own question text, tags already stripped
 * @param skills the catalogue to rank
 * @returns the section's lines, in order
 */
export function skillRoutingLines({
  question,
  skills,
}: {
  question: string;
  skills: readonly CatalogueSkill[];
}): readonly string[] {
  if (skills.length === 0) {
    return [
      "SKILLS — no skill catalogue was discoverable from here. That is a defect, not an absence: say so in",
      "  `grounding.evidence.couldNotSee` rather than answering as though no procedure exists.",
    ];
  }
  const ranked = rankSkills({ question, skills });
  if (ranked.length === 0) {
    return [
      `SKILLS — ${skills.length} available, none matched this question's subject. Judgement is yours; if you`,
      "  find yourself inventing a procedure, stop and look for one that already exists.",
    ];
  }
  const rest = skills.length - ranked.length;
  return [
    "SKILLS OWNING THIS SUBJECT — read the ones that apply BEFORE you investigate, and name every one you",
    `  read in \`grounding.provenance.skillsLoaded\`. ${rest} more in the catalogue:`,
    ...ranked.map(({ skill }) => `  - ${skill.name} (${skill.path}) — ${skill.description}`),
  ];
}
