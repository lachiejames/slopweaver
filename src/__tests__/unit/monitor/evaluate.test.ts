import { describe, expect, it } from "vitest";

import type { SilentRow } from "../../../live/automation/silentRows.js";
import type { ListenerHeartbeat } from "../../../live/listen/supervise/heartbeat.js";
import { HEARTBEAT_STALE_AFTER_MS, SOCKET_DOWN_AFTER_MS } from "../../../live/listen/supervise/heartbeat.js";
import {
  evaluateBotOffTheAir,
  evaluateChairOffFable,
  evaluatePrsBackedUp,
  type LandingSubjectInput,
  subjectKey,
} from "../../../monitor/evaluate.js";
import {
  CLOSED_BY_OWNER_SUMMARY_ID,
  CORPUS_CARD_SUMMARY_ID,
  evaluateCorpusSyncStopped,
  evaluateRecipeRepairing,
  evaluateRecipeStopped,
  REPAIR_TAKEN_SUMMARY_ID,
  SUPERVISOR_HELD_SUMMARY_ID,
} from "../../../monitor/evaluateStopped.js";

import { firing, unmeasurable } from "./readings.js";

/** No stop taken by any seat — every stopped row is still the owner's to have seated. */
const NONE: ReadonlyMap<string, string> = new Map();

const NOW_MS = Date.parse("2026-09-19T06:00:00.000Z");

/** An instant a given number of milliseconds before the pass. No scaling, so `epoch-arithmetic` is untouched. */
function isoBefore({ ms }: { ms: number }): string {
  return new Date(NOW_MS - ms).toISOString();
}

function landingRow(over: Partial<LandingSubjectInput> = {}): LandingSubjectInput {
  return {
    action: "blocked-on",
    blockedOn: ["@acme/platform"],
    ciRed: false,
    number: 891,
    queueKind: "not-queued",
    repoSlug: "octo-self/slopweaver",
    title: "A step only the owner's hands can take reaches the owner where the owner is looking",
    ...over,
  };
}

function heartbeat(over: Partial<ListenerHeartbeat> = {}): ListenerHeartbeat {
  return {
    armId: "arm-1",
    lastSocketEventAtIso: "2026-09-19T05:58:00.000Z",
    pid: 4242,
    socketState: "connected",
    socketStateSinceIso: "2026-09-19T05:00:00.000Z",
    writtenAtIso: "2026-09-19T05:59:50.000Z",
    ...over,
  };
}

describe("subjectKey", () => {
  it("keeps a readable stem and appends a digest of the whole name", () => {
    expect(subjectKey({ name: "octo-self/slopweaver#891" })).toBe("octo-self-slopweaver-32c2d0");
  });

  it("disambiguates two names sharing the first twenty characters", () => {
    const first = subjectKey({ name: "push-what-is-blocked-on-the-owner-to-a-card" });
    const second = subjectKey({ name: "push-what-is-blocked-on-the-owner-to-a-page" });
    expect(first.slice(0, 20)).toBe(second.slice(0, 20));
    expect(first).not.toBe(second);
  });

  it("answers the bare digest when a name reduces to nothing sayable", () => {
    expect(subjectKey({ name: "///" })).toBe("732c4e");
  });

  it("is stable across calls, because the register is keyed on it", () => {
    expect(subjectKey({ name: "octo-self/slopweaver#891" })).toBe(subjectKey({ name: "octo-self/slopweaver#891" }));
  });
});

