/**
 * The sessions page: every value escaped, at most one button for the reason, the producer's text only under the
 * fold, and no control but that button and the page's own Recovery button (`fleetPageRecovery.test.ts`).
 */
import { describe, expect, it } from "vitest";

import type { FleetHealth } from "../../src/fleetHealth";
import { fleetLinkOf, fleetNoteUrl, fleetPageHtml } from "../../src/fleetPage";
import { RECOVERY_IDLE } from "../../src/fleetRecoveryCheck";

const HEALTH: FleetHealth = {
  capacity: { configured: 15, online: 1 },
  console: "serving",
  lastAttempt: undefined,
  newestAttempt: undefined,
  observedAtIso: "2026-10-04T10:00:00.000Z",
  reason: {
    code: "MODEL_REFUSED",
    detail: "This seat was running on Fable.",
    handStep: {
      action: { hatch: "ALLOW_FABLE_OVERRIDE", kind: "policy-override" },
      id: "policy-override:ALLOW_FABLE_OVERRIDE",
      label: "Resume it on Fable",
      note: "A seat was running on Fable. Resume it on Fable?",
    },
    headline: "This seat runs on Fable, and resuming it needs your override.",
    raw: "--model fable on a worker seat needs ALLOW_FABLE_OVERRIDE=1 <script>",
  },
  recoveryPhase: "resuming the other seats by priority",
  seats: [
    {
      colour: "green",
      detail: "Caught up.",
      flashing: false,
      held: false,
      live: true,
      lastSignal: { atIso: "2026-10-04T09:58:00.000Z", kind: "reoriented" },
      priority: "unassigned",
      role: "supervisor",
      rowTitle: "Supervisor",
      seatId: "a",
      signalExpectedSinceIso: "2026-10-04T09:50:00.000Z",
    },
    {
      colour: "yellow",
      detail: "Recovering.",
      flashing: true,
      held: false,
      live: false,
      lastSignal: undefined,
      priority: "p0",
      role: "worker",
      rowTitle: "Fix <b>it</b>",
      seatId: "b",
      signalExpectedSinceIso: undefined,
    },
  ],
  state: "recovering",
  unmapped: ["NEW_GATE: no"],
};

