/**
 * `supervisor tick close` end to end over a real temp directory, the second half: the refused page it leaves on
 * disk, every link and swap it refuses to write through, and the close that resumes after a strand. The seams are
 * the plain functions in `harness.ts`.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type renderInProcess, renderInProcessOver } from "../../../../../../cli/commands/supervisor/tickRender.js";
import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { SupervisorTickRow } from "../../../../../../supervisor/tickTypes.js";
import { memoryAutonomyLedgerPort } from "../../../../../autonomyLedgerFixture.js";
import { FORM, tickFile } from "../tickFixtures.js";
import { dir, fake, recentBlocks, root, seatAndOpen, useWorkdir } from "./harness.js";

useWorkdir();

describe("supervisor tick close", () => {
  it("leaves the refused page on disk at the path the REAL render's refusal names, and nothing at --out", async () => {
    await seatAndOpen({
      tick: tickFile({
        foldSummary: "What this pass read.",
        headline: { sentences: ["The fix for #100 is queued.", "Nothing needs the owner this hour."] },
      }),
    });
    // The fixed list stands in for a session-start run only as far as the fake render; the real one validates it,
    // so this case renders with no list at all.
    rmSync(join(dir, "tick-1", "run.json"));
    const { earlierToday: _empty, ...rest } = FORM;
    writeFileSync(join(dir, "form.json"), JSON.stringify({ ...rest, awaiting: [], history: [] }));
    const render: typeof renderInProcess = ({ argv, formText }) =>
      renderInProcessOver({ argv, autonomy: memoryAutonomyLedgerPort(), formText });
    const run = fake({ refreshFails: true, render });
    const refusedPath = join(dir, "tick-1", "page.fragment.refused.html");

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics).toContain(
      'supervisor tick:   bare reference in section "done since you last looked" › fold "1 landing(s) since you ' +
        'last looked": "#100" is a bare reference (renders as #100) with no single repo to resolve it against — ' +
        'write it as "owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same text, which ' +
        "names the repo every bare reference beside it means.",
    );
    expect(run.diagnostics).toContain(
      `supervisor tick:   the refused page is written to ${refusedPath} — read it to see what was counted; ` +
        `nothing was written to ${join(dir, "tick-1", "page.fragment.html")}`,
    );
    expect(readFileSync(refusedPath, "utf8")).toContain("The fix for #100 is queued.");
    expect(existsSync(join(dir, "tick-1", "page.fragment.html"))).toBe(false);
    expect(run.published).toEqual([]);
    expect(run.appended).toEqual([]);
  });

  it("replaces a link planted at the staged open-pages path rather than writing through it", async () => {
    await seatAndOpen({ tick: tickFile({ openPagesReviewed: true }) });
    writeFileSync(join(dir, "open-pages.json"), "[]\n");
    const formBefore = readFileSync(join(dir, "form.json"), "utf8");
    symlinkSync("../form.json", join(dir, "tick-1", "open-pages.json"));
    const run = fake({ gateRefuses: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(readFileSync(join(dir, "form.json"), "utf8")).toBe(formBefore);
    expect(readFileSync(join(dir, "tick-1", "open-pages.json"), "utf8")).toBe("[]\n");
  });

  it("refuses a tick directory that is a link, writing nothing into what it points at", async () => {
    await seatAndOpen();
    const real = join(dir, "tick-moved");
    renameSync(join(dir, "tick-1"), real);
    symlinkSync("tick-moved", join(dir, "tick-1"));
    const before = readdirSync(dir).toSorted();
    const ledger: SupervisorTickRow[] = [];

    expect(await runSupervisorTick({ deps: fake({ ledger }).deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(readdirSync(dir).toSorted()).toEqual(before);
    expect(ledger).toEqual([]);
  });

  it("writes nothing through a tick directory the refresh child swapped for a link to the seat", async () => {
    await seatAndOpen({ tick: tickFile({ openPagesReviewed: true }) });
    // A list the open already refreshed is reused, so remove it: the refresh child must run for the swap to happen.
    rmSync(join(dir, "tick-1", "run.json"));
    writeFileSync(join(dir, "open-pages.json"), "[]\n");
    const seatPagesInode = lstatSync(join(dir, "open-pages.json")).ino;
    const swap = (): void => {
      renameSync(join(dir, "tick-1"), join(dir, "tick-saved"));
      symlinkSync(".", join(dir, "tick-1"));
    };
    const ledger: SupervisorTickRow[] = [];
    const run = fake({ duringRefresh: swap, ledger });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(lstatSync(join(dir, "open-pages.json")).ino).toBe(seatPagesInode);
    expect(existsSync(join(dir, "page.fragment.html"))).toBe(false);
    expect(run.renders).toEqual([]);
    expect(ledger).toEqual([]);
    expect(run.diagnostics.some((line) => line.includes("was replaced after the close read it"))).toBe(true);
  });

  it("stops mid-commit when a lingering helper swaps the tick directory, writing no state through the link", async () => {
    await seatAndOpen();
    const swap = (): void => {
      renameSync(join(dir, "tick-1"), join(dir, "tick-saved"));
      symlinkSync(".", join(dir, "tick-1"));
    };
    const ledger: SupervisorTickRow[] = [];
    const run = fake({ duringPublish: swap, ledger });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(existsSync(join(dir, "close-state.json"))).toBe(false);
    expect(ledger).toEqual([]);
    expect(run.diagnostics.some((line) => line.includes("was replaced after the close read it"))).toBe(true);
  });

  it("stops mid-commit when a helper swaps in a copy of the validated tick file, identical bytes and all", async () => {
    await seatAndOpen();
    const validated = join(dir, "tick-1", "tick.json");
    const swap = (): void => {
      writeFileSync(join(dir, "tick-1", "copy.json"), readFileSync(validated));
      renameSync(join(dir, "tick-1", "copy.json"), validated);
    };
    const ledger: SupervisorTickRow[] = [];
    const run = fake({ duringPublish: swap, ledger });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(ledger).toEqual([]);
    expect(run.diagnostics.some((line) => line.includes("is no longer the file that was validated"))).toBe(true);
  });

  it("replaces a link at the seat's run snapshot rather than writing through it onto the form", async () => {
    await seatAndOpen();
    symlinkSync("form.json", join(dir, "run.json"));
    const ledger: SupervisorTickRow[] = [];

    expect(await runSupervisorTick({ deps: fake({ ledger }).deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(lstatSync(join(dir, "run.json")).isSymbolicLink()).toBe(false);
    expect(recentBlocks()).toBe(1);
  });

  it("refuses a --home that is a link into the seat directory, writing nothing", async () => {
    await seatAndOpen();
    const link = join(root, "home-link");
    symlinkSync(join(dir, "tick-1"), link);
    const ledger: SupervisorTickRow[] = [];

    expect(
      await runSupervisorTick({ deps: fake({ ledger }).deps, rest: ["close", "--dir", dir, "--home", link] }),
    ).toBe(EXIT_ERROR);
    expect(ledger).toEqual([]);
  });

  it("refuses a --home that is a dangling link into the seat before deciding anything", async () => {
    await seatAndOpen();
    const link = join(root, "dangling-home");
    symlinkSync(join(dir, "never-made"), link);
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--home", link] })).toBe(EXIT_ERROR);
    expect(run.renders).toEqual([]);
    expect(run.published).toEqual([]);
  });

  it("refuses a --home that is a dangling link the refresh child makes real inside the seat", async () => {
    await seatAndOpen();
    rmSync(join(dir, "tick-1", "run.json"));
    const link = join(root, "dangling-home");
    symlinkSync(join(dir, "child-home"), link);
    const ledger: SupervisorTickRow[] = [];
    const run = fake({ duringRefresh: () => mkdirSync(join(dir, "child-home")), ledger });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--home", link] })).toBe(EXIT_ERROR);
    expect(run.published).toEqual([]);
    expect(ledger).toEqual([]);
  });

  it("refuses a --home that climbs out of a link with .. into the seat", async () => {
    await seatAndOpen();
    mkdirSync(join(root, "outside"));
    symlinkSync(join(dir, "tick-1"), join(root, "outside", "link"));
    const run = fake();

    expect(
      await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--home", `${root}/outside/link/..`] }),
    ).toBe(EXIT_ERROR);
    expect(run.renders).toEqual([]);
  });

  it("refuses a --home inside the seat before any other refusal, a broken form included", async () => {
    await seatAndOpen();
    writeFileSync(join(dir, "form.json"), "{ not json");
    const run = fake();

    expect(
      await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--home", join(dir, "tick-1")] }),
    ).toBe(EXIT_ERROR);
    expect(run.diagnostics).toEqual([
      `supervisor tick: ${join(dir, "tick-1")}: --home sits inside the seat directory; point it outside`,
    ]);
  });

  it("refuses a --home inside the seat directory, writing nothing", async () => {
    await seatAndOpen();
    const ledger: SupervisorTickRow[] = [];
    const run = fake({ ledger });

    expect(
      await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir, "--home", join(dir, "tick-1")] }),
    ).toBe(EXIT_ERROR);
    expect(ledger).toEqual([]);
    expect(run.diagnostics).toContain(
      `supervisor tick: ${join(dir, "tick-1")}: --home sits inside the seat directory; point it outside`,
    );
  });

  it("refuses a tick file that is not valid UTF-8, writing nothing", async () => {
    await seatAndOpen();
    const path = join(dir, "tick-1", "tick.json");
    writeFileSync(path, Buffer.concat([readFileSync(path).subarray(0, -2), Buffer.from([0x80, 0x7d, 0x0a])]));
    const ledger: SupervisorTickRow[] = [];

    expect(await runSupervisorTick({ deps: fake({ ledger }).deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(ledger).toEqual([]);
    expect(recentBlocks()).toBe(0);
  });

  it("replaces a link planted at the saved form rather than proposing from what it points at", async () => {
    await seatAndOpen();
    symlinkSync("../form.json", join(dir, "tick-1", "form.before.json"));
    const ledger: SupervisorTickRow[] = [];

    expect(
      await runSupervisorTick({ deps: fake({ ledger, publishFails: true }).deps, rest: ["close", "--dir", dir] }),
    ).toBe(EXIT_ERROR);
    expect(await runSupervisorTick({ deps: fake({ ledger }).deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(recentBlocks()).toBe(1);
    expect(ledger.length).toBe(1);
  });

  it("writes nothing past the chair gate when the gate refuses", async () => {
    await seatAndOpen();
    const run = fake({ gateRefuses: true });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(recentBlocks()).toBe(0);
    expect(run.published).toEqual([]);
    expect(existsSync(join(dir, "tick-1", "close-state.json"))).toBe(false);
  });

  it("resumes a stranded close without adding the block twice or recording the tick twice", async () => {
    await seatAndOpen();
    const ledger: SupervisorTickRow[] = [];
    const first = fake({ ledger, publishFails: true });

    expect(await runSupervisorTick({ deps: first.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(first.diagnostics.join("\n")).toContain("the pages directory is read-only");
    expect(first.out).toEqual([]);
    expect(recentBlocks()).toBe(1);
    const second = fake({ ledger });

    expect(await runSupervisorTick({ deps: second.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(recentBlocks()).toBe(1);
    expect(second.published).toEqual(["<p>the page</p>"]);
    expect(ledger.map((row) => row.tickId)).toEqual(["handoff-9292-tick-1"]);
    const third = fake({ ledger });

    expect(await runSupervisorTick({ deps: third.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(third.published).toEqual([]);
    expect(ledger).toHaveLength(1);
  });

  it("refuses to resume under an edited tick file", async () => {
    await seatAndOpen();
    expect(await runSupervisorTick({ deps: fake({ publishFails: true }).deps, rest: ["close", "--dir", dir] })).toBe(
      EXIT_ERROR,
    );
    writeFileSync(join(dir, "tick-1", "tick.json"), tickFile({ sleeping: true }));
    const run = fake();

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(run.diagnostics.join("\n")).toContain("this tick already committed a close from a different input");
    expect(run.published).toEqual([]);
  });
});