describe("evaluatePrsBackedUp", () => {
  it("fires over a row blocked on a code owner and unqueued, carrying its title", () => {
    expect(firing({ reading: evaluatePrsBackedUp({ rows: [landingRow()] }) }).subjects).toEqual([
      {
        id: "octo-self/slopweaver#891",
        key: "octo-self-slopweaver-32c2d0",
        label: "A step only the owner's hands can take reaches the owner where the owner is looking",
      },
    ]);
  });

  it("is clear when the row has already been queued, because nobody is waiting on the owner", () => {
    expect(evaluatePrsBackedUp({ rows: [landingRow({ queueKind: "queued" })] })).toEqual({
      monitorId: "prs-backed-up",
      state: "clear",
    });
  });

  it("is clear for a code-owner wait whose own CI is red — an advisory-only red that holds nothing else", () => {
    expect(evaluatePrsBackedUp({ rows: [landingRow({ ciRed: true })] }).state).toBe("clear");
  });

  it("is clear for a verdict the fleet clears itself", () => {
    expect(evaluatePrsBackedUp({ rows: [landingRow({ action: "press" })] }).state).toBe("clear");
    expect(evaluatePrsBackedUp({ rows: [landingRow({ action: "fix-ci" })] }).state).toBe("clear");
  });

  it("is clear over no rows at all", () => {
    expect(evaluatePrsBackedUp({ rows: [] }).state).toBe("clear");
  });

  it("fires over only the waiting rows when a document carries both kinds", () => {
    const reading = firing({
      reading: evaluatePrsBackedUp({ rows: [landingRow(), landingRow({ action: "press", number: 892 })] }),
    });
    expect(reading.subjects.map((subject) => subject.id)).toEqual(["octo-self/slopweaver#891"]);
  });
});

describe("evaluateBotOffTheAir", () => {
  it("is clear on a connected socket", () => {
    expect(evaluateBotOffTheAir({ heartbeat: heartbeat(), nowMs: NOW_MS }).state).toBe("clear");
  });

  it("is unmeasurable when no beat was ever written, rather than reporting the listener down", () => {
    expect(unmeasurable({ reading: evaluateBotOffTheAir({ heartbeat: undefined, nowMs: NOW_MS }) }).because).toContain(
      "no listener heartbeat has ever been written",
    );
  });

  it("fires when the beat itself has stopped advancing", () => {
    const stale = heartbeat({ writtenAtIso: isoBefore({ ms: HEARTBEAT_STALE_AFTER_MS + 1_000 }) });
    expect(firing({ reading: evaluateBotOffTheAir({ heartbeat: stale, nowMs: NOW_MS }) }).subjects[0]!.id).toBe(
      "listener-stale",
    );
  });

  it("treats a short disconnection as a reconnect in progress, not a fault", () => {
    const backoff = heartbeat({
      socketState: "disconnected",
      socketStateSinceIso: isoBefore({ ms: SOCKET_DOWN_AFTER_MS - 1_000 }),
    });
    expect(evaluateBotOffTheAir({ heartbeat: backoff, nowMs: NOW_MS }).state).toBe("clear");
  });

  it("fires once the socket has been down past the measured backoff tolerance", () => {
    const down = heartbeat({
      socketState: "disconnected",
      socketStateSinceIso: isoBefore({ ms: SOCKET_DOWN_AFTER_MS + 1_000 }),
    });
    expect(firing({ reading: evaluateBotOffTheAir({ heartbeat: down, nowMs: NOW_MS }) }).subjects[0]!.id).toBe(
      "listener-socket",
    );
  });
});

describe("evaluateChairOffFable", () => {
  it("fires when nothing holds the pin at all", () => {
    const reading = firing({
      reading: evaluateChairOffFable({ chair: { bootModel: undefined, workspaceRef: undefined } }),
    });
    expect(reading.subjects).toEqual([
      { id: "chair-unpinned", key: "unpinned", label: "no workspace holds the supervisor pin" },
    ]);
  });

  it("is clear on a pinned chair booted on Fable", () => {
    expect(
      evaluateChairOffFable({
        chair: { bootModel: { kind: "pinned", model: "fable" }, workspaceRef: "workspace:137" },
      }).state,
    ).toBe("clear");
  });

  it("fires on a pinned chair booted on anything else, naming the model", () => {
    const reading = firing({
      reading: evaluateChairOffFable({
        chair: { bootModel: { kind: "pinned", model: "opus" }, workspaceRef: "workspace:137" },
      }),
    });
    expect(reading.subjects[0]!.label).toBe("workspace:137 booted on opus, not Fable");
  });

  it("is unmeasurable when the ledger recorded no boot row for the pinned workspace", () => {
    const reading = unmeasurable({
      reading: evaluateChairOffFable({ chair: { bootModel: undefined, workspaceRef: "workspace:137" } }),
    });
    expect(reading.because).toContain("no spawned row for workspace:137");
  });

  it("is unmeasurable on an inherited boot, because the saved default names no tier", () => {
    const reading = unmeasurable({
      reading: evaluateChairOffFable({ chair: { bootModel: { kind: "inherited" }, workspaceRef: "workspace:137" } }),
    });
    expect(reading.because).toContain("names no tier");
  });
});

