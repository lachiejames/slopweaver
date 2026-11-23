import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DETAIL_LINE_CAP, DETAILS_MAX, detailEntry } from "../../../hand/details.js";
import { type ConsoleSyncFailure, readConsoleSyncFailures } from "../../../live/consoleSyncFailureStore.js";
import { buildArrival } from "../../../monitor/card.js";
import { CONSOLE_SYNC_UNBLOCKS, evaluateConsoleSyncFailed } from "../../../monitor/consoleSyncFailed.js";
import { foldOpenCards } from "../../../monitor/openCards.js";
import { readingShapeRefusal } from "../../../monitor/pass.js";
import { handStepId, MONITORS } from "../../../monitor/registry.js";
import type { FiringReading } from "../../../monitor/types.js";
import { stateHomePaths } from "../../../stateHome.js";

import { NO_REFUSALS, NOW, rowsOf } from "./consoleSyncFailedFixtures.js";

const homes: string[] = [];

afterEach(() => {
  homes.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true }));
});

function home(): string {
  const path = mkdtempSync(join(tmpdir(), "console-sync-failed-"));
  homes.push(path);
  return path;
}

/** Seed the ledger with rows exactly as the console writes them, one JSON line each. */
function seed({ root, failures }: { root: string; failures: readonly ConsoleSyncFailure[] }): void {
  const path = stateHomePaths({ home: root }).live.consoleSyncFailuresJsonl;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, failures.map((failure) => `${JSON.stringify(failure)}\n`).join(""));
}

