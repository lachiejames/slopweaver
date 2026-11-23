/**
 * The request-body fidelity RATCHET: walk every committed cassette (the safe fixture plus any recorded
 * integration cassette) and hold the debt register
 * (`cassetteBodyDebt.ts`) to what the `.har` files actually say.
 *
 * Runs in the fast unit lane, over committed files, so CI re-checks it on every push with no credential and
 * no network. Equality rather than an upper bound in BOTH directions, which is what makes it a debt list
 * rather than a comment: a suite re-recorded under the current persist path gains bodies and FAILS until its
 * row is lowered or deleted, and a new recording that somehow writes no body fails just as loudly.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CASSETTE_BODY_ABSENT,
  CASSETTE_BODY_DEBT,
  CASSETTE_BODY_PROVEN,
  CASSETTE_BODY_UNTEXTED,
} from "../cassetteBodyDebt.js";
import { parseOwnJson } from "../parseOwnJson.js";

const RECORDINGS_DIR = join(process.cwd(), "src/__tests__/integration/__recordings__");
const SAFE_FIXTURE = join(process.cwd(), "src/__tests__/fixtures/cassettes/safe/recording.har");

/** One committed entry's request-body state, as the four counts this file asserts distinguish them. */
type BodyState = "proven" | "unproven" | "untexted" | "absent";

/**
 * Every committed `.har`, each with the directory that owns it: the synthetic safe fixture (owner `safe`),
 * which is always there, plus every recorded integration cassette. The recordings directory is absent while
 * no recorded cassette is committed — git keeps no empty directory — so that walk is read only when it exists.
 */
function recordings(): readonly { readonly file: string; readonly cassette: string }[] {
  const integration = existsSync(RECORDINGS_DIR)
    ? readdirSync(RECORDINGS_DIR, { recursive: true })
        .map((entry) => String(entry))
        .filter((entry) => entry.endsWith(".har"))
        .map((entry) => ({ cassette: entry.split("/")[0]!, file: join(RECORDINGS_DIR, entry) }))
    : [];
  return [{ cassette: "safe", file: SAFE_FIXTURE }, ...integration];
}

/** Every entry's body state in one `.har`. */
function bodyStates({ file }: { file: string }): readonly BodyState[] {
  const har = parseOwnJson<{ log?: { entries?: { request?: { postData?: { text?: string } } }[] } }>({
    text: readFileSync(file, "utf8"),
  });
  const entries = har.log?.entries;
  if (entries === undefined) {
    return []; // a HAR with no entry list at all — nothing to classify
  }
  return entries.map((entry) => {
    const postData = entry.request?.postData;
    if (postData === undefined) {
      return "absent";
    }
    if (postData.text === undefined) {
      return "untexted";
    }
    return postData.text.length === 0 ? "unproven" : "proven";
  });
}

/** The debt the committed cassettes actually carry: recording directory → unproven entry count. */
function measuredDebt(): ReadonlyMap<string, number> {
  const debt = new Map<string, number>();
  for (const { cassette, file } of recordings()) {
    const unproven = bodyStates({ file }).filter((state) => state === "unproven").length;
    if (unproven > 0) {
      const running = debt.get(cassette);
      debt.set(cassette, running === undefined ? unproven : running + unproven);
    }
  }
  return debt;
}

/** How many committed entries are in one state across every recording. */
function totalIn({ state }: { state: BodyState }): number {
  return recordings()
    .flatMap(({ file }) => bodyStates({ file }))
    .filter((each) => each === state).length;
}

/** A debt map's rows ordered by recording directory, so two maps compare independent of insertion order. */
function sortedRows({ debt }: { debt: ReadonlyMap<string, number> }): readonly (readonly [string, number])[] {
  return [...debt].toSorted(([left], [right]) => left.localeCompare(right));
}

describe("committed cassette request-body fidelity", () => {
  it("finds cassettes to measure at all — the guard against a silently empty walk", () => {
    expect(recordings().length).toBeGreaterThan(0);
  });

  it("holds the debt register to what the committed cassettes say, entry for entry", () => {
    expect(sortedRows({ debt: measuredDebt() })).toEqual(sortedRows({ debt: CASSETTE_BODY_DEBT }));
  });

  it("counts the entries a replay holds to their recorded body", () => {
    expect(totalIn({ state: "proven" })).toBe(CASSETTE_BODY_PROVEN);
  });

  it("counts the entries that sent a body the persister writes no text for — an upload's bytes", () => {
    expect(totalIn({ state: "untexted" })).toBe(CASSETTE_BODY_UNTEXTED);
  });

  it("counts the entries that sent no request body at all", () => {
    expect(totalIn({ state: "absent" })).toBe(CASSETTE_BODY_ABSENT);
  });

  it("counts the unproven entries as the register's own total, so the two can never drift", () => {
    const registered = [...CASSETTE_BODY_DEBT.values()].reduce((sum, count) => sum + count, 0);
    expect(totalIn({ state: "unproven" })).toBe(registered);
  });
});
