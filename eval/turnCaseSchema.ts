/**
 * The typed shape of `turn.cases.json` — turn-level judgement cases for the promptfoo lane the owner
 * ruled for the judgement-bug class (5 review rounds on one ask; a follow-up worker drafting "nothing
 * ran" while the first worker was alive). Same "given this input, expect this outcome" shape as
 * `../eval/routing.cases.json`, extended from a routing decision to a composed judgement text.
 *
 * Model calls are allowed in THIS lane only — `AGENTS.md`'s owner ruling names it "the one lane that
 * judges judgement" — so unlike `../src/eval/scorer.ts`'s deterministic grounding cases, what a case
 * expects here is a property of a model-COMPOSED text, checked by `judgementAssertion.ts`.
 */
import { z } from "zod";

const turnCaseSchema = z.object({
  description: z.string(),
  expected: z.object({
    forbiddenGlyphs: z.array(z.string()).optional(),
    forbiddenPhrases: z.array(z.string()).optional(),
    mustFlagMissingAskerMention: z.boolean().optional(),
    mustMentionAsker: z.boolean().optional(),
    mustMentionLiveWorker: z.boolean().optional(),
  }),
  id: z.string(),
  incidentFixture: z.string(),
  input: z.object({ prompt: z.string() }),
  tags: z.array(z.string()),
});

const turnCasesFileSchema = z.object({
  cases: z.array(turnCaseSchema),
  schemaVersion: z.literal(1),
});

/** One turn-level judgement case, parsed and validated. */
export type TurnCase = z.infer<typeof turnCaseSchema>;

/**
 * Parse and validate `turn.cases.json`'s raw text into typed cases.
 *
 * @param raw the file's raw JSON text
 * @returns every case in file order
 */
export function loadTurnCases({ raw }: { raw: string }): readonly TurnCase[] {
  return turnCasesFileSchema.parse(JSON.parse(raw)).cases;
}