describe("console sync failure ledger and monitor", () => {
  it("reads every failed run back and exposes each recent one to the sweep", () => {
    const root = home();
    seed({
      failures: [
        {
          failureId: "failure-1",
          slug: "landing",
          startedAtIso: "2026-11-12T09:58:00.000Z",
          title: "slopweaver github landing",
          tookMs: 1_200,
          why: "GitHub answered 502",
        },
        {
          failureId: "failure-2",
          slug: "currency",
          startedAtIso: "2026-11-12T09:59:00.000Z",
          title: "slopweaver handover currency",
          tookMs: 800,
          why: "the ledger refused the append",
        },
      ],
      root,
    });

    const reading = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: readConsoleSyncFailures({ home: root }),
      nowIso: NOW,
    });
    const lines = [
      "slopweaver handover currency failed at 2026-11-12T09:59:00.000Z: the ledger refused the append",
      "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: GitHub answered 502",
    ];
    expect(reading).toStrictEqual({
      monitorId: "console-sync-failed",
      state: "firing",
      subjects: [
        {
          checkIn: true,
          details: lines,
          detailsInFull: lines,
          id: "console sync failure-2",
          key: "failure-2",
          label:
            "2 console refreshes failed in 24 hours; the latest to fail: slopweaver handover currency failed at 2026-11-12T09:59:00.000Z: the ledger refused the append",
        },
      ],
    });
  });

  it("posts the whole set as ONE card, which the monitor pass accepts without perSubject", () => {
    const row = { slug: "landing", title: "slopweaver github landing", tookMs: 100, why: "failed" };
    const reading = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(
        { ...row, failureId: "failure-1", startedAtIso: "2026-11-12T09:58:00.000Z" },
        { ...row, failureId: "failure-2", startedAtIso: "2026-11-12T09:59:00.000Z" },
      ),
      nowIso: NOW,
    });
    const definition = MONITORS.find((monitor) => monitor.id === "console-sync-failed")!;

    expect(reading.state).toBe("firing");
    expect(definition.perSubject).toBeUndefined();
    expect(readingShapeRefusal({ definition, reading: reading as FiringReading })).toBeUndefined();
  });

  it("re-cuts the card to a long run that fails after a later, quicker one has already been carded", () => {
    const row = { slug: "landing", title: "slopweaver github landing", tookMs: 100, why: "failed" };
    const quick = { ...row, failureId: "quick", startedAtIso: "2026-11-12T09:59:00.000Z" };
    const long = { ...row, failureId: "long", startedAtIso: "2026-11-12T09:58:00.000Z" };

    const first = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(quick),
      nowIso: NOW,
    }) as FiringReading;
    const second = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(quick, long),
      nowIso: NOW,
    }) as FiringReading;

    expect(first.subjects[0]!.key).toBe("quick");
    expect(second.subjects[0]!.key).toBe("long");
    expect(second.subjects[0]!.detailsInFull).toStrictEqual([
      "slopweaver github landing failed at 2026-11-12T09:59:00.000Z: failed",
      "slopweaver github landing failed at 2026-11-12T09:58:00.000Z: failed",
    ]);
  });

  it("re-cuts the card when a second failure ties the first on its start", () => {
    const row = { slug: "landing", startedAtIso: "2026-11-12T09:59:00.000Z", title: "slopweaver github landing" };
    const one = { ...row, failureId: "one", tookMs: 100, why: "failed" };
    const two = { ...row, failureId: "two", tookMs: 200, why: "failed again" };

    const first = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(one),
      nowIso: NOW,
    }) as FiringReading;
    const second = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(one, two),
      nowIso: NOW,
    }) as FiringReading;

    expect(first.subjects[0]!.key).toBe("one");
    expect(second.subjects[0]!.key).toBe("two");
  });

  it("re-cuts the card to the last row still inside the window when the latest to fail ages out first", () => {
    const row = { slug: "landing", title: "slopweaver github landing", tookMs: 100, why: "failed" };
    const quick = { ...row, failureId: "quick", startedAtIso: "2026-11-11T10:01:00.000Z" };
    const long = { ...row, failureId: "long", startedAtIso: "2026-11-11T10:00:00.000Z" };
    const definition = MONITORS.find((monitor) => monitor.id === "console-sync-failed")!;
    const before = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(quick, long),
      nowIso: NOW,
    }) as FiringReading;
    const openId = handStepId({ prefix: definition.prefix, subject: before.subjects[0]! });

    const after = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(quick, long),
      nowIso: "2026-11-12T10:00:30.000Z",
    }) as FiringReading;
    const { folded } = foldOpenCards({ definition, openIds: [openId], openWithDecision: new Set(), reading: after });

    expect(before.subjects[0]!.key).toBe("long");
    expect(after.subjects[0]!.key).toBe("quick");
    expect(after.subjects[0]!.detailsInFull).toStrictEqual([
      "slopweaver github landing failed at 2026-11-11T10:01:00.000Z: failed",
    ]);
    expect(folded.arrived.map((subject) => subject.key)).toStrictEqual(["quick"]);
    expect(folded.departed).toStrictEqual([openId]);
  });

  it("puts a failure whose reason spans lines on one line, which the register accepts", () => {
    const reading = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf({
        failureId: "failure-1",
        slug: "landing",
        startedAtIso: "2026-11-12T09:59:00.000Z",
        title: "slopweaver github landing",
        tookMs: 100,
        why: "GitHub answered 502\n  retry later\tplease",
      }),
      nowIso: NOW,
    }) as FiringReading;

    expect(reading.subjects[0]!.details).toStrictEqual([
      "slopweaver github landing failed at 2026-11-12T09:59:00.000Z: GitHub answered 502 retry later please",
    ]);
  });

  it("posts a card whatever a failure's title or reason says, with only fixed words in the fields the gates read", () => {
    const definition = MONITORS.find((monitor) => monitor.id === "console-sync-failed")!;
    const hostile = [
      "proof register unreadable",
      "no gold anchor; silver and bronze proofs are missing",
      "session a0000016-0000-4000-8000-000000000017 failed",
      "run 1a2b3c4d failed",
      "PR #3911 and pull request 3912 have no witness",
      "could not read /Users/someone/.slopweaver/live/console-sync-failures.jsonl",
      "first line\nsecond line",
      "y".repeat(400),
      "see the card [hand:mon-fleet-health]",
    ];
    const rows = hostile.map((why, index) => ({
      failureId: `failure-${String(index)}`,
      slug: "currency",
      startedAtIso: new Date(Date.parse(NOW) - (index + 1) * 60_000).toISOString(),
      title: index === 0 ? "slopweaver handover currency --json --record-reading sync-now" : `proof ${why}`,
      tookMs: 100,
      why,
    }));
    const readings = [...rows.map((row) => rowsOf(row)), rowsOf(...rows)].map(
      (ledger) => evaluateConsoleSyncFailed({ appendFailures: NO_REFUSALS, ledger, nowIso: NOW }) as FiringReading,
    );
    const refusals = readings.flatMap((reading) =>
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition,
        nowIso: NOW,
        postedBy: "supervisor",
        subject: reading.subjects[0]!,
      }).match(
        (step) => (step.unblocks === CONSOLE_SYNC_UNBLOCKS ? [] : [`unblocks carried ${step.unblocks}`]),
        (refusal) => [refusal.detail],
      ),
    );

    expect(readings.length).toBe(hostile.length + 1);
    expect(refusals).toStrictEqual([]);
    // The Queue card never draws `details`, so its fixed words point at where every failure prints instead.
    expect(CONSOLE_SYNC_UNBLOCKS).toBe(
      "the console readings those failed refreshes left stale; slopweaver monitor check --only console-sync-failed prints each failure and its reason",
    );
    expect(readings.at(-1)!.subjects[0]!.details!.some((line) => detailEntry({ line }).act !== "")).toBe(false);
  });

  it("reads a failure id outside the hand-step id shape as unmeasurable, never as a card the register refuses", () => {
    const row = { slug: "landing", startedAtIso: "2026-11-12T09:59:00.000Z", title: "t", tookMs: 1, why: "w" };
    const unreadable = ["ABC", "a--b", "-a", "a-"].map((failureId) => {
      const root = home();
      const path = stateHomePaths({ home: root }).live.consoleSyncFailuresJsonl;
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `${JSON.stringify({ ...row, failureId })}\n`);
      return evaluateConsoleSyncFailed({
        appendFailures: NO_REFUSALS,
        ledger: readConsoleSyncFailures({ home: root }),
        nowIso: NOW,
      }).state;
    });

    expect(unreadable).toStrictEqual(["unmeasurable", "unmeasurable", "unmeasurable", "unmeasurable"]);
  });

  it("caps the lines on the note at the register's limit and names the verb that prints the rest", () => {
    const failures = Array.from({ length: 14 }, (_, index) => ({
      failureId: `failure-${String(index)}`,
      slug: "landing",
      startedAtIso: new Date(Date.parse(NOW) - (index + 1) * 60_000).toISOString(),
      title: "slopweaver github landing",
      tookMs: 100,
      why: "x".repeat(400),
    }));
    const reading = evaluateConsoleSyncFailed({
      appendFailures: NO_REFUSALS,
      ledger: rowsOf(...failures),
      nowIso: NOW,
    }) as FiringReading;
    const subject = reading.subjects[0]!;

    expect(subject.details!.length).toBe(DETAILS_MAX);
    expect(subject.details!.at(-1)).toBe(
      "+3 more — slopweaver monitor check --only console-sync-failed prints every one",
    );
    expect(subject.details!.every((line) => line.length <= DETAIL_LINE_CAP)).toBe(true);
    expect(subject.details![0]!.endsWith("…")).toBe(true);
    expect(subject.detailsInFull!.length).toBe(14);
  });

  it("reads an absent ledger as clear", () => {
    expect(
      evaluateConsoleSyncFailed({
        appendFailures: NO_REFUSALS,
        ledger: readConsoleSyncFailures({ home: home() }),
        nowIso: NOW,
      }),
    ).toStrictEqual({ monitorId: "console-sync-failed", state: "clear" });
  });

  it("keeps a run started exactly 24 hours ago and clears one a millisecond older", () => {
    const root = home();
    const row = { slug: "landing", title: "slopweaver github landing", tookMs: 100, why: "failed" };
    seed({
      failures: [
        { ...row, failureId: "too-old", startedAtIso: "2026-11-11T09:59:59.999Z" },
        { ...row, failureId: "on-the-edge", startedAtIso: "2026-11-11T10:00:00.000Z" },
      ],
      root,
    });

    expect(
      evaluateConsoleSyncFailed({
        appendFailures: NO_REFUSALS,
        ledger: readConsoleSyncFailures({ home: root }),
        nowIso: NOW,
      }),
    ).toStrictEqual({
      monitorId: "console-sync-failed",
      state: "firing",
      subjects: [
        {
          checkIn: true,
          details: ["slopweaver github landing failed at 2026-11-11T10:00:00.000Z: failed"],
          detailsInFull: ["slopweaver github landing failed at 2026-11-11T10:00:00.000Z: failed"],
          id: "console sync on-the-edge",
          key: "on-the-edge",
          label: "slopweaver github landing failed at 2026-11-11T10:00:00.000Z: failed",
        },
      ],
    });
  });

  it("clears after the failed run leaves the monitor window", () => {
    const root = home();
    seed({
      failures: [
        {
          failureId: "old-failure",
          slug: "landing",
          startedAtIso: "2026-11-11T09:59:59.999Z",
          title: "slopweaver github landing",
          tookMs: 100,
          why: "old failure",
        },
      ],
      root,
    });

    expect(
      evaluateConsoleSyncFailed({
        appendFailures: NO_REFUSALS,
        ledger: readConsoleSyncFailures({ home: root }),
        nowIso: NOW,
      }),
    ).toStrictEqual({
      monitorId: "console-sync-failed",
      state: "clear",
    });
  });

  it("reports a damaged ledger as unmeasurable instead of clear", () => {
    const root = home();
    const path = stateHomePaths({ home: root }).live.consoleSyncFailuresJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, Buffer.from([0xff, 0x0a]));

    expect(
      evaluateConsoleSyncFailed({
        appendFailures: NO_REFUSALS,
        ledger: readConsoleSyncFailures({ home: root }),
        nowIso: NOW,
      }),
    ).toStrictEqual({
      because: `1 line(s) in the console sync failure ledger at ${path} did not decode, and no failure inside 24 hours decodes`,
      monitorId: "console-sync-failed",
      state: "unmeasurable",
    });
  });

  it("reports a shape-correct row with an invalid timestamp as unmeasurable", () => {
    const root = home();
    const path = stateHomePaths({ home: root }).live.consoleSyncFailuresJsonl;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({
        failureId: "failure-1",
        slug: "landing",
        startedAtIso: "not-a-date",
        title: "slopweaver github landing",
        tookMs: 100,
        why: "failed",
      })}\n`,
    );

    expect(
      evaluateConsoleSyncFailed({
        appendFailures: NO_REFUSALS,
        ledger: readConsoleSyncFailures({ home: root }),
        nowIso: NOW,
      }),
    ).toStrictEqual({
      because: `1 line(s) in the console sync failure ledger at ${path} did not decode, and no failure inside 24 hours decodes`,
      monitorId: "console-sync-failed",
      state: "unmeasurable",
    });
  });
});
