/**
 * LOCAL SKILL GUIDANCE — question-triggered reminders that a repo-local skill owns this ask, rendered into
 * the dispatched child's own brief before it takes any action.
 *
 * Mirrors `../../cli/skillReminder.ts`'s `GOVERNED_VERBS` shape, but the trigger is the ASK QUESTION's own
 * text rather than a CLI verb. `skillReminder.ts` fires AFTER a governed CLI verb runs without its skill in
 * context — there is no equivalent verb here: a fresh session dispatched to "raise a fix PR for this vuln"
 * goes straight to `gh`/branch work, so the only place left to land the reminder is the brief itself, before
 * any of that happens.
 *
 * Shipped from a retrofit of four vulnerability-fix PRs: a tag-spawned child raised four real
 * vulnerability-fix PRs without ever loading `.agents/skills/vulnerability-fix-pr/SKILL.md`, so none filed a
 * Linear ticket first and two shipped without the `yarn why` before/after proof the skill's step 3 and step 6
 * require. Deliberately scoped to that one proven trigger — add another only alongside a matching real gap,
 * never speculatively.
 */

/** One question-triggered reminder that a repo-local skill owns this class of ask. */
export interface LocalSkillTrigger {
  /** Lower-cased substrings; any single match against the (lower-cased) question fires this trigger. */
  readonly keywords: readonly string[];
  /** The skill's path, relative to the target repo's root. */
  readonly skillPath: string;
  /** One clause naming what actually lives in the skill, not improvised in the moment. */
  readonly why: string;
}

const LOCAL_SKILL_TRIGGERS: readonly LocalSkillTrigger[] = [
  {
    keywords: ["vuln", "cve", "ghsa", "dependabot", "critical"],
    skillPath: ".agents/skills/vulnerability-fix-pr/SKILL.md",
    why: "filing the Linear ticket FIRST (before any branch/code), and the yarn-why before/after proof — necessary but not sufficient; also show the new version still works for our usage. Slopweaver now owns the generic half itself — `slopweaver github vuln list|get|body` plus the `vulnerability-fix` skill carry the ladder, the reviewer bar and the built-not-typed alert citation — so a repo-local skill only adds what is true of THAT repository",
  },
];

/**
 * Which local-skill triggers this question matches, in table order. Pure and total.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns every trigger whose keyword appears (case-insensitively) in the question — empty when none match
 */
export function matchingLocalSkillTriggers({ question }: { question: string }): readonly LocalSkillTrigger[] {
  const lower = question.toLowerCase();
  return LOCAL_SKILL_TRIGGERS.filter((trigger) => trigger.keywords.some((keyword) => lower.includes(keyword)));
}

/**
 * Render the local-skill guidance section for a question, or no lines when nothing matches.
 *
 * @param question the ask's own question text, tags already stripped
 * @returns the guidance lines, or an empty array when no trigger matches
 */
export function localSkillGuidanceLines({ question }: { question: string }): readonly string[] {
  const matched = matchingLocalSkillTriggers({ question });
  if (matched.length === 0) {
    return [];
  }
  return [
    "LOCAL SKILL — this repo may own this procedure; load it before any branch/PR work:",
    ...matched.map((trigger) => `  - ${trigger.skillPath} — ${trigger.why}`),
  ];
}
