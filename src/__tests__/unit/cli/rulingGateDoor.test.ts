/**
 * The dispatch boundary's own decisions: what it refuses, and the two things it must never gate.
 *
 * The placement itself — above the `manifest`/`legacy` branch in `src/cli/main.ts` — is asserted by
 * `./mainGatePlacement.test.ts`, because a verdict function can be perfect while nothing calls it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EXIT_ERROR } from "../../../cli/exitCodes.js";
import {
  distinctGateHomes,
  gateHomes,
  readGatesForHomes,
  refuseRunnerOnStandingRuling,
  rulingGateDoor,
  rulingGateDoorVerdict,
  withCallerGateHomes,
} from "../../../cli/rulingGateDoor.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { type StandingGate, standingGatesOf } from "../../../handover/rulingGate.js";
import { writeStandingGates } from "../../../handover/rulingGateStore.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const PLACED = "2026-09-21T03:01:34.000Z";
const NOW = "2026-09-21T05:35:28.000Z";

const placing: RunEvent = {
  anchor: "transcript:a0000036#a0000064",
  atIso: PLACED,
  decidedIso: PLACED,
  gate: { subjects: [], verbs: [{ noun: "slack", verb: "post" }] },
  kind: "ruling",
  ruling: "post only what someone has asked for",
};

const gates = standingGatesOf({ events: [placing], slug: "a-row" });

describe("rulingGateDoorVerdict", () => {
  it("refuses the gated verb and names the action", () => {
    const verdict = rulingGateDoorVerdict({
      argv: ["node", "cli", "slack", "post", "--text", "hi"],
      gates,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(true);
    expect(verdict.lines.join("\n")).toContain("cannot slopweaver slack post");
  });

  it("never gates --help, so a refused verb's usage is still readable", () => {
    const verdict = rulingGateDoorVerdict({
      argv: ["node", "cli", "slack", "post", "--help"],
      gates,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(false);
    expect(verdict.lines).toEqual([]);
  });

  it("lets an ungated verb through", () => {
    const verdict = rulingGateDoorVerdict({
      argv: ["node", "cli", "slack", "read-thread", "url"],
      gates,
      noun: "slack",
      nowIso: NOW,
      verb: "read-thread",
    });

    expect(verdict.refuse).toBe(false);
  });

  it("lets a lapsed gate through", () => {
    const lapsing = standingGatesOf({
      events: [
        {
          ...placing,
          gate: { subjects: [], untilIso: "2026-09-21T04:00:00.000Z", verbs: [{ noun: "slack", verb: "post" }] },
        },
      ],
      slug: "a-row",
    });

    const verdict = rulingGateDoorVerdict({
      argv: ["node", "cli", "slack", "post"],
      gates: lapsing,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(false);
  });
});

describe("gateHomes", () => {
  it("reads the environment's home AND the one --home names, the environment's first", () => {
    const homes = gateHomes({ argv: ["node", "cli", "handover", "reap", "--home", "/tmp/a"], home: "/real" });

    expect(homes).toEqual(["/real", "/tmp/a"]);
  });

  it("reads the --home=<dir> spelling too", () => {
    const homes = gateHomes({ argv: ["node", "cli", "handover", "reap", "--home=/tmp/b"], home: "/real" });

    expect(homes).toEqual(["/real", "/tmp/b"]);
  });

  it("reads one home when --home names the environment's own", () => {
    const homes = gateHomes({ argv: ["node", "cli", "handover", "reap", "--home", "/real"], home: "/real" });

    expect(homes).toEqual(["/real"]);
  });

  it("adds nothing when --home names no value, rather than swallowing the next flag", () => {
    const homes = gateHomes({ argv: ["node", "cli", "handover", "reap", "--home", "--json"], home: "/real" });

    expect(homes).toEqual(["/real"]);
  });

  it("reads a home whose name opens with one dash, since the flag parser accepts it as the value", () => {
    const homes = gateHomes({ argv: ["node", "cli", "slack", "post", "--home", "-held"], home: "/real" });

    expect(homes).toEqual(["/real", "-held"]);
  });

  it("reads a --home= riding in as another flag's value as a home too, since a misread only adds", () => {
    const homes = gateHomes({ argv: ["node", "cli", "slack", "post", "--text", "--home=/x"], home: "/real" });

    expect(homes).toEqual(["/real", "/x"]);
  });

  it("keeps every argv home, so an earlier decoy cannot hide the verb's real one", () => {
    const homes = gateHomes({
      argv: ["node", "cli", "slack", "post", "--text", "--home=/decoy", "--home", "/tmp/c"],
      home: "/real",
    });

    expect(homes).toEqual(["/real", "/decoy", "/tmp/c"]);
  });

  it("reads an empty home in both spellings, since the flag parser hands a verb that home", () => {
    expect(gateHomes({ argv: ["node", "cli", "handover", "reap", "--home="], home: "/real" })).toEqual(["/real", ""]);
    expect(gateHomes({ argv: ["node", "cli", "handover", "reap", "--home", ""], home: "/real" })).toEqual([
      "/real",
      "",
    ]);
  });

  it("reads only the environment's home when argv names none", () => {
    expect(gateHomes({ argv: ["node", "cli", "handover", "reap"], home: "/real" })).toEqual(["/real"]);
  });
});

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home, holding the slack-post gate when `gated`, or `holding` when it is given. */
function homeWith({ gated, holding }: { gated: boolean; holding?: readonly StandingGate[] }): string {
  const home = mkdtempSync(join(tmpdir(), "sw-door-"));
  fixtures.push(home);
  if (gated) {
    let written = gates;
    if (holding !== undefined) {
      written = holding;
    }
    unwrap(
      writeStandingGates({ builtAtIso: PLACED, gates: written, indexPath: stateHomePaths({ home }).rulingGatesJson }),
    );
  }
  return home;
}

