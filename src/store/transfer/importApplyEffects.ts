/**
 * What an apply that may go ahead writes, row by row, decided by what its fresh plan made of each row and the answer
 * its question holds. Pure.
 *
 * A row the store holds identically writes nothing. A new record or measurement is written as it is. An append-only
 * row the store holds differently writes nothing: its live row stands and the imported one stays staged. A restored
 * instruction is written in the state its activation answer gave it, and a conflict's `take-imported` writes the
 * imported row over what it meets — a directive retiring its live version, a standing ask withdrawing every live ask
 * the fresh plan found it meeting. `keep-current` writes nothing. Rows are written in their staged order, which is the
 * order the exporting store held them in.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { OwnerCorrection, OwnerDirective } from "../../judgement/ownerDirective.js";
import type { ImportedCorrectionVersion, ImportedDirectiveVersion } from "../../judgement/ownerJudgementImport.js";
import type { RecallRecord } from "../../knowledge/recallRestore.js";
import type { RestoredRecording } from "../../knowledge/restore.js";
import type { ImportedStandingAskVersion } from "../../profile/standingAskImportRows.js";
import type { SteerMeasurementEnvelopeV2 } from "../../profile/steerMeasurementTransfer.js";
import type { VoiceCohort } from "../profile/types.js";

import type { ImportQuestion } from "./compare.js";
import type { PortableOwnerProfile } from "./decode.js";
import { type StoreImportApplyError, StoreImportApplyErrors } from "./importApplyErrors.js";
import type { ImportApplicationPlan } from "./importApplyPlan.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import type { ImportRowStatus } from "./rowClassify.js";
import type { StagedValue } from "./stagedDecode.js";

/** Every row an apply writes, by the register it lands in, each list in staged order. */
export interface ImportEffects {
  /** The owner profile's portable fields, or `null` when the apply leaves the profile as it is. */
  readonly profile: PortableOwnerProfile | null;
  readonly voice: readonly VoiceCohort[];
  readonly memories: readonly RestoredRecording[];
  readonly recalls: readonly RecallRecord[];
  readonly directives: readonly ImportedDirectiveVersion[];
  readonly corrections: readonly ImportedCorrectionVersion[];
  readonly standingAsks: readonly ImportedStandingAskVersion[];
  readonly steerMeasurements: readonly SteerMeasurementEnvelopeV2[];
}

/** What one row's plan and answer make of it. */
type RowDecision =
  | { readonly write: false }
  | {
      readonly write: true;
      /** Whether it steers; a record or measurement is always written as itself. */
      readonly state: "active" | "inactive";
      /** The question whose answer admitted it, or `null` for a new record or measurement no question asked about. */
      readonly questionId: string | null;
      /** Whether it is written over what it meets: a conflict's `take-imported`. */
      readonly replaces: boolean;
    };

/** One part's place and key, as one string no key can run into. */
function rowKey({ part, key }: { part: StoreExportPartKind; key: string }): string {
  return `${part}\u0000${key}`;
}

/** What one row's status, question and answer make of it, or why an answer an apply needs is not there. */
function decide({
  batchId,
  status,
  question,
  answer,
}: {
  batchId: string;
  status: ImportRowStatus;
  question: ImportQuestion | undefined;
  answer: string | undefined;
}): Result<RowDecision, StoreImportApplyError> {
  if (status.status === "identical") {
    return ok({ write: false });
  }
  if (question === undefined) {
    return ok({ questionId: null, replaces: false, state: "active", write: true });
  }
  if (question.kind === "alignment") {
    return ok({ write: false });
  }
  if (answer === undefined) {
    return err(StoreImportApplyErrors.questionsOpen({ batchId, questionIds: [question.id] }));
  }
  if (answer === "keep-current") {
    return ok({ write: false });
  }
  const state = answer === "leave-inactive" ? "inactive" : "active";
  return ok({ questionId: question.id, replaces: answer === "take-imported", state, write: true });
}

/** The effects being gathered, each list growable. */
interface Gathering {
  profile: PortableOwnerProfile | null;
  readonly voice: VoiceCohort[];
  readonly memories: RestoredRecording[];
  readonly recalls: RecallRecord[];
  readonly directives: ImportedDirectiveVersion[];
  readonly corrections: ImportedCorrectionVersion[];
  readonly standingAsks: ImportedStandingAskVersion[];
  readonly steerMeasurements: SteerMeasurementEnvelopeV2[];
}

/** One judgement version as its writer takes it, or why an instruction arrived with no question admitting it. */
function judgementVersion<T extends OwnerDirective | OwnerCorrection>({
  batchId,
  value,
  key,
  decision,
}: {
  batchId: string;
  value: T;
  key: string;
  decision: Extract<RowDecision, { write: true }>;
}): Result<
  { value: T; state: "active" | "inactive"; questionId: string; retiresCurrent: boolean },
  StoreImportApplyError
