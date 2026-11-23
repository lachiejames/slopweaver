/**
 * A whole-register document turned into one batch, judged by the baseline it carries — over the in-memory store, so
 * each case runs the same judges the port does. The real-store halves (races between the read and the commit) are
 * `integration/workstreamStoreBatch.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { EMPTY_REGISTER_BASELINE } from "../../../../workstreams/store/baseline.js";
import { WorkstreamStoreErrors } from "../../../../workstreams/store/errors.js";
import type { WorkstreamStore } from "../../../../workstreams/store/port.js";
import { projectRegister } from "../../../../workstreams/store/projection.js";
import { fencedWorkstreamStore, isEmptyRegister } from "../../../../workstreams/store/register.js";
import { parseWholeRegisterDocument, wholeRegisterBatch } from "../../../../workstreams/store/wholePut.js";
import { inMemoryWorkstreamStore } from "../../../workstreamStoreFake.js";
import { ACME_META, acmeLocal, acmeOutcome } from "../../../workstreamStoreFixtures.js";

const NOW = "2026-11-09T12:00:00.000Z";
const HOME = "/acme/home";

/**
 * A store holding the outcome, a local workstream and the register document.
 *
 * @returns the store
 */
async function seeded(): Promise<WorkstreamStore> {
  const store = inMemoryWorkstreamStore({ nowIso: NOW });
  unwrap(
    await store.applyBatch({
      deletes: [],
      home: HOME,
      meta: { document: ACME_META, expectedRevision: null },
      writes: [
        { aggregate: acmeOutcome(), expectedRevision: null },
        { aggregate: acmeLocal({ id: "acme-scratch" }), expectedRevision: null },
      ],
    }),
  );
  return store;
}

/**
 * The list document of what a store holds, round-tripped through JSON as `workstreams list --json` prints it.
 *
 * @returns the parsed document
 */
async function listed({ store }: { store: WorkstreamStore }): Promise<Record<string, unknown>> {
  const snapshot = unwrap(await store.read({ home: HOME }));
  return JSON.parse(JSON.stringify(projectRegister({ snapshot }))) as Record<string, unknown>;
}

/**
 * Parse, plan and apply one document against a store, the way `workstreams put` does.
 *
 * @returns what the batch wrote, or the refusal
 */
async function put({ document, store }: { document: unknown; store: WorkstreamStore }) {
  const parsed = parseWholeRegisterDocument({ value: document });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const snapshot = unwrap(await store.read({ home: HOME }));
  const batch = wholeRegisterBatch({ document: parsed.value, snapshot });
  if (batch.isErr()) {
    return err(batch.error);
  }
  return store.applyBatch({ ...batch.value, home: HOME });
}

describe("parseWholeRegisterDocument", () => {
  it("accepts the list's own output back unedited, derived fields and all", async () => {
    const document = await listed({ store: await seeded() });
    const parsed = unwrap(parseWholeRegisterDocument({ value: document }));
    expect(parsed.workstreams.map((one) => one.id).toSorted()).toEqual(["acme-onboarding", "acme-scratch"]);
    expect(parsed.baseline).toBe(document["baseline"]);
  });

  it("judges a document carrying no baseline against the empty register's", () => {
    const parsed = unwrap(parseWholeRegisterDocument({ value: { meta: null, schemaVersion: 2, workstreams: [] } }));
    expect(parsed.baseline).toBe(EMPTY_REGISTER_BASELINE);
  });

  it("refuses a field that is not a workstream's, naming it", () => {
    const refused = unwrapErr(
      parseWholeRegisterDocument({
        value: { meta: null, schemaVersion: 2, workstreams: [{ ...acmeOutcome(), reaches: 50 }] },
      }),
    );
    expect(refused.code).toBe("WORKSTREAM_INVALID");
    expect(refused.message).toContain("workstreams.0.reaches: not a field of a workstream");
  });

  it("refuses a version 1 register", () => {
    const refused = unwrapErr(parseWholeRegisterDocument({ value: { meta: null, schemaVersion: 1, workstreams: [] } }));
    expect(refused.code).toBe("WORKSTREAM_INVALID");
    expect(refused.message).toContain("schemaVersion");
  });

  it("refuses a Slack link into a conversation the register document does not name, and takes one it does", () => {
    const slack = ({ channel }: { channel: string }) => {
      const outcome = acmeOutcome();
      const [first, ...rest] = outcome.entries;
      return acmeOutcome({
        entries: [{ ...first!, href: `https://acme.slack.com/archives/${channel}/p1730000000000100` }, ...rest],
      });
    };
    const refused = unwrapErr(
      parseWholeRegisterDocument({
        value: { meta: ACME_META, schemaVersion: 2, workstreams: [slack({ channel: "C0FIXTURE2" })] },
      }),
    );
    expect(refused.code).toBe("WORKSTREAM_INVALID");
    expect(refused.message).toContain("a link points into Slack channel C0FIXTURE2, which channels does not name");
    const named = parseWholeRegisterDocument({
      value: { meta: ACME_META, schemaVersion: 2, workstreams: [slack({ channel: "C0FIXTURE1" })] },
    });
    expect(unwrap(named).workstreams.map((one) => one.id)).toEqual(["acme-onboarding"]);
  });

  it("refuses a Slack link in feedback when there is no register document to name its conversation", () => {
    const feedback = {
      date: "2026-11-02",
      href: "https://acme.slack.com/archives/C0FIXTURE1/p1730000000000200",
      response: null,
      sign: "negative",
      text: "too slow",
      who: "an acme lead",
    };
    const outcome = acmeOutcome();
    const withFeedback = acmeOutcome({ detail: { ...outcome.detail, feedback: [feedback] } });
    const refused = unwrapErr(
      parseWholeRegisterDocument({ value: { meta: null, schemaVersion: 2, workstreams: [withFeedback] } }),
    );
    expect(refused.message).toContain("a link points into Slack channel C0FIXTURE1, which channels does not name");
  });
});

