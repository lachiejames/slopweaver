/**
 * The board-level fields `./read.ts`'s `readBoard` reads off the published document beside its rows: the Linear
 * facts, the detached asks and the doc files the scan could not read.
 */
import { type Bag, isBag, str, strings, sub } from "../../lib/bag";

/**
 * The install's Linear workspace, as `handover list --json` publishes it once per board: what turns a bare
 * `QQQQ-134` on a card into its address when its team key is one of these.
 */
export interface LinearReferences {
  readonly workspaceSlug: string | undefined;
  readonly teamKeys: readonly string[];
}

/** No Linear facts — a board cut before the verb published them, or an install with no Linear. */
export const NO_LINEAR_REFERENCES: LinearReferences = { teamKeys: [], workspaceSlug: undefined };

/**
 * A run waiting on the owner's word whose doc left the board (archived, renamed or deleted), exactly as `handover list
 * --json` publishes it under `detachedAsks`. Structural, mirroring `src/handover/detachedAsk.ts`.
 */
export interface DetachedAsk {
  readonly slug: string;
  readonly question: string;
  readonly askedIso: string;
  readonly journal: string;
  /** `missing` is proven gone; `unreadable` carries why its absence is not shown. */
  readonly doc: { readonly kind: "missing" } | { readonly kind: "unreadable"; readonly why: string };
}

/**
 * One published detached ask, or `undefined` when any field will not read.
 *
 * @param entry the raw list member
 * @returns the ask, or `undefined`
 */
function detachedAskOf({ entry }: { entry: Bag }): DetachedAsk | undefined {
  const slug = str({ bag: entry, key: "slug" });
  const question = str({ bag: entry, key: "question" });
  const askedIso = str({ bag: entry, key: "askedIso" });
  const journal = str({ bag: entry, key: "journal" });
  const doc = entry["doc"];
  if (slug === undefined || question === undefined || askedIso === undefined || journal === undefined) {
    return undefined;
  }
  if (!isBag(doc)) {
    return undefined;
  }
  if (doc["kind"] === "missing") {
    return { askedIso, doc: { kind: "missing" }, journal, question, slug };
  }
  const why = str({ bag: doc, key: "why" });
  if (doc["kind"] !== "unreadable" || why === undefined) {
    return undefined;
  }
  return { askedIso, doc: { kind: "unreadable", why }, journal, question, slug };
}

/**
 * The board's detached asks. ABSENT is a board cut by a CLI older than the field, which carries none; PRESENT and
 * unreadable — not a list, or one member that will not read — refuses the whole board, because dropping one would
 * take a question the owner owes an answer to off the one page the owner reads with nothing saying so.
 *
 * @param payload the published board document
 * @returns the asks, empty when the field is absent, or `undefined` when it is present and will not read
 */
export function detachedAsksOf({ payload }: { payload: Bag }): readonly DetachedAsk[] | undefined {
  const raw = payload["detachedAsks"];
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const out: DetachedAsk[] = [];
  for (const entry of raw as readonly unknown[]) {
    const ask = isBag(entry) ? detachedAskOf({ entry }) : undefined;
    if (ask === undefined) {
      return undefined;
    }
    out.push(ask);
  }
  return out;
}

/**
 * The board's Linear facts, `undefined` when the field is present and will not read.
 *
 * Absent reads as none, said here rather than hidden in a `??`: a board cut before the verb published the
 * field carries no Linear facts, which only narrows what a card links. A present field that will not read is a
 * disagreement between the verb and this page, and refuses the board like any other malformed field.
 *
 * @param payload the board's raw bag
 * @returns the facts, or `undefined` when a present field is malformed
 */
export function linearReferencesOf({ payload }: { payload: Bag }): LinearReferences | undefined {
  if (payload["referenceContext"] === undefined) {
    return NO_LINEAR_REFERENCES;
  }
  const context = sub({ bag: payload, key: "referenceContext" });
  if (context === undefined) {
    return undefined;
  }
  const teamKeys = strings({ bag: context, key: "linearTeamKeys" });
  const workspaceSlug = str({ bag: context, key: "linearWorkspaceSlug" });
  const slugMalformed = context["linearWorkspaceSlug"] !== undefined && workspaceSlug === undefined;
  if (teamKeys === undefined || slugMalformed) {
    return undefined;
  }
  return { teamKeys, workspaceSlug };
}

/**
 * The doc files the board says it could not read, `undefined` when the field is present and will not read.
 *
 * Absent reads as none, said here rather than in a `??`: a board cut before the verb published the field
 * names no unreadable file, which is what that board claimed.
 *
 * @param payload the board's raw bag
 * @returns the file names, or `undefined` when a present field is not a list of strings
 */
export function unreadableOf({ payload }: { payload: Bag }): readonly string[] | undefined {
  if (payload["unreadable"] === undefined) {
    return [];
  }
  return strings({ bag: payload, key: "unreadable" });
}
