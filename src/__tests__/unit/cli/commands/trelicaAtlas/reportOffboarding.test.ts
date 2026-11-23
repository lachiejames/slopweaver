/**
 * `atlas trelica report --offboarding` over an injected snapshot: one leaver, one offboarding workflow and one
 * failed run of it, so each case pins the whole printed view, the JSON document, or the refusal, and the exit code.
 * The default report's kind read is logged too, so a case proves `--offboarding` never takes that path.
 */
import { describe, expect, it } from "vitest";

import { trelicaKindRecord } from "../../../../../atlas/trelica/kindRecord.js";
import {
  initialTrelicaManifest,
  type TrelicaAtlasKind,
  type TrelicaAtlasKindFile,
  type TrelicaAtlasManifest,
} from "../../../../../atlas/trelica/model.js";
import { TRELICA_PROVIDER_TEXT_WITHHELD } from "../../../../../atlas/trelica/providerText.js";
import type { TrelicaAtlasSnapshot } from "../../../../../atlas/trelica/store.js";
import {
  runTrelicaAtlasReport,
  type TrelicaAtlasReportDeps,
} from "../../../../../cli/commands/trelicaAtlas/reportRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { identityAccount, person, run, step, workflow } from "../../../atlas/trelica/offboardingFixtures.js";

const AS_OF = "2026-10-14T00:00:00.000Z";
const RUNS_READ_AT = "2026-10-13T00:00:00.000Z";
const RAN_AT = "2026-10-01T00:00:00.000Z";

/** The process argv for `slopweaver atlas trelica report <tail…>`. */
function argvOf({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "trelica", "report", ...tail];
}

/** Deps whose snapshot read answers `answer`, logging every call in order. */
function harness({ answer }: { answer: Result<TrelicaAtlasSnapshot> }): {
  deps: TrelicaAtlasReportDeps;
  events: string[];
} {
  const events: string[] = [];
  return {
    deps: {
      error: ({ msg }) => {
        events.push(`err: ${msg}`);
      },
      out: ({ line }) => {
        events.push(`out: ${line}`);
      },
      readKind: ({ home, kind }) => {
        events.push(`read ${kind}: ${home}`);
        return ok(null);
      },
      readSnapshot: ({ home }) => {
        events.push(`snapshot: ${home}`);
        return answer;
      },
    },
    events,
  };
}

/** A kind file holding each record as an observed first-party entity. */
function kindFile({
  kind,
  records,
}: {
  kind: TrelicaAtlasKind;
  records: readonly { readonly id: string }[];
}): TrelicaAtlasKindFile {
  return {
    coverage: [],
    entities: records.map((record) => ({
      channels: {
        browser: null,
        "first-party-api": {
          channel: "first-party-api",
          detail: record,
          firstSeenAt: RUNS_READ_AT,
          lastSeenAt: RUNS_READ_AT,
          source: null,
          state: "observed",
        },
        "published-api": null,
      },
      id: `${kind}:${record.id}`,
      kind,
      providerId: record.id,
    })),
    gaps: [],
    kind,
    platform: "trelica",
    schemaVersion: 3,
    updatedAt: AS_OF,
  };
}

/** A manifest with the three input kinds read whole, and the run kind's latest attempt failed when `runsFailed`. */
function manifest({ runsFailed }: { runsFailed: boolean }): TrelicaAtlasManifest {
  const base = initialTrelicaManifest({ updatedAt: AS_OF });
  const read = { digest: "d", entityCount: 1, lastAttempt: null };
  const failed = { at: AS_OF, outcome: "failed" as const, reasons: ["step read refused"] };
  return {
    ...base,
    kinds: {
      ...base.kinds,
      person: { ...read, lastSuccessAt: AS_OF },
      workflow: { ...read, lastSuccessAt: AS_OF },
      "workflow-run": { ...read, lastAttempt: runsFailed ? failed : null, lastSuccessAt: RUNS_READ_AT },
    },
  };
}

/** A whole snapshot: one Terminated leaver with a live Identity account, one workflow, one failed run of it. */
function snapshot({
  runsFailed = false,
  manifest: held = manifest({ runsFailed }),
  mismatched = [],
  unpublished = [],
}: {
  runsFailed?: boolean;
  manifest?: TrelicaAtlasManifest | null;
  mismatched?: readonly TrelicaAtlasKind[];
  unpublished?: readonly TrelicaAtlasKind[];
}): TrelicaAtlasSnapshot {
  const leaver = person({
    accounts: [identityAccount({ deleted: false, suspended: false })],
    id: "p1",
    name: "Ada Leaver",
  });
  const failed = run({
    createdAt: RAN_AT,
    id: "r1",
    personId: "p1",
    status: "Failed",
    steps: [
      // An older generation held this under a looser rule; the report re-holds it rather than printing it.
      step({ failureMessage: "login failed for hunter2", name: "Suspend user", status: "Failed" }),
      step({ name: "Remove from groups", status: "Skipped" }),
    ],
    uiStatus: "Failed",
    workflowId: "w1",
  });
  return {
    files: {
      ...trelicaKindRecord({ of: () => null }),
      person: kindFile({ kind: "person", records: [leaver] }),
      workflow: kindFile({ kind: "workflow", records: [workflow({ id: "w1", name: "Leaver flow" })] }),
      "workflow-run": kindFile({ kind: "workflow-run", records: [failed] }),
    },
    manifest: held,
    mismatched,
    missing: [],
    superseded: [],
    unpublished,
  };
}

