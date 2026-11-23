/**
 * The whole-table rewriters, exercised through an injected fake connection — the seam
 * `recallWriter.test.ts` describes, not a mock. What is under test is what each writer ASKS the database to
 * set and how it counts and reports the result; the SQL itself only a real Postgres settles.
 */
import { describe, expect, it } from "vitest";

import { planDomainMigration } from "../../../knowledge/domainMigration.js";
import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { applyDomainMigration, rekeyImports } from "../../../knowledge/memoryRewriteStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { StoreClient } from "../../../store/client.js";

/**
 * A fake connection whose every update chain records its `set` values and, when awaited, answers
 * `returned` — the rows a `returning()` would hand back. `failWith` makes the transaction itself throw.
 */
function fakeClient({
  sets,
  returned,
  failWith,
}: {
  sets: Record<string, unknown>[];
  returned: readonly unknown[];
  failWith?: Error;
}): StoreClient {
  const chain = (): Record<string, unknown> => {
    const methods: Record<string, unknown> = {};
    ["set", "where", "returning"].forEach((name) => {
      // named-object-params-exempt: a Drizzle builder method is positional, so the seam must accept that call
      methods[name] = (value: unknown): unknown => {
        if (name === "set") {
          sets.push(value as Record<string, unknown>);
        }
        return chain();
      };
    });
    return Object.assign(Promise.resolve(returned), methods);
  };
  const writer = { update: (): unknown => chain() };
  const db = {
    // named-object-params-exempt: Drizzle's `transaction(callback)` is positional, and the fake must match
    transaction: (run: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      failWith === undefined ? run(writer) : Promise.reject(failWith),
  };
  // The fake answers exactly the calls these writers make, for the reason `recallWriter.test.ts` gives.
  return { close: async (): Promise<void> => {}, db } as unknown as StoreClient;
}

/** One claim under a retired spelling, and a canonical claim that retires it. */
const plan = planDomainMigration({
  installDomains: noInstallDomains({ home: "/tmp/sw-home" }),
  rows: [
    {
      claim: "a required check that never ran blocks the merge queue",
      domain: "github-ci",
      id: "l-old",
      kind: "lesson",
      recordingId: "r1",
      supersedes: null,
    },
    {
      claim: "the merge queue waits on every required context",
      domain: "ci",
      id: "l-other",
      kind: "lesson",
      recordingId: "r2",
      supersedes: "l-old",
    },
  ],
});

describe("applyDomainMigration", () => {
  it("rewrites each recording's domain, id and supersedes, then counts the recalls it moved", async () => {
    const sets: Record<string, unknown>[] = [];
    const moved = plan.idMap[0]!.to;
    const result = await applyDomainMigration({
      client: fakeClient({ returned: [{ recallId: "x" }, { recallId: "y" }], sets }),
      plan,
    });
    expect(unwrap(result)).toEqual({ recalls: 2, recordings: 2 });
    expect(sets).toEqual([
      { domain: "ci", id: moved, supersedes: null },
      { domain: "ci", id: "l-other", supersedes: moved },
      { memoryId: moved },
    ]);
  });

  it("reports a failed transaction as DATABASE_FAILED naming the fold, never a partial count", async () => {
    const result = await applyDomainMigration({
      client: fakeClient({ failWith: new Error("connection reset"), returned: [], sets: [] }),
      plan,
    });
    expect(unwrapErr(result).code).toBe("DATABASE_FAILED");
    expect(unwrapErr(result).message).toContain("fold 2 recording(s) onto canonical domains");
  });
});

describe("rekeyImports", () => {
  it("writes nothing and reports zero when there is nothing to rekey", async () => {
    const sets: Record<string, unknown>[] = [];
    const result = await rekeyImports({
      client: fakeClient({ failWith: new Error("must not open a transaction"), returned: [], sets }),
      rekeys: [],
    });
    expect(unwrap(result)).toBe(0);
    expect(sets).toEqual([]);
  });

  it("sets each recording's new import key and reports how many it rewrote", async () => {
    const sets: Record<string, unknown>[] = [];
    const result = await rekeyImports({
      client: fakeClient({ returned: [], sets }),
      rekeys: [
        { recordingId: "r1", to: "k1" },
        { recordingId: "r2", to: "k2" },
      ],
    });
    expect(unwrap(result)).toBe(2);
    expect(sets).toEqual([{ importKey: "k1" }, { importKey: "k2" }]);
  });
});
