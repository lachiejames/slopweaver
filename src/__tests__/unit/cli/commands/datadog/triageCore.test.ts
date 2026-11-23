import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { client } from "@datadog/datadog-api-client";
import { describe, expect, it } from "vitest";

import { DEFAULT_GATES } from "../../../../../admit/door.js";
import type { DoorLedgerPort } from "../../../../../admit/doorLedgerPort.js";
import type { DoorGate } from "../../../../../admit/types.js";
import { DatadogArgsErrors } from "../../../../../cli/commands/datadog/errors.js";
import {
  type DatadogTriageOptions,
  parseDatadogTriageOptions,
  triagePlanLines,
  triageStateLines,
} from "../../../../../cli/commands/datadog/triageCore.js";
import {
  datadogTriageCommand,
  runDatadogTriage,
  runTriage,
  type TriageReport,
  triageDoorRequestFor,
} from "../../../../../cli/commands/datadog/triageRun.js";
import { DATADOG_TRIAGE_USAGE } from "../../../../../cli/commands/datadog/usage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { datadogManifest } from "../../../../../cli/manifests/datadog.js";
import type { ErrorTrackingState } from "../../../../../datadog/errorTracking.js";
import { planTriage, type TriageApi, type TriageTargetState } from "../../../../../datadog/errorTrackingTriage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

const DUPLICATE = "6d6d6d6d-4444-4444-8444-444444444444";
const GRAPHQL = "cbcbcbcb-5555-4555-a555-555555555555";

describe("parseDatadogTriageOptions", () => {
  it("collects ids across repeated and comma-separated --issue, and reads the console's word for the state", () => {
    const options = parseDatadogTriageOptions({
      rest: ["--issue", `${DUPLICATE},${GRAPHQL}`, "--issue", DUPLICATE, "--state", "reviewed", "--dry-run"],
    });
    expect(unwrap(options)).toEqual({
      dryRun: true,
      home: undefined,
      issues: [DUPLICATE, GRAPHQL, DUPLICATE],
      json: false,
      state: "ACKNOWLEDGED",
    });
  });

  it("reads for-review, ignored and resolved, and the API's own names", () => {
    const states = ["for-review", "ignored", "resolved", "IGNORED"].map(
      (state) => unwrap(parseDatadogTriageOptions({ rest: ["--issue", DUPLICATE, "--state", state] })).state,
    );
    expect(states).toEqual(["OPEN", "IGNORED", "RESOLVED", "IGNORED"]);
  });

  it("refuses a missing --issue and a missing --state together", () => {
    expect(unwrapErr(parseDatadogTriageOptions({ rest: [] }))).toEqual(
      DatadogArgsErrors.optionsRefused({
        reasons: [
          "--issue is required: one or more Error Tracking issue ids, comma-separated or repeated",
          "--state is required: one of reviewed, ignored, resolved, for-review",
        ],
      }),
    );
  });

  it("refuses excluded, which stops collection and changes billing and so is never a triage's call", () => {
    const error = unwrapErr(parseDatadogTriageOptions({ rest: ["--issue", DUPLICATE, "--state", "excluded"] }));
    expect(error.message).toBe(
      "--state 'excluded' is not one a triage moves into — one of reviewed, ignored, resolved, for-review",
    );
  });

  it("refuses an empty comma member rather than silently dropping it", () => {
    const error = unwrapErr(parseDatadogTriageOptions({ rest: ["--issue", `${DUPLICATE},`, "--state", "ignored"] }));
    expect(error).toEqual(
      DatadogArgsErrors.optionsRefused({
        reasons: ["--issue carries an empty member — every comma-separated entry must be an issue id"],
      }),
    );
  });

  it("refuses an --issue given no value", () => {
    const error = unwrapErr(parseDatadogTriageOptions({ rest: ["--state", "ignored", "--issue"] }));
    expect(error).toEqual(
      DatadogArgsErrors.optionsRefused({
        reasons: ["--issue was given without a value — pass one or more issue ids after each --issue"],
      }),
    );
  });

  it("reads --issue=ID, and refuses an empty --issue=", () => {
    expect(unwrap(parseDatadogTriageOptions({ rest: [`--issue=${DUPLICATE}`, "--state", "ignored"] })).issues).toEqual([
      DUPLICATE,
    ]);
    const error = unwrapErr(parseDatadogTriageOptions({ rest: ["--issue=", "--state", "ignored"] }));
    expect(error).toEqual(
      DatadogArgsErrors.optionsRefused({
        reasons: ["--issue carries an empty member — every comma-separated entry must be an issue id"],
      }),
    );
  });

  it("refuses an unknown flag through the tokeniser", () => {
    const error = unwrapErr(
      parseDatadogTriageOptions({ rest: ["--issue", DUPLICATE, "--state", "ignored", "--reason", "noise"] }),
    );
    expect(error.code).toBe("FLAGS_INVALID");
  });
});

