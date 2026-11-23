/**
 * What an apply writes, row by row: a new row written as it is, a row the store holds identically skipped, an
 * append-only difference left standing, a restored instruction in the state its activation answer gave it, and a
 * conflict's `take-imported` written over what it meets.
 */
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { standingAskLine } from "../../../../profile/standingAsks.js";
import type { StoreExportContents } from "../../../../store/transfer/bundlePublish.js";
import type { ImportAction } from "../../../../store/transfer/compare.js";
import { type ImportEffects, importApplicationEffects } from "../../../../store/transfer/importApplyEffects.js";
import {
  applicationReadiness,
  type ImportApplicationPlan,
  reconstructStagedImport,
} from "../../../../store/transfer/importApplyPlan.js";
import type { StoreExportPartKind } from "../../../../store/transfer/parts.js";
import type { RetainedEntry } from "../../../../store/transfer/retained.js";
import { importRowStatuses } from "../../../../store/transfer/rowClassify.js";
import { OWNER, STANDING_ASK_LINES } from "./fixtures.js";
import {
  ACTIVE,
  CHANGED_MEMORY_LINE,
  EMPTY_LIVE,
  liveOf,
  replan,
  runCleanups,
  type StagedBatch,
  stagedBatch,
} from "./stagedBatch.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  runCleanups({ cleanups });
});

/** Nothing written to any register. */
const NOTHING: ImportEffects = {
  corrections: [],
  directives: [],
  memories: [],
  profile: null,
  recalls: [],
  standingAsks: [],
  steerMeasurements: [],
  voice: [],
};

/** A batch of `contents` staged against `live`, each question of a kind answered by `answers`, made ready to apply. */
function ready({
  contents = ACTIVE,
  live = EMPTY_LIVE,
  answers,
}: {
  contents?: StoreExportContents;
  live?: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
  answers: Partial<Record<"activation" | "conflict" | "alignment", ImportAction>>;
}): { probe: StagedBatch; application: ImportApplicationPlan } {
  const probe = stagedBatch({ cleanups, contents, live });
  const resolutions = probe.draft.questions.flatMap((question) => {
    const action = answers[question.kind];
    return action === undefined ? [] : [{ action, questionId: question.id }];
  });
  const read = unwrap(reconstructStagedImport({ ...probe.rows, resolutions }));
  const application = unwrap(
    applicationReadiness({ replanned: replan({ import: read, live }), staged: read, stopOnConflict: false }),
  );
  return { application, probe };
}

/** What `application` writes against `live`. */
function effectsOf({
  application,
  live = EMPTY_LIVE,
}: {
  application: ImportApplicationPlan;
  live?: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
}): ImportEffects {
  const statuses = unwrap(importRowStatuses({ imported: application.staged.imported, live }));
  return unwrap(importApplicationEffects({ application, statuses }));
}

/** The id of the question the draft asks about `key`. */
function questionOf({ probe, key }: { probe: StagedBatch; key: string }): string {
  return probe.draft.questions.find((question) => question.key === key)!.id;
}

/** The live store holding only the part `part` of an export of `contents`. */
function liveHolding({
  contents,
  part,
}: {
  contents: StoreExportContents;
  part: StoreExportPartKind;
}): ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]> {
  return new Map([...EMPTY_LIVE, [part, liveOf({ contents }).get(part)!]]);
}

