/**
 * The staged import questions nobody has answered, as `slopweaver store import-questions --json` publishes them
 * (`src/cli/commands/store/importQuestionsRun.ts`) — the register the Queue draws one card per question from.
 *
 * **All or nothing.** One question that will not read refuses the whole reading rather than leaving its siblings: a
 * dropped question is an answer the owner was never asked for, and a restore waits on every one of them, so a Queue
 * that drew the rest would read as complete while one stayed hidden.
 *
 * The part and answer vocabularies are RESTATED from `src/store/transfer/parts.ts` and `src/store/transfer/compare.ts`,
 * since `site/` may not import `src/`; the producer/consumer golden (`site/__tests__/unit/importQuestionsContract.test.ts`)
 * is what binds the copies.
 */
import { type Bag, bags, instant, isBag, str, strings } from "../../lib/bag";

/**
 * What a staged question asks: whether a new instruction takes effect, which side of a conflict stands, or, on an
 * alignment, that an append-only row differs while the current one stands.
 */
export type ImportQuestionKind = "activation" | "conflict" | "alignment";

/** One answer a staged question takes — `src/store/transfer/compare.ts`'s `ImportAction`. */
export type ImportQuestionAction = "activate" | "leave-inactive" | "keep-current" | "take-imported";

/** The export part a staged row came from — `src/store/transfer/parts.ts`'s `StoreExportPartKind`. */
export type ImportQuestionPart =
  | "memories"
  | "memory-recalls"
  | "owner-profile"
  | "owner-voice"
  | "owner-directives"
  | "standing-asks"
  | "steer-verdicts";

/** One unanswered import question as a card draws it. */
export interface ImportQuestionView {
  readonly batchId: string;
  readonly questionId: string;
  readonly kind: ImportQuestionKind;
  readonly part: ImportQuestionPart;
  readonly key: string;
  /** The imported row in one line. */
  readonly imported: string;
  /** The live row in one line on a conflict or an alignment; `undefined` on an activation, which has no live side. */
  readonly current: string | undefined;
  /** Exactly the answers the question takes, in the order the verb lists them. */
  readonly actions: readonly ImportQuestionAction[];
  readonly stagedAtIso: string;
}

/** The register as read. */
export interface ImportQuestionReading {
  readonly questions: readonly ImportQuestionView[];
}

/** A staged question's id: `import-q-` and 16 hex, the only shape the store accepts. */
const QUESTION_ID = /^import-q-[0-9a-f]{16}$/u;

/** The answers each kind takes, exactly and in order — the store's own CHECK. */
const ACTIONS: Readonly<Record<ImportQuestionKind, readonly ImportQuestionAction[]>> = {
  activation: ["activate", "leave-inactive"],
  alignment: ["keep-current"],
  conflict: ["keep-current", "take-imported"],
};

/** Every part a store export carries. */
const PARTS: ReadonlySet<string> = new Set<ImportQuestionPart>([
  "memories",
  "memory-recalls",
  "owner-profile",
  "owner-voice",
  "owner-directives",
  "standing-asks",
  "steer-verdicts",
]);

/**
 * Whether a value is one of the three question kinds.
 *
 * @returns true for `activation`, `conflict` or `alignment`
 */
function isQuestionKind(value: unknown): value is ImportQuestionKind {
  return value === "activation" || value === "conflict" || value === "alignment";
}

/**
 * Whether a value is a part a store export carries.
 *
 * @returns true for one of the seven part kinds
 */
function isQuestionPart(value: unknown): value is ImportQuestionPart {
  return typeof value === "string" && PARTS.has(value);
}

/**
 * The live side: `null` exactly on an activation, a line exactly on a conflict or an alignment, or `false` when
 * neither holds.
 */
function currentOf({ bag, kind }: { bag: Bag; kind: ImportQuestionKind }): string | undefined | false {
  const value = bag["current"];
  if (kind === "activation") {
    return value === null ? undefined : false;
  }
  return typeof value === "string" && value.length > 0 ? value : false;
}

/** The answers as published, when they are exactly the kind's own, position by position; else `undefined`. */
function actionsOf({ bag, kind }: { bag: Bag; kind: ImportQuestionKind }): readonly ImportQuestionAction[] | undefined {
  const published = strings({ bag, key: "actions" });
  const expected = ACTIONS[kind];
  if (published === undefined || published.length !== expected.length) {
    return undefined;
  }
  if (!expected.every((action, index) => published[index] === action)) {
    return undefined;
  }
  return expected;
}

/** One published question, or `undefined` when any field will not read. */
function questionOf({ value }: { value: Bag }): ImportQuestionView | undefined {
  const kind = value["kind"];
  const part = value["part"];
  const questionId = str({ bag: value, key: "questionId" });
  const batchId = str({ bag: value, key: "batchId" });
  const key = str({ bag: value, key: "key" });
  const imported = str({ bag: value, key: "imported" });
  const stagedAtIso = instant({ bag: value, key: "stagedAtIso" });
  if (!isQuestionKind(kind) || !isQuestionPart(part) || questionId === undefined || !QUESTION_ID.test(questionId)) {
    return undefined;
  }
  if (batchId === undefined || key === undefined || imported === undefined || stagedAtIso === undefined) {
    return undefined;
  }
  const current = currentOf({ bag: value, kind });
  const actions = actionsOf({ bag: value, kind });
  if (current === false || actions === undefined) {
    return undefined;
  }
  return { actions, batchId, current, imported, key, kind, part, questionId, stagedAtIso };
}

/**
 * Read the import-question register.
 *
 * @param payload the parsed stdout
 * @returns the reading, or `undefined` when the payload is not one, its own instant will not read, a question will
 *   not read, or two share an id
 */
export function readImportQuestions(payload: unknown): ImportQuestionReading | undefined {
  if (!isBag(payload) || instant({ bag: payload, key: "observedAtIso" }) === undefined) {
    return undefined;
  }
  const published = bags({ bag: payload, key: "questions" });
  if (published === undefined) {
    return undefined;
  }
  const questions: ImportQuestionView[] = [];
  for (const value of published) {
    const question = questionOf({ value });
    if (question === undefined) {
      return undefined;
    }
    questions.push(question);
  }
  if (new Set(questions.map((question) => question.questionId)).size !== questions.length) {
    return undefined;
  }
  return { questions };
}