/** {@link silentRow}'s last run, JSON-quoted as the episode key's name spells it. */
const LAST_RUN = JSON.stringify("2026-09-16T03:46:41.000Z");

/** One silent row as `silentRows` produces it, overridable field by field. */
function silentRow(over: Partial<SilentRow> = {}): SilentRow {
  return {
    cadence: "30 9 * * *",
    currentSlotHold: null,
    detail:
      "2 slot(s) of `30 9 * * *` went by unrun; it last ran 2026-09-16T03:46:41Z and nothing recorded why it stopped",
    lastRunAtIso: "2026-09-16T03:46:41.000Z",
    missedSlots: 2,
    reason: "MISSED",
    recipeId: "vulnfix-digest-acme-admin",
    ...over,
  };
}

describe("evaluateRecipeStopped", () => {
  it("is clear when no live row has gone quiet", () => {
    expect(evaluateRecipeStopped({ taken: NONE, rows: [] })).toEqual({ monitorId: "recipe-stopped", state: "clear" });
  });

  it("fires with ONE subject for one silent row, keyed by its recipe id and cadence, its reason and detail on the label", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow({ detail: "3 slots", reason: "MISSED" })] }),
    });

    expect(reading.subjects).toEqual([
      {
        id: "vulnfix-digest-acme-admin",
        key: subjectKey({ digestLength: 16, name: '["vulnfix-digest-acme-admin","30 9 * * *"]' }),
        label: "MISSED: 3 slots",
        repair: {
          episodeKey: subjectKey({ digestLength: 16, name: `["vulnfix-digest-acme-admin","30 9 * * *",${LAST_RUN}]` }),
          recipeIds: ["vulnfix-digest-acme-admin"],
        },
      },
    ]);
  });

  it("fires with ONE subject for several silent rows, so 46 stopped rows are one card, not 46", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        taken: NONE,
        rows: [silentRow({ reason: "MISSED" }), silentRow({ reason: "FAILING", recipeId: "resync-atlas-datadog" })],
      }),
    });

    expect(reading.subjects).toEqual([
      {
        id: "2 recipes, worst vulnfix-digest-acme-admin",
        key: subjectKey({
          digestLength: 16,
          name: '["resync-atlas-datadog","30 9 * * *"],["vulnfix-digest-acme-admin","30 9 * * *"]',
        }),
        label: "vulnfix-digest-acme-admin MISSED; resync-atlas-datadog FAILING",
        repair: {
          episodeKey: subjectKey({
            digestLength: 16,
            name:
              `["resync-atlas-datadog","30 9 * * *",${LAST_RUN}],` +
              `["vulnfix-digest-acme-admin","30 9 * * *",${LAST_RUN}]`,
          }),
          recipeIds: ["resync-atlas-datadog", "vulnfix-digest-acme-admin"],
        },
      },
    ]);
  });

  it("names each RAW recipe id once, sorted, for the repair seat, while the card shows the quoted one", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        taken: NONE,
        rows: [silentRow({ recipeId: "z" }), silentRow({ recipeId: "a b\n" }), silentRow({ recipeId: "z" })],
      }),
    });

    expect(reading.subjects[0]!.repair!.recipeIds).toEqual(["a b\n", "z"]);
    expect(reading.subjects[0]!.label).toBe('z MISSED; "a b\\n" MISSED; z MISSED');
  });

  it("keys the EPISODE by each row's last run, so a set that recovered and stopped again is a new repair on the same card", () => {
    const before = firing({ reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow()] }) }).subjects[0]!;
    const again = firing({
      reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow({ lastRunAtIso: "2026-10-01T09:30:00.000Z" })] }),
    }).subjects[0]!;

    expect(again.key).toBe(before.key);
    expect(again.repair!.episodeKey).not.toBe(before.repair!.episodeKey);
  });

  it("keys the set by WHICH rows are in it, so a newly stopped row is a new card and order is not", () => {
    const pair = evaluateRecipeStopped({ taken: NONE, rows: [silentRow(), silentRow({ recipeId: "b" })] });
    const reordered = evaluateRecipeStopped({ taken: NONE, rows: [silentRow({ recipeId: "b" }), silentRow()] });
    const grown = evaluateRecipeStopped({
      taken: NONE,
      rows: [silentRow(), silentRow({ recipeId: "b" }), silentRow({ recipeId: "c" })],
    });

    expect(firing({ reading: reordered }).subjects[0]!.key).toBe(firing({ reading: pair }).subjects[0]!.key);
    expect(firing({ reading: grown }).subjects[0]!.key).not.toBe(firing({ reading: pair }).subjects[0]!.key);
  });

  it("folds two definitions sharing one recipe id into the one card rather than two colliding steps", () => {
    const reading = firing({ reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow(), silentRow()] }) });

    expect(reading.subjects.map((subject) => [subject.id, subject.key])).toEqual([
      [
        "2 recipes, worst vulnfix-digest-acme-admin",
        subjectKey({
          digestLength: 16,
          name: '["vulnfix-digest-acme-admin","30 9 * * *"],["vulnfix-digest-acme-admin","30 9 * * *"]',
        }),
      ],
    ]);
  });

  it("tells one stopped duplicate from two, and which one stopped, so a shared recipe id still re-posts (Codex review)", () => {
    const keyOf = ({ rows }: { rows: Parameters<typeof evaluateRecipeStopped>[0]["rows"] }) =>
      firing({ reading: evaluateRecipeStopped({ taken: NONE, rows }) }).subjects[0]!.key;
    const first = keyOf({ rows: [silentRow()] });
    const other = keyOf({ rows: [silentRow({ cadence: "0 8 * * *" })] });
    const both = keyOf({ rows: [silentRow(), silentRow({ cadence: "0 8 * * *" })] });

    expect(new Set([first, other, both]).size).toBe(3);
  });

  it("quotes a recipe id whose edge whitespace a card would trim away, so the card still names it", () => {
    const reading = firing({ reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow({ recipeId: " " })] }) });

    expect(reading.subjects[0]!.id).toBe('" "');
  });

  it("quotes an id whose inner whitespace a card would collapse, so `x.\\ny` never reads as `x. y`", () => {
    const shown = ["x.\ny", "a  b", "x. y", '" "'].map(
      (recipeId) =>
        firing({ reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow({ recipeId })] }) }).subjects[0]!.id,
    );

    expect(shown).toEqual(['"x.\\ny"', '"a  b"', "x. y", '"\\" \\""']);
  });

  it("keys a set apart from one recipe whose id spells that set's joined text", () => {
    const pair = evaluateRecipeStopped({
      taken: NONE,
      rows: [silentRow({ cadence: "0 0 * * *", recipeId: "a" }), silentRow({ cadence: "1 1 * * *", recipeId: "b" })],
    });
    const lookalike = evaluateRecipeStopped({
      taken: NONE,
      rows: [silentRow({ cadence: "1 1 * * *", recipeId: "a 0 0 * * *,b" })],
    });

    expect(firing({ reading: lookalike }).subjects[0]!.key).not.toBe(firing({ reading: pair }).subjects[0]!.key);
  });

  it("FIRES over a steered atlas row — a steer answers the choice, never the silence", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        taken: NONE,
        rows: [silentRow({ detail: "4 slots", reason: "MISSED", recipeId: "resync-atlas-github", steerId: "240-6" })],
      }),
    });

    expect(reading.subjects).toEqual([
      {
        id: "resync-atlas-github",
        key: subjectKey({ digestLength: 16, name: '["resync-atlas-github","30 9 * * *"]' }),
        label: "MISSED: 4 slots",
        repair: {
          episodeKey: subjectKey({ digestLength: 16, name: `["resync-atlas-github","30 9 * * *",${LAST_RUN}]` }),
          recipeIds: ["resync-atlas-github"],
        },
      },
    ]);
    expect(reading.steers).toBeUndefined();
  });

  it("answers STEERED when every untaken stopped row is a corpus resync — that card is loud for each of them", () => {
    expect(
      evaluateRecipeStopped({
        taken: NONE,
        rows: [
          silentRow({ recipeId: "resync-corpus-github", steerId: "240-6" }),
          silentRow({ recipeId: "resync-corpus-slack", steerId: "240-6" }),
        ],
      }),
    ).toEqual({
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [{ count: 2, instead: "each is on the corpus-sync-stopped card", steerId: "corpus-sync-stopped" }],
    });
  });

  it("keys the card by the rows on it alone, so a corpus resync stopping or recovering never re-posts it", () => {
    const keyOf = ({ rows }: { rows: Parameters<typeof evaluateRecipeStopped>[0]["rows"] }) =>
      firing({ reading: evaluateRecipeStopped({ taken: NONE, rows }) }).subjects[0]!.key;
    const alone = keyOf({ rows: [silentRow({ recipeId: "store-backup-daily" })] });
    const beside = keyOf({
      rows: [
        silentRow({ recipeId: "store-backup-daily" }),
        silentRow({ recipeId: "resync-corpus-github", steerId: "240-6" }),
      ],
    });

    expect(beside).toBe(alone);
  });

  it("keys two sets whose six-hex digests collide apart, so a changed set is never left on the old card", () => {
    const keyOf = ({ recipeId }: { recipeId: string }) =>
      firing({ reading: evaluateRecipeStopped({ taken: NONE, rows: [silentRow({ recipeId })] }) }).subjects[0]!.key;

    expect(subjectKey({ name: "collision-recipe-name-22v 30 9 * * *" })).toBe(
      subjectKey({ name: "collision-recipe-name-7j0 30 9 * * *" }),
    );
    expect(keyOf({ recipeId: "collision-recipe-name-22v" })).not.toBe(keyOf({ recipeId: "collision-recipe-name-7j0" }));
    expect(keyOf({ recipeId: "collision-recipe-name-22v" })).toHaveLength("collision-recipe-nam-".length + 16);
  });
});

