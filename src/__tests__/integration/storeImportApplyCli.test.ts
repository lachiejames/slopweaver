/**
 * `slopweaver store import --apply` through the SHIPPED binary, on a REAL Postgres: a staged batch applied with its
 * receipt, a second apply finding it already applied, a batch nobody staged refused with nothing written, and a strict
 * apply's printed acknowledging command run as printed, by a shell, against the same store. What
 * `storeImportApply.test.ts` cannot settle, calling `applyStagedImport` in process, is the verb's own seam — the
 * parsed flags, the store it selects, what it prints and the exit code.
 *
 * OPT-IN, and never in CI: it needs a running local stack. Its throwaway database is created from the admin
 * connection, migrated, handed to the spawned verb as `SLOPWEAVER_STORE_URL`, and dropped afterwards — it never
 * touches the database the admin URL names:
 *
 *   STORE_IMPORT_PROOF_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/storeImportApplyCli.test.ts
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runStoreImportApply } from "../../cli/commands/store/importApplyRun.js";
import { EXIT_ERROR } from "../../cli/exitCodes.js";
import { ACTIVE, CHANGED_MEMORY_LINE } from "../unit/store/transfer/stagedBatch.js";
import {
  ADMIN_URL,
  type AdminConnection,
  closeAll,
  openAdmin,
  type ProofStore,
  rowCounts,
  stagedAndAnswered,
  throwawayStore,
} from "./storeImportApplyHarness.js";

const BIN = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), "bin", "slopweaver");
const NEVER_STAGED = "0f1e2d3c-4b5a-4968-8776-655443322110";
/** The fixture export with its memory's claim changed, so the two meet as one memory held two ways. */
const CHANGED = { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] };

/** What one spawned run printed and exited with. */
interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The environment a spawned run sees: `store` and nothing else, with the shipped binary's own directory first on
 * `PATH` so a printed `slopweaver …` line runs exactly that binary.
 */
function storeEnv({ store }: { store: ProofStore }): NodeJS.ProcessEnv {
  return {
    HOME: store.root,
    PATH: `${dirname(BIN)}:${process.env["PATH"]!}`,
    SLOPWEAVER_HOME: store.home,
    SLOPWEAVER_STORE_URL: store.url,
    TMPDIR: process.env["TMPDIR"]!,
  };
}

/** One `store import` run of the shipped binary against `store`, its home and nothing else. */
function storeImport({ store, args }: { store: ProofStore; args: readonly string[] }): Ran {
  const ran = spawnSync(BIN, ["store", "import", ...args, "--home", store.home], {
    cwd: store.root,
    encoding: "utf8",
    env: storeEnv({ store }),
    timeout: 120_000,
  });
  return { status: ran.status, stderr: ran.stderr, stdout: ran.stdout };
}

/** A command line exactly as a verb printed it, run by a POSIX shell — so its quoting is under test too. */
function printedCommand({ store, line }: { store: ProofStore; line: string }): Ran {
  const ran = spawnSync("/bin/sh", ["-c", line], {
    cwd: store.root,
    encoding: "utf8",
    env: storeEnv({ store }),
    timeout: 120_000,
  });
  return { status: ran.status, stderr: ran.stderr, stdout: ran.stdout };
}

describe.skipIf(ADMIN_URL === undefined)("store import --apply, through the shipped binary (opt-in)", () => {
  // Built in `beforeAll`, never at collection: `skipIf` still runs this body.
  let admin: AdminConnection;
  const opened: ProofStore[] = [];

  beforeAll(() => {
    admin = openAdmin();
  });

  afterEach(async () => {
    await closeAll({ stores: opened.splice(0) });
  });

  afterAll(async () => {
    await admin.sql.end();
  });

  it("applies a staged batch once, then finds it applied, and refuses a batch nobody staged", async () => {
    const store = await throwawayStore({ admin });
    opened.push(store);
    const { batchId } = await stagedAndAnswered({ answers: { activation: "activate" }, contents: ACTIVE, store });

    const first = storeImport({ args: ["--apply", batchId, "--json"], store });
    const document = JSON.parse(first.stdout) as { outcome: string; batchId: string; writes: number };
    const afterFirst = await rowCounts({ client: store.client });

    expect([first.status, document.outcome, document.batchId]).toEqual([0, "applied", batchId]);
    expect(document.writes).toBe(Object.values(afterFirst).reduce((sum, count) => sum + count, 0));

    const second = storeImport({ args: ["--apply", batchId], store });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain(`store import: batch ${batchId} was already applied under plan`);
    expect(await rowCounts({ client: store.client })).toEqual(afterFirst);

    const never = storeImport({ args: ["--apply", NEVER_STAGED], store });

    expect(never.status).toBe(1);
    expect(never.stderr).toContain(`store import: no batch ${NEVER_STAGED} is staged`);
    expect(await rowCounts({ client: store.client })).toEqual(afterFirst);
  }, 300_000);

  it("stops on an append-only difference when told to, prints the command that acknowledges it, and that command works", async () => {
    const store = await throwawayStore({ admin });
    opened.push(store);
    const held = await stagedAndAnswered({ answers: { activation: "activate" }, contents: CHANGED, store });
    expect(storeImport({ args: ["--apply", held.batchId], store }).status).toBe(0);
    const { batchId, draft } = await stagedAndAnswered({ answers: {}, contents: ACTIVE, store });
    const questionId = draft.questions[0]!.id;
    const before = await rowCounts({ client: store.client });

    const stopped = storeImport({ args: ["--apply", batchId, "--stop-on-conflict"], store });
    const acknowledge = stopped.stderr.split("\n").find((line) => line.startsWith("      acknowledge: "))!;
    const command = acknowledge.slice("      acknowledge: ".length);

    expect(stopped.status).toBe(1);
    expect(stopped.stderr).toContain(
      `store import: batch ${batchId} was not applied, and none of its rows was written`,
    );
    expect(command).toBe(
      `slopweaver store import-resolve --question ${questionId} --action keep-current --home ${store.home}`,
    );
    expect(await rowCounts({ client: store.client })).toEqual(before);

    const answered = printedCommand({ line: command, store });

    expect(answered.status).toBe(0);

    const kept = storeImport({ args: ["--apply", batchId], store });

    expect(kept.status).toBe(0);
    expect(kept.stdout).toContain(`    memories ${draft.questions[0]!.key} (${questionId}, acknowledged)`);
    expect(kept.stdout).not.toContain("acknowledge: ");
  }, 300_000);

  it("runs in process against the store the environment selects, and fails a batch nobody staged", async () => {
    const store = await throwawayStore({ admin });
    opened.push(store);
    const before = await rowCounts({ client: store.client });
    const ambient = process.env["SLOPWEAVER_STORE_URL"];
    // The environment selection wins over any home's, so the verb opens this throwaway store and no other.
    process.env["SLOPWEAVER_STORE_URL"] = store.url;
    let status: number;
    try {
      status = await runStoreImportApply({
        args: { batchId: NEVER_STAGED, home: store.home, json: false, mode: "apply", stopOnConflict: false },
      });
    } finally {
      if (ambient === undefined) {
        delete process.env["SLOPWEAVER_STORE_URL"];
      } else {
        process.env["SLOPWEAVER_STORE_URL"] = ambient;
      }
    }

    expect(status).toBe(EXIT_ERROR);
    expect(await rowCounts({ client: store.client })).toEqual(before);
  }, 120_000);
});