describe("triagePlanLines", () => {
  it("names each move from its state before to the target, and counts what is already there", () => {
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "ACKNOWLEDGED" },
      ],
      target: "ACKNOWLEDGED",
    });
    expect(triagePlanLines({ plan, verb: "would move" })).toEqual([
      "would move 1 issue(s) to Reviewed; 1 already Reviewed",
      `  ${DUPLICATE}  For Review → Reviewed`,
    ]);
  });
});

describe("triageStateLines", () => {
  it("prints one line per issue in the console's words", () => {
    expect(triageStateLines({ rows: [{ id: DUPLICATE, state: "IGNORED" }] })).toEqual([`Ignored     ${DUPLICATE}`]);
  });
});

describe("triageDoorRequestFor", () => {
  it("is an external write that names only the issues moved and the target state", () => {
    const plan = planTriage({
      rows: [
        { id: DUPLICATE, state: "OPEN" },
        { id: GRAPHQL, state: "IGNORED" },
      ],
      target: "IGNORED",
    });
    expect(triageDoorRequestFor({ home: "/tmp/home", plan })).toEqual({
      action: { kind: "verb", noun: "datadog", verb: "triage" },
      artifact: { issues: [DUPLICATE], state: "IGNORED" },
      meta: { createsWorkItem: false, effect: "external-write", home: "/tmp/home", requiresApproval: false },
    });
  });
});

describe("the datadog triage manifest entry", () => {
  it("is door-routed as an external write and quotes the usage the verb prints", () => {
    const meta = datadogManifest["triage"]!.meta;
    expect(meta.effect).toBe("external-write");
    expect(meta.doorRouted).toBe(true);
    expect(meta.usage).toBe(DATADOG_TRIAGE_USAGE);
  });

  it("loads the command the runner module exports", async () => {
    expect(await datadogManifest["triage"]!.load()).toBe(datadogTriageCommand);
  });
});

/**
 * A fake Error Tracking over a state map. `refuse` throws a 403 on that issue's move, `sticky` accepts the
 * move and changes nothing, `lost` applies the move and then throws, `unreadableAfter` makes every lookup
 * past that many throw a 500, and `onGet` runs before each lookup answers, so a test can change an issue
 * outside the run.
 */
function fakeApi({
  states,
  refuse = [],
  sticky = [],
  lost = [],
  unreadableAfter = Number.POSITIVE_INFINITY,
  onGet = () => undefined,
}: {
  states: Readonly<Record<string, ErrorTrackingState>>;
  refuse?: readonly string[];
  sticky?: readonly string[];
  lost?: readonly string[];
  unreadableAfter?: number;
  onGet?: (request: { id: string; live: Map<string, ErrorTrackingState>; reads: number }) => void;
}): { api: TriageApi; puts: string[] } {
  const live = new Map(Object.entries(states));
  const puts: string[] = [];
  let reads = 0;
  return {
    api: {
      get: ({ id }) => {
        reads += 1;
        onGet({ id, live, reads });
        if (reads > unreadableAfter) {
          return Promise.reject(new client.ApiException(500, { errors: ["Internal"] }));
        }
        const state = live.get(id);
        if (state === undefined) {
          return Promise.resolve({ found: false });
        }
        return Promise.resolve({ found: true, state });
      },
      setState: ({ id, state }) => {
        if (refuse.includes(id)) {
          return Promise.reject(new client.ApiException(403, { errors: ["Forbidden"] }));
        }
        puts.push(id);
        if (!sticky.includes(id)) {
          live.set(id, state);
        }
        if (lost.includes(id)) {
          return Promise.reject(new Error("socket hang up"));
        }
        return Promise.resolve();
      },
    },
    puts,
  };
}

/** A gate that holds every request, the way the profile-load gate holds an unloaded session's write. */
const HOLD_ALL: DoorGate = () => [
  { code: "TEST_HOLD", correction: "nothing — a test hold", severity: "hold", summary: "held by the test's gate" },
];

/** The parsed invocation a test runs, `--json` on so the one document is what gets asserted. */
function optionsFor({ state, dryRun = false }: { state: TriageTargetState; dryRun?: boolean }): DatadogTriageOptions {
  return { dryRun, home: undefined, issues: [], json: true, state };
}