describe("evaluateCorpusSyncStopped", () => {
  it("is clear when no corpus resync is among the stopped rows, whatever else is", () => {
    expect(
      evaluateCorpusSyncStopped({ taken: NONE, rows: [silentRow(), silentRow({ recipeId: "resync-atlas-vanta" })] }),
    ).toEqual({
      monitorId: "corpus-sync-stopped",
      state: "clear",
    });
  });

  it("FIRES over a steered corpus row — a steer says who seats it, never that it ran", () => {
    const rows = [silentRow({ missedSlots: 22, recipeId: "resync-corpus-github", steerId: "240-6" })];

    expect(evaluateRecipeStopped({ taken: NONE, rows }).state).toBe("steered");
    expect(
      firing({ reading: evaluateCorpusSyncStopped({ taken: NONE, rows }) }).subjects.map((subject) => subject.id),
    ).toEqual(["resync-corpus-github"]);
  });

  it("labels one stopped corpus row by its reason and missed slots, never its free-text detail", () => {
    const rows = [silentRow({ detail: "PR 123 held it", missedSlots: 22, recipeId: "resync-corpus-github" })];
    expect(
      firing({ reading: evaluateCorpusSyncStopped({ taken: NONE, rows }) }).subjects.map((subject) => subject.label),
    ).toEqual(["MISSED ×22"]);
  });

  it("puts the whole stopped corpus set on ONE subject, naming each source, its reason and the slots it missed", () => {
    const reading = firing({
      reading: evaluateCorpusSyncStopped({
        taken: NONE,
        rows: [
          silentRow({ missedSlots: 22, recipeId: "resync-corpus-slack", steerId: "240-6" }),
          silentRow({ recipeId: "vulnfix-digest-acme-admin" }),
          silentRow({ missedSlots: 21, reason: "FAILING", recipeId: "resync-corpus-linear", steerId: "240-6" }),
        ],
      }),
    });

    expect(reading.subjects.map((subject) => [subject.id, subject.label])).toEqual([
      ["2 corpus sources", "resync-corpus-slack MISSED ×22; resync-corpus-linear FAILING ×21"],
    ]);
    expect(reading.subjects[0]!.decision).toBe(undefined);
  });

  it("re-keys when the stopped set changes, so a newly stopped source re-posts the card", () => {
    const one = evaluateCorpusSyncStopped({ taken: NONE, rows: [silentRow({ recipeId: "resync-corpus-slack" })] });
    const two = evaluateCorpusSyncStopped({
      taken: NONE,
      rows: [silentRow({ recipeId: "resync-corpus-slack" }), silentRow({ recipeId: "resync-corpus-notion" })],
    });

    expect(firing({ reading: one }).subjects[0]!.key).not.toBe(firing({ reading: two }).subjects[0]!.key);
  });

  it("leaves a corpus row a seat has taken to the repairing note", () => {
    const taken = new Map([["resync-corpus-slack", "fix-slack-resync"]]);
    const reading = firing({
      reading: evaluateCorpusSyncStopped({
        rows: [silentRow({ recipeId: "resync-corpus-slack" }), silentRow({ recipeId: "resync-corpus-notion" })],
        taken,
      }),
    });

    expect(reading.subjects.map((subject) => subject.id)).toEqual(["resync-corpus-notion"]);
  });
});