describe("importApplicationEffects", () => {
  it("writes every new row, each restored instruction inactive when its answer left it so", () => {
    const { application, probe } = ready({ answers: { activation: "leave-inactive" } });
    const effects = effectsOf({ application });

    expect([effects.memories.length, effects.recalls.length, effects.voice.length]).toEqual([1, 1, 1]);
    expect(effects.profile!.displayName).toBe(OWNER.displayName);
    expect(effects.steerMeasurements.map((envelope) => envelope.sourceOrdinal)).toEqual([1, 2]);
    expect(effects.corrections).toEqual([]);
    expect(effects.directives.map((one) => [one.value.id, one.state, one.retiresCurrent, one.questionId])).toEqual([
      ["d-one", "inactive", false, questionOf({ key: "directive:d-one", probe })],
      ["d-two", "inactive", false, questionOf({ key: "directive:d-two", probe })],
    ]);
    expect(effects.standingAsks.map((one) => [one.ask.id, one.state, one.withdraws, one.questionId])).toEqual([
      ["org-intel", "inactive", [], questionOf({ key: "org-intel", probe })],
    ]);
  });

  it("writes a restored instruction active when its answer activated it", () => {
    const { application } = ready({ answers: { activation: "activate" } });
    const effects = effectsOf({ application });

    expect([...effects.directives, ...effects.standingAsks].map((one) => one.state)).toEqual([
      "active",
      "active",
      "active",
    ]);
  });

  it("writes nothing for a store that already holds every row identically", () => {
    const live = liveOf({ contents: ACTIVE });
    const { application, probe } = ready({ answers: {}, live });

    expect(probe.draft.questions).toEqual([]);
    expect(effectsOf({ application, live })).toEqual(NOTHING);
  });

  it("leaves an append-only row the store holds differently standing, acknowledged or not", () => {
    const live = liveHolding({ contents: { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] }, part: "memories" });
    const open = ready({ answers: { activation: "activate" }, live });
    const acknowledged = ready({ answers: { activation: "activate", alignment: "keep-current" }, live });

    expect(
      [open, acknowledged].map(({ application }) => {
        const effects = effectsOf({ application, live });
        return [effects.memories.length, effects.recalls.length];
      }),
    ).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it("writes the imported profile over a conflicting one only when the answer takes it", () => {
    const live = liveOf({ contents: { ...ACTIVE, owner: { ...OWNER, displayName: "Acme Owner, renamed" } } });
    const taken = ready({ answers: { conflict: "take-imported" }, live });
    const kept = ready({ answers: { conflict: "keep-current" }, live });

    const written = effectsOf({ application: taken.application, live });

    expect(written.profile!.displayName).toBe(OWNER.displayName);
    expect({ ...written, profile: null }).toEqual(NOTHING);
    expect(effectsOf({ application: kept.application, live })).toEqual(NOTHING);
  });

  it("withdraws every live ask a standing ask it takes meets, and none it keeps", () => {
    const rival = standingAskLine({
      event: {
        ...(JSON.parse(STANDING_ASK_LINES[0]) as Parameters<typeof standingAskLine>[0]["event"]),
        id: "org-intel-two",
      },
    });
    const live = liveHolding({ contents: { ...ACTIVE, standingAskLines: [rival] }, part: "standing-asks" });
    const taken = ready({ answers: { activation: "activate", conflict: "take-imported" }, live });
    const kept = ready({ answers: { activation: "activate", conflict: "keep-current" }, live });

    expect(taken.probe.draft.questions.filter((one) => one.kind === "conflict").map((one) => one.key)).toEqual([
      "org-intel",
    ]);
    expect(
      effectsOf({ application: taken.application, live }).standingAsks.map((one) => [one.ask.id, one.withdraws]),
    ).toEqual([["org-intel", ["org-intel-two"]]]);
    expect(effectsOf({ application: kept.application, live }).standingAsks).toEqual([]);
  });

  it("refuses to write a restored instruction whose answer it does not hold", () => {
    const { application } = ready({ answers: { activation: "activate" } });
    const unanswered = { ...application, staged: { ...application.staged, answers: new Map<string, ImportAction>() } };
    const statuses = unwrap(importRowStatuses({ imported: application.staged.imported, live: EMPTY_LIVE }));

    expect(unwrapErr(importApplicationEffects({ application: unanswered, statuses })).code).toBe(
      "IMPORT_QUESTIONS_OPEN",
    );
  });

  it("refuses a row its plan never classified", () => {
    const { application } = ready({ answers: { activation: "activate" } });
    const statuses = unwrap(importRowStatuses({ imported: application.staged.imported, live: EMPTY_LIVE }));

    expect(
      unwrapErr(importApplicationEffects({ application, statuses: statuses.filter((one) => one.part !== "memories") }))
        .message,
    ).toContain("of memories was not planned");
  });
});

describe("importRowStatuses", () => {
  it("names every imported row new, identical or conflicting, and the live row a conflicting one meets", () => {
    const imported = unwrap(reconstructStagedImport(stagedBatch({ cleanups }).rows)).imported;
    const live = liveHolding({ contents: { ...ACTIVE, memoryLines: [CHANGED_MEMORY_LINE] }, part: "memories" });
    const memoryKey = imported.get("memories")![0]!.key;
    const statuses = unwrap(
      importRowStatuses({
        imported,
        live: new Map([...live, ["owner-voice", liveOf({ contents: ACTIVE }).get("owner-voice")!]]),
      }),
    );

    expect(statuses.map((one) => [one.part, one.status, one.meets])).toEqual([
      ["memories", "conflicting", [memoryKey]],
      ["memory-recalls", "new", []],
      ["owner-profile", "new", []],
      ["owner-voice", "identical", ["slack/all-sent"]],
      ["owner-directives", "new", []],
      ["owner-directives", "new", []],
      ["standing-asks", "new", []],
      ["steer-verdicts", "new", []],
      ["steer-verdicts", "new", []],
    ]);
  });
});