/** A second slack-post gate under the SAME id as {@link gates}' one, carrying different words. */
const sameIdOtherWords = standingGatesOf({
  events: [{ ...placing, ruling: "no unasked posts to a channel" }],
  slug: "a-row",
});

describe("rulingGateDoor reads the real home whatever argv names", () => {
  it("still refuses when --home <dir> re-points at a home with no rulings", () => {
    const home = homeWith({ gated: true });
    const empty = homeWith({ gated: false });

    const verdict = rulingGateDoor({
      argv: ["node", "cli", "slack", "post", "--home", empty],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(true);
    expect(verdict.lines.join("\n")).toContain("cannot slopweaver slack post");
  });

  it("still refuses when a --home= token rides in as another flag's value", () => {
    const home = homeWith({ gated: true });
    const empty = homeWith({ gated: false });

    const verdict = rulingGateDoor({
      argv: ["node", "cli", "slack", "post", "--text", `--home=${empty}`],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(true);
  });

  it("adds the gates an argv home holds, so a test driving --home is still judged", () => {
    const home = homeWith({ gated: false });
    const gatedArgvHome = homeWith({ gated: true });

    const verdict = rulingGateDoor({
      argv: ["node", "cli", "slack", "post", "--home", gatedArgvHome],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(true);
  });

  it("prints one refusal when the same ruling stands in both homes", () => {
    const home = homeWith({ gated: true });
    const alsoGated = homeWith({ gated: true });
    const argv = ["node", "cli", "slack", "post"];

    const both = rulingGateDoor({
      argv: [...argv, "--home", alsoGated],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });
    const one = rulingGateDoor({ argv, home, noun: "slack", nowIso: NOW, verb: "post" });

    expect(one.refuse).toBe(true);
    expect(both.lines).toEqual(one.lines);
  });

  it("keeps BOTH of two different gates that share an id, so the argv home cannot overwrite one", () => {
    const home = homeWith({ gated: true });
    const otherWords = homeWith({ gated: true, holding: sameIdOtherWords });

    const verdict = rulingGateDoor({
      argv: ["node", "cli", "slack", "post", "--home", otherWords],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(sameIdOtherWords[0]!.id).toBe(gates[0]!.id);
    expect(verdict.lines.join("\n")).toContain("post only what someone has asked for");
    expect(verdict.lines.join("\n")).toContain("no unasked posts to a channel");
  });

  it("still refuses on the environment's gate when the argv home's projection is unreadable", () => {
    const home = homeWith({ gated: true });
    const corrupt = homeWith({ gated: false });
    writeFileSync(stateHomePaths({ home: corrupt }).rulingGatesJson, "{ truncated", "utf8");

    const verdict = rulingGateDoor({
      argv: ["node", "cli", "slack", "post", "--home", corrupt],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict.refuse).toBe(true);
  });

  it("lets the verb run when neither home holds a ruling", () => {
    const home = homeWith({ gated: false });
    const empty = homeWith({ gated: false });

    const verdict = rulingGateDoor({
      argv: ["node", "cli", "slack", "post", "--home", empty],
      home,
      noun: "slack",
      nowIso: NOW,
      verb: "post",
    });

    expect(verdict).toEqual({ lines: [], refuse: false });
  });
});

describe("readGatesForHomes", () => {
  it("unions every home's gates and folds an identical one projected into two", () => {
    const home = homeWith({ gated: true });
    const alsoGated = homeWith({ gated: true });
    const otherWords = homeWith({ gated: true, holding: sameIdOtherWords });

    const read = readGatesForHomes({ homes: [home, alsoGated, otherWords] });

    expect(read.map((gate) => gate.words)).toEqual([
      "post only what someone has asked for",
      "no unasked posts to a channel",
    ]);
  });

  it("reads nothing from homes with no projection", () => {
    expect(readGatesForHomes({ homes: [homeWith({ gated: false })] })).toEqual([]);
  });
});

describe("distinctGateHomes", () => {
  it("opens one home ONCE however it is spelled: absolute, relative, trailing slash", () => {
    const home = homeWith({ gated: true });
    const other = homeWith({ gated: false });

    const homes = distinctGateHomes({ homes: [home, relative(process.cwd(), home), `${home}/`, other] });

    expect(homes).toEqual([home, other]);
  });

  it("resolves an empty home to the working directory, where the projection path built from it lands", () => {
    expect(distinctGateHomes({ homes: ["", process.cwd()] })).toEqual([process.cwd()]);
  });
});

describe("refuseRunnerOnStandingRuling — the gate a verb body asks when it is called in-process", () => {
  it("refuses a gated verb when the gate stands in a home its words name", () => {
    const gated = homeWith({ gated: true });

    expect(refuseRunnerOnStandingRuling({ noun: "slack", rest: ["--home", gated], verb: "post" })).toBe(EXIT_ERROR);
  });

  it("lets the same verb through when no home it reads holds a gate", () => {
    const empty = homeWith({ gated: false });

    expect(refuseRunnerOnStandingRuling({ noun: "slack", rest: ["--home", empty], verb: "post" })).toBe(undefined);
  });

  it("lets a sibling verb through under the same gate", () => {
    const gated = homeWith({ gated: true });

    expect(refuseRunnerOnStandingRuling({ noun: "slack", rest: ["--home", gated], verb: "reply" })).toBe(undefined);
  });

  it("gates a help-looking word too, since a body never answers help and `-h` may be a flag's value", () => {
    const gated = homeWith({ gated: true });
    const valued = ["--home", gated, "--no-picture-because", "-h"];

    expect(refuseRunnerOnStandingRuling({ noun: "slack", rest: valued, verb: "post" })).toBe(EXIT_ERROR);
    expect(refuseRunnerOnStandingRuling({ noun: "slack", rest: ["--home", gated, "--help"], verb: "post" })).toBe(
      EXIT_ERROR,
    );
  });
});

describe("withCallerGateHomes — a caller's home reaches a body handed no --home", () => {
  it("refuses inside the caller's homes and lets the same words through outside them", () => {
    const gated = homeWith({ gated: true });

    const inside = withCallerGateHomes({
      homes: [gated],
      run: () => refuseRunnerOnStandingRuling({ noun: "slack", rest: [], verb: "post" }),
    });
    const outside = refuseRunnerOnStandingRuling({ noun: "slack", rest: [], verb: "post" });

    expect([inside, outside]).toEqual([EXIT_ERROR, undefined]);
  });

  it("carries the homes across an await, where an in-process verb body actually runs", async () => {
    const gated = homeWith({ gated: true });

    const code = await withCallerGateHomes({
      homes: [gated],
      run: async () => {
        await Promise.resolve();
        return refuseRunnerOnStandingRuling({ noun: "slack", rest: [], verb: "post" });
      },
    });

    expect(code).toBe(EXIT_ERROR);
  });

  it("keeps the outer caller's homes under a nested one, so a nested home only adds", () => {
    const gated = homeWith({ gated: true });
    const empty = homeWith({ gated: false });

    const code = withCallerGateHomes({
      homes: [gated],
      run: () =>
        withCallerGateHomes({
          homes: [empty],
          run: () => refuseRunnerOnStandingRuling({ noun: "slack", rest: [], verb: "post" }),
        }),
    });

    expect(code).toBe(EXIT_ERROR);
  });

  it("keeps a home its caller's own array later drops, since the store holds a copy", () => {
    const gated = homeWith({ gated: true });
    const empty = homeWith({ gated: false });
    const homes = [gated];

    const code = withCallerGateHomes({
      homes,
      run: () => {
        homes.length = 0;
        return withCallerGateHomes({
          homes: [empty],
          run: () => refuseRunnerOnStandingRuling({ noun: "slack", rest: [], verb: "post" }),
        });
      },
    });

    expect(code).toBe(EXIT_ERROR);
  });
});