describe("evaluateRecipeStopped with a seat repairing", () => {
  it("carries no decision — the fix is never the owner's to choose", () => {
    const reading = firing({ reading: evaluateRecipeStopped({ rows: [silentRow()], taken: NONE }) });

    expect(reading.subjects[0]!.decision).toBe(undefined);
  });

  it("puts only the stops no seat has on the card, and counts the taken ones beside it", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        rows: [silentRow({ recipeId: "store-backup-daily" }), silentRow()],
        taken: new Map([["vulnfix-digest-acme-admin", "fix-vulnfix-digest"]]),
      }),
    });

    expect(reading.subjects.map((subject) => subject.id)).toEqual(["store-backup-daily"]);
    expect(reading.steers).toEqual([
      {
        count: 1,
        instead: "a seat is repairing it, named on the recipe-repairing note",
        steerId: REPAIR_TAKEN_SUMMARY_ID,
      },
    ]);
  });

  it("answers STEERED, never firing, when a seat has every stop — no card at the top of the owner's queue", () => {
    expect(
      evaluateRecipeStopped({ rows: [silentRow()], taken: new Map([["vulnfix-digest-acme-admin", "fix-it"]]) }),
    ).toEqual({
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "a seat is repairing it, named on the recipe-repairing note",
          steerId: REPAIR_TAKEN_SUMMARY_ID,
        },
      ],
    });
  });
});