/** Run one triage against a fake and a real temp home, returning the exit code and the one JSON document. */
async function runAgainst({
  api,
  ids,
  options,
  gates = DEFAULT_GATES,
  ledger = memoryDoorLedger().port,
}: {
  api: TriageApi;
  ids: readonly string[];
  options: DatadogTriageOptions;
  gates?: readonly DoorGate[];
  ledger?: DoorLedgerPort;
}): Promise<{ code: number; report: TriageReport }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-dd-triage-"));
  const lines: string[] = [];
  try {
    const code = await runTriage({
      api,
      gates,
      home,
      ids,
      ledger,
      options,
      print: ({ line }) => {
        lines.push(line);
      },
    });
    expect(lines).toHaveLength(1);
    return { code, report: JSON.parse(lines[0]!) as TriageReport };
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
}

describe("runTriage", () => {
  it("moves what is elsewhere, leaves what is there, and reports the read-back", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "ACKNOWLEDGED" } });
    const { code, report } = await runAgainst({
      api,
      ids: [DUPLICATE, GRAPHQL],
      options: optionsFor({ state: "ACKNOWLEDGED" }),
    });
    expect(code).toBe(EXIT_OK);
    expect(puts).toEqual([DUPLICATE]);
    expect(report).toEqual({
      dryRun: false,
      error: null,
      issues: [
        { id: DUPLICATE, state: "ACKNOWLEDGED" },
        { id: GRAPHQL, state: "ACKNOWLEDGED" },
      ],
      moved: [DUPLICATE],
      plan: { alreadyThere: [GRAPHQL], target: "ACKNOWLEDGED", toMove: [{ id: DUPLICATE, state: "OPEN" }] },
      uncertain: [],
    });
  });

  it("sends nothing when every issue is already there, and still reads back", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "IGNORED" } });
    const { code, report } = await runAgainst({ api, ids: [DUPLICATE], options: optionsFor({ state: "IGNORED" }) });
    expect(code).toBe(EXIT_OK);
    expect(puts).toEqual([]);
    expect(report.moved).toEqual([]);
    expect(report.issues).toEqual([{ id: DUPLICATE, state: "IGNORED" }]);
  });

  it("a dry run plans and sends nothing", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "OPEN" } });
    const { code, report } = await runAgainst({
      api,
      ids: [DUPLICATE],
      options: optionsFor({ dryRun: true, state: "IGNORED" }),
    });
    expect(code).toBe(EXIT_OK);
    expect(puts).toEqual([]);
    expect(report).toEqual({
      dryRun: true,
      error: null,
      issues: null,
      moved: [],
      plan: { alreadyThere: [], target: "IGNORED", toMove: [{ id: DUPLICATE, state: "OPEN" }] },
      uncertain: [],
    });
  });

  it("a door refusal still prints the one report, naming the plan and the door's findings", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "OPEN" } });
    const { code, report } = await runAgainst({
      api,
      gates: [HOLD_ALL],
      ids: [DUPLICATE],
      options: optionsFor({ state: "IGNORED" }),
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(puts).toEqual([]);
    expect(report.moved).toEqual([]);
    expect(report.plan).toEqual({ alreadyThere: [], target: "IGNORED", toMove: [{ id: DUPLICATE, state: "OPEN" }] });
    expect(report.error!.code).toBe("DOOR_REFUSED");
    expect(report.error!.findings.map((finding) => finding.code)).toEqual(["TEST_HOLD"]);
    expect(report.error!.message).toContain("held by the test's gate");
  });

  it("a store that cannot record the decision sends nothing and reports a store error, not a door refusal", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "OPEN" } });
    const { code, report } = await runAgainst({
      api,
      ids: [DUPLICATE],
      ledger: unreachableDoorLedger(),
      options: optionsFor({ state: "IGNORED" }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(puts).toEqual([]);
    expect(report.moved).toEqual([]);
    expect(report.error!.code).toBe("DOOR_STORE_UNAVAILABLE");
    expect(report.error!.message).toContain("fixture: the store is down");
  });

  it("an accepted move whose read straight after fails is reported uncertain", async () => {
    // Reads: the plan's, the pre-move one, then the after-read fails.
    const { api } = fakeApi({ states: { [DUPLICATE]: "OPEN" }, unreadableAfter: 2 });
    const { code, report } = await runAgainst({ api, ids: [DUPLICATE], options: optionsFor({ state: "IGNORED" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(report.moved).toEqual([]);
    expect(report.uncertain).toEqual([DUPLICATE]);
    expect(report.error!.code).toBe("UPDATE_UNCONFIRMED");
  });

  it("in text, a door refusal follows the PLAN, never a line saying the issue is being moved", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "OPEN" } });
    const home = mkdtempSync(join(tmpdir(), "slopweaver-dd-triage-"));
    const lines: string[] = [];
    try {
      const code = await runTriage({
        api,
        gates: [HOLD_ALL],
        home,
        ids: [DUPLICATE],
        ledger: memoryDoorLedger().port,
        options: { ...optionsFor({ state: "IGNORED" }), json: false },
        print: ({ line }) => {
          lines.push(line);
        },
      });
      expect(code).toBe(EXIT_EXPECTED_EMPTY);
      expect(puts).toEqual([]);
      expect(lines.slice(0, 2)).toEqual([
        "plan: move 1 issue(s) to Ignored; 0 already Ignored",
        `  ${DUPLICATE}  For Review → Ignored`,
      ]);
      expect(lines.filter((line) => line.startsWith("moving"))).toEqual([]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("a move whose answer was lost is uncertain even though it applied", async () => {
    const { api } = fakeApi({ lost: [DUPLICATE], states: { [DUPLICATE]: "OPEN" } });
    const { code, report } = await runAgainst({ api, ids: [DUPLICATE], options: optionsFor({ state: "IGNORED" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(report.moved).toEqual([]);
    expect(report.uncertain).toEqual([DUPLICATE]);
    expect(report.error!.code).toBe("UPDATE_UNCONFIRMED");
  });

  it("an unknown issue refuses the whole run before anything is sent", async () => {
    const { api, puts } = fakeApi({ states: { [DUPLICATE]: "OPEN" } });
    const { code, report } = await runAgainst({
      api,
      ids: [DUPLICATE, GRAPHQL],
      options: optionsFor({ state: "IGNORED" }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(puts).toEqual([]);
    expect(report.plan).toBeNull();
    expect(report.moved).toEqual([]);
    expect(report.error!.code).toBe("ISSUE_UNKNOWN");
  });

  it("a refused move part-way names the issues already moved as the receipt", async () => {
    const { api, puts } = fakeApi({ refuse: [GRAPHQL], states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN" } });
    const { code, report } = await runAgainst({
      api,
      ids: [DUPLICATE, GRAPHQL],
      options: optionsFor({ state: "IGNORED" }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(puts).toEqual([DUPLICATE]);
    expect(report.moved).toEqual([DUPLICATE]);
    expect(report.error!.code).toBe("UPDATE_REJECTED");
    expect(report.issues).toBeNull();
  });

  it("a failed read-back still names what was moved", async () => {
    // Two plan reads, a read before and after each of two moves, then the read-back fails.
    const { api } = fakeApi({ states: { [DUPLICATE]: "OPEN", [GRAPHQL]: "OPEN" }, unreadableAfter: 6 });
    const { code, report } = await runAgainst({
      api,
      ids: [DUPLICATE, GRAPHQL],
      options: optionsFor({ state: "IGNORED" }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(report.moved).toEqual([DUPLICATE, GRAPHQL]);
    expect(report.error!.code).toBe("READ_FAILED");
  });

  it("an accepted move read back where the plan left it exits 1 as uncertain, never as untouched", async () => {
    const { api } = fakeApi({ states: { [DUPLICATE]: "OPEN" }, sticky: [DUPLICATE] });
    const { code, report } = await runAgainst({ api, ids: [DUPLICATE], options: optionsFor({ state: "RESOLVED" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(report.moved).toEqual([]);
    expect(report.uncertain).toEqual([DUPLICATE]);
    expect(report.error!.code).toBe("UPDATE_UNCONFIRMED");
  });

  it("an issue that leaves the target state before the read-back exits 1, named by the read-back", async () => {
    const { api } = fakeApi({
      // Reads: the plan's, before the move, after it, then the read-back — moved back just before that one.
      onGet: ({ id, live, reads }) => {
        if (reads === 4) {
          live.set(id, "OPEN");
        }
      },
      states: { [DUPLICATE]: "OPEN" },
    });
    const { code, report } = await runAgainst({ api, ids: [DUPLICATE], options: optionsFor({ state: "RESOLVED" }) });
    expect(code).toBe(EXIT_ERROR);
    expect(report.moved).toEqual([DUPLICATE]);
    expect(report.issues).toEqual([{ id: DUPLICATE, state: "OPEN" }]);
    expect(report.error!.code).toBe("NOT_MOVED_AFTER_UPDATE");
  });
});

describe("runDatadogTriage, before any credential or network", () => {
  it("--help prints usage and exits EXIT_OK", async () => {
    expect(await runDatadogTriage(["node", "slopweaver", "datadog", "triage", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an id that is not an issue id with EXIT_USAGE", async () => {
    const argv = ["node", "slopweaver", "datadog", "triage", "--issue", "6d6d6d6d", "--state", "ignored"];
    expect(await runDatadogTriage(argv)).toBe(EXIT_USAGE);
  });
});
