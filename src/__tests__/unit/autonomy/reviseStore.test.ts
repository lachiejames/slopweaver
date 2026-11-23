/**
 * `qualifyStoredAct` — the one in-place revision the store-backed autonomy ledger allows — over the in-memory
 * store, with a port over the SAME store seeding the act and reading the revision back.
 */
import { describe, expect, it } from "vitest";

import { qualifiedWitness, qualifyStoredAct } from "../../../autonomy/reviseStore.js";
import { buildAutonomyAction, buildAutonomySteer } from "../../../autonomy/row.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import { bareReferenceErrors } from "../../../briefing/autonomyActRefs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  heldAutonomyRecords,
  type MemoryAutonomyStore,
  memoryAutonomyLedgerPort,
  memoryAutonomySeams,
  memoryAutonomyStore,
  seedAutonomyRecords,
} from "../../autonomyLedgerFixture.js";

const HOME = "/fixture-home";
const REPO = { owner: "acme", repo: "widgets" };
const NOW = "2026-11-02T11:00:00.000Z";
const BARE_WHY = "acme/widgets#2914 merged; the same read on #2913 lagged its merge.";

/** One act whose why carries a bare reference, as the finding door wrote one before the fix. */
function bareAct({ why = BARE_WHY }: { why?: string } = {}): AutonomyActionRow {
  return unwrap(
    buildAutonomyAction({
      actionId: "finding-pr.watchpr-dies",
      bySession: "session-40",
      doneIso: "2026-11-02T10:23:48.664Z",
      kind: "open-internal-finding-pull-request",
      run: "watchpr-dies",
      said: "I opened a pull request for a problem the fleet found itself.",
      steer: undefined,
      subject: "watchpr-dies",
      why,
      witness: "open a pull request on main: finding gate",
    }),
  );
}

/** A store holding one act, and the port that reads it back. */
async function seeded({ act = bareAct() }: { act?: AutonomyActionRow } = {}): Promise<{
  store: MemoryAutonomyStore;
  port: ReturnType<typeof memoryAutonomyLedgerPort>;
}> {
  const store = memoryAutonomyStore();
  const port = memoryAutonomyLedgerPort({ store });
  await seedAutonomyRecords({ port, records: [act] });
  return { port, store };
}

