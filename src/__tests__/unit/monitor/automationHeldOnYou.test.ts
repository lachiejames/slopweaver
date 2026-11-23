import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DETAIL_LINE_CAP, DETAILS_MAX } from "../../../hand/details.js";
import { buildHandStep } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import type { RecipeDefinition, RecipeHold } from "../../../live/automation/definition.js";
import {
  evaluateAutomationHeldOnYou,
  heldSubjectOf,
  holdReasonLines,
  type OwnerHeldAutomationInput,
} from "../../../monitor/automationHeldOnYou.js";
import { readAutomationHeldOnYou } from "../../../monitor/automationHeldOnYouSource.js";
import { buildArrival } from "../../../monitor/card.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import type { MonitorReading, MonitorSubject } from "../../../monitor/types.js";

const NOW = "2026-10-19T11:40:00.000Z";
const HIS_HOLD =
  "Hold, discussion first — lift only on the owner's word once the #dev-alerts conversation has happened.";

/** The owner's own hold, naming no finding. */
const ownerHold = (over: Partial<RecipeHold> = {}): RecipeHold => ({
  askedIso: "2026-10-17T08:24:00.000Z",
  clearedBy: null,
  reason: HIS_HOLD,
  ...over,
});

/**
 * The security-fix top-up row's shape as a recorded row, re-minted as a row registered today: the card's purpose
 * line is read off the row's argv, which names the live verb, and its id and file carry the stem that verb mints.
 * The recorded row's own `vulnfix-…` id and argv would name a verb that no longer exists.
 */
const topup = (over: Partial<RecipeDefinition> = {}): RecipeDefinition => ({
  cadence: "0 9 * * 1-5",
  destination: { kind: "slack" },
  effect: "read",
  enabled: false,
  hold: ownerHold(),
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["vulnerability-fix", "topup", "--repo", "acme/acme-admin"] },
  recipeId: "vulnerability-fix-topup-acme-admin",
  schemaVersion: 1,
  ...over,
});

const input = ({
  over = {},
  file = "vulnerability-fix-topup-acme-admin.json",
}: { over?: Partial<RecipeDefinition>; file?: string } = {}): OwnerHeldAutomationInput => ({
  definition: topup(over),
  definitionFile: file,
  kindSummary: "run one slopweaver verb on a cadence",
});

/** The subjects of a reading that must be firing. */
function subjectsOf({ reading }: { reading: MonitorReading }): readonly MonitorSubject[] {
  expect(reading.state).toBe("firing");
  return (reading as Extract<MonitorReading, { state: "firing" }>).subjects;
}

describe("evaluateAutomationHeldOnYou — which rows stand on the owner's own hold", () => {
  it("fires on a row held by the owner and switched off, which is how the security-fix top-up stood with no card", () => {
    const [held] = subjectsOf({ reading: evaluateAutomationHeldOnYou({ rows: [input()] }) });
    expect([held!.id, held!.label]).toEqual(["Security fix top-up", "stopped on your hold since 2026-10-17"]);
  });

  it("fires on a row held by the owner while still enabled — the hold outranks `enabled`", () => {
    expect(
      subjectsOf({ reading: evaluateAutomationHeldOnYou({ rows: [input({ over: { enabled: true } })] }) }).length,
    ).toBe(1);
  });

  it("is clear for a row merely switched off with no hold — switched off for good, nothing waits on the owner", () => {
    const { hold: _dropped, ...noHold } = topup();
    const reading = evaluateAutomationHeldOnYou({
      rows: [{ definition: noHold, definitionFile: "copy.json", kindSummary: null }],
    });
    expect(reading).toEqual({ monitorId: "automation-held-on-you", state: "clear" });
  });

  it("is clear once the owner's hold is cleared, however the row is left", () => {
    const cleared = ownerHold({ clearedBy: { atIso: "2026-10-19T12:00:00.000Z", runSlug: "lift-vulnfix-topup" } });
    expect(evaluateAutomationHeldOnYou({ rows: [input({ over: { hold: cleared } })] }).state).toBe("clear");
  });

  it("leaves a FIX hold alone — a broken row the store paused is a seat's repair, never the owner's decision", () => {
    const fix = ownerHold({ finding: "recipe-failing-abc123-a1" });
    expect(evaluateAutomationHeldOnYou({ rows: [input({ over: { hold: fix } })] }).state).toBe("clear");
  });

  it("keys one recipe id in two files as two cards, and a re-placed hold as a new one", () => {
    const [first, second, replaced] = [
      heldSubjectOf({ input: input({ file: "a.json" }) })!,
      heldSubjectOf({ input: input({ file: "b.json" }) })!,
      heldSubjectOf({
        input: input({ file: "a.json", over: { hold: ownerHold({ askedIso: "2026-10-20T08:00:00.000Z" }) } }),
      })!,
    ];
    expect(new Set([first.key, second.key, replaced.key]).size).toBe(3);
    expect(heldSubjectOf({ input: input({ file: "a.json" }) })!.key).toBe(first.key);
  });
});

