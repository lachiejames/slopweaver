/**
 * `slopweaver handover gate` — the runner's own argument handling and the two sub-verbs that touch a real
 * projection on disk.
 *
 * The whole seam against the shipped binary is `../../subprocess/handover/rulingGate.test.ts`. What this file
 * holds down is the part that is cheap to break and invisible there: a sub-verb dropped from the dispatch, an
 * argument check that stops refusing, and a `release` that reports success without a gate behind it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HANDOVER_GATE_FLAG_NAMES,
  HANDOVER_GATE_USAGE,
  runHandoverGate,
} from "../../../cli/commands/handover/gateRun.js";
import { handoverManifest } from "../../../cli/manifests/handover.js";
import { handoverRulingManifest } from "../../../cli/manifests/handoverRulings.js";
import { renderRulingGateIndex } from "../../../handover/rulingGateIndex.js";
import { stateHomePaths } from "../../../stateHome.js";

const PLACED = "2026-09-21T03:01:34.000Z";
const NOW = "2026-09-21T05:35:28.000Z";
const GATE_ID = `a-row#${PLACED}`;

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home, optionally carrying one projected gate and no journal behind it. */
function stateHome({ projected }: { projected: boolean }): string {
  const home = mkdtempSync(join(tmpdir(), "sw-gate-run-"));
  homes.push(home);
  const paths = stateHomePaths({ home });
  mkdirSync(paths.runs, { recursive: true });
  if (projected) {
    writeFileSync(
      paths.rulingGatesJson,
      renderRulingGateIndex({
        builtAtIso: PLACED,
        gates: [
          {
            anchor: "transcript:a0000036#a0000064",
            id: GATE_ID,
            placedIso: PLACED,
            slug: "a-row",
            subjects: [],
            verbs: [{ noun: "slack", verb: "post" }],
            words: "stop posting shit that no one is asking for",
          },
        ],
      }),
      "utf8",
    );
  }
  return home;
}

/** The argv the CLI hands a verb: `[node, cli, noun, verb, …]`. */
function argvFor({ args, home }: { args: readonly string[]; home: string }): readonly string[] {
  return ["node", "cli", "handover", "gate", ...args, "--home", home, "--now", NOW];
}

describe("the flag and usage surface", () => {
  it("declares every flag it parses, sorted and `--`-prefixed for the help-truth ratchet", () => {
    expect(HANDOVER_GATE_FLAG_NAMES).toEqual(["--anchor", "--home", "--now", "--words"]);
  });

  it("names all four sub-verbs in its usage, so a caller can see the whole surface", () => {
    expect(HANDOVER_GATE_USAGE).toContain("list|rebuild|check");
    expect(HANDOVER_GATE_USAGE).toContain("release <gate-id>");
  });
});

describe("runHandoverGate argument handling", () => {
  it("answers --help on stdout and exits 0", () => {
    expect(runHandoverGate(["node", "cli", "handover", "gate", "--help"])).toBe(0);
  });

  it("refuses a missing sub-verb as a caller mistake", () => {
    const home = stateHome({ projected: false });

    expect(runHandoverGate(argvFor({ args: [], home }))).toBe(2);
  });

  it("refuses an unknown sub-verb rather than silently listing", () => {
    const home = stateHome({ projected: false });

    expect(runHandoverGate(argvFor({ args: ["lift"], home }))).toBe(2);
  });

  it("refuses a --now that is not an instant", () => {
    const home = stateHome({ projected: false });

    expect(runHandoverGate(["node", "cli", "handover", "gate", "list", "--home", home, "--now", "soon"])).toBe(2);
  });

  it("refuses a loose --now spelling Date.parse would read as the wrong year", () => {
    const home = stateHome({ projected: false });
    const loose = "0001-01-01 00:00:00.000Z";

    expect(Date.parse(loose)).toBe(Date.parse("2001-01-01T00:00:00.000Z"));
    expect(runHandoverGate(["node", "cli", "handover", "gate", "list", "--home", home, "--now", loose])).toBe(2);
    expect(runHandoverGate(["node", "cli", "handover", "gate", "list", "--home", home, "--now", NOW])).toBe(0);
  });

  it("refuses a release naming no gate id", () => {
    const home = stateHome({ projected: true });

    expect(runHandoverGate(argvFor({ args: ["release", "--anchor", "a", "--words", "ok"], home }))).toBe(2);
  });

  it("refuses a release with no anchor — a lift is anchored exactly as a placement is", () => {
    const home = stateHome({ projected: true });

    expect(runHandoverGate(argvFor({ args: ["release", GATE_ID, "--words", "ok"], home }))).toBe(2);
  });

  it("refuses a release with no words, since a release is itself a ruling", () => {
    const home = stateHome({ projected: true });

    expect(runHandoverGate(argvFor({ args: ["release", GATE_ID, "--anchor", "a"], home }))).toBe(2);
  });

  it("refuses a release of an id no journal holds", () => {
    const home = stateHome({ projected: true });

    const code = runHandoverGate(argvFor({ args: ["release", GATE_ID, "--anchor", "a", "--words", "ok"], home }));

    expect(code).toBe(1);
  });
});

describe("the sub-verbs that read the projection", () => {
  it("lists an empty home without failing — nothing standing is not an error", () => {
    const home = stateHome({ projected: false });

    expect(runHandoverGate(argvFor({ args: ["list"], home }))).toBe(0);
  });

  it("lists a projected gate", () => {
    const home = stateHome({ projected: true });

    expect(runHandoverGate(argvFor({ args: ["list"], home }))).toBe(0);
  });

  it("rebuilds an empty projection and then agrees with itself", () => {
    const home = stateHome({ projected: false });

    expect(runHandoverGate(argvFor({ args: ["rebuild"], home }))).toBe(0);
    expect(runHandoverGate(argvFor({ args: ["check"], home }))).toBe(0);
  });

  it("FAILS check on a projected gate no journal holds, and does not repair it", () => {
    const home = stateHome({ projected: true });

    expect(runHandoverGate(argvFor({ args: ["check"], home }))).toBe(1);
    // Reported, never repaired: the same check still fails, because nothing rewrote the index.
    expect(runHandoverGate(argvFor({ args: ["check"], home }))).toBe(1);
  });
});

describe("the ruling family's manifest", () => {
  it("declares every verb that writes or reads a ruling event, and no second copy of one", () => {
    expect(Object.keys(handoverRulingManifest).toSorted()).toEqual([
      "audit-rulings",
      "backfill-rulings",
      "gate",
      "risk",
      "rule",
    ]);
  });

  it("spells the same invocation lines the verb itself prints, so the eager copy cannot drift", () => {
    // The manifest's `usage` carries extra prose the verb does not print; what must agree is the grammar.
    expect(handoverRulingManifest["gate"]!.meta.usage).toContain("slopweaver handover gate list|rebuild|check");
    expect(handoverRulingManifest["gate"]!.meta.usage).toContain("slopweaver handover gate release <gate-id>");
  });

  it("is folded into the one handover manifest rather than standing beside it", () => {
    expect(Object.keys(handoverManifest)).toContain("gate");
    expect(handoverManifest["gate"]!.meta.usage).toBe(handoverRulingManifest["gate"]!.meta.usage);
  });
});
