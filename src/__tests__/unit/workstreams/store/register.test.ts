import { describe, expect, it } from "vitest";

import { err, ok, unwrap } from "#lib/result.js";
import { WorkstreamStoreErrors } from "../../../../workstreams/store/errors.js";
import { fencedWorkstreamStore, isEmptyRegister } from "../../../../workstreams/store/register.js";
import { inMemoryWorkstreamStore } from "../../../workstreamStoreFake.js";
import { ACME_META, acmeLocal } from "../../../workstreamStoreFixtures.js";

const NOW = "2026-11-09T09:00:00.000Z";
const HOME = "/acme/home";

describe("fencedWorkstreamStore", () => {
  it("passes every operation through to the store once the fence stands", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const fenced = fencedWorkstreamStore({ fence: () => ok(undefined), store });
    unwrap(await fenced.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null, home: HOME }));
    unwrap(await fenced.put({ aggregate: acmeLocal({ id: "acme-spare" }), expectedRevision: null, home: HOME }));
    unwrap(await fenced.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    unwrap(await fenced.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-spare" }));
    const read = unwrap(await fenced.read({ home: HOME }));
    expect([read.workstreams.map((one) => one.id), read.meta!.document]).toEqual([["acme-scratch"], ACME_META]);
  });

  it("answers every operation with the fence's refusal and leaves the store untouched", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    const refusal = WorkstreamStoreErrors.tombstoneNotDurable({ path: "/acme/home/workstreams", reason: "EROFS" });
    const fenced = fencedWorkstreamStore({ fence: () => err(refusal), store });
    const answers = [
      await fenced.put({ aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null, home: HOME }),
      await fenced.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }),
      await fenced.remove({ expectedRevision: 1, home: HOME, workstreamId: "acme-scratch" }),
      await fenced.applyBatch({ deletes: [], home: HOME, writes: [] }),
      await fenced.read({ home: HOME }),
    ];
    expect(answers.map((one) => one.isErr() && one.error.code)).toEqual(
      Array.from({ length: 5 }, () => "WORKSTREAM_TOMBSTONE_NOT_DURABLE"),
    );
    expect(isEmptyRegister({ snapshot: unwrap(await store.read({ home: HOME })) })).toBe(true);
  });
});

describe("isEmptyRegister", () => {
  it("is true only for no workstream and no register document", async () => {
    const store = inMemoryWorkstreamStore({ nowIso: NOW });
    expect(isEmptyRegister({ snapshot: unwrap(await store.read({ home: HOME })) })).toBe(true);
    unwrap(await store.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    expect(isEmptyRegister({ snapshot: unwrap(await store.read({ home: HOME })) })).toBe(false);
  });
});
