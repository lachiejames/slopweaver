/**
 * A tick confined to a scratch `--home`: which tick it is, what each of its readings becomes, the lines it says,
 * and the environment its children get. Every case is pure; the verbs that apply it are covered in
 * `../../cli/commands/supervisor/tick/seatOpen.test.ts` and `../../cli/commands/supervisor/scratchRun.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tickReadings } from "../../../../supervisor/scratch/tickCapture.js";
import {
  confinedChildEnv,
  confinementLines,
  readingsForConfinement,
  type TickConfinement,
  tickConfinement,
} from "../../../../supervisor/scratch/tickConfinement.js";

/** Every reading a tick can run: the seat's, the fleet's, a landing repository's and a bump drive's. */
const EVERY_READING = tickReadings({
  bumpDriveRepos: ["acme/widgets"],
  landingRepos: ["acme/widgets"],
  loopSessionKey: "loop-a",
});

const CONFINED: TickConfinement = { ambientHome: "/ambient/home", home: "/scratch/home", kind: "confined" };

describe("tickConfinement", () => {
  it("is ambient with no --home", () => {
    expect(tickConfinement({ ambientHome: "/ambient/home", home: undefined })).toEqual({
      home: "/ambient/home",
      kind: "ambient",
    });
  });

  it("is ambient when --home names the ambient home, however it is spelled", () => {
    expect(tickConfinement({ ambientHome: "/ambient/home", home: "/ambient/./x/../home/" })).toEqual({
      home: "/ambient/home",
      kind: "ambient",
    });
  });

  it("is confined to any other --home, resolved", () => {
    expect(tickConfinement({ ambientHome: "/ambient/home", home: "/scratch/./home" })).toEqual(CONFINED);
  });
});

describe("every reading a tick runs carries a confined disposition", () => {
  it("covers the whole set: each one is kept, rehearsed or withheld, and nothing is lost between them", () => {
    expect(EVERY_READING.length).toBeGreaterThan(0);
    const plan = readingsForConfinement({ confinement: CONFINED, readings: EVERY_READING });
    const accounted = [...plan.readings.map((reading) => reading.name), ...plan.withheld.map((row) => row.name)];
    expect(accounted.toSorted()).toEqual(EVERY_READING.map((reading) => reading.name).toSorted());
    expect(
      EVERY_READING.filter((reading) => !["keep", "rehearse", "withhold"].includes(reading.confined.kind)),
    ).toEqual([]);
  });

  it("never keeps a reading that fires: every --fire is rehearsed or withheld", () => {
    expect(
      EVERY_READING.filter((reading) => reading.argv.includes("--fire") && reading.confined.kind === "keep").map(
        (reading) => reading.name,
      ),
    ).toEqual([]);
  });

  it("rehearses only a reading that has a --fire to drop", () => {
    expect(
      EVERY_READING.filter((reading) => reading.confined.kind === "rehearse" && !reading.argv.includes("--fire")).map(
        (reading) => reading.name,
      ),
    ).toEqual([]);
  });

  it("withholds exactly the readings that act on the world or read the owner's live state", () => {
    const plan = readingsForConfinement({ confinement: CONFINED, readings: EVERY_READING });
    expect(plan.withheld.map((row) => row.name)).toEqual([
      "events",
      "close-done",
      "handover-wake",
      "turn-dispatch-sweep",
      "codex-reset-at-limit",
      "gauge",
      "gauge-report",
      "codex-route",
      "queue-refusals",
      "hand-recheck",
      "queue-stopping",
      "org-health-read",
      "snooze-wake",
      "landing",
      "landing-drafts",
      "bump-drive-acme-widgets",
    ]);
  });
});

describe("readingsForConfinement", () => {
  it("hands an ambient tick its readings untouched — the same list", () => {
    const plan = readingsForConfinement({
      confinement: { home: "/ambient/home", kind: "ambient" },
      readings: EVERY_READING,
    });
    expect(plan.readings).toBe(EVERY_READING);
    expect(plan.withheld).toEqual([]);
    expect(plan.rehearsed).toEqual([]);
  });

  it("drops only --fire from a rehearsed monitor, keeping its order and every other word", () => {
    const plan = readingsForConfinement({ confinement: CONFINED, readings: EVERY_READING });
    expect(plan.readings.find((reading) => reading.name === "fleet-health")!.argv).toEqual([
      "monitor",
      "check",
      "--only",
      "fleet-unhealthy",
      "--by-session",
      "supervisor",
      "--json",
    ]);
    expect(plan.rehearsed).toContain("fleet-health");
  });

  it("keeps a read-only reading exactly as declared", () => {
    const plan = readingsForConfinement({ confinement: CONFINED, readings: EVERY_READING });
    const declared = EVERY_READING.find((reading) => reading.name === "reconcile")!;
    expect(plan.readings.find((reading) => reading.name === "reconcile")).toBe(declared);
  });
});

describe("confinementLines", () => {
  it("says nothing for an ambient tick", () => {
    const confinement: TickConfinement = { home: "/ambient/home", kind: "ambient" };
    expect(
      confinementLines({ confinement, plan: readingsForConfinement({ confinement, readings: EVERY_READING }) }),
    ).toEqual([]);
  });

  it("opens on the home every child ran under, then names each withheld reading and why", () => {
    const plan = readingsForConfinement({
      confinement: CONFINED,
      readings: EVERY_READING.filter((reading) => ["events", "reconcile"].includes(reading.name)),
    });
    expect(confinementLines({ confinement: CONFINED, plan })).toEqual([
      "CONFINED tick: every reading ran with SLOPWEAVER_HOME=/scratch/home, not the ambient /ambient/home",
      "withheld events: it advances the chair's own events cursor",
    ]);
  });

  it("lists the rehearsed monitors on one line", () => {
    const plan = readingsForConfinement({
      confinement: CONFINED,
      readings: EVERY_READING.filter((reading) => ["fleet-health", "org-health"].includes(reading.name)),
    });
    expect(confinementLines({ confinement: CONFINED, plan }).at(-1)).toBe(
      "rehearsed without --fire (no card, no note): fleet-health, org-health",
    );
  });
});

describe("confinedChildEnv", () => {
  it("hands an ambient tick's children no environment, so they keep the launcher default", () => {
    expect(
      confinedChildEnv({ base: { PATH: "/bin" }, confinement: { home: "/ambient/home", kind: "ambient" } }),
    ).toBeUndefined();
  });

  it("replaces the state home in a confined tick's environment, keeping the rest", () => {
    expect(
      confinedChildEnv({ base: { PATH: "/bin", SLOPWEAVER_HOME: "/ambient/home" }, confinement: CONFINED }),
    ).toEqual({ PATH: "/bin", SLOPWEAVER_HOME: "/scratch/home" });
  });
});
