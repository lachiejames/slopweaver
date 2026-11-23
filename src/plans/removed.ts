/**
 * What the register remembers about a destination `plans remove` took off it — the alias, the store it named, and
 * when — so an alias can never quietly come back naming a DIFFERENT store.
 *
 * ## Why an alias outlives its row
 *
 * An alias is more than a selector once a row has lived: per-plan state outside the register is keyed by it. Claude
 * usage snapshots (`live/claude-usage/<alias>`), the Codex quota cache and its clear mark
 * (`codex-quota/<alias>.json`), Claude spend readings, sign-in records, identity assertions, rotation holds and reset
 * journals all name the alias and not the store. Re-adding
 * `plan-two` at a new store would hand the new account the old one's cap, hold, spend and asserted identity.
 *
 * So the register refuses that re-add rather than every one of those readers learning store identity: a different
 * store takes a NEW alias, which every one of them already reads as a plan with no history. Re-adding at the SAME
 * store is a restore — the history is that store's own — and it clears the entry.
 *
 * ## Stored beside the rows, never as a row
 *
 * `removed` is a top-level key of the register document, so an older checkout reading the `plans.json` projection
 * carries it through untouched (`PlanRegisterDocument` keeps every key) and never mistakes it for a destination.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";

import { isPlanAlias } from "./alias.js";
import type { PlanProvider, PlanRegisterDocument } from "./types.js";

/** The document key the history is kept under. */
const REMOVED_KEY = "removed";

/** One destination `plans remove` took off the register. */
export interface RemovedPlan {
  readonly provider: PlanProvider;
  readonly alias: string;
  /** The store the row named when it was removed — the only store its alias may come back at. */
  readonly storeDir: string;
  /** When it was removed, ISO-8601. */
  readonly removedAtIso: string;
}

/**
 * Whether one decoded entry is a well-formed removal.
 *
 * @param entry one element of the document's `removed` array
 * @returns whether it carries a provider, an alias a row could carry, a non-blank store and a strict instant — a row's
 *   own alias grammar and store rule, so no entry can name what no row ever could
 */
function isRemovedPlan(entry: unknown): entry is RemovedPlan {
  return (
    isRecord(entry) &&
    (entry["provider"] === "claude" || entry["provider"] === "codex") &&
    typeof entry["alias"] === "string" &&
    isPlanAlias({ alias: entry["alias"] }) &&
    typeof entry["storeDir"] === "string" &&
    entry["storeDir"].trim() !== "" &&
    typeof entry["removedAtIso"] === "string" &&
    parseStrictIsoInstantMs({ text: entry["removedAtIso"] }) !== undefined
  );
}

/**
 * Every problem with the document's removal history, empty when it has none.
 *
 * A malformed entry refuses the register rather than being skipped: a skipped one is an alias whose old history a
 * different store could then inherit, the exact failure this module exists to stop. So does a SECOND entry for one
 * alias: `remove` replaces an alias's earlier entry, so only a hand edit writes two, and an `add` honouring either
 * one would wave the alias through at the other's store.
 *
 * @param document the decoded register document
 * @returns every problem found
 */
export function removedProblems({ document }: { document: Readonly<Record<string, unknown>> }): readonly string[] {
  const removed = document[REMOVED_KEY];
  if (removed === undefined) {
    return [];
  }
  if (!Array.isArray(removed)) {
    return ["the register's `removed`, when present, must be an array"];
  }
  const seen = new Set<string>();
  return removed.flatMap((entry, index) => {
    const position = String(index + 1);
    if (!isRemovedPlan(entry)) {
      return [
        `removed entry ${position} needs a \`provider\`, an \`alias\`, the \`storeDir\` it named and a ` +
          "`removedAtIso` instant",
      ];
    }
    const key = `${entry.provider}/${entry.alias}`;
    if (seen.has(key)) {
      return [`removed entry ${position} names ${key} a second time; one alias keeps one removal record`];
    }
    seen.add(key);
    return [];
  });
}

/**
 * The removal history a document carries, after {@link removedProblems} reported nothing.
 *
 * @param document the register document
 * @returns each removal in recorded order, empty when there is none
 */
export function removedPlans({ document }: { document: PlanRegisterDocument }): readonly RemovedPlan[] {
  const removed = document[REMOVED_KEY];
  if (!Array.isArray(removed)) {
    return [];
  }
  return removed.filter(isRemovedPlan);
}

/**
 * Why an add may not reuse an alias, or undefined when it may.
 *
 * @param document the register document as it stands
 * @param provider the provider the add names
 * @param alias the alias the add names
 * @param storeDir the store the add names
 * @returns the refusal sentence, or undefined when the alias was never removed or comes back at its own store
 */
export function removedAliasConflict({
  alias,
  document,
  provider,
  storeDir,
}: {
  alias: string;
  document: PlanRegisterDocument;
  provider: PlanProvider;
  storeDir: string;
}): string | undefined {
  const prior = removedPlans({ document }).find((entry) => entry.provider === provider && entry.alias === alias);
  if (prior === undefined || prior.storeDir === storeDir) {
    return undefined;
  }
  return (
    `the ${provider} plan \`${alias}\` was removed at ${prior.removedAtIso} while it named ${prior.storeDir}; its ` +
    "usage snapshots, quota cache, identity assertion and rotation holds are keyed by that alias, so a different " +
    `store takes a new alias — or re-add \`${alias}\` at ${prior.storeDir} to restore it`
  );
}

/**
 * The document with one removal recorded, or with one cleared because its alias came back.
 *
 * @param document the register document to copy
 * @param entries the removal history it should carry
 * @returns a copy carrying exactly that history, the key dropped when it is empty
 */
export function withRemoved({
  document,
  entries,
}: {
  document: PlanRegisterDocument;
  entries: readonly RemovedPlan[];
}): PlanRegisterDocument {
  const rest = Object.fromEntries(Object.entries(document).filter(([key]) => key !== REMOVED_KEY));
  return {
    ...rest,
    rows: document.rows,
    version: document.version,
    ...(entries.length === 0 ? {} : { [REMOVED_KEY]: entries }),
  };
}
