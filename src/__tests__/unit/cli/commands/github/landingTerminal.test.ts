import { describe, expect, it } from "vitest";

import type { GithubLandingArgs } from "../../../../../cli/commands/github/landingCore.js";
import { landingFacts } from "../../../../../cli/commands/github/landingFacts.js";
import {
  type LandingDocument,
  landingDocument,
  landingTable,
} from "../../../../../cli/commands/github/landingReport.js";
import { reportLanding } from "../../../../../cli/commands/github/landingTerminal.js";
import type { LandingRow, LandingTally } from "../../../../../review/landing.js";
import type { ReadCadence } from "../../../../../review/readJournal.js";
import { landingRowFake } from "../../../../landingRowFake.js";

const TALLY: LandingTally = {
  advisoryRedBypassed: 0,
  byAction: [{ action: "press", count: 1 }],
  byDispatch: [{ count: 1, verdict: "merge-now" }],
  ready: 1,
  total: 1,
};

const ARGS: GithubLandingArgs = {
  author: undefined,
  authoredByOwner: false,
  cadenceMinutes: 30,
  draftsOnly: false,
  dryRun: false,
  full: false,
  home: undefined,
  ifDue: false,
  includeDrafts: false,
  json: false,
  limit: 50,
  optOutLabels: [],
  pr: undefined,
  press: false,
  recordReadingBy: undefined,
  register: false,
  repos: ["acme/widgets"],
  slackLive: false,
};

const CADENCE: ReadCadence = { kind: "due", lastReadAtIso: undefined, why: "no fleet read is recorded" };

/** A document over `rows` with the given residue and nothing else. */
const documentOf = ({
  rows,
  residue = [],
}: {
  rows: readonly LandingRow[];
  residue?: readonly string[];
}): LandingDocument =>
  landingDocument({
    census: [],
    loginSlackIds: {},
    logins: {},
    people: {},
    presses: [],
    residue,
    rows,
    selection: { author: undefined, includeDrafts: false, repos: ["acme/widgets"] },
    tally: TALLY,
  });

/** The two output channels, recorded in order. */
function sinks(): {
  deps: Parameters<typeof reportLanding>[0]["deps"];
  out: string[];
  diagnostics: string[];
} {
  const out: string[] = [];
  const diagnostics: string[] = [];
  return {
    deps: { writeDiagnostic: (line) => diagnostics.push(line), writeOut: (line) => out.push(line) },
    diagnostics,
    out,
  };
}

describe("reportLanding", () => {
  it("prints the fact lines, the tally and the dispatch line by default, and nothing on the diagnostic channel", () => {
    const row = landingRowFake();
    const seam = sinks();
    reportLanding({ args: ARGS, cadence: CADENCE, deps: seam.deps, document: documentOf({ rows: [row] }) });
    expect(seam.out).toStrictEqual([
      "merge-now — 1",
      `  ${landingFacts({ row })}`,
      "1 open · 1 ready · press 1",
      "dispatch: merge-now 1 — 1 to spawn, 0 to card",
    ]);
    expect(seam.diagnostics).toStrictEqual([]);
  });

  it("prints the whole document as one JSON string under --json and nothing else", () => {
    const document = documentOf({ rows: [landingRowFake()], residue: ["a residue line"] });
    const seam = sinks();
    reportLanding({ args: { ...ARGS, json: true }, cadence: CADENCE, deps: seam.deps, document });
    expect(seam.out).toHaveLength(1);
    expect(JSON.parse(seam.out[0]!)).toStrictEqual(JSON.parse(JSON.stringify(document)));
    expect(seam.diagnostics).toStrictEqual([]);
  });

  it("prints the table under --full and every residue line rather than a folded one", () => {
    const row = landingRowFake();
    const seam = sinks();
    reportLanding({
      args: { ...ARGS, full: true },
      cadence: CADENCE,
      deps: seam.deps,
      document: documentOf({ residue: ["first residue", "second residue"], rows: [row] }),
    });
    expect(seam.out).toStrictEqual([
      ...landingTable({ rows: [row] }),
      "1 open · 1 ready · press 1",
      "dispatch: merge-now 1 — 1 to spawn, 0 to card",
    ]);
    expect(seam.diagnostics).toStrictEqual(["first residue", "second residue"]);
  });

  it("folds the residue to one line by default, naming the flags that print it whole", () => {
    const seam = sinks();
    reportLanding({
      args: ARGS,
      cadence: CADENCE,
      deps: seam.deps,
      document: documentOf({ residue: ["first residue", "second residue"], rows: [landingRowFake()] }),
    });
    expect(seam.diagnostics).toStrictEqual([
      "2 residue line(s) folded — rerun with --full, or --pr <n> with one --repo, to read them",
    ]);
  });

  it("names why the read was due on the diagnostic channel under --if-due, ahead of the residue", () => {
    const seam = sinks();
    reportLanding({
      args: { ...ARGS, ifDue: true },
      cadence: { kind: "due", lastReadAtIso: "2026-10-01T00:00:00.000Z", why: "the cadence elapsed" },
      deps: seam.deps,
      document: documentOf({ residue: ["only residue"], rows: [landingRowFake()] }),
    });
    expect(seam.diagnostics).toStrictEqual([
      "landing: read because the cadence elapsed",
      "1 residue line(s) folded — rerun with --full, or --pr <n> with one --repo, to read them",
    ]);
  });

  it("prints a warning line for the owner's pull requests with no walkthrough, and none when the read is not theirs", () => {
    const row = landingRowFake({ threads: [], threadsTruncated: false });
    const owners = sinks();
    reportLanding({
      args: { ...ARGS, authoredByOwner: true },
      cadence: CADENCE,
      deps: owners.deps,
      document: documentOf({ rows: [row] }),
    });
    const others = sinks();
    reportLanding({ args: ARGS, cadence: CADENCE, deps: others.deps, document: documentOf({ rows: [row] }) });
    expect(owners.out).toHaveLength(others.out.length + 1);
    expect(owners.out[4]).toBe(
      "⚠ no self-review walkthrough on 1: acme/widgets#16378. Every pull request of the owner's carries inline notes " +
        "guiding the reviewer — post a round with `slopweaver github pr update --self-review -`",
    );
  });

  it("prints each press and registration outcome after the totals", () => {
    const row = landingRowFake();
    const base = documentOf({ rows: [row] });
    const document: LandingDocument = {
      ...base,
      presses: [
        {
          detail: "queued",
          number: 16378,
          outcome: "pressed",
          repoSlug: "acme/widgets",
          url: "https://github.com/acme/widgets/pull/16378",
        },
      ],
      registrations: [],
    };
    const seam = sinks();
    reportLanding({ args: ARGS, cadence: CADENCE, deps: seam.deps, document });
    expect(seam.out.at(-1)).toBe("pressed: acme/widgets#16378 — queued");
  });
});