describe("evaluateRecipeStopped with a row the supervisor holds", () => {
  const held: Partial<SilentRow> = {
    recipeId: "bump-drive-acme-admin",
    supervisorStop: {
      kind: "held",
      reason: "bump-drive-acme-admin and bump-fix-slopweaver are skipped on a standing word, however late they read.",
      recordedIso: "2026-10-13T01:50:59.735Z",
    },
  };

  it("keeps the held row off the card, keys the card by the open rows alone, and counts the held one beside it", () => {
    const withHeld = firing({
      reading: evaluateRecipeStopped({ rows: [silentRow(held), silentRow()], taken: NONE }),
    });
    const withoutHeld = firing({ reading: evaluateRecipeStopped({ rows: [silentRow()], taken: NONE }) });

    expect(withHeld.subjects.map((subject) => subject.id)).toEqual(["vulnfix-digest-acme-admin"]);
    expect(withHeld.subjects[0]!.key).toBe(withoutHeld.subjects[0]!.key);
    expect(withHeld.steers).toEqual([
      {
        count: 1,
        instead: "the supervisor holds it, its reason on the Automations page",
        steerId: SUPERVISOR_HELD_SUMMARY_ID,
      },
    ]);
  });

  it("answers STEERED when every stop is held — no card at the top of the owner's queue", () => {
    expect(evaluateRecipeStopped({ rows: [silentRow(held)], taken: NONE })).toEqual({
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "the supervisor holds it, its reason on the Automations page",
          steerId: SUPERVISOR_HELD_SUMMARY_ID,
        },
      ],
    });
  });

  it("still carries a row the supervisor only passed over, which no hold explains", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        rows: [
          silentRow({
            supervisorStop: { firstSeenDueIso: "2026-10-12T21:15:00.000Z", kind: "passed-over", passes: 19 },
          }),
        ],
        taken: NONE,
      }),
    });

    expect(reading.subjects.map((subject) => subject.id)).toEqual(["vulnfix-digest-acme-admin"]);
  });

  it("counts a held corpus resync as the corpus card's, never as held — that card stays loud", () => {
    expect(
      evaluateRecipeStopped({ rows: [silentRow({ ...held, recipeId: "resync-corpus-slack" })], taken: NONE }),
    ).toEqual({
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [{ count: 1, instead: "each is on the corpus-sync-stopped card", steerId: CORPUS_CARD_SUMMARY_ID }],
    });
  });

  it("keeps a held row on the card when a sibling definition shares its id — the ledger cannot say which is held", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        rows: [
          silentRow({ ...held, cadence: "0 9 * * *" }),
          silentRow({ cadence: "0 * * * *", recipeId: held.recipeId! }),
        ],
        taken: NONE,
      }),
    });

    expect(reading.subjects.map((subject) => subject.id)).toEqual(["2 recipes, worst bump-drive-acme-admin"]);
    expect(reading.steers).toBeUndefined();
  });
});

