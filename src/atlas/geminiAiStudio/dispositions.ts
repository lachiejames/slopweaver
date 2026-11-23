/**
 * What this atlas may do with one Gemini operation, decided per OPERATION rather than per family.
 *
 * `docs/atlas-intent/06-holdings.md` carries the criterion and it is deliberately not a list of families to skip:
 * a family is voluminous when its records are time-series OBSERVATIONS — emitted by the platform rather than
 * created by a person, unbounded, growing with the clock, identified by a generated handle rather than by a
 * name somebody chose. Configuration is the complement: what a person or a project CREATED, listable
 * exhaustively.
 *
 * That criterion cuts THROUGH this platform's families rather than along them, which is why the rules below
 * are predicates over one operation and not a table of resource names:
 *
 * - `GET /files` lists what a person uploaded, each with a name and a 48-hour life. Configuration.
 * - `GET /generatedFiles` lists what the platform emitted while somebody was generating. Observations.
 * - `GET /{name}/operations` lists long-running job records the platform minted. Observations.
 * - `GET /{name}` for one of those same job records addresses a row somebody can name. Configuration.
 *
 * ## Every non-GET is excluded, and inference is the reason that matters
 *
 * On most platforms "excluded: every mutation" is about not provisioning a user. Here it is also about not
 * spending money and not sending anybody's text to a model: `generateContent`, `embedContent`,
 * `countTokens`, `predict` and `generateAnswer` are all POSTs, so one rule covers both classes. Each is
 * still RECORDED as an operation — an atlas that omitted them would answer "the Gemini API offers no way to
 * generate content", which is false — and none will ever be called.
 *
 * ## A dead rule is a gap, not a tidy default
 *
 * Every rule here carries an id, and `sync.ts` raises `disposition-rule-never-fired` for one that matched
 * nothing in the documents. A rule nobody's data reaches reads as considered judgement and is not one.
 */
import type { GeminiAiStudioDisposition } from "./model.js";

/**
 * The parts of one operation a disposition rule may look at.
 *
 * Deliberately narrower than the stored row: a rule that could read a response field would be a rule whose
 * behaviour changes when Google renames a property, and the disposition is a judgement about what an
 * operation IS, not about what it returns.
 *
 * @internal
 */
export interface GeminiAiStudioDispositionInput {
  /** The HTTP method, upper-cased. */
  readonly method: string;
  /** The first resource segment, which is this atlas's kind. */
  readonly rootResource: string;
  /** The last resource segment before the method name, e.g. `operations` in `models.operations.list`. */
  readonly leafResource: string;
  /** The discovery document's own method name, e.g. `list`, `get`, `download`. */
  readonly methodName: string;
}

/**
 * One reviewed rule: what it matches, what it decides, and why in English.
 *
 * @internal
 */
export interface GeminiAiStudioDispositionRule {
  readonly id: string;
  readonly disposition: GeminiAiStudioDisposition;
  readonly reason: string;
  readonly matches: (input: GeminiAiStudioDispositionInput) => boolean;
}

/**
 * Every rule, in the order they are applied. First match wins, and the last one matches everything, so an
 * operation always leaves here with a decision and a reason rather than with a default nobody wrote down.
 */
export const GEMINI_AI_STUDIO_DISPOSITION_RULES: readonly GeminiAiStudioDispositionRule[] = [
  {
    disposition: "excluded",
    id: "mutation-or-inference-excluded",
    matches: (input) => input.method !== "GET",
    reason:
      "not a GET: it either changes state on the platform or runs inference, which costs money and sends " +
      "content to a model. This atlas calls neither. The operation is recorded because omitting it would " +
      "claim the API cannot do it",
  },
  {
    disposition: "excluded",
    id: "media-payload-excluded",
    matches: (input) => input.methodName === "download",
    reason:
      "returns a file's BYTES rather than a description of anything. Every field this atlas stores is a " +
      "name, so there is nothing here it could keep; the operation is recorded, and never called",
  },
  {
    disposition: "voluminous",
    id: "generated-file-stream-voluminous",
    matches: (input) => input.rootResource === "generatedFiles" && input.methodName === "list",
    reason:
      "lists artefacts the platform emitted while somebody was generating — unbounded, growing with use, " +
      "and named by a handle Google minted rather than by anything a person chose. Enumerated and declared; " +
      "never stored row by row",
  },
  {
    disposition: "voluminous",
    id: "operation-record-stream-voluminous",
    matches: (input) =>
      input.methodName === "list" && (input.leafResource === "operations" || input.rootResource === "operations"),
    reason:
      "lists long-running job records the platform minted, one per request anybody made — unbounded and " +
      "growing with the clock. The matching single-record GET is reachable, because that one addresses a " +
      "row a caller can already name",
  },
  {
    disposition: "reachable",
    id: "configuration-reachable",
    matches: () => true,
    reason:
      "a GET over configuration a person or a project created, listable exhaustively. This atlas may call " +
      "it once an API key exists, and holds none today",
  },
];

/**
 * What this atlas may do with one operation.
 *
 * @param input the operation's method, resource path and method name
 * @returns the disposition, the rule that decided it, and that rule's reason
 */
export function geminiAiStudioDispositionFor({ input }: { input: GeminiAiStudioDispositionInput }): {
  disposition: GeminiAiStudioDisposition;
  ruleId: string;
  reason: string;
} {
  for (const rule of GEMINI_AI_STUDIO_DISPOSITION_RULES) {
    if (rule.matches(input)) {
      return { disposition: rule.disposition, reason: rule.reason, ruleId: rule.id };
    }
  }
  // Unreachable: the last rule matches everything. Kept as a total function rather than a non-null assertion
  // so a future edit that removes the catch-all fails loudly here instead of throwing at a call site.
  return {
    disposition: "excluded",
    reason: "no reviewed disposition rule matched, which is a defect in `dispositions.ts` rather than a judgement",
    ruleId: "no-rule-matched",
  };
}

/**
 * Every reviewed rule's id, so a sync can report the ones nothing matched.
 *
 * @returns the rule ids, in application order
 */
export function geminiAiStudioDispositionRuleIds(): readonly string[] {
  return GEMINI_AI_STUDIO_DISPOSITION_RULES.map((rule) => rule.id);
}