> {
  if (decision.questionId === null) {
    return err(
      StoreImportApplyErrors.batchIncomplete({ batchId, why: `instruction ${key} is restored with no question asked` }),
    );
  }
  return ok({ questionId: decision.questionId, retiresCurrent: decision.replaces, state: decision.state, value });
}

/** One standing ask as its writer takes it, withdrawing what it meets when it replaces it. */
function standingAskVersion({
  batchId,
  ask,
  status,
  decision,
}: {
  batchId: string;
  ask: ImportedStandingAskVersion["ask"];
  status: ImportRowStatus;
  decision: Extract<RowDecision, { write: true }>;
}): Result<ImportedStandingAskVersion, StoreImportApplyError> {
  if (decision.questionId === null) {
    const why = `standing ask ${ask.id} is restored with no question asked`;
    return err(StoreImportApplyErrors.batchIncomplete({ batchId, why }));
  }
  const withdraws = decision.replaces ? status.meets : [];
  return ok({ ask, questionId: decision.questionId, state: decision.state, withdraws });
}

/** Add one written row to the register it lands in. */
function gather({
  batchId,
  into,
  value,
  status,
  decision,
}: {
  batchId: string;
  into: Gathering;
  value: StagedValue;
  status: ImportRowStatus;
  decision: Extract<RowDecision, { write: true }>;
}): Result<undefined, StoreImportApplyError> {
  switch (value.kind) {
    case "memory": {
      into.memories.push(value.recording);
      return ok(undefined);
    }
    case "recall": {
      into.recalls.push(value.recall);
      return ok(undefined);
    }
    case "owner": {
      into.profile = value.owner;
      return ok(undefined);
    }
    case "voice": {
      into.voice.push(value.cohort);
      return ok(undefined);
    }
    case "directive": {
      const key = status.key;
      return judgementVersion({ batchId, decision, key, value: value.directive }).map((version) => {
        into.directives.push(version);
        return undefined;
      });
    }
    case "correction": {
      const key = status.key;
      return judgementVersion({ batchId, decision, key, value: value.correction }).map((version) => {
        into.corrections.push(version);
        return undefined;
      });
    }
    case "standing-ask": {
      return standingAskVersion({ ask: value.ask, batchId, decision, status }).map((version) => {
        into.standingAsks.push(version);
        return undefined;
      });
    }
    case "steer": {
      into.steerMeasurements.push(value.envelope);
      return ok(undefined);
    }
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}

/** One carried part's rows, in staged order, each decided and gathered. */
function gatherPart({
  application,
  part,
  statuses,
  questions,
  into,
}: {
  application: ImportApplicationPlan;
  part: StoreExportPartKind;
  statuses: ReadonlyMap<string, ImportRowStatus>;
  questions: ReadonlyMap<string, ImportQuestion>;
  into: Gathering;
}): Result<undefined, StoreImportApplyError> {
  const batchId = application.staged.batch.id;
  const values = application.staged.values.get(part)!;
  for (const entry of application.staged.imported.get(part)!) {
    const at = rowKey({ key: entry.key, part });
    const status = statuses.get(at);
    if (status === undefined) {
      return err(
        StoreImportApplyErrors.batchIncomplete({ batchId, why: `row ${entry.key} of ${part} was not planned` }),
      );
    }
    const question = questions.get(at);
    const answer = question === undefined ? undefined : application.staged.answers.get(question.id);
    const decision = decide({ answer, batchId, question, status });
    if (decision.isErr()) {
      return err(decision.error);
    }
    if (!decision.value.write) {
      continue;
    }
    const gathered = gather({ batchId, decision: decision.value, into, status, value: values.get(entry.key)! });
    if (gathered.isErr()) {
      return err(gathered.error);
    }
  }
  return ok(undefined);
}

/**
 * Every row an apply that may go ahead writes.
 *
 * @param application the readiness decision's plan, its staged import holding each row's decoded value
 * @param statuses every imported row's status against the live store, from the same live read the plan was made on
 * @returns the effects, register by register in staged order, or `IMPORT_QUESTIONS_OPEN` for a row whose answer an
 *   apply needs and does not hold, or `IMPORT_STAGED_BATCH_INCOMPLETE` for a row the plan did not cover or an
 *   instruction no question admitted
 */
export function importApplicationEffects({
  application,
  statuses,
}: {
  application: ImportApplicationPlan;
  statuses: readonly ImportRowStatus[];
}): Result<ImportEffects, StoreImportApplyError> {
  const byRow = new Map(statuses.map((status) => [rowKey(status), status]));
  const questions = new Map(application.plan.questions.map((question) => [rowKey(question), question]));
  const into: Gathering = {
    corrections: [],
    directives: [],
    memories: [],
    profile: null,
    recalls: [],
    standingAsks: [],
    steerMeasurements: [],
    voice: [],
  };
  for (const spec of STORE_EXPORT_PARTS.filter((one) => application.staged.imported.has(one.kind))) {
    const gathered = gatherPart({ application, into, part: spec.kind, questions, statuses: byRow });
    if (gathered.isErr()) {
      return err(gathered.error);
    }
  }
  return ok(into);
}