describe("a stopped set the owner closed themselves", () => {
  const stopped = firing({ reading: evaluateRecipeStopped({ rows: [silentRow()], taken: NONE }) });
  const key = stopped.subjects[0]!.key;
  const lastRun = silentRow().lastRunAtIso!;
  const afterRun = new Date(Date.parse(lastRun) + 60_000).toISOString();
  const beforeRun = new Date(Date.parse(lastRun) - 60_000).toISOString();

  it("reads steered on recipe-stopped, naming why, while no row of it has run since the owner's close — the set still owed a repair", () => {
    expect(evaluateRecipeStopped({ closed: new Map([[key, afterRun]]), rows: [silentRow()], taken: NONE })).toEqual({
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "you closed this card, and none of its recipes has run since",
          repair: stopped.subjects[0]!.repair,
          steerId: CLOSED_BY_OWNER_SUMMARY_ID,
        },
      ],
    });
  });

  it("reads steered when a hold shrinks a larger set back to one the owner closed, so the pass settles the larger card", () => {
    const held = silentRow({
      recipeId: "bump-drive-acme-admin",
      supervisorStop: { kind: "held", reason: "Held on the owner's word.", recordedIso: "2026-10-13T01:50:59.735Z" },
    });

    expect(
      evaluateRecipeStopped({ closed: new Map([[key, afterRun]]), rows: [held, silentRow()], taken: NONE }),
    ).toEqual({
      monitorId: "recipe-stopped",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "the supervisor holds it, its reason on the Automations page",
          steerId: SUPERVISOR_HELD_SUMMARY_ID,
        },
        {
          count: 1,
          instead: "you closed this card, and none of its recipes has run since",
          repair: stopped.subjects[0]!.repair,
          steerId: CLOSED_BY_OWNER_SUMMARY_ID,
        },
      ],
    });
  });

  it("posts again once a row of it ran after the owner's close — that stop ended and this is a new one", () => {
    expect(evaluateRecipeStopped({ closed: new Map([[key, beforeRun]]), rows: [silentRow()], taken: NONE })).toEqual(
      stopped,
    );
  });

  it("posts when a run and the owner's close share an instant, or the close's stamp will not read — an ambiguous order is loud", () => {
    expect(evaluateRecipeStopped({ closed: new Map([[key, lastRun]]), rows: [silentRow()], taken: NONE })).toEqual(
      stopped,
    );
    expect(evaluateRecipeStopped({ closed: new Map([[key, "not a date"]]), rows: [silentRow()], taken: NONE })).toEqual(
      stopped,
    );
  });

  it("posts a set whose key the owner never closed", () => {
    const reading = firing({
      reading: evaluateRecipeStopped({
        closed: new Map([["another-set", afterRun]]),
        rows: [silentRow()],
        taken: NONE,
      }),
    });

    expect(reading).toEqual(stopped);
  });

  it("reads steered on recipe-repairing the same way", () => {
    const taken = new Map([["vulnfix-digest-acme-admin", "fix-it"]]);
    const repairingKey = firing({ reading: evaluateRecipeRepairing({ rows: [silentRow()], taken }) }).subjects[0]!.key;

    expect(
      evaluateRecipeRepairing({ closed: new Map([[repairingKey, afterRun]]), rows: [silentRow()], taken }),
    ).toEqual({
      monitorId: "recipe-repairing",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "you closed this note, and none of its recipes has run since",
          steerId: CLOSED_BY_OWNER_SUMMARY_ID,
        },
      ],
    });
  });

  it("posts the repairing note again when a seat takes the repair after the owner's close, though no recipe ran", () => {
    const taken = new Map([["vulnfix-digest-acme-admin", "fix-it"]]);
    const open = evaluateRecipeRepairing({ rows: [silentRow()], taken });
    const repairingKey = firing({ reading: open }).subjects[0]!.key;
    const retakenAfter = new Date(Date.parse(afterRun) + 60_000).toISOString();

    expect(
      evaluateRecipeRepairing({
        closed: new Map([[repairingKey, afterRun]]),
        rows: [silentRow()],
        taken,
        takenIso: new Map([["vulnfix-digest-acme-admin", retakenAfter]]),
      }),
    ).toEqual(open);
  });
});