describe("wholeRegisterBatch", () => {
  it("rewrites only the workstream whose content changed, and deletes one the document omits", async () => {
    const store = await seeded();
    const document = await listed({ store });
    const workstreams = document["workstreams"] as Record<string, unknown>[];
    const edited = workstreams
      .filter((one) => one["id"] === "acme-onboarding")
      .map((one) => ({ ...one, name: "Acme onboarding, renamed" }));
    const applied = unwrap(await put({ document: { ...document, workstreams: edited }, store }));
    expect(applied.written.map((one) => [one.id, one.name, one.revision])).toEqual([
      ["acme-onboarding", "Acme onboarding, renamed", 2],
    ]);
    const after = unwrap(await store.read({ home: HOME }));
    expect(after.workstreams.map((one) => one.id)).toEqual(["acme-onboarding"]);
    expect(after.meta!.document).toEqual(ACME_META);
  });

  it("keeps every stored child id through the round trip", async () => {
    const store = await seeded();
    const document = await listed({ store });
    unwrap(await put({ document, store }));
    const after = unwrap(await store.read({ home: HOME }));
    const onboarding = after.workstreams.find((one) => one.id === "acme-onboarding")!;
    expect(onboarding.entries.map((entry) => entry.id)).toEqual(acmeOutcome().entries.map((entry) => entry.id));
    expect(onboarding.revision).toBe(1);
  });

  it("refuses a document read before another writer changed the register, writing nothing", async () => {
    const store = await seeded();
    const stale = await listed({ store });
    unwrap(
      await store.put({
        aggregate: acmeOutcome({ name: "changed by another writer" }),
        expectedRevision: 1,
        home: HOME,
      }),
    );
    const before = unwrap(await store.read({ home: HOME }));
    const refused = unwrapErr(await put({ document: stale, store }));
    expect(refused.code).toBe("WORKSTREAM_BASELINE_STALE");
    expect(unwrap(await store.read({ home: HOME }))).toEqual(before);
  });

  it("refuses a meta-only change since the read", async () => {
    const store = await seeded();
    const stale = await listed({ store });
    const moved = { ...ACME_META, initiatives: [] };
    unwrap(await store.putMeta({ document: moved, expectedRevision: 1, home: HOME }));
    expect(unwrapErr(await put({ document: stale, store })).code).toBe("WORKSTREAM_BASELINE_STALE");
  });

  it("lets a document with no baseline seed an empty register, and only an empty one", async () => {
    const empty = inMemoryWorkstreamStore({ nowIso: NOW });
    const seed = { meta: ACME_META, schemaVersion: 2, workstreams: [acmeOutcome()] };
    unwrap(await put({ document: seed, store: empty }));
    expect(unwrap(await empty.read({ home: HOME })).workstreams.map((one) => one.id)).toEqual(["acme-onboarding"]);
    expect(unwrapErr(await put({ document: seed, store: await seeded() })).code).toBe("WORKSTREAM_BASELINE_STALE");
  });

  it("deletes the register document when the document carries none", async () => {
    const store = await seeded();
    const document = await listed({ store });
    unwrap(await put({ document: { ...document, meta: null }, store }));
    expect(unwrap(await store.read({ home: HOME })).meta).toBe(null);
  });
});

describe("fencedWorkstreamStore", () => {
  it("opens nothing when the fence refuses, and answers with the fence's refusal", async () => {
    const refusal = WorkstreamStoreErrors.retiredRegisterPresent({
      found: "a regular file",
      path: "/acme/home/workstreams/register.json",
    });
    const fenced = fencedWorkstreamStore({ fence: () => err(refusal), store: await seeded() });
    expect(unwrapErr(await fenced.read({ home: HOME }))).toEqual(refusal);
    expect(unwrapErr(await fenced.applyBatch({ deletes: [], home: HOME, writes: [] }))).toEqual(refusal);
  });

  it("runs the operation once the fence stands, passing the home it was asked for", async () => {
    const asked: string[] = [];
    const fenced = fencedWorkstreamStore({
      fence: ({ home }) => {
        asked.push(home);
        return ok(undefined);
      },
      store: await seeded(),
    });
    expect(unwrap(await fenced.read({ home: HOME })).workstreams.length).toBe(2);
    expect(asked).toEqual([HOME]);
  });
});

describe("isEmptyRegister", () => {
  it("is true only with no workstream and no register document", async () => {
    expect(isEmptyRegister({ snapshot: { meta: null, workstreams: [] } })).toBe(true);
    const metaOnly = inMemoryWorkstreamStore({ nowIso: NOW });
    unwrap(await metaOnly.putMeta({ document: ACME_META, expectedRevision: null, home: HOME }));
    expect(isEmptyRegister({ snapshot: unwrap(await metaOnly.read({ home: HOME })) })).toBe(false);
  });
});
