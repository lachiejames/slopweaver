/**
 * The one-time autonomy import, over a temp register and an in-memory {@link AutonomyImportStore} with the
 * table's unique indexes. What only Postgres decides is `integration/autonomyLedgerStore.test.ts`'s.
 */
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAutonomyAction, buildAutonomySteer } from "../../../../autonomy/row.js";
import type { AutonomyRecord } from "../../../../autonomy/types.js";
import { type AutonomyImportStore, runAutonomyLeg } from "../../../../cli/commands/store/importAutonomyLeg.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { StoreErrors } from "../../../../store/errors.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";
import type { NewAutonomyEventRecord } from "../../../../store/schema/ledgers.js";

const NOW = "2026-11-01T00:00:00.000Z";

/** Every directory this file has minted, so `afterEach` can remove them. */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway home and the register inside it, holding these lines. */
function register({ lines }: { lines: readonly string[] }): { home: string; path: string } {
  const home = mkdtempSync(join(tmpdir(), "autonomy-leg-"));
  dirs.push(home);
  const path = join(home, "autonomy.jsonl");
  writeFileSync(path, `${lines.join("\n")}\n`);
  return { home, path };
}

/** One valid act's line. */
function act({ actionId = "16324-rebase", why = "red ci" }: { actionId?: string; why?: string } = {}): AutonomyRecord {
  return unwrap(
    buildAutonomyAction({
      actionId,
      bySession: "workspace:1",
      doneIso: "2026-09-12T03:30:01.123456Z",
      kind: "github.pr.rebase",
      run: undefined,
      said: undefined,
      steer: undefined,
      subject: "https://github.com/acme/acme-admin/pull/1",
      why,
      witness: "slopweaver github push -> pushed",
    }),
  );
}

const STEER = unwrap(
  buildAutonomySteer({
    actionId: "16324-rebase",
    bySession: "supervisor",
    steer: "fine",
    steeredIso: "2026-09-13T00:00:00Z",
  }),
);

/** An in-memory import store with the table's two unique indexes, recording what was asked of it. */
function memoryImportStore({ failInsert = false }: { failInsert?: boolean } = {}): AutonomyImportStore & {
  rows: NewAutonomyEventRecord[];
  marked: boolean;
} {
  const rows: NewAutonomyEventRecord[] = [];
  const state = { marked: false };
  return {
    imported: () => Promise.resolve(ok(state.marked)),
    insert: ({ rows: incoming }) => {
      if (failInsert) {
        return Promise.resolve(err(StoreErrors.queryFailed({ cause: new Error("boom"), what: "insert" })));
      }
      let written = 0;
      for (const row of incoming) {
        const taken = rows.some(
          (held) =>
            held.importKey === row.importKey ||
            (held.entryKind === "action" && row.entryKind === "action" && held.actionId === row.actionId),
        );
        if (!taken) {
          rows.push(row);
          written += 1;
        }
      }
      return Promise.resolve(ok(written));
    },
    mark: () => {
      state.marked = true;
      return Promise.resolve(ok(undefined));
    },
    get marked() {
      return state.marked;
    },
    readBack: () =>
      Promise.resolve(
        ok(
          rows.map((row) => ({
            actionId: row.actionId,
            entryKind: row.entryKind,
            importKey: row.importKey,
            record: row.record,
          })),
        ),
      ),
    rows,
  };
}

describe("runAutonomyLeg", () => {
  it("names an absent register and writes nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "autonomy-leg-"));
    dirs.push(home);
    const store = memoryImportStore();
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path: join(home, "absent.jsonl"), store });
    expect(outcome.absentSource).toBe(join(home, "absent.jsonl"));
    expect(store.marked).toBe(false);
  });

  it("refuses a register behind a dangling symlink rather than reading it as absent, and does not mark", async () => {
    const home = mkdtempSync(join(tmpdir(), "autonomy-leg-"));
    dirs.push(home);
    const path = join(home, "autonomy.jsonl");
    symlinkSync(join(home, "unmounted", "autonomy.jsonl"), path);
    const store = memoryImportStore();
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(outcome.absentSource).toBe(undefined);
    expect(outcome.refused).toEqual([
      FleetImportErrors.legWriteFailed({
        path,
        reason: `the register could not be located: ${path} is behind a dangling symlink`,
      }),
    ]);
    expect(store.marked).toBe(false);
  });

  it("validates every line on a dry run and writes nothing", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act()), "", '{"doneIso":"x"}'] });
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store: undefined });
    expect(outcome.projected).toBe(1);
    expect(outcome.written).toBe(0);
    expect(outcome.refused.map((error) => error.code)).toEqual(["AUTONOMY_LINE_REFUSED"]);
  });

  it("imports every line verbatim, then marks the register imported", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act()), JSON.stringify(STEER)] });
    const store = memoryImportStore();
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(outcome.refused).toEqual([]);
    expect(outcome.written).toBe(2);
    expect(store.marked).toBe(true);
    expect(store.rows.map((row) => row.record)).toEqual([{ ...act() }, { ...STEER }]);
  });

  it("verifies only on a second run, writing nothing", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act())] });
    const store = memoryImportStore();
    await runAutonomyLeg({ home, nowIso: NOW, path, store });
    const again = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(again.written).toBe(0);
    expect(again.refused).toEqual([]);
    expect(store.rows.length).toBe(1);
  });

  it("reads an identical act written twice as one fact, not a divergence", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act()), JSON.stringify(act())] });
    const store = memoryImportStore();
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(outcome.refused).toEqual([]);
    expect(store.rows.length).toBe(1);
    expect(store.marked).toBe(true);
  });

  it("refuses a second, different act under one id, and does not mark", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act()), JSON.stringify(act({ why: "another" }))] });
    const store = memoryImportStore();
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(outcome.refused.map((error) => error.code)).toEqual(["AUTONOMY_IMPORT_DIVERGED"]);
    expect(outcome.refused[0]!.message).toContain(":2 differs from the stored action for act 16324-rebase");
    expect(store.marked).toBe(false);
  });

  it("writes nothing and does not mark while any line is refused", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act()), '{"actionId":"broken"}'] });
    const store = memoryImportStore();
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(outcome.refused.map((error) => error.code)).toEqual(["AUTONOMY_LINE_REFUSED"]);
    expect(store.rows).toEqual([]);
    expect(store.marked).toBe(false);
  });

  it("does not mark after a failed write", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act())] });
    const store = memoryImportStore({ failInsert: true });
    const outcome = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(outcome.refused.map((error) => error.code)).toEqual(["LEG_WRITE_FAILED"]);
    expect(store.marked).toBe(false);
  });

  it("names a line edited after the import as a divergence, never new authority", async () => {
    const { home, path } = register({ lines: [JSON.stringify(act())] });
    const store = memoryImportStore();
    await runAutonomyLeg({ home, nowIso: NOW, path, store });
    writeFileSync(path, `${JSON.stringify(act())}\n${JSON.stringify(act({ actionId: "later-act" }))}\n`);
    const again = await runAutonomyLeg({ home, nowIso: NOW, path, store });
    expect(again.refused.map((error) => error.code)).toEqual(["AUTONOMY_IMPORT_DIVERGED"]);
    expect(store.rows.length).toBe(1);
  });
});