describe("evaluateRecipeRepairing", () => {
  it("is clear when no stopped row is taken, however many are stopped", () => {
    expect(evaluateRecipeRepairing({ rows: [silentRow()], taken: NONE })).toEqual({
      monitorId: "recipe-repairing",
      state: "clear",
    });
  });

  it("names the one taken recipe and the row whose seat is repairing it", () => {
    const reading = firing({
      reading: evaluateRecipeRepairing({
        rows: [silentRow(), silentRow({ recipeId: "store-backup-daily" })],
        taken: new Map([["vulnfix-digest-acme-admin", "fix-vulnfix-digest"]]),
      }),
    });

    expect(reading.subjects).toEqual([
      {
        id: "vulnfix-digest-acme-admin",
        key: subjectKey({ digestLength: 16, name: '["vulnfix-digest-acme-admin","30 9 * * *","fix-vulnfix-digest"]' }),
        label: "vulnfix-digest-acme-admin → seat fix-vulnfix-digest",
        repairedBy: "fix-vulnfix-digest",
      },
    ]);
  });

  it("puts several taken recipes on ONE subject, each beside its seat, naming no single seat", () => {
    const reading = firing({
      reading: evaluateRecipeRepairing({
        rows: [silentRow(), silentRow({ recipeId: "resync-corpus-slack", steerId: "240-6" })],
        taken: new Map([
          ["vulnfix-digest-acme-admin", "fix-a"],
          ["resync-corpus-slack", "fix-b"],
        ]),
      }),
    });

    expect(reading.subjects.map((subject) => [subject.id, subject.label, subject.repairedBy])).toEqual([
      ["2 stopped recipes", "vulnfix-digest-acme-admin → seat fix-a; resync-corpus-slack → seat fix-b", undefined],
    ]);
  });

  it("re-keys when the seat changes, so a new seat re-raises the note", () => {
    const keyOf = ({ row }: { row: string }) =>
      firing({
        reading: evaluateRecipeRepairing({ rows: [silentRow()], taken: new Map([["vulnfix-digest-acme-admin", row]]) }),
      }).subjects[0]!.key;

    expect(keyOf({ row: "fix-a" })).not.toBe(keyOf({ row: "fix-b" }));
  });
});
