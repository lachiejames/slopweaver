/**
 * The register's statements over a store that cannot run one: Drizzle's connectionless `drizzle.mock()` database
 * builds every statement for real and throws when asked to execute it, which is exactly a driver failure. So what is
 * under test is the refusal half — every operation answers `WORKSTREAM_STORE_UNAVAILABLE` naming what it was doing,
 * never a throw and never an empty answer. The predicates, locks and races are
 * `src/__tests__/integration/workstreamStore.test.ts`, against a real database.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import type { StoreClient } from "../../../../store/client.js";
import * as storeSchema from "../../../../store/schema.js";
import { aggregateRowsOf } from "../../../../workstreams/store/aggregateWrite.js";
import { workstreamRowsOver } from "../../../../workstreams/store/rows.js";
import { ACME_META, acmeOutcome } from "../../../workstreamStoreFixtures.js";

/**
 * A client whose database builds statements but cannot run one.
 *
 * @returns the client
 */
function unrunnableClient(): StoreClient {
  return { close: async () => {}, db: drizzle.mock({ schema: storeSchema }) };
}

describe("the workstream register's statements over a store that cannot run one", () => {
  it("refuses the whole-register read, naming it", async () => {
    const error = unwrapErr(await workstreamRowsOver({ client: unrunnableClient() }).readAll());

    expect(error.code).toBe("WORKSTREAM_STORE_UNAVAILABLE");
    expect(error.message).toBe("the store could not read the workstream register: this.client.begin is not a function");
  });

  it("refuses an aggregate write, naming the workstream", async () => {
    const rows = workstreamRowsOver({ client: unrunnableClient() });
    const error = unwrapErr(await rows.writeAggregate({ aggregate: acmeOutcome(), expectedRevision: null }));

    expect(error.code).toBe("WORKSTREAM_STORE_UNAVAILABLE");
    expect(error.message).toBe(
      "the store could not write workstream acme-onboarding: this.client.begin is not a function",
    );
  });

  it("refuses a delete and a register-document write the same way", async () => {
    const rows = workstreamRowsOver({ client: unrunnableClient() });
    const deleted = unwrapErr(await rows.deleteWorkstream({ expectedRevision: 1, workstreamId: "acme-onboarding" }));
    const meta = unwrapErr(await rows.writeMeta({ document: ACME_META, expectedRevision: null }));

    expect([deleted.code, meta.code]).toEqual(["WORKSTREAM_STORE_UNAVAILABLE", "WORKSTREAM_STORE_UNAVAILABLE"]);
    expect([deleted.message, meta.message]).toEqual([
      "the store could not delete workstream acme-onboarding: this.client.begin is not a function",
      'the store could not write the workstream register document: Failed query: insert into "workstream_register_meta" ("id", "document", "revision", "updated_at") values ($1, $2, $3, default) on conflict ("id") do nothing returning "id", "document", "revision", "updated_at"\nparams: workstreams,{"channels":{"C0FIXTURE1":"acme platform"},"grouping":{"anchor":"talk:fixture","builtFrom":"the fixture","label":"by initiative","why":"a test needs one"},"initiatives":[{"id":"acme-growth","name":"Acme growth"}]},1',
    ]);
  });

  it("lets a bare read-back throw to its caller, whose transaction or `attempt` turns it into the refusal", async () => {
    // `toMatchObject` compares the message for equality; `toThrow(string)` would accept any message containing it.
    await expect(
      aggregateRowsOf({ reader: unrunnableClient().db, workstreamId: "acme-onboarding" }),
    ).rejects.toMatchObject({
      message:
        'Failed query: select "id", "name", "kind", "workspace", "outcome", "status", "detail", "revision", "created_at", "updated_at" from "workstream" where "workstream"."id" = $1\nparams: acme-onboarding',
    });
  });
});
