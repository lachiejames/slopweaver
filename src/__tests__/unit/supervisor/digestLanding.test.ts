/**
 * The digest's actionable lists, read directly: every press, registration and blocked turn behind a count is
 * named, a long list is capped with the rest counted, and a quiet reading says so.
 */
import { describe, expect, it } from "vitest";

import { blockedLines, bumpDriveLines, landingLines } from "../../../supervisor/digestLanding.js";
import type { DigestInputs, DigestReading } from "../../../supervisor/digestRead.js";

const inputsOf = ({ readings }: { readings: ReadonlyMap<string, DigestReading> }): DigestInputs => ({
  openPagesAgeMinutes: undefined,
  priorHolds: { kind: "none" },
  readings,
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: undefined,
});

describe("digestLanding", () => {
  it("names each press past eight as a count, and skips an outcome that did nothing", () => {
    const presses = [
      ...Array.from({ length: 9 }, (_, index) => ({ number: index, outcome: "pressed", repoSlug: "o/r" })),
      { number: 99, outcome: "would-press", repoSlug: "o/r" },
    ];
    const inputs = inputsOf({
      readings: new Map([["landing", { kind: "json", value: { dispatchable: [], kind: "read", presses } }]]),
    });

    expect(landingLines({ inputs })).toEqual([
      "landing: read — 0 dispatchable, 9 pressed, 0 registered, 0 failed",
      ...Array.from({ length: 8 }, (_, index) => `landing pressed: #${String(index)} o/r`),
      "landing acts: and 1 more",
    ]);
  });

  it("prints each dispatchable row's own fact line, and the act line for a reading recorded before facts existed", () => {
    const dispatchable = [
      {
        action: "spawn-ci",
        facts: "o/r#1 rebase-and-fix/spawn-ci · CI red, REQUIRED: unit",
        number: 1,
        repoSlug: "o/r",
      },
      { action: "spawn-ci", actionDetail: "CI is red", number: 2, repoSlug: "o/r" },
    ];
    const inputs = inputsOf({
      readings: new Map([["landing", { kind: "json", value: { dispatchable, kind: "read", presses: [] } }]]),
    });

    expect(landingLines({ inputs })).toEqual([
      "landing: read — 2 dispatchable, 0 pressed, 0 registered, 0 failed",
      "landing: o/r#1 rebase-and-fix/spawn-ci · CI red, REQUIRED: unit",
      "landing: #2 o/r spawn-ci — CI is red",
    ]);
  });

  it("prints the drafts read after the press read, under its own name, so the two never read as one", () => {
    const dispatchable = [{ facts: "o/r#7 finish-or-card-close/draft · CI red", number: 7, repoSlug: "o/r" }];
    const registrations = [{ number: 7, outcome: "registered", repoSlug: "o/r" }];
    const inputs = inputsOf({
      readings: new Map<string, DigestReading>([
        ["landing-drafts", { kind: "json", value: { dispatchable, kind: "read", presses: [], registrations } }],
        ["landing", { kind: "json", value: { kind: "skipped", nextDueAtIso: "2026-11-03T08:00:00.000Z" } }],
      ]),
    });

    expect(landingLines({ inputs })).toEqual([
      "landing: not due — next 2026-11-03T08:00:00.000Z",
      "landing-drafts: read — 1 dispatchable, 0 pressed, 1 registered, 0 failed",
      "landing-drafts: o/r#7 finish-or-card-close/draft · CI red",
      "landing-drafts registered: #7 o/r",
    ]);
  });

  it("prints nothing when the landing reading was never captured", () => {
    expect(landingLines({ inputs: inputsOf({ readings: new Map() }) })).toEqual([]);
  });

  it("names what each blocked turn needs, and says zero when none waits", () => {
    const blocked = inputsOf({
      readings: new Map([["blocked", { kind: "json", value: [{ need: "decision", what: "x".repeat(120) }] }]]),
    });
    const none = inputsOf({ readings: new Map([["blocked", { kind: "json", value: [] }]]) });

    expect(blockedLines({ inputs: blocked })).toEqual(["blocked turns: 1", `blocked: decision — ${"x".repeat(100)}…`]);
    expect(blockedLines({ inputs: none })).toEqual(["blocked turns: 0"]);
  });
});

describe("bumpDriveLines (the tick drives bumps the bump-drive row did not)", () => {
  it("counts each repository's drive beside the landing line, and names each failed bump with its reason", () => {
    const outcomes = [
      { number: 1, outcome: "acted", repoSlug: "acme/widgets" },
      { number: 2, outcome: "acted", repoSlug: "acme/widgets" },
      { number: 3, outcome: "skipped", repoSlug: "acme/widgets" },
      { detail: "`github enqueue` refused it", number: 4, outcome: "failed", repoSlug: "acme/widgets" },
    ];
    const inputs = inputsOf({
      readings: new Map<string, DigestReading>([
        ["landing", { kind: "json", value: { kind: "skipped", nextDueAtIso: "2026-10-30T02:00:00.000Z" } }],
        ["bump-drive-acme-widgets", { kind: "json", value: { outcomes, repos: ["acme/widgets"] } }],
        ["bump-drive-acme-gadgets", { kind: "json", value: { outcomes: [], repos: ["acme/gadgets"] } }],
      ]),
    });

    expect(bumpDriveLines({ inputs })).toEqual([
      "bump-drive acme/widgets: 4 bump(s) — 2 acted, 1 skipped, 1 failed",
      "bump-drive failed: #4 acme/widgets — `github enqueue` refused it",
      "bump-drive acme/gadgets: 0 bump(s) — 0 acted, 0 skipped, 0 failed",
    ]);
  });

  it("names a drive that did not complete rather than counting it as zero", () => {
    const inputs = inputsOf({
      readings: new Map<string, DigestReading>([
        [
          "bump-drive-acme-widgets",
          {
            child: { durationMs: 300_000, kind: "timed-out", signal: "SIGKILL", timeoutMs: 300_000 },
            kind: "unavailable",
          },
        ],
      ]),
    });

    expect(bumpDriveLines({ inputs })[0]!.startsWith("bump-drive-acme-widgets: unavailable — ")).toBe(true);
  });

  it("prints nothing when the tick drove no repository", () => {
    expect(bumpDriveLines({ inputs: inputsOf({ readings: new Map() }) })).toEqual([]);
  });
});
