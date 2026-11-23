/**
 * The two halves of a close, run apart: `readClose` and `refreshList` that read and stage the owner's list, then
 * `prepareClose` and `commitClose` that decide and write. Includes the refresh that overruns under load. The seams
 * are the plain functions in `harness.ts`.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { commitClose } from "../../../../../../cli/commands/supervisor/tickCloseCommit.js";
import { prepareClose } from "../../../../../../cli/commands/supervisor/tickClosePrepare.js";
import { readClose } from "../../../../../../cli/commands/supervisor/tickCloseRead.js";
import { type RefreshedList, refreshList } from "../../../../../../cli/commands/supervisor/tickCloseRefresh.js";
import type { TickCloseArgs } from "../../../../../../cli/commands/supervisor/tickCore.js";
import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { sha256Hex } from "../../../../../../lib/hash.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { HANDED_BYTES, HANDED_TEXT, NOT_READ, NOW, REFRESHED_TEXT, tickFile } from "../tickFixtures.js";
import { dir, fake, recentBlocks, root, seatAndOpen, useWorkdir } from "./harness.js";

useWorkdir();

/** The seat's own list rendered, with nothing staged bound. */
const SEAT_LIST: RefreshedList = { listSha256: null, refreshed: false };

/**
 * A `tick close` invocation of the seat under test.
 *
 * @returns the parsed arguments
 */
function closeArgs({ yourList }: { yourList?: string } = {}): TickCloseArgs {
  return { bin: undefined, dir, home: undefined, subaction: "close", tick: undefined, yourList };
}