describe("fleetPageHtml", () => {
  const html = fleetPageHtml({ health: HEALTH, recovery: RECOVERY_IDLE, timeZone: "Australia/Sydney" });

  it("names the supervisor's last sign of working on its row, as a clock time and never an age", () => {
    expect(html).toContain(
      '<span class="title">Supervisor</span><span class="detail">Caught up.</span><span class="detail">Last sign it was working: it said it was caught up at 8:58 pm.</span>',
    );
    expect(html).not.toContain(" ago");
  });

  it("headlines the owner's words and folds the producer's text, escaped", () => {
    expect(html).toContain("<h1>This seat runs on Fable, and resuming it needs your override.</h1>");
    expect(html).toContain(
      "<details><summary>The original text</summary><pre>--model fable on a worker seat needs ALLOW_FABLE_OVERRIDE=1 &lt;script&gt;\n\nNEW_GATE: no</pre></details>",
    );
  });

  it("draws exactly one button for the reason, and it names the hand step standing now", () => {
    expect(html.match(/href="slopweaver-fleet:\/\/act\//gu)!.length).toBe(1);
    expect(html).toContain('href="slopweaver-fleet://act/policy-override%3AALLOW_FABLE_OVERRIDE"');
  });

  it("draws each seat's colour, its band and its row, flashing only while recovering", () => {
    expect(html).toContain('<span class="dot yellow flash" title="yellow"></span><span class="band">p0</span>');
    expect(html).toContain('<span class="title">Fix &lt;b&gt;it&lt;/b&gt;</span>');
    expect(html).toContain("1 of 15 online · console serving · recovery: resuming the other seats by priority");
  });

  it("carries no script and a policy that allows none", () => {
    expect(html).not.toContain("<script");
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
  });
});

describe("fleetLinkOf", () => {
  it("reads the one button and the note's close link back", () => {
    expect(fleetLinkOf({ url: "slopweaver-fleet://act/policy-override%3AALLOW_FABLE_OVERRIDE" })).toEqual({
      kind: "act",
      stepId: "policy-override:ALLOW_FABLE_OVERRIDE",
    });
    expect(fleetLinkOf({ url: "slopweaver-fleet://dismiss/open-cmux" })).toEqual({
      kind: "dismiss",
      stepId: "open-cmux",
    });
  });

  it("ignores any other navigation", () => {
    expect(fleetLinkOf({ url: "https://example.com/act/x" })).toBeUndefined();
    expect(fleetLinkOf({ url: "slopweaver-fleet://reseat/x" })).toBeUndefined();
  });
});

/** The supervisor read after its sweep: not running, so not live, its last sweep the day before. */
const STALLED_CHAIR: FleetHealth["seats"][number] = {
  colour: "red",
  detail: "The supervisor is not running.",
  flashing: false,
  held: false,
  live: false,
  lastSignal: { atIso: "2026-10-08T23:05:00.000Z", kind: "swept" },
  priority: "p0",
  role: "supervisor",
  rowTitle: "Supervisor",
  seatId: "supervisor",
  signalExpectedSinceIso: undefined,
};

/**
 * Read in Sydney in the afternoon: a supervisor whose process is not running, its last sweep the day before, and the
 * shell's own "Start recovery again" standing — which only ever stands over a supervisor that is not live.
 */
const STALLED: FleetHealth = {
  ...HEALTH,
  newestAttempt: undefined,
  observedAtIso: "2026-10-10T02:28:00.000Z",
  reason: {
    code: "FLEET_DOWN",
    detail: "The supervisor is down.",
    handStep: {
      action: { kind: "resume" },
      id: "resume-4",
      label: "Start recovery again",
      note: "n",
      recoveryDetail: "Recovery was sent to cmux 4 times, and no attempt has recorded starting.",
    },
    headline: "The supervisor is down.",
    raw: undefined,
  },
  recoveryPhase: undefined,
  seats: [STALLED_CHAIR],
  state: "down",
  unmapped: [],
};

/** A supervisor whose process runs and has given no sign since it took the seat that morning: live, and red. */
const QUIET_LIVE_CHAIR: FleetHealth["seats"][number] = {
  ...STALLED_CHAIR,
  detail:
    "There seems to be a problem: it is running, but it has not said it is caught up or closed a sweep in the 10 minutes since it became the supervisor.",
  live: true,
  signalExpectedSinceIso: "2026-10-09T23:27:54.000Z",
};

describe("fleetNoteUrl", () => {
  /** The note's HTML, decoded off its URL. */
  function noteHtml({ health }: { health: FleetHealth }): string {
    return decodeURIComponent(
      fleetNoteUrl({ health, timeZone: "Australia/Sydney" })!.slice("data:text/html;charset=utf-8,".length),
    );
  }

  it("is absent when the reason offers no step", () => {
    const none: FleetHealth = { ...HEALTH, reason: { ...HEALTH.reason, handStep: undefined } };
    expect(fleetNoteUrl({ health: none, timeZone: "Australia/Sydney" })).toBeUndefined();
  });

  it("carries the step's sentence, its button and a close link", () => {
    const html = noteHtml({ health: HEALTH });
    expect(html).toContain("A seat was running on Fable. Resume it on Fable?");
    expect(html).toContain('href="slopweaver-fleet://dismiss/policy-override%3AALLOW_FABLE_OVERRIDE">Not now</a>');
    expect(html).not.toContain("<pre>");
    expect(html).toContain("<title>Slopweaver fleet</title>");
    expect(html.match(/class="act"/gu)!.length).toBe(1);
    expect(html).not.toContain("<script");
  });

  it("folds the fleet's own reason under a step the fleet named", () => {
    expect(noteHtml({ health: HEALTH })).toContain(
      '<details><summary>Why it reads this way</summary><ul class="why"><li>This seat was running on Fable.</li></ul></details>',
    );
  });

  it("shows the command under Start recovery again, the one step you could run yourself", () => {
    expect(noteHtml({ health: STALLED })).toContain(
      '<p class="detail">Or run it yourself:</p><pre>slopweaver fleet resume</pre>',
    );
  });

  it("folds why it reads down: the red seat's words, its last sign, and what recovery did", () => {
    expect(noteHtml({ health: STALLED })).toContain(
      '<details><summary>Why it reads this way</summary><ul class="why">' +
        "<li>Supervisor: The supervisor is not running.</li>" +
        "<li>Last sign it was working: it closed a sweep at Friday 10:05 am.</li>" +
        "<li>Recovery was sent to cmux 4 times, and no attempt has recorded starting.</li>" +
        "</ul></details>",
    );
  });

  it("folds since when a sign has been expected under a step of the fleet's own over a quiet live supervisor", () => {
    const quiet: FleetHealth = { ...STALLED, reason: HEALTH.reason, seats: [QUIET_LIVE_CHAIR] };
    expect(noteHtml({ health: quiet })).toContain(
      "<li>A sign has been expected since 10:27 am, when it started or took the seat.</li>",
    );
  });

  it("says no sign was seen rather than leaving the line out, and names a console that is not answering", () => {
    const quiet: FleetHealth = {
      ...STALLED,
      console: "down",
      seats: [{ ...STALLED_CHAIR, lastSignal: undefined }],
    };
    const html = noteHtml({ health: quiet });
    expect(html).toContain(
      "<li>No sign it was working has been seen: it has not said it is caught up or closed a sweep.</li>",
    );
    expect(html).toContain("<li>The console is not answering.</li>");
  });

  it("says a console it could not check was not checked, never that it is not answering", () => {
    const html = noteHtml({ health: { ...STALLED, console: "unmeasured" } });
    expect(html).toContain("<li>The console could not be checked.</li>");
    expect(html).not.toContain("The console is not answering.");
  });

  it("draws an unchanged reading as the same document, so a poll never closes an open fold", () => {
    const later: FleetHealth = { ...STALLED, observedAtIso: "2026-10-10T02:28:30.000Z" };
    expect(fleetNoteUrl({ health: later, timeZone: "Australia/Sydney" })).toBe(
      fleetNoteUrl({ health: STALLED, timeZone: "Australia/Sydney" }),
    );
  });
});
