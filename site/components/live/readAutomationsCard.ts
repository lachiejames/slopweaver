/**
 * One automation as its card draws it, and the readers that build it from the verb's card. A sibling of
 * `./readAutomations.ts`, under every rule its module doc states.
 */

import { type Bag, bags, bool, every, nullableStr, num, str, strings, sub } from "../../lib/bag";
import {
  type AutomationOutputs,
  type AutomationSteering,
  readAutomationOutputs,
  readAutomationSteering,
} from "./readAutomationDetail";
import { accountOf, type BrokenAccount } from "./readAutomationsAccount";
import { type Firing, firing } from "./readAutomationsFiring";
import { type CardSyncRun, readSyncRun } from "./readAutomationsSyncRun";

/** One automation. */
export interface Automation {
  readonly recipeId: string;
  /** Its plain name, when this build names it; the card falls back to its id only when it does not. */
  readonly name: string | undefined;
  /** What it is for, in one sentence. */
  readonly forWhat: string | undefined;
  /** The five answers, for a broken or paused one. */
  readonly account: BrokenAccount | undefined;
  /** The board row whose fix lifts its failure hold. */
  readonly fixRow: string | undefined;
  /** The owner's own recorded reason for pausing it. */
  readonly pauseReason: string | undefined;
  /**
   * Whether the row is switched on, whenever it next runs — what the sidebar counts as an active automation. The
   * verb's own judgement (`src/automations/card.ts`), never guessed here off the health.
   */
  readonly switchedOn: boolean;
  readonly kind: string;
  readonly kindSummary: string | undefined;
  readonly cadence: string;
  readonly destination: string;
  readonly what: string;
  readonly health: string;
  readonly why: string;
  readonly nowDoing: string;
  /** "How long does it take?", answered in plain sentences. */
  readonly durationWords: string;
  /** "Is a failure common?", answered in plain sentences. */
  readonly reliabilityWords: string;
  /** Both answers in a few words, for the folded card. */
  readonly glanceWords: string;
  readonly waitingOn: string | undefined;
  readonly lastRunAtIso: string | undefined;
  readonly lastSucceededIso: string | undefined;
  readonly lastBrokeIso: string | undefined;
  /** Why the firing history may be missing rows, when the slot ledger did not read whole. */
  readonly firingsGap: string | undefined;
  /** Every firing on disk that settled failed or dead, newest first — counted past the owner's last look. */
  readonly brokeAtIsos: readonly string[];
  readonly newestFailure: { readonly atIso: string; readonly detail: string } | undefined;
  readonly firings: {
    readonly recorded: number;
    readonly sinceIso: string | undefined;
    readonly succeeded: number;
    readonly failed: number;
    readonly dead: number;
    readonly deferred: number;
    readonly open: number;
    /** Scheduled times since the oldest firing that went by with no run — absent when it was not counted. */
    readonly unrun: { readonly count: number; readonly bound: "exact" | "at-least" } | undefined;
  };
  readonly recentFirings: readonly Firing[];
  readonly syncSource: string | undefined;
  readonly syncRuns: readonly CardSyncRun[];
  /** Why the sync runs above may be missing, when the sync-run ledger would not read. */
  readonly syncRunsGap: string | undefined;
  /** What each recent firing posted or filed, and the readings and floating notes the row left. */
  readonly outputs: AutomationOutputs;
  /** Every request sent to the supervisor about this row, its answer, and the row's dated timeline. */
  readonly steering: AutomationSteering;
}

/** One of a card's sync runs: the shared view plus its plain words, which only a card carries. */
function cardSyncRun(bag: Bag): CardSyncRun | undefined {
  const run = readSyncRun(bag);
  const said = nullableStr({ bag, key: "said" });
  if (run === undefined || said === false) {
    return undefined;
  }
  return { ...run, said };
}

/** An automation's name, purpose and hold pointers, each `null` on the wire read as absent. */
function automationPurpose({
  bag,
}: {
  bag: Bag;
}): Pick<Automation, "name" | "forWhat" | "account" | "fixRow" | "pauseReason"> | undefined {
  const name = nullableStr({ bag, key: "name" });
  const forWhat = nullableStr({ bag, key: "forWhat" });
  const fixRow = nullableStr({ bag, key: "fixRow" });
  const pauseReason = nullableStr({ bag, key: "pauseReason" });
  const account = accountOf({ bag });
  if (name === false || forWhat === false || fixRow === false || pauseReason === false || account === false) {
    return undefined;
  }
  return { account, fixRow, forWhat, name, pauseReason };
}

/** The firing tally. */
function firingTally({ bag }: { bag: Bag | undefined }): Automation["firings"] | undefined {
  if (bag === undefined) {
    return undefined;
  }
  const sinceIso = nullableStr({ bag, key: "sinceIso" });
  const recorded = num({ bag, key: "recorded" });
  const succeeded = num({ bag, key: "succeeded" });
  const failed = num({ bag, key: "failed" });
  const dead = num({ bag, key: "dead" });
  const deferred = num({ bag, key: "deferred" });
  const open = num({ bag, key: "open" });
  if (sinceIso === false || recorded === undefined || succeeded === undefined || failed === undefined) {
    return undefined;
  }
  const unrun = unrunOf({ bag });
  if (dead === undefined || deferred === undefined || open === undefined || unrun === false) {
    return undefined;
  }
  return { dead, deferred, failed, open, recorded, sinceIso, succeeded, unrun };
}

