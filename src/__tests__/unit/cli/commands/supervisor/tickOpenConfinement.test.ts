/**
 * `tick open`'s wiring of its confinement: an ambient open runs every reading with no environment of its own and seats
 * as it always has; a confined one runs under its home, withholds what acts, never seats, and opens its output on the
 * confinement lines. The homes are throwaway directories, read by the bump-drive selection and never written.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  confinedOpen,
  openOutputLines,
  seatUnlessConfined,
} from "../../../../../cli/commands/supervisor/tickOpenConfinement.js";

const SEAT: { landingRepos: string[]; loopSessionKey: string } = { landingRepos: [], loopSessionKey: "k" };
const NOW = "2026-09-16T01:00:00.000Z";

let root: string;
let ambient: string;
let scratch: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "open-confinement-"));
  ambient = join(root, "ambient");
  scratch = join(root, "scratch");
  mkdirSync(ambient);
  mkdirSync(scratch);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** The two seams `confinedOpen` reads, over the test's ambient home. */
function deps(): { defaultHome: () => string; scratch: { now: () => string } } {
  return { defaultHome: () => ambient, scratch: { now: () => NOW } };
}

describe("confinedOpen", () => {
  it("leaves an open with no --home ambient: every reading kept, no environment of its own", () => {
    const open = confinedOpen({ deps: deps(), home: undefined, seat: SEAT });
    expect(open.confinement).toEqual({ home: ambient, kind: "ambient" });
    expect(open.env).toBe(undefined);
    expect([open.plan.withheld, open.plan.rehearsed]).toEqual([[], []]);
    expect(open.plan.readings.map((reading) => reading.name)).toContain("events");
  });

  it("confines an open whose --home is another home: its children under it, the cursor and wake withheld", () => {
    const open = confinedOpen({ deps: deps(), home: scratch, seat: SEAT });
    expect(open.confinement).toEqual({ ambientHome: ambient, home: scratch, kind: "confined" });
    expect(open.env!["SLOPWEAVER_HOME"]).toBe(scratch);
    const names = new Set(open.plan.readings.map((reading) => reading.name));
    expect(["events", "handover-wake"].filter((name) => names.has(name))).toEqual([]);
    expect(open.plan.withheld.map((reading) => reading.name)).toContain("events");
    expect(open.plan.rehearsed.length).toBeGreaterThan(0);
  });
});

describe("seatUnlessConfined", () => {
  it("never seats a confined open, and says it withheld the seating", async () => {
    const seated: string[] = [];
    const outcome = await seatUnlessConfined({
      confinement: { ambientHome: ambient, home: scratch, kind: "confined" },
      seat: () => {
        seated.push("seated");
        return Promise.resolve({ actions: [], lines: ["seated"] });
      },
    });
    expect([outcome, seated]).toEqual([
      { actions: [], lines: ["withheld stopped-recipe seating: it registers a board row and runs a real cmux spawn"] },
      [],
    ]);
  });

  it("seats an ambient open exactly as its seating answers", async () => {
    const outcome = await seatUnlessConfined({
      confinement: { home: ambient, kind: "ambient" },
      seat: () => Promise.resolve({ actions: [], lines: ["seated"] }),
    });
    expect(outcome).toEqual({ actions: [], lines: ["seated"] });
  });
});

describe("openOutputLines", () => {
  it("opens a confined open's output on its confinement lines, every line indented", () => {
    const open = confinedOpen({ deps: deps(), home: scratch, seat: SEAT });
    const lines = openOutputLines({ open, rest: ["digest"] });
    expect(lines[0]).toBe(
      `  CONFINED tick: every reading ran with SLOPWEAVER_HOME=${scratch}, not the ambient ${ambient}`,
    );
    expect(lines.at(-1)).toBe("  digest");
  });

  it("prints only the rest for an ambient open", () => {
    const open = confinedOpen({ deps: deps(), home: undefined, seat: SEAT });
    expect(openOutputLines({ open, rest: ["digest", "drive"] })).toEqual(["  digest", "  drive"]);
  });
});
