/**
 * `supervisor tick close` over a page the render qualifies or refuses: a passing page that resolved bare references,
 * and a page over its byte cap that the close fits by moving the oldest notes out. The renders are the seams in
 * `renderSeams.ts`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SupervisorTickDeps } from "../../../../../../cli/commands/supervisor/tickDeps.js";
import { runSupervisorTick } from "../../../../../../cli/commands/supervisor/tickRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import type { SupervisorTickRow } from "../../../../../../supervisor/tickTypes.js";
import { FORM } from "../tickFixtures.js";
import { dir, fake, seatAndOpen, useWorkdir } from "./harness.js";
import { heavyNotes, linkingRender, notesIn, notesOf, refNotes, seatHeavyForm, sizedRender } from "./renderSeams.js";

useWorkdir();

describe("a close whose passing page resolved bare references", () => {
  it("commits the form with every resolved reference qualified, from a second render of that qualified form", async () => {
    await seatAndOpen();
    const form = {
      ...FORM,
      earlierToday: { notes: refNotes({ count: 2, spelling: "#2687" }), summary: "earlier today" },
    };
    writeFileSync(join(dir, "form.json"), `${JSON.stringify(form, null, 2)}\n`);
    const forms: string[] = [];
    const run = fake({ render: linkingRender({ fitsQualified: 2, forms }) });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(forms.map((text) => notesOf({ text }))).toEqual([
      refNotes({ count: 2, spelling: "#2687" }),
      refNotes({ count: 2, spelling: "acme/widget#2687" }),
    ]);
    expect(notesIn({ path: join(dir, "form.json") })).toEqual(refNotes({ count: 2, spelling: "acme/widget#2687" }));
    expect(run.published).toEqual(['<p><a href="https://github.com/acme/widget/pull/2686">#2686</a> 2</p>']);
  });

  it("fits a qualified form over the cap by cutting from the QUALIFIED form, archiving qualified notes", async () => {
    await seatAndOpen();
    const form = {
      ...FORM,
      earlierToday: { notes: refNotes({ count: 4, spelling: "#2687" }), summary: "earlier today" },
    };
    writeFileSync(join(dir, "form.json"), `${JSON.stringify(form, null, 2)}\n`);
    const forms: string[] = [];
    const run = fake({ render: linkingRender({ fitsQualified: 2, forms }) });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(forms.map((text) => notesOf({ text }).length)).toEqual([4, 4, 3, 2]);
    expect(notesIn({ path: join(dir, "form.json") })).toEqual(refNotes({ count: 2, spelling: "acme/widget#2687" }));
    expect(JSON.parse(readFileSync(join(dir, "tick-1", "briefing-archive.json"), "utf8")).earlierNotes).toEqual(
      refNotes({ count: 4, spelling: "acme/widget#2687" }).slice(2),
    );
  });
});

describe("a close whose page renders over its byte cap", () => {
  it("moves the oldest notes out one render at a time while the overshoot is under one note, and keeps the newest", async () => {
    await seatAndOpen();
    seatHeavyForm({ count: 6 });
    const forms: string[] = [];
    const run = fake({ render: sizedRender({ fits: 3, forms, overBytes: 1 }) });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(forms.map((text) => notesOf({ text }).length)).toEqual([6, 5, 4, 3]);
    expect(notesIn({ path: join(dir, "form.json") })).toEqual(heavyNotes({ count: 3 }));
    expect(JSON.parse(readFileSync(join(dir, "tick-1", "briefing-archive.json"), "utf8")).earlierNotes).toEqual(
      heavyNotes({ count: 6 }).slice(3),
    );
    expect(run.published).toEqual(["<p>fits</p>"]);
    expect(existsSync(join(dir, "tick-1", "page.fragment.refused.html"))).toBe(false);
  });

  it("drops enough notes to cover a larger overshoot in ONE step, so the page renders twice rather than four times", async () => {
    await seatAndOpen();
    seatHeavyForm({ count: 6 });
    const forms: string[] = [];
    const run = fake({ render: sizedRender({ fits: 3, forms, overBytes: 2500 }) });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(forms.map((text) => notesOf({ text }).length)).toEqual([6, 3]);
    expect(notesIn({ path: join(dir, "form.json") })).toEqual(heavyNotes({ count: 3 }));
  });

  it("renders once and refuses on any other refusal, archiving nothing", async () => {
    await seatAndOpen();
    seatHeavyForm({ count: 6 });
    const forms: string[] = [];
    const run = fake({ render: sizedRender({ fits: 3, forms, overBytes: 1, refusalCode: "RENDER_CHECK_FAILED" }) });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(forms).toHaveLength(1);
    expect(notesIn({ path: join(dir, "form.json") })).toEqual(heavyNotes({ count: 6 }));
    expect(existsSync(join(dir, "tick-1", "briefing-archive.json"))).toBe(false);
    expect(existsSync(join(dir, "tick-1", "page.fragment.refused.html"))).toBe(true);
  });

  it("stops at one note, says the weight is elsewhere, writes the last refused page and commits nothing", async () => {
    await seatAndOpen();
    seatHeavyForm({ count: 3 });
    const forms: string[] = [];
    const run = fake({ render: sizedRender({ fits: 0, forms, overBytes: 1 }) });

    expect(await runSupervisorTick({ deps: run.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(forms.map((text) => notesOf({ text }).length)).toEqual([3, 2, 1]);
    expect(run.diagnostics.join("\n")).toContain(
      "tick close moved earlierToday down to 1 note(s) and the page is still over its cap",
    );
    expect(notesIn({ path: join(dir, "form.json") })).toEqual(heavyNotes({ count: 3 }));
    expect(existsSync(join(dir, "tick-1", "page.fragment.refused.html"))).toBe(true);
    expect(run.published).toEqual([]);
  });

  it("renders a resumed close's COMMITTED form exactly, fitting and archiving nothing again", async () => {
    await seatAndOpen();
    seatHeavyForm({ count: 6 });
    const ledger: SupervisorTickRow[] = [];
    const first = fake({ ledger, publishFails: true, render: sizedRender({ fits: 3, forms: [], overBytes: 1 }) });

    expect(await runSupervisorTick({ deps: first.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    const committed = readFileSync(join(dir, "form.json"), "utf8");
    const archive = readFileSync(join(dir, "tick-1", "briefing-archive.json"), "utf8");
    const forms: string[] = [];
    const second = fake({ ledger, render: sizedRender({ fits: 6, forms, overBytes: 1 }) });

    expect(await runSupervisorTick({ deps: second.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_OK);
    expect(forms).toEqual([committed]);
    expect(readFileSync(join(dir, "form.json"), "utf8")).toBe(committed);
    expect(readFileSync(join(dir, "tick-1", "briefing-archive.json"), "utf8")).toBe(archive);
    expect(second.published).toEqual(["<p>fits</p>"]);
  });

  it("refuses a resumed close whose committed form was replaced after its page was rendered", async () => {
    await seatAndOpen();
    seatHeavyForm({ count: 6 });
    const ledger: SupervisorTickRow[] = [];
    const first = fake({ ledger, publishFails: true, render: sizedRender({ fits: 3, forms: [], overBytes: 1 }) });

    expect(await runSupervisorTick({ deps: first.deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    const replaced = `${JSON.stringify({ replaced: true })}\n`;
    const second = fake({ ledger, render: sizedRender({ fits: 6, forms: [], overBytes: 1 }) });
    const { gate } = second.deps;
    const deps: SupervisorTickDeps = {
      ...second.deps,
      gate: (pass) => {
        writeFileSync(join(dir, "form.json"), replaced);
        return gate(pass);
      },
    };

    expect(await runSupervisorTick({ deps, rest: ["close", "--dir", dir] })).toBe(EXIT_ERROR);
    expect(second.published).toEqual([]);
    expect(second.diagnostics.some((line) => line.includes("changed after this resumed close rendered its page"))).toBe(
      true,
    );
  });
});
