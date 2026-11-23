/**
 * The whole autonomy loop through the SHIPPED binary: a session records an act, the owner steers it, and their
 * own page carries both.
 *
 * The unit lane proves each half in one process. What only this lane can prove is that the ledger a verb WRITES
 * is the ledger another verb READS and a third verb RENDERS — one store, four processes, and the shipped gate
 * reading exactly the bytes that landed on disk. A projection that agreed with itself in memory and disagreed
 * across a process boundary is the defect this closes.
 *
 * The chain needs a real, migrated store, and no lane has one, so it is OPT-IN and lives in its own file, beside
 * `renderThenCheck.test.ts` rather than inside it, so that file runs everything it holds. Point it at a THROWAWAY
 * database in the running stack, never `postgres`, which is the live fleet's:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres autonomy_ledger_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/autonomy_ledger_proof slopweaver store push
 *   AUTONOMY_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/autonomy_ledger_proof \
 *     yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/cli/commands/briefing/autonomyLedgerChain.test.ts
 *
 * The act's id is unique to the run and its rows are deleted afterwards, so the page counts this act alone.
 */
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStore } from "../../../../../store/client.js";
import { autonomyEventTable } from "../../../../../store/schema/ledgers.js";
import { grantedEnv } from "../../../../hatchGrantFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
const FORM = join(repoRoot, "src/__tests__/fixtures/briefing/fleet-briefing-form.json");

const PROOF_URL = process.env["AUTONOMY_STORE_PROOF_URL"];

let home: string;
let grantEnv: Readonly<Record<string, string>>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-autonomy-chain-"));
  grantEnv = grantedEnv({ hatchIds: ["stale-cards"], home });
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Run the shipped binary against the proof store, with an isolated environment and an optional stdin body.
 *
 * @param args the verb and its flags
 * @param stdin what the verb reads on stdin
 * @returns the finished process, both streams included
 */
function run({ args, stdin }: { args: readonly string[]; stdin: string }): SpawnSyncReturns<string> {
  return spawnSync(BIN, args, {
    cwd: home,
    encoding: "utf8",
    env: { ...grantEnv, HOME: home, PATH: process.env["PATH"]!, SLOPWEAVER_STORE_URL: PROOF_URL! },
    input: stdin,
    maxBuffer: 8 * 1024 * 1024,
  });
}

describe.skipIf(PROOF_URL === undefined)("bin/slopweaver autonomy record, steer, then briefing render", () => {
  const actId = `16644-enqueue-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    const client = openStore({ url: PROOF_URL! });
    await client.db.delete(autonomyEventTable).where(eq(autonomyEventTable.actionId, actId));
    await client.close();
  });

  it("carries an act and the owner's word onto the page, through four separate processes", { timeout: 60_000 }, () => {
    const recorded = run({
      args: [
        "autonomy",
        "record",
        "--home",
        home,
        "--action-id",
        actId,
        "--kind",
        "press-merge-when-ready",
        // A pull request in the SAME repository the fixture's own card names, on purpose: an act on a
        // second repo makes the page two-repo, and `../../../../../briefing/bareRef.ts` then correctly
        // refuses the fixture card's bare pull-request number for having no sole repo to resolve against. That is the
        // gate working rather than a defect — see `skills/supervisor/reference/autonomy-ledger.md`.
        "--subject",
        "https://github.com/lachiejames/slopweaver/pull/16644",
        "--done-iso",
        "2026-09-12T02:06:09Z",
        "--by-session",
        "workspace:123 act-on-open-acme-admin-prs",
        "--why",
        "CI green, mergeable, every review thread resolved, and no code-owner request outstanding.",
        "--said",
        "I merged your pull request on the admin app — every check had passed and nobody was left to press the button.",
        "--witness",
        "slopweaver github enqueue --pr 16644 -> queued at position 1",
      ],
      stdin: "",
    });
    expect(recorded.status).toBe(0);
    expect(recorded.stdout).toContain(`${actId} recorded`);

    const steered = run({
      args: [
        "autonomy",
        "steer",
        actId,
        "--home",
        home,
        "--steer",
        "that's the right call — keep landing those",
        "--by-session",
        "fresh-supervisor-handoff-9240",
      ],
      stdin: "",
    });
    expect(steered.status).toBe(0);

    const listed = run({ args: ["autonomy", "list", "--home", home], stdin: "" });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("press merge when ready on lachiejames/slopweaver#16644");
    expect(listed.stdout).toContain("their steer: that's the right call — keep landing those");

    const page = join(home, "fleet-briefing-autonomy.html");
    const rendered = run({
      args: ["briefing", "render", "--form", "-", "--autonomy-ledger", "--out", page, "--home", home],
      stdin: readFileSync(FORM, "utf8"),
    });
    expect(rendered.status).toBe(0);

    const html = readFileSync(page, "utf8");
    expect(html).toContain('<h2 id="autonomy-ledger">done for you, without asking</h2>');
    expect(html).toContain(
      '<a href="https://github.com/lachiejames/slopweaver/pull/16644">lachiejames/slopweaver#16644</a>',
    );
    expect(html).toContain("you have steered this");
    expect(html).toContain("<strong>Your steer:</strong> that's the right call — keep landing those");
    expect(html).toContain(`· act ${actId}`);

    const checked = run({ args: ["briefing", "check", page, "--home", home], stdin: "" });
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("autonomy ledger: 1 act(s) shown, newest first, each with its act id");
  });
});
