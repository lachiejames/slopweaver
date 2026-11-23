/**
 * The proof-store guard: every spelling that selects the live `postgres` database is refused, including the two
 * a match on `/postgres` alone let through, and a throwaway one passes.
 */
import { describe, expect, it } from "vitest";

import { refuseLiveStore } from "../proofStoreUrl.js";

const BASE = "postgresql://postgres:postgres@127.0.0.1:55322";
const VARIABLE = "DOOR_LEDGER_STORE_PROOF_URL";

/** The message the guard throws for `url`, or the empty string when it lets it through. */
function refusal({ url }: { url: string }): string {
  try {
    refuseLiveStore({ url, variable: VARIABLE });
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

describe("refuseLiveStore", () => {
  it("lets a throwaway database named by path through", () => {
    expect(refusal({ url: `${BASE}/door_ledger_proof` })).toBe("");
  });

  it("refuses the live database by name", () => {
    expect(refusal({ url: `${BASE}/postgres` })).toBe(
      `${VARIABLE} names the \`postgres\` database (or none), the live fleet's — use a throwaway one`,
    );
  });

  it("refuses the live database percent-encoded", () => {
    expect(refusal({ url: `${BASE}/postgre%73` })).toContain("names the `postgres` database");
  });

  it("refuses a URL naming no database, which a client defaults to the user's", () => {
    expect(refusal({ url: BASE })).toContain("names the `postgres` database (or none)");
  });

  it("refuses a query parameter that could override the path's database", () => {
    expect(refusal({ url: `${BASE}/door_ledger_proof?database=postgres` })).toBe(
      `${VARIABLE} carries a query or fragment, which could select another database — name it by path only`,
    );
  });

  it("refuses a fragment", () => {
    expect(refusal({ url: `${BASE}/door_ledger_proof#postgres` })).toContain("carries a query or fragment");
  });
});