/** The unrun-slot count, `null` on the wire meaning it was not counted; `false` for a shape that is neither. */
function unrunOf({ bag }: { bag: Bag }): Automation["firings"]["unrun"] | false {
  if (bag["unrun"] === null) {
    return undefined;
  }
  const unrun = sub({ bag, key: "unrun" });
  if (unrun === undefined) {
    return false;
  }
  const count = num({ bag: unrun, key: "count" });
  const bound = unrun["bound"];
  const wholeCount = count !== undefined && Number.isInteger(count) && count >= 0;
  if (!wholeCount || (bound !== "exact" && bound !== "at-least")) {
    return false;
  }
  return { bound, count };
}

/** The newest failure, `null` meaning none is on disk. */
function newestFailureOf({ bag }: { bag: Bag }): Automation["newestFailure"] | false {
  if (bag["newestFailure"] === null) {
    return undefined;
  }
  const inner = sub({ bag, key: "newestFailure" });
  if (inner === undefined) {
    return false;
  }
  const atIso = str({ bag: inner, key: "atIso" });
  const detail = str({ bag: inner, key: "detail" });
  if (atIso === undefined || detail === undefined) {
    return false;
  }
  return { atIso, detail };
}

/** An automation's own words: what it is, its health and what it is doing. */
function automationWords({
  bag,
}: {
  bag: Bag;
}):
  | Pick<
      Automation,
      | "recipeId"
      | "kind"
      | "cadence"
      | "destination"
      | "what"
      | "health"
      | "why"
      | "nowDoing"
      | "durationWords"
      | "reliabilityWords"
      | "glanceWords"
    >
  | undefined {
  const recipeId = str({ bag, key: "recipeId" });
  const kind = str({ bag, key: "kind" });
  const cadence = str({ bag, key: "cadence" });
  const destination = str({ bag, key: "destination" });
  const what = str({ bag, key: "what" });
  const health = str({ bag, key: "health" });
  const why = str({ bag, key: "why" });
  const nowDoing = str({ bag, key: "nowDoing" });
  const durationWords = str({ bag, key: "durationWords" });
  const reliabilityWords = str({ bag, key: "reliabilityWords" });
  const glanceWords = str({ bag, key: "glanceWords" });
  if (recipeId === undefined || kind === undefined || cadence === undefined || destination === undefined) {
    return undefined;
  }
  if (what === undefined || health === undefined || why === undefined || nowDoing === undefined) {
    return undefined;
  }
  if (durationWords === undefined || reliabilityWords === undefined || glanceWords === undefined) {
    return undefined;
  }
  return {
    cadence,
    destination,
    durationWords,
    glanceWords,
    health,
    kind,
    nowDoing,
    recipeId,
    reliabilityWords,
    what,
    why,
  };
}

/** An automation's instants and pointers, each `null` on the wire read as absent. */
function automationMarks({
  bag,
}: {
  bag: Bag;
}):
  | Pick<
      Automation,
      | "kindSummary"
      | "waitingOn"
      | "lastRunAtIso"
      | "lastSucceededIso"
      | "lastBrokeIso"
      | "syncSource"
      | "firingsGap"
      | "syncRunsGap"
    >
  | undefined {
  const kindSummary = nullableStr({ bag, key: "kindSummary" });
  const waitingOn = nullableStr({ bag, key: "waitingOn" });
  const lastRunAtIso = nullableStr({ bag, key: "lastRunAtIso" });
  const lastSucceededIso = nullableStr({ bag, key: "lastSucceededIso" });
  const lastBrokeIso = nullableStr({ bag, key: "lastBrokeIso" });
  const syncSource = nullableStr({ bag, key: "syncSource" });
  const firingsGap = nullableStr({ bag, key: "firingsGap" });
  const syncRunsGap = nullableStr({ bag, key: "syncRunsGap" });
  if (kindSummary === false || waitingOn === false || lastRunAtIso === false) {
    return undefined;
  }
  if (lastSucceededIso === false || lastBrokeIso === false || syncSource === false || firingsGap === false) {
    return undefined;
  }
  if (syncRunsGap === false) {
    return undefined;
  }
  return { firingsGap, kindSummary, lastBrokeIso, lastRunAtIso, lastSucceededIso, syncRunsGap, syncSource, waitingOn };
}

/**
 * One automation.
 *
 * @returns the automation, or `undefined` when its shape moved
 */
export function automation(bag: Bag): Automation | undefined {
  const words = automationWords({ bag });
  const marks = automationMarks({ bag });
  const purpose = automationPurpose({ bag });
  const firings = firingTally({ bag: sub({ bag, key: "firings" }) });
  const recentFirings = every({ list: bags({ bag, key: "recentFirings" }), read: firing });
  const syncRuns = every({ list: bags({ bag, key: "syncRuns" }), read: cardSyncRun });
  const newestFailure = newestFailureOf({ bag });
  const brokeAtIsos = strings({ bag, key: "brokeAtIsos" });
  const outputs = readAutomationOutputs({ bag: sub({ bag, key: "outputs" }) });
  const steering = readAutomationSteering({ bag: sub({ bag, key: "steering" }) });
  const switchedOn = bool({ bag, key: "switchedOn" });
  if (words === undefined || marks === undefined || firings === undefined || recentFirings === undefined) {
    return undefined;
  }
  if (syncRuns === undefined || newestFailure === false || brokeAtIsos === undefined || switchedOn === undefined) {
    return undefined;
  }
  if (outputs === undefined || steering === undefined || purpose === undefined) {
    return undefined;
  }
  return {
    ...words,
    ...marks,
    ...purpose,
    brokeAtIsos,
    firings,
    newestFailure,
    outputs,
    recentFirings,
    steering,
    switchedOn,
    syncRuns,
  };
}
