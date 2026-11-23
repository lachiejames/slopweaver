/**
 * The register's row operations over a store that cannot run a statement: Drizzle's connectionless
 * `drizzle.mock()` database builds every statement for real and then throws when asked to execute it, which is
 * exactly a driver failure. So what is under test is the refusal half — every operation answers
 * `REGISTER_STORE_UNAVAILABLE` naming what it was doing, never a thrown error and never an empty row — and that
 * `close` is the client's own. What only a real database can prove (the compare-and-set predicate, the singleton
 * CHECK, the `jsonb` round trip) is `src/__tests__/integration/planRegisterStore.test.ts`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../lib/result.js";
import { planRegisterRowsOver } from "../../../plans/storeRows.js";
import type { StoreClient } from "../../../store/client.js";
import * as storeSchema from "../../../store/schema.js";

const DOCUMENT = {
  rows: [{ alias: "codex-one", provider: "codex", storeDir: "/stores/codex-one" }],
  version: 1,
} as const;

/**
 * A client whose database builds statements but cannot run one, and which counts its own closes.
 *
 * @returns the client, and how many times it has been closed so far
 */
function unrunnableClient(): { client: StoreClient; closes: () => number } {
  let closed = 0;
  const client: StoreClient = {
    close: async () => {
      closed += 1;
    },
    db: drizzle.mock({ schema: storeSchema }),
  };
  return { client, closes: () => closed };
}

describe("the plan register's row operations over a store that cannot run a statement", () => {
  it("refuses a read as REGISTER_STORE_UNAVAILABLE, naming the read", async () => {
    const rows = planRegisterRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await rows.read());

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not read the plan register");
  });

  it("refuses the adopting insert the same way, naming the import", async () => {
    const rows = planRegisterRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await rows.insert({ document: DOCUMENT }));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not import the plan register");
  });

  it("refuses a compare-and-set update the same way, naming the write", async () => {
    const rows = planRegisterRowsOver({ client: unrunnableClient().client });

    const error = unwrapErr(await rows.update({ document: DOCUMENT, expectedRevision: 3 }));

    expect(error.code).toBe("REGISTER_STORE_UNAVAILABLE");
    expect(error.message).toContain("the store could not write the plan register");
  });

  it("closes through the client it was given", async () => {
    const { client, closes } = unrunnableClient();
    const rows = planRegisterRowsOver({ client });

    await rows.close();

    expect(closes()).toBe(1);
  });
});
