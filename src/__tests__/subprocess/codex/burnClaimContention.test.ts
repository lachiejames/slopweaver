/**
 * The Codex burn watch's episode claim, under REAL contention — the one property a unit test cannot prove.
 *
 * `unit/codex/drawdownJournalStore.test.ts` proves the claim is first-wins by calling it three times in one
 * process, which is a correct and useful test of the return shape. It cannot prove the thing the design
 * turns on: that two processes deciding to investigate in the same instant are settled by the KERNEL rather
 * than by cooperation between them. The defect being prevented is a read-then-append check, and a
 * read-then-append check passes a sequential test perfectly — one caller, then the next, sees the file the
 * first one wrote. It only fails when the two overlap.
 *
 * So this forks real Node processes, holds them at a barrier, and releases them together. Exactly one must
 * come back `taken`.
 *
 * **The witness fires.** Checked by replacing the atomic create in
 * `src/codex/drawdownJournalStore.ts` with the defect it prevents — `existsSync(path)` then `openSync(path,
 * "w")`, the read-then-check shape — and re-running this file: `expected 2 to be 1`. Two processes took the
 * same claim and would both have opened a workspace. Restoring `openSync(path, "wx", …)` puts it back to
 * one. An assertion on an absence is worth nothing unless it has been seen to fail, and this one has.
 *
 * It lives in the subprocess lane because it spawns processes; it spends nothing and reaches no network.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

/** How many processes race for the one claim. */
const RACERS = 8;

/** How long the racers spin before claiming, so every one of them is past tsx start-up and at the barrier. */
const BARRIER_MS = 15_000;

/** `execFile`, promisified, so eight racers can be launched together rather than one after another. */
const run = promisify(execFile);

/** Every directory this file has minted, so `afterEach` can remove them. */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home inside this file's own temp-root sandbox. */
function scratchHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-claim-race-"));
  dirs.push(dir);
  return dir;
}

describe("the codex burn episode claim under real contention", () => {
  it("gives the claim to exactly ONE of eight concurrent processes", async () => {
    const home = scratchHome();
    const runnerDir = scratchHome();
    const runner = join(runnerDir, "race.ts");
    // Each racer busy-waits to a shared wall-clock instant before claiming, so they contend rather than
    // arriving in start order — which is what a sequential test accidentally measures instead.
    writeFileSync(
      runner,
      [
        `import { claimCodexDrawdownEpisode } from ${JSON.stringify(join(process.cwd(), "src/codex/drawdownJournalStore.ts"))};`,
        "const startAt = Number(process.argv[3]);",
        "while (Date.now() < startAt) { /* spin to the barrier */ }",
        'const claim = claimCodexDrawdownEpisode({ episodeId: "raced", home: process.argv[2]!, nowIso: new Date().toISOString() });',
        'process.stdout.write(claim.isOk() ? claim.value.kind : "error");',
      ].join("\n"),
      "utf8",
    );

    // Launched together and awaited together, so they genuinely overlap. `execFileSync` would run them one
    // after another, which is the sequential shape a read-then-append check passes — the very thing this
    // exists to catch. The barrier is generous because each racer pays tsx's own start-up first.
    const startAt = Date.now() + BARRIER_MS;
    const launched = Array.from({ length: RACERS }, async () =>
      (await run(process.execPath, ["--import", "tsx", runner, home, String(startAt)])).stdout.trim(),
    );
    const racers = await Promise.all(launched);

    expect(racers.filter((kind) => kind === "taken").length).toBe(1);
    expect(racers.filter((kind) => kind === "held").length).toBe(RACERS - 1);
  });
});