describe("the two halves of a close", () => {
  it("reads nothing into a tick that was never opened", async () => {
    await runSupervisorTick({
      deps: fake().deps,
      rest: [
        "seat",
        "--dir",
        dir,
        "--workspace",
        "workspace:93",
        "--model",
        "fable",
        "--pinned-at",
        NOW,
        "--loop-session-key",
        "k",
      ],
    });

    expect(unwrapErr(readClose({ args: closeArgs(), deps: fake().deps })).message).toBe(
      `${dir}: holds no tick-<n> — run \`tick open\` first`,
    );
  });

  it("refreshes the owner's list in a private directory over one an uncommitted close staged, and copies it in", async () => {
    await seatAndOpen();
    expect(readFileSync(join(dir, "tick-1", "run.json"), "utf8")).toBe(JSON.stringify({ nowIso: NOW }));
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));

    expect(unwrap(await refreshList({ args: closeArgs(), deps: run.deps, read }))).toEqual({
      listSha256: sha256Hex({ bytes: REFRESHED_TEXT }),
      refreshed: true,
    });
    expect(run.launched).toEqual(["session-start"]);
    expect(readFileSync(join(dir, "tick-1", "run.json"), "utf8")).toBe(REFRESHED_TEXT);
    expect(readdirSync(join(dir, "tick-1")).filter((name) => name.startsWith("run.json.session-start"))).toEqual([]);
  });

  it("copies nothing through a tick directory the refresh child swapped for a link to the seat", async () => {
    await seatAndOpen();
    rmSync(join(dir, "tick-1", "run.json"));
    writeFileSync(join(dir, "run.json"), "the seat list\n");
    const run = fake({
      duringRefresh: () => {
        renameSync(join(dir, "tick-1"), join(dir, "tick-saved"));
        symlinkSync(".", join(dir, "tick-1"));
      },
    });
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));

    expect(unwrap(await refreshList({ args: closeArgs(), deps: run.deps, read }))).toEqual(SEAT_LIST);
    expect(readFileSync(join(dir, "run.json"), "utf8")).toBe("the seat list\n");
  });

  it("copies a handed --your-list into the tick byte for byte, replacing a staged one, and launches no child", async () => {
    await seatAndOpen();
    const handed = join(dir, "run.fresh.json");
    const bytes = HANDED_BYTES;
    writeFileSync(handed, bytes);
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs({ yourList: handed }), deps: run.deps }));

    expect(unwrap(await refreshList({ args: closeArgs({ yourList: handed }), deps: run.deps, read }))).toEqual({
      listSha256: sha256Hex({ bytes }),
      refreshed: true,
    });
    expect(readFileSync(join(dir, "tick-1", "run.json")).equals(bytes)).toBe(true);
    expect(run.launched).toEqual([]);
    expect(readFileSync(handed).equals(bytes)).toBe(true);
  });

  it("refuses a handed list whose nowIso the render could not date, which its age door would read as fresh", async () => {
    await seatAndOpen();
    const handed = join(root, "handed.json");
    writeFileSync(handed, JSON.stringify({ nowIso: "2026-01-01T00:00:00,000Z" }));
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs({ yourList: handed }), deps: run.deps }));
    const refused = unwrapErr(await refreshList({ args: closeArgs({ yourList: handed }), deps: run.deps, read }));

    expect(JSON.stringify(refused)).toContain(
      `${handed}: carries no nowIso the render can date, so its age could not be judged`,
    );
    expect(readFileSync(join(dir, "tick-1", "run.json"), "utf8")).toBe(JSON.stringify({ nowIso: NOW }));
  });

  it("refuses a --your-list that is missing, a directory or a link, never falling back to the seat's list", async () => {
    await seatAndOpen();
    writeFileSync(join(dir, "run.json"), "the seat list\n");
    writeFileSync(join(root, "real.json"), "{}");
    symlinkSync(join(root, "real.json"), join(root, "linked.json"));
    const sources = [join(root, "absent.json"), root, join(root, "linked.json")];
    const refusals: string[] = [];
    const launched: string[] = [];
    for (const source of sources) {
      const run = fake();
      const read = unwrap(readClose({ args: closeArgs({ yourList: source }), deps: run.deps }));
      const refused = unwrapErr(await refreshList({ args: closeArgs({ yourList: source }), deps: run.deps, read }));
      refusals.push(JSON.stringify(refused));
      launched.push(...run.launched);
    }

    expect(launched).toEqual([]);
    expect(refusals.map((one) => (JSON.parse(one) as { code: string }).code)).toEqual([
      "PREFLIGHT_REFUSED",
      "PREFLIGHT_REFUSED",
      "PREFLIGHT_REFUSED",
    ]);
    expect(refusals[0]).toContain("ENOENT");
    expect(refusals[1]).toContain(`${root}: is not a regular file`);
    expect(refusals[2]).toContain("ELOOP");
    expect(readFileSync(join(dir, "tick-1", "run.json"), "utf8")).toBe(JSON.stringify({ nowIso: NOW }));
  });

  it("copies nothing through a tick directory swapped for a link after the close read it", async () => {
    await seatAndOpen();
    rmSync(join(dir, "tick-1", "run.json"));
    writeFileSync(join(dir, "run.json"), "the seat list\n");
    const handed = join(root, "handed.json");
    writeFileSync(handed, HANDED_TEXT);
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs({ yourList: handed }), deps: run.deps }));
    renameSync(join(dir, "tick-1"), join(dir, "tick-saved"));
    symlinkSync(".", join(dir, "tick-1"));

    expect(unwrapErr(await refreshList({ args: closeArgs({ yourList: handed }), deps: run.deps, read })).code).toBe(
      "CAPTURE_INVALID",
    );
    expect(readFileSync(join(dir, "run.json"), "utf8")).toBe("the seat list\n");
  });

  it("refuses --your-list on a part-committed close whose staged list is gone, rather than rendering a new one", async () => {
    await seatAndOpen();
    expect(await runSupervisorTick({ deps: fake({ publishFails: true }).deps, rest: ["close", "--dir", dir] })).toBe(
      EXIT_ERROR,
    );
    rmSync(join(dir, "tick-1", "run.json"));
    const handed = join(root, "handed.json");
    writeFileSync(handed, HANDED_TEXT);
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs({ yourList: handed }), deps: run.deps }));
    const refused = unwrapErr(await refreshList({ args: closeArgs({ yourList: handed }), deps: run.deps, read }));

    expect(JSON.stringify(refused)).toContain(
      `${join(dir, "tick-1", "run.json")}: this close already committed a stage against a list that is no longer staged`,
    );
    expect(existsSync(join(dir, "tick-1", "run.json"))).toBe(false);
  });

  it("keeps the list a part-committed close staged, byte for byte, and says it did not read --your-list", async () => {
    await seatAndOpen();
    expect(await runSupervisorTick({ deps: fake({ publishFails: true }).deps, rest: ["close", "--dir", dir] })).toBe(
      EXIT_ERROR,
    );
    const handed = join(root, "handed.json");
    writeFileSync(handed, HANDED_TEXT);
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs({ yourList: handed }), deps: run.deps }));

    expect(unwrap(await refreshList({ args: closeArgs({ yourList: handed }), deps: run.deps, read }))).toEqual({
      listSha256: sha256Hex({ bytes: REFRESHED_TEXT }),
      refreshed: true,
    });
    expect(readFileSync(join(dir, "tick-1", "run.json"), "utf8")).toBe(REFRESHED_TEXT);
    expect(run.diagnostics).toEqual([
      `supervisor tick close: this close already committed a stage, so it keeps the list it staged at ` +
        `${join(dir, "tick-1", "run.json")} and does not read --your-list ${handed}`,
    ]);
  });

  it("keeps the staged list when the close state records no stage done, since a stage may be mid-write", async () => {
    await seatAndOpen();
    expect(await runSupervisorTick({ deps: fake({ publishFails: true }).deps, rest: ["close", "--dir", dir] })).toBe(
      EXIT_ERROR,
    );
    const statePath = join(dir, "tick-1", "close-state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    writeFileSync(statePath, JSON.stringify({ ...state, done: [] }));
    const handed = join(root, "handed.json");
    writeFileSync(handed, HANDED_TEXT);
    const run = fake();
    const read = unwrap(readClose({ args: closeArgs({ yourList: handed }), deps: run.deps }));

    expect(unwrap(await refreshList({ args: closeArgs({ yourList: handed }), deps: run.deps, read }))).toEqual({
      listSha256: sha256Hex({ bytes: REFRESHED_TEXT }),
      refreshed: true,
    });
    expect(readFileSync(join(dir, "tick-1", "run.json"), "utf8")).toBe(REFRESHED_TEXT);
    expect(run.launched).toEqual([]);
    expect(run.diagnostics).toEqual([
      `supervisor tick close: this close already committed a stage, so it keeps the list it staged at ` +
        `${join(dir, "tick-1", "run.json")} and does not read --your-list ${handed}`,
    ]);
  });
});