describe("qualifyStoredAct", () => {
  it("reports the revision on a dry run and writes nothing", async () => {
    const { port, store } = await seeded();

    const report = unwrap(
      await qualifyStoredAct({
        actionId: "finding-pr.watchpr-dies",
        apply: false,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: memoryAutonomySeams({ store }),
      }),
    );

    expect(report.applied).toBe(false);
    expect(report.changed).toEqual([
      {
        after: "acme/widgets#2914 merged; the same read on acme/widgets#2913 lagged its merge.",
        before: BARE_WHY,
        field: "why",
      },
    ]);
    expect(await heldAutonomyRecords({ port })).toEqual([bareAct()]);
  });

  it("with apply, rewrites only the bare reference and quotes the original why in the witness", async () => {
    const { port, store } = await seeded();

    unwrap(
      await qualifyStoredAct({
        actionId: "finding-pr.watchpr-dies",
        apply: true,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: memoryAutonomySeams({ store }),
      }),
    );

    const [held] = await heldAutonomyRecords({ port });
    const expected: AutonomyActionRow = {
      ...bareAct(),
      why: "acme/widgets#2914 merged; the same read on acme/widgets#2913 lagged its merge.",
      witness:
        "open a pull request on main: finding gate Bare references qualified against acme/widgets by " +
        `\`slopweaver autonomy qualify\` at ${NOW}. Original why: ${JSON.stringify(BARE_WHY)}.`,
    };
    expect(held).toEqual(expected);
    expect(store.rows[0]!.why).toBe(expected.why);
    expect(store.rows[0]!.witness).toBe(expected.witness);
    expect(
      bareReferenceErrors({
        entry: { action: expected, classSteer: undefined, latestSteer: undefined, patternSteer: undefined },
      }),
    ).toEqual([]);
  });

  it("rewrites the STORED bytes, keeping whitespace the decoder would trim", async () => {
    const { store } = await seeded();
    store.rows[0] = {
      ...store.rows[0]!,
      record: { ...store.rows[0]!.record, why: `  ${BARE_WHY}  `, witness: "  proof  " },
    };

    unwrap(
      await qualifyStoredAct({
        actionId: "finding-pr.watchpr-dies",
        apply: true,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: memoryAutonomySeams({ store }),
      }),
    );

    expect(store.rows[0].record).toEqual({
      ...bareAct(),
      why: "  acme/widgets#2914 merged; the same read on acme/widgets#2913 lagged its merge.  ",
      witness:
        "  proof   Bare references qualified against acme/widgets by `slopweaver autonomy qualify` at " +
        `${NOW}. Original why: ${JSON.stringify(`  ${BARE_WHY}  `)}.`,
    });
  });

  it("refuses NOTHING_TO_QUALIFY on an act whose prose is already whole", async () => {
    const { store } = await seeded({ act: bareAct({ why: "acme/widgets#2914 merged." }) });

    const refused = unwrapErr(
      await qualifyStoredAct({
        actionId: "finding-pr.watchpr-dies",
        apply: true,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: memoryAutonomySeams({ store }),
      }),
    );

    expect(refused.code).toBe("NOTHING_TO_QUALIFY");
  });

  it("refuses UNKNOWN_ACTION for an id no act carries", async () => {
    const { store } = await seeded();

    const refused = unwrapErr(
      await qualifyStoredAct({
        actionId: "no-such-act",
        apply: true,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: memoryAutonomySeams({ store }),
      }),
    );

    expect(refused.code).toBe("UNKNOWN_ACTION");
  });

  it("never touches the owner's steer: a steer under the act's id is not an act to repair", async () => {
    const { port, store } = await seeded();
    const steer = unwrap(
      buildAutonomySteer({
        actionId: "finding-pr.watchpr-dies",
        bySession: "supervisor",
        steer: "fine, see #12",
        steeredIso: "2026-11-02T10:30:00Z",
      }),
    );
    store.rows.push({ ...store.rows[0]!, entryKind: "steer", importKey: "steer-key", record: { ...steer } });

    unwrap(
      await qualifyStoredAct({
        actionId: "finding-pr.watchpr-dies",
        apply: true,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: memoryAutonomySeams({ store }),
      }),
    );

    expect(store.rows[1]!.record).toEqual(steer);
    expect((await heldAutonomyRecords({ port })).length).toBe(2);
  });

  it("refuses AUTONOMY_REVISION_LOST when the act changed after it was read, overwriting nothing", async () => {
    const { store } = await seeded();
    const seams = memoryAutonomySeams({ store });
    const racing = {
      ...seams,
      connect: async (request: { readonly home: string }) =>
        (await seams.connect(request)).map((rows) => ({
          ...rows,
          readAction: async (read: { readonly actionId: string }) => {
            const held = await rows.readAction(read);
            store.rows[0] = { ...store.rows[0]!, record: { ...store.rows[0]!.record, why: "changed meanwhile" } };
            return held;
          },
        })),
    };

    const refused = unwrapErr(
      await qualifyStoredAct({
        actionId: "finding-pr.watchpr-dies",
        apply: true,
        home: HOME,
        nowIso: NOW,
        repo: REPO,
        seams: racing,
      }),
    );

    expect(refused.code).toBe("AUTONOMY_REVISION_LOST");
    expect(store.rows[0]!.record).toEqual({ ...bareAct(), why: "changed meanwhile" });
  });
});

describe("qualifiedWitness", () => {
  it("appends one terminated, JSON-quoted clause per changed field after the provenance sentence", () => {
    expect(
      qualifiedWitness({
        changed: [
          { field: "why", original: 'saw "#1"' },
          { field: "said", original: "see #1" },
        ],
        nowIso: NOW,
        repo: REPO,
        witness: "w",
      }),
    ).toBe(
      "w Bare references qualified against acme/widgets by `slopweaver autonomy qualify` at " +
        `${NOW}. Original why: "saw \\"#1\\"". Original said: "see #1".`,
    );
  });
});