describe("evaluateAutomationHeldOnYou — a hold the owner answered stays answered until it changes", () => {
  const answered = heldSubjectOf({ input: input({ file: "a.json" }) })!;
  const closed = new Map([[answered.key, "2026-10-19T22:30:42.586Z"]]);

  it("reads steered, not a fresh card, once the owner closed the card for the only held row", () => {
    expect(evaluateAutomationHeldOnYou({ closed, rows: [input({ file: "a.json" })] })).toEqual({
      monitorId: "automation-held-on-you",
      state: "steered",
      steers: [
        {
          count: 1,
          instead: "you answered this hold's card, and the hold has not changed since",
          steerId: "closed-by-owner",
        },
      ],
    });
  });

  it("still cards a held row the owner has not answered beside one they have, counting the answered one as a steer", () => {
    const reading = evaluateAutomationHeldOnYou({
      closed,
      rows: [input({ file: "a.json" }), input({ file: "b.json" })],
    });
    expect(subjectsOf({ reading }).map((subject) => subject.key)).toEqual([
      heldSubjectOf({ input: input({ file: "b.json" }) })!.key,
    ]);
    expect((reading as Extract<MonitorReading, { state: "firing" }>).steers!.map((steer) => steer.count)).toEqual([1]);
  });

  it("cards a re-placed hold whose six-hex key collides with the answered one, since the owner closed it before", () => {
    const at = ({ askedIso }: { askedIso: string }): OwnerHeldAutomationInput =>
      input({ file: "a.json", over: { hold: ownerHold({ askedIso }) } });
    const [first, second] = [
      at({ askedIso: "2026-10-20T00:00:03.717Z" }),
      at({ askedIso: "2026-10-20T00:00:07.799Z" }),
    ];
    const key = heldSubjectOf({ input: first })!.key;
    expect(heldSubjectOf({ input: second })!.key).toBe(key);
    const closedBetween = new Map([[key, "2026-10-20T00:00:05.000Z"]]);
    expect(evaluateAutomationHeldOnYou({ closed: closedBetween, rows: [first] }).state).toBe("steered");
    expect(subjectsOf({ reading: evaluateAutomationHeldOnYou({ closed: closedBetween, rows: [second] }) }).length).toBe(
      1,
    );
  });

  it("holds a closed card whose hold instant will not read as a date, rather than re-carding it every tick", () => {
    const undated = input({ file: "a.json", over: { hold: ownerHold({ askedIso: "not-a-date" }) } });
    const closedUndated = new Map([[heldSubjectOf({ input: undated })!.key, "2026-10-20T01:00:00.000Z"]]);
    expect(evaluateAutomationHeldOnYou({ closed: closedUndated, rows: [undated] }).state).toBe("steered");
  });

  it("cards again a hold lifted and placed again, since the owner's answer was to the hold that stood then", () => {
    const replaced = input({ file: "a.json", over: { hold: ownerHold({ askedIso: "2026-10-20T08:00:00.000Z" }) } });
    expect(subjectsOf({ reading: evaluateAutomationHeldOnYou({ closed, rows: [replaced] }) }).length).toBe(1);
  });
});

describe("the held card — what is stopped, since when, the owner's words, what it is for, and the decision", () => {
  const subject = heldSubjectOf({ input: input() })!;

  it("carries the owner's hold word for word, the instant, the purpose and the file behind the fold", () => {
    expect(subject.details).toEqual([
      "Stopped on your hold since 2026-10-17T08:24:00.000Z",
      `Your hold, word for word: ${HIS_HOLD}`,
      "What it is for: Raises a batch of fix pull requests for the open Dependabot security alerts nobody is fixing yet, opening a visible session per batch.",
      "Recipe vulnerability-fix-topup-acme-admin, defined in vulnerability-fix-topup-acme-admin.json",
    ]);
  });

  it("offers lift, keep and switch off for good — never the restart / repair / retire choice that is a seat's", () => {
    expect(subject.decision!.options.map((option) => option.option)).toEqual([
      "Lift your hold and switch it back on",
      "Keep it stopped until the condition in your recorded hold is met",
      "Switch it off for good",
    ]);
  });

  it("posts as a work step the register accepts, marked as stopping the owner's work", () => {
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: monitorDefinition({ monitorId: "automation-held-on-you" }),
        nowIso: NOW,
        postedBy: "workspace:29",
        subject,
      }),
    );
    expect([step.what, step.context, step.stopsWork, step.decision!.options.length]).toEqual([
      "Decide whether to lift your hold on Security fix top-up — it stays stopped until you say",
      "work",
      true,
      3,
    ]);
  });

  it("names the command a verb run without its own sentence runs, rather than a generic line", () => {
    const unknown = heldSubjectOf({
      input: input({ over: { params: { argv: ["some", "verb"] }, recipeId: "some-verb-nightly" } }),
    })!;
    expect([unknown.id, unknown.details![2]]).toEqual([
      "Scheduled command",
      "What it is for: Runs `slopweaver some verb` on a schedule.",
    ]);
  });

  it("names a row of a kind this build does not register by its recipe id, and says so", () => {
    const unregistered = heldSubjectOf({
      input: input({ over: { kind: "retired-kind", params: {}, recipeId: "retired-nightly" } }),
    })!;
    expect([unregistered.id, unregistered.details![2]]).toEqual([
      "retired-nightly",
      "What it is for: not recorded for this row, and this build does not register its kind, retired-kind",
    ]);
  });
});