describe("runTrelicaAtlasReport --offboarding", () => {
  it("prints the inputs, the reconciliation, the workflow and the named leaver, reading no method kind", () => {
    const { deps, events } = harness({ answer: ok(snapshot({})) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([
      "snapshot: /h",
      `out: trelica offboarding evidence as of ${AS_OF} — 1 offboarding workflow(s); 1 people: run-stuck 0, ` +
        "run-failed 1, no-observed-run 0, run-aborted 0, run-completed-with-errors 0, unknown 0, run-clean 0",
      `out:   inputs: person read whole ${AS_OF}; workflow read whole ${AS_OF}; workflow-run read whole ` +
        `${RUNS_READ_AT}`,
      "out:   reconciliation: 0 run(s) without a person, 0 naming a person the atlas does not hold, 0 without " +
        "held step states; 0 leaver(s) with no run and no date, 0 who left before the first run; 0 held record(s) " +
        "unreadable",
      'out: workflow "Leaver flow" — enabled, Offboarding, trigger Person leaves (leaving date +0 days; for ' +
        `Employee; approval: no), v3; 1 run(s) touching 1 people, last run ${RAN_AT} Failed (Run named p1)`,
      "out:   run outcomes: Failed 1",
      "out:   configured in v3, in order, each with what runs recorded under its id:",
      "out:     1. Suspend user via Google Workspace [continues on error] {action Suspend}: Failed 1; commonest " +
        `failure "${TRELICA_PROVIDER_TEXT_WITHHELD}" ×1`,
      "out:     2. Remove from groups via Google Workspace {removes from every group: yes}: Skipped 1",
      "out: evidence needing a look — 1 current leaver(s), Terminated or with a due leaving date (a run's states " +
        "record what the workflow executed, not what a provider now holds):",
      "out:   run-failed — Ada Leaver <p1@example.test> [Terminated], 1 run(s); live Identity account(s): Google " +
        "Workspace",
      `out:       run-failed — "Leaver flow" ${RAN_AT} Failed at "End"; Suspend user Failed (${TRELICA_PROVIDER_TEXT_WITHHELD})`,
      "out: not counted as leavers — 0 people an offboarding run names whose current record does not say they have " +
        "left; to interpret, never to remediate:",
    ]);
  });

  it("prints the inputs beside the report as one JSON document under --json", () => {
    const { deps, events } = harness({ answer: ok(snapshot({})) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--json", "--home", "/h"] }), deps })).toBe(
      EXIT_OK,
    );
    expect(events.length).toBe(2);
    const document = JSON.parse(events[1]!.slice("out: ".length)) as {
      asOf: string;
      inputs: unknown[];
      people: { name: string; verdict: string }[];
    };
    expect(document.asOf).toBe(AS_OF);
    expect(document.inputs[2]).toEqual({
      kind: "workflow-run",
      lastSuccessAt: RUNS_READ_AT,
      latestAttemptFailed: null,
    });
    expect(document.people.map((entry) => [entry.name, entry.verdict])).toEqual([["Ada Leaver", "run-failed"]]);
  });

  it("is expected-empty, naming the refresh verb, when no generation has been published", () => {
    const { deps, events } = harness({ answer: ok(snapshot({ manifest: null })) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(events).toEqual([
      "snapshot: /h",
      "err: no trelica generation has been published — run: slopweaver atlas trelica refresh",
    ]);
  });

  it("refuses a generation that does not vouch for an input kind, naming only the input kinds", () => {
    const { deps, events } = harness({ answer: ok(snapshot({ mismatched: ["app", "workflow-run"] })) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(EXIT_ERROR);
    expect(events).toEqual([
      "snapshot: /h",
      "err: the generation does not vouch for workflow-run — the files on disk are not the ones its manifest " +
        "published; run: slopweaver atlas trelica refresh",
    ]);
  });

  it("refuses an input kind never read whole, quoting its latest attempt rather than calling the file wrong", () => {
    const { deps, events } = harness({ answer: ok(snapshot({ runsFailed: true, unpublished: ["workflow-run"] })) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(EXIT_ERROR);
    expect(events).toEqual([
      "snapshot: /h",
      "err: workflow-run has never been read whole, so the view would rest on a partial read — its latest attempt " +
        "said: step read refused",
    ]);
  });

  it("refuses when an input kind's latest read failed, though an earlier one was whole, naming what it said", () => {
    const { deps, events } = harness({ answer: ok(snapshot({ runsFailed: true })) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(EXIT_ERROR);
    expect(events).toEqual([
      "snapshot: /h",
      "err: workflow-run's latest read failed, so the view would rest on older evidence — it said: step read " +
        "refused; run: slopweaver atlas trelica sync",
    ]);
  });

  it("builds the view when only a kind it does not read is untrusted", () => {
    const { deps, events } = harness({ answer: ok(snapshot({ mismatched: ["app"] })) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(EXIT_OK);
    expect(events.length).toBe(13);
  });

  it("reports every reason the snapshot could not be read, as an error", () => {
    const { deps, events } = harness({ answer: err(["manifest.json is not JSON", "retry the refresh"]) });

    expect(runTrelicaAtlasReport({ argv: argvOf({ tail: ["--offboarding", "--home", "/h"] }), deps })).toBe(EXIT_ERROR);
    expect(events).toEqual(["snapshot: /h", "err: manifest.json is not JSON", "err: retry the refresh"]);
  });
});
