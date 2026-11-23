/**
 * The per-row field readers `./readLanding.ts`'s landing row is built from — its tests, failing checks, red
 * rollup, board join and thread counts — and the types they return. A sibling of `./readLanding.ts`, under every
 * rule its module doc states.
 */

import { type Bag, bags, num, str, sub } from "../../lib/bag";

/** One of the six tests `github landing` runs per row, with the verb's own verdict and reason. */
export interface LandingTest {
  readonly id: string;
  readonly verdict: string;
  readonly why: string;
}

/** One check GitHub reported as not green, as the verb carried it. */
export interface LandingCheck {
  readonly name: string;
  /** Whether the base requires it — `undefined` when the verb could not tell, which is never advisory. */
  readonly required: boolean | undefined;
  readonly state: string;
  readonly url: string | undefined;
}

/**
 * What a red rollup is red ON, mirroring the verb's `LandingCiFailure`: `required: true` a required check,
 * `false` advisory checks only, `undefined` a requirement the read could not establish.
 */
export type LandingCiFailure =
  { readonly kind: "not-red" } | { readonly kind: "red"; readonly required: boolean | undefined };

/** One reviewer with open threads, as the verb tallied them. */
export interface LandingWaiting {
  readonly login: string;
  readonly open: number;
}

/** Reviewer threads counted for one party — CodeRabbit or humans — exactly as the verb counted them. */
export interface LandingThreads {
  readonly open: number;
  readonly awaitingUs: number;
}

/**
 * The threads the verb counted for one party.
 *
 * @returns both counts, or `undefined` when either is missing — a count that cannot be read is not zero
 */
export function threadsOf({ bag, key }: { bag: Bag; key: string }): LandingThreads | undefined {
  const party = sub({ bag, key });
  if (party === undefined) {
    return undefined;
  }
  const open = num({ bag: party, key: "open" });
  const awaitingUs = num({ bag: party, key: "awaitingUs" });
  if (open === undefined || awaitingUs === undefined) {
    return undefined;
  }
  return { awaitingUs, open };
}

/**
 * The six tests as the verb published them.
 *
 * @returns every test, or `undefined` when one is missing a field — a test the page cannot read is not a pass
 */
export function testsOf({ row }: { row: Bag }): readonly LandingTest[] | undefined {
  const held = bags({ bag: row, key: "tests" });
  if (held === undefined) {
    return undefined;
  }
  const out: LandingTest[] = [];
  for (const test of held) {
    const id = str({ bag: test, key: "id" });
    const verdict = str({ bag: test, key: "verdict" });
    const why = str({ bag: test, key: "why" });
    if (id === undefined || verdict === undefined || why === undefined) {
      return undefined;
    }
    out.push({ id, verdict, why });
  }
  return out;
}

/**
 * The checks GitHub reported as not green.
 *
 * @returns every check, or `undefined` when one is unreadable
 */
export function checksOf({ row }: { row: Bag }): readonly LandingCheck[] | undefined {
  const held = bags({ bag: row, key: "failingChecks" });
  if (held === undefined) {
    return undefined;
  }
  const out: LandingCheck[] = [];
  for (const check of held) {
    const name = str({ bag: check, key: "name" });
    const state = str({ bag: check, key: "state" });
    const required = check["required"];
    // Omitted is the verb's own `undefined`, which JSON drops, and reads unknown; any other non-boolean refuses.
    const badRequired = required !== undefined && typeof required !== "boolean";
    if (name === undefined || state === undefined || badRequired) {
      return undefined;
    }
    out.push({ name, required, state, url: str({ bag: check, key: "url" }) });
  }
  return out;
}

/**
 * What the row's red rollup is red on. A document from before the verb classified it carries no `ciFailure`,
 * and reads unknown on red — never advisory, because nothing established that — and `not-red` otherwise.
 *
 * @param ci the row's own rollup word, which a present classification must agree with
 * @returns the classification, or `null` when it is present and malformed or contradicts the rollup
 */
export function ciFailureOf({ row, ci }: { row: Bag; ci: string }): LandingCiFailure | null {
  if (row.ciFailure === undefined) {
    if (ci === "red") {
      return { kind: "red", required: undefined };
    }
    return { kind: "not-red" };
  }
  const held = sub({ bag: row, key: "ciFailure" });
  if (held === undefined) {
    return null;
  }
  const kind = str({ bag: held, key: "kind" });
  if (kind === "not-red" && ci !== "red") {
    return { kind: "not-red" };
  }
  if (kind !== "red" || ci !== "red") {
    return null;
  }
  const required = held["required"];
  if (required !== undefined && typeof required !== "boolean") {
    return null;
  }
  return { kind: "red", required };
}

/**
 * The slug a `row` board join names, mirroring the verb's `LandingBoardRow` (`src/review/landingBoard.ts`).
 *
 * @returns the slug on a `row` join, `undefined` on any other kind, or `null` for a `row` join whose slug
 *   the verb could not have written — which refuses the whole reading, as every malformed field here does
 */
export function boardRowSlugOf({ boardRow }: { boardRow: Bag }): string | undefined | null {
  if (boardRow["kind"] !== "row") {
    return undefined;
  }
  const slug = str({ bag: boardRow, key: "slug" });
  if (slug === undefined || slug.trim() === "") {
    return null;
  }
  return slug;
}

/**
 * The verb's `openThreads`: one entry per login with threads open, as it tallied them.
 *
 * @returns the entries, or `undefined` when one will not parse
 */
export function waitingOf({ row }: { row: Bag }): readonly LandingWaiting[] | undefined {
  const held = bags({ bag: row, key: "openThreads" });
  if (held === undefined) {
    return undefined;
  }
  const out: LandingWaiting[] = [];
  for (const bag of held) {
    const login = str({ bag, key: "login" });
    const open = num({ bag, key: "open" });
    if (login === undefined || open === undefined) {
      return undefined;
    }
    out.push({ login, open });
  }
  return out;
}
