/**
 * The reader for `automation status --json` — every automation and corpus sync, as the Automations page draws them.
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never drop a row. What is different is that two of its shapes are built to be REUSED: the sync-run
 * view is what onboarding's sync wait draws too, so it is exported and read by its own function rather than inline.
 *
 * Every field is the verb's (`src/automations/read.ts`, `src/syncRun/fold.ts`). Nothing here computes a figure; a
 * rate arrives as an amount over a measured span and is divided at draw time, never projected forward.
 */
import { type Bag, bags, every, isBag, nullableStr, str, strings } from "../../lib/bag";
import { type Automation, automation } from "./readAutomationsCard";
import { readSyncRun, type SyncRun } from "./readAutomationsSyncRun";

/** The whole page. */
export interface AutomationsView {
  readonly observedAtIso: string;
  readonly automations: readonly Automation[];
  readonly rejected: readonly { readonly file: string; readonly why: string }[];
  readonly issues: readonly string[];
  /** Why the definitions would not list — set, every count on the page is unread rather than zero. */
  readonly rosterGap: string | undefined;
  readonly unscheduledSyncs: readonly { readonly source: string; readonly runs: readonly SyncRun[] }[];
}

/** One unscheduled sync. */
function unscheduled(bag: Bag): AutomationsView["unscheduledSyncs"][number] | undefined {
  const source = str({ bag, key: "source" });
  const runs = every({ list: bags({ bag, key: "runs" }), read: readSyncRun });
  if (source === undefined || runs === undefined) {
    return undefined;
  }
  return { runs, source };
}

/** One rejected definition file. */
function rejectedFile(bag: Bag): { file: string; why: string } | undefined {
  const file = str({ bag, key: "file" });
  const why = str({ bag, key: "why" });
  if (file === undefined || why === undefined) {
    return undefined;
  }
  return { file, why };
}

/**
 * Project `automation status --json` into the page's view.
 *
 * @param payload the parsed document
 * @returns the view, or `undefined` when any part of the payload is not the verb's shape
 */
export function readAutomations(payload: unknown): AutomationsView | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const issues = strings({ bag: payload, key: "issues" });
  const automations = every({ list: bags({ bag: payload, key: "cards" }), read: automation });
  const rejected = every({ list: bags({ bag: payload, key: "rejected" }), read: rejectedFile });
  const unscheduledSyncs = every({ list: bags({ bag: payload, key: "unscheduledSyncs" }), read: unscheduled });
  if (observedAtIso === undefined || issues === undefined || automations === undefined) {
    return undefined;
  }
  const rosterGap = nullableStr({ bag: payload, key: "rosterGap" });
  if (rejected === undefined || unscheduledSyncs === undefined || rosterGap === false) {
    return undefined;
  }
  return { automations, issues, observedAtIso, rejected, rosterGap, unscheduledSyncs };
}
