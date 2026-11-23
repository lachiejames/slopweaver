/**
 * Bridges the turn-level judgement cases (`turn.cases.json`) into promptfoo's test shape — the same pattern
 * as `cases.ts`, but for `judgementAssertion.ts` instead of `groundingAssertion.ts`. promptfoo loads this via
 * `tests: file://./turnCases.ts`; the default export (an array of test cases) is the framework contract.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTurnCases } from "./turnCaseSchema.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(resolve(repoRoot, "eval/turn.cases.json"), "utf8");
const cases = loadTurnCases({ raw });

export default cases.map((turnCase) => ({
  assert: [{ type: "javascript", value: "file://./judgementAssertion.ts" }],
  description: turnCase.description,
  vars: { caseId: turnCase.id, prompt: turnCase.input.prompt },
}));
