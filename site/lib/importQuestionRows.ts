/**
 * The queue's rows for the import-question register: one per question a store import staged and nobody has answered.
 * A restored instruction never takes effect, and a conflict with a live row is never settled, until the owner answers, so
 * each one is the owner's. An alignment is the owner's to SEE: an append-only row differs, the current one stands
 * whatever they say, and their one answer acknowledges it. Every option is a command rather than a button: the console records nothing.
 */

import type {
  ImportQuestionAction,
  ImportQuestionReading,
  ImportQuestionView,
} from "../components/live/readImportQuestions";
import type { LiveState } from "../components/live/useLive";
import { type BriefingCardBasis, briefingCardForm } from "./briefingCardForm";
import { withoutMachineIds } from "./machineIds";
import { asQuestion, type BriefingCard, type CardOption, foldedText } from "./queueCard";
import type { QueueRow } from "./queueRows";
import type { QueueTags } from "./queueTagsInherited";
import { waitingTierOf } from "./waitingRank";
import { installationStateEvidence } from "./workspacePlacement";

/** What `importQuestionCard` states: a `what` read off the staged question, and nothing it was not given. */
const IMPORT_BASIS: BriefingCardBasis = { lean: "absent", problem: "absent", stakes: "absent", what: "present" };

/** The sentence each answer draws as an option, in the words of what it does. */
const ANSWER_SENTENCES: Readonly<Record<ImportQuestionAction, string>> = {
  activate: "Activate it: the restored instruction steers once the import is applied.",
  "keep-current": "Keep the current one: the live row stands and the imported one is not applied.",
  "leave-inactive": "Leave it inactive: it is restored as a record and steers nothing.",
  "take-imported": "Take the imported one: it replaces the live row once the import is applied.",
};

/** The one answer an alignment takes, in the words of what it does: nothing changes, so it acknowledges. */
const ALIGNMENT_SENTENCE = "Acknowledge it: the current row stands, and the imported one stays staged, unapplied.";

/** The pill each kind of question draws. */
const PILLS: Readonly<Record<ImportQuestionView["kind"], string>> = {
  activation: "restored instruction",
  alignment: "import difference",
  conflict: "import conflict",
};

/** What a card of one kind says, beside its options: the question, what it shows, and what silence does. */
interface KindWording {
  readonly asked: string;
  readonly what: string;
  readonly ifSilent: string;
  readonly whyYou: string;
}

/** Why an instruction or a conflict is the owner's: neither is settled without them. */
const DECIDE_WHY =
  "A restored instruction never takes effect, and a conflict with a live row is never settled, without your answer.";

/** The wording one question's card carries, by its kind; every staged line is drawn without machine ids. */
function kindWording({ question }: { question: ImportQuestionView }): KindWording {
  const key = withoutMachineIds({ text: question.key });
  const imported = withoutMachineIds({ text: question.imported });
  if (question.current === undefined) {
    return {
      asked: `Should the restored ${question.part} row ${key} take effect`,
      ifSilent: "The question stays open and nothing the import staged is applied.",
      what: `The import restores: ${imported}`,
      whyYou: DECIDE_WHY,
    };
  }
  const what = `Current: ${withoutMachineIds({ text: question.current })} Imported: ${imported}`;
  if (question.kind === "alignment") {
    return {
      asked: `The imported ${question.part} row ${key} differs from your current one, which stays. Acknowledge it`,
      ifSilent: "The question stays open, and the current row stands either way.",
      what,
      whyYou:
        "An old row that disagrees with a current one is never settled by assumption, so you see every difference.",
    };
  }
  return {
    asked: `Keep your current ${question.part} row ${key}, or take the imported one`,
    ifSilent: "The question stays open and nothing the import staged is applied.",
    what,
    whyYou: DECIDE_WHY,
  };
}

/**
 * The command that records one answer.
 *
 * @returns the `store import-resolve` line for this question and answer
 */
export function importResolveCommand({
  question,
  action,
}: {
  question: ImportQuestionView;
  action: ImportQuestionAction;
}): string {
  return `slopweaver store import-resolve --question ${question.questionId} --action ${action}`;
}

/**
 * The card for one staged import question.
 *
 * @returns the card, one option per answer the question takes, and no silent option: silence applies nothing
 */
export function importQuestionCard({ question }: { question: ImportQuestionView }): BriefingCard {
  const options: CardOption[] = question.actions.map((action, index) => ({
    how: { command: importResolveCommand({ action, question }), kind: "elsewhere", where: "a session" },
    letter: String.fromCodePoint(65 + index),
    sentence: question.kind === "alignment" ? ALIGNMENT_SENTENCE : ANSWER_SENTENCES[action],
  }));
  // A staged summary is the export's text, so it may carry a session, call or talk id. The drawn lines hide one
  // (`./machineIds.ts`), so the card is always drawn rather than withheld; the panel's record lines keep it verbatim.
  const wording = kindWording({ question });
  return {
    commands: [],
    examples: undefined,
    head: undefined,
    ifSilent: wording.ifSilent,
    kind: "briefing",
    lean: undefined,
    options,
    pages: [],
    problem: undefined,
    question: asQuestion({ text: wording.asked }),
    stakes: undefined,
    subject: `${question.part} ${question.key}`,
    what: foldedText({ text: wording.what }),
    whyYou: wording.whyYou,
  };
}

/**
 * One row per open import question.
 *
 * @param imports the register as the page holds it
 * @returns the rows, without tags yet; none until the register has read
 */
export function importQuestionRows({
  imports,
}: {
  imports: LiveState<ImportQuestionReading>;
}): Omit<QueueRow, keyof QueueTags>[] {
  if (imports.phase !== "ready") {
    return [];
  }
  // A store import changes this installation's own state, so every question is the self workspace's.
  const placedBy = installationStateEvidence({ value: "state:store_import_question" })!;
  return imports.value.questions.map((question) => {
    const card = importQuestionCard({ question });
    return {
      card,
      hint: [question.part, question.key, question.imported, question.current]
        .filter((part) => part !== undefined)
        .join(" "),
      id: question.questionId,
      key: `import:${question.questionId}`,
      kind: "import",
      pill: PILLS[question.kind],
      provenance: "self",
      record: { form: briefingCardForm({ basis: IMPORT_BASIS, card }), kind: "import", question },
      placement: { by: [placedBy], kind: "placed", workspace: "self" },
      // No batch id here: it is a uuid, which the machine-id gate refuses on any drawn line (`./machineIdForm.ts`).
      // The panel folds it into the record's own lines instead.
      source: { kind: "unrecorded", origin: "a store import staged this question", steers: [] },
      threadUrl: undefined,
      tier: waitingTierOf({ checkIn: false, teamFacing: false }),
      verifiedBy: "the import-question register still holds it",
      currencyFloorIso: question.stagedAtIso,
      verifiedIso: imports.observedAtIso,
      whenIso: question.stagedAtIso,
    };
  });
}