describe("holdReasonLines — the owner's words are never cut to fit", () => {
  it("runs a reason past one line's cap onto the next, every word kept and in order", () => {
    const words = Array.from({ length: 120 }, (_, index) => `w${String(index)}`);
    const lines = holdReasonLines({ reason: words.join(" "), room: 9 });
    const rejoined = lines
      .map((line) => line.replace("Your hold, word for word: ", "").replace("…continued: ", ""))
      .join(" ");
    expect(rejoined).toBe(words.join(" "));
    expect(lines.length).toBe(2);
    expect(lines.every((line) => line.length <= DETAIL_LINE_CAP)).toBe(true);
  });

  it("ends a reason longer than every line the note may carry on a marked cut naming the verb that prints it", () => {
    const lines = holdReasonLines({ reason: "word ".repeat(2_000), room: DETAILS_MAX - 3 });
    expect(lines.length).toBe(DETAILS_MAX - 3);
    expect(lines.at(-1)).toBe("…the rest of your hold is cut here — `slopweaver automation status` prints it whole");
  });

  it("keeps a 338-character hold — the longest measured — whole inside a step the register accepts", () => {
    const long = `${"Off until you approve a version of the policy text, ".repeat(6)}then on.`;
    const step = buildHandStep({
      draft: {
        details: heldSubjectOf({ input: input({ over: { hold: ownerHold({ reason: long }) } }) })!.details,
        id: "mon-held-x",
        postedBy: "workspace:29",
        postedIso: NOW,
        unblocks: "x",
        what: "Decide whether to lift your hold on x",
        witness: "monitor",
      },
    });
    expect(step.isOk()).toBe(true);
  });
});

describe("readAutomationHeldOnYou — not having looked is never clear", () => {
  let home = "";
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** A home whose definitions directory holds the given files. */
  function homeWith({ files }: { files: Readonly<Record<string, string>> }): string {
    home = mkdtempSync(join(tmpdir(), "held-"));
    const dir = join(home, "live", "recipe", "definitions");
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(dir, name), text);
    }
    return home;
  }

  it("fires off a held definition on disk", () => {
    const reading = readAutomationHeldOnYou({
      home: homeWith({ files: { "vulnerability-fix-topup-acme-admin.json": JSON.stringify(topup()) } }),
    });
    expect(subjectsOf({ reading }).map((subject) => subject.id)).toEqual(["Security fix top-up"]);
  });

  it("reads a file that will not parse as unmeasurable rather than clear, naming the file", () => {
    const reading = readAutomationHeldOnYou({ home: homeWith({ files: { "broken.json": "{" } }) });
    expect(reading.state).toBe("unmeasurable");
    expect((reading as Extract<MonitorReading, { state: "unmeasurable" }>).because).toContain("broken.json");
  });

  it("holds a card the owner closed off the reading, read off the hand register on disk", () => {
    const at = homeWith({ files: { "vulnerability-fix-topup-acme-admin.json": JSON.stringify(topup()) } });
    const stepId = `mon-held-${heldSubjectOf({ input: input() })!.key}`;
    const register = join(at, "hand-steps");
    mkdirSync(register, { recursive: true });
    const settled = {
      bySession: "workspace:416",
      did: "B, kept stopped on the owner's own word",
      id: stepId,
      kind: "settled",
      settledIso: "2026-10-19T22:30:42.586Z",
    };
    writeFileSync(join(register, "steps.jsonl"), `${JSON.stringify(settled)}\n`);
    expect(readAutomationHeldOnYou({ home: at }).state).toBe("steered");
  });

  it("reads a hand register it cannot open as unmeasurable, never as nothing closed", () => {
    const at = homeWith({ files: { "vulnerability-fix-topup-acme-admin.json": JSON.stringify(topup()) } });
    mkdirSync(join(at, "hand-steps", "steps.jsonl"), { recursive: true });
    const reading = readAutomationHeldOnYou({ home: at });
    expect(reading.state).toBe("unmeasurable");
    expect((reading as Extract<MonitorReading, { state: "unmeasurable" }>).because).toContain(
      "the hand register could not be read",
    );
  });

  it("still fires over a held row beside a file that will not parse, carrying the blind spot", () => {
    const reading = readAutomationHeldOnYou({
      home: homeWith({
        files: { "broken.json": "{", "vulnerability-fix-topup-acme-admin.json": JSON.stringify(topup()) },
      }),
    });
    expect((reading as Extract<MonitorReading, { state: "firing" }>).blindSpot).toContain("broken.json");
  });
});