describe("a close whose refresh overruns under load", () => {
  it("falls back to the seat's list and prints the bare build and the --your-list close that follows it", async () => {
    await seatAndOpen();
    rmSync(join(dir, "tick-1", "run.json"));
    const run = fake({ refreshTimesOut: true });
    const args = { ...closeArgs(), home: join(root, "my home"), tick: 1 };
    const read = unwrap(readClose({ args, deps: run.deps }));
    const handed = join(dir, "run.fresh.json");

    expect(unwrap(await refreshList({ args, deps: run.deps, read }))).toEqual(SEAT_LIST);
    expect(run.diagnostics).toEqual([
      "supervisor tick close: the owner's list was not refreshed (`slopweaver session-start --json --no-record --deadline 2026-09-27T01:05:00.000Z` timed out " +
        "after 420s (killed)); the seat has none",
      "supervisor tick close: the refresh overran its budget under load — build the list with no budget, as a " +
        "background job that resumes you (never a sleep-poll):",
      `  slopweaver session-start --json --no-record --out ${handed}`,
      `  then: slopweaver supervisor tick close --dir ${dir} --tick 1 --home '${join(root, "my home")}' ` +
        `--your-list ${handed}`,
    ]);
  });

  it("names no route when the refresh child failed for any other reason", async () => {
    await seatAndOpen();
    rmSync(join(dir, "tick-1", "run.json"));
    const run = fake({ refreshFails: true });
    const read = unwrap(readClose({ args: closeArgs(), deps: run.deps }));

    expect(unwrap(await refreshList({ args: closeArgs(), deps: run.deps, read }))).toEqual(SEAT_LIST);
    expect(run.diagnostics).toEqual([
      "supervisor tick close: the owner's list was not refreshed (`slopweaver session-start --json --no-record --deadline 2026-09-27T01:05:00.000Z` exit 1); " +
        "the seat has none",
    ]);
  });

  it("closes end to end on the handed list, rendering its bound bytes and never the caller's path", async () => {
    await seatAndOpen();
    rmSync(join(dir, "tick-1", "run.json"));
    const handed = join(dir, "run.fresh.json");
    writeFileSync(handed, JSON.stringify({ nowIso: NOW }));
    const run = fake({ refreshTimesOut: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--your-list", handed] })).toBe(
      EXIT_OK,
    );
    expect(run.launched.includes("session-start")).toBe(false);
    expect(run.renderedLists).toEqual([JSON.stringify({ nowIso: NOW })]);
    expect(run.renders[0]!.includes(handed)).toBe(false);
    expect(run.published).toEqual(["<p>the page</p>"]);
  });

  it("decides everything without touching the seat's own files", async () => {
    await seatAndOpen();
    const before = readdirSync(dir).toSorted();
    const form = readFileSync(join(dir, "form.json"), "utf8");

    const prepared = unwrap(await prepareClose({ args: closeArgs(), deps: fake().deps }));

    expect(prepared.owed).toEqual(["form-committed", "snapshots-resolved", "page-published", "tick-recorded"]);
    expect(prepared.tickId).toBe("handoff-9292-tick-1");
    expect(readdirSync(dir).toSorted()).toEqual(before);
    expect(readFileSync(join(dir, "form.json"), "utf8")).toBe(form);
  });

  it("refuses to commit a tick file edited after it was validated, writing nothing", async () => {
    await seatAndOpen();
    const run = fake();
    const prepared = unwrap(await prepareClose({ args: closeArgs(), deps: run.deps }));
    writeFileSync(join(dir, "tick-1", "tick.json"), tickFile({ sleeping: true }));

    expect(await commitClose({ deps: run.deps, evidence: NOT_READ, prepared })).toBe(EXIT_ERROR);
    expect(run.diagnostics.some((line) => line.includes("changed after it was validated"))).toBe(true);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
    expect(existsSync(join(dir, "tick-1", "close-state.json"))).toBe(false);
  });

  it("stops at the next stage when the tick file is edited mid-commit, and a resume under the edit refuses", async () => {
    await seatAndOpen();
    const run = fake();
    const prepared = unwrap(await prepareClose({ args: closeArgs(), deps: run.deps }));
    const editing: SupervisorTickDeps = {
      ...run.deps,
      publish: async (args) => {
        writeFileSync(join(dir, "tick-1", "tick.json"), tickFile({ sleeping: true }));
        return run.deps.publish(args);
      },
    };

    expect(await commitClose({ deps: editing, evidence: NOT_READ, prepared })).toBe(EXIT_ERROR);
    expect(run.published.length).toBe(1);
    expect(run.appended).toEqual([]);
    expect(await runSupervisorTick({ deps: fake().deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.appended).toEqual([]);
  });

  it("commits only the stages still owed", async () => {
    await seatAndOpen();
    const run = fake();
    const prepared = unwrap(await prepareClose({ args: closeArgs(), deps: run.deps }));
    // A close owing only its row has committed its form, so what it rendered is what the seat holds.
    const seatForm = readFileSync(join(dir, "form.json"), "utf8");
    const owedOnlyTheRow = { ...prepared, formAfter: seatForm, owed: ["tick-recorded" as const] };

    expect(await commitClose({ deps: run.deps, evidence: NOT_READ, prepared: owedOnlyTheRow })).toBe(EXIT_OK);
    expect(run.published).toEqual([]);
    expect(recentBlocks()).toBe(0);
    expect(run.appended.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
  });
});
