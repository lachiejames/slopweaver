import { describe, expect, it } from "vitest";

import type { NoteLevel } from "../../../hand/note/panel.js";
import type { NoteStanding } from "../../../hand/note/raise.js";
import { buildHandStep, type HandStep } from "../../../hand/step.js";
import { err, ok, type Result, unwrap } from "../../../lib/result.js";
import { composeHandStep } from "../../../monitor/card.js";
import { evaluateMeetingPrepDue, MEETING_PREP_DUE } from "../../../monitor/meetingPrepDue.js";
import { noticesToReraise, reraiseLostNotices } from "../../../monitor/noticeReraise.js";
import type { NoteRaiser, PassOutcome } from "../../../monitor/pass.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import type { MonitorId, MonitorReading } from "../../../monitor/types.js";
import type { MeetingTag } from "../../../pages/meetingTag.js";

const NOW = "2026-10-02T04:43:00.000Z";

const TAG: MeetingTag = {
  calendarId: "primary",
  eventId: "6h1s9r0k4p2m8n3q_20261002T050000Z",
  schemaVersion: 1,
  slug: "tobias-one-on-one-2-oct",
  startIso: "2026-10-02T05:00:00.000Z",
  startWall: "15:00",
  summary: "Tobias / the owner 1:1",
  taggedIso: "2026-10-01T05:40:00.000Z",
};

/* The firing reading over the one due meeting, its page published. */
const FIRING: MonitorReading = evaluateMeetingPrepDue({
  dismissed: new Set(),
  nowMs: Date.parse(NOW),
  pageAddress: () => "file:///pages/tobias-one-on-one-2-oct/index.html",
  tags: [TAG],
  unparsed: [],
});

/* The open card a pass posted for that reading's subject. */
function openCard(): HandStep {
  const [subject] = (FIRING as Extract<MonitorReading, { state: "firing" }>).subjects;
  const draft = unwrap(
    composeHandStep({ definition: MEETING_PREP_DUE, nowIso: NOW, postedBy: "test", subject: subject! }),
  );
  return unwrap(buildHandStep({ draft }));
}

/* A pass that read `reading` and did `actions`. */
function outcome({
  reading = FIRING,
  actions = [],
}: { reading?: MonitorReading; actions?: PassOutcome["actions"] } = {}): PassOutcome {
  return { actions, readings: [reading] };
}

describe("noticesToReraise", () => {
  it("owes the open card of a firing notice that the pass left alone, at its monitor's own level", () => {
    const card = openCard();
    const owed = noticesToReraise({ open: [card], outcome: outcome() });
    expect(owed.map((entry) => [entry.step.id, entry.level])).toEqual([[card.id, "meeting-prep"]]);
  });

  it("owes a notice that declares no level too, at the ordinary level", () => {
    const subject = { id: "worktree-prune", key: "worktree-prune", label: "worktree-prune", repairedBy: "ws-7" };
    const draft = unwrap(
      composeHandStep({
        definition: monitorDefinition({ monitorId: "recipe-repairing" }),
        nowIso: NOW,
        postedBy: "test",
        subject,
      }),
    );
    const card = unwrap(buildHandStep({ draft }));
    const reading: MonitorReading = { monitorId: "recipe-repairing", state: "firing", subjects: [subject] };
    const owed = noticesToReraise({ open: [card], outcome: outcome({ reading }) });
    expect(owed.map((entry) => [entry.step.id, entry.level])).toEqual([[card.id, "ordinary"]]);
  });

  it("owes a floating step card that keeps its note up, and none that does not", () => {
    const subject = { id: "plan-two", key: "plan-two", label: "plan-two is signed out" };
    const cardOf = ({ monitorId }: { monitorId: MonitorId }): HandStep =>
      unwrap(
        buildHandStep({
          draft: unwrap(
            composeHandStep({ definition: monitorDefinition({ monitorId }), nowIso: NOW, postedBy: "test", subject }),
          ),
        }),
      );
    const kept = cardOf({ monitorId: "claude-plan-unusable" });
    const quiet = cardOf({ monitorId: "codex-plan-signed-out" });
    const owed = [
      ...noticesToReraise({
        open: [kept],
        outcome: outcome({ reading: { monitorId: "claude-plan-unusable", state: "firing", subjects: [subject] } }),
      }),
      ...noticesToReraise({
        open: [quiet],
        outcome: outcome({ reading: { monitorId: "codex-plan-signed-out", state: "firing", subjects: [subject] } }),
      }),
    ];
    expect(owed.map((entry) => [entry.monitorId, entry.step.id, entry.level])).toEqual([
      ["claude-plan-unusable", kept.id, "ordinary"],
    ]);
  });

  it("owes nothing for a card the pass acted on", () => {
    const card = openCard();
    const settled = { detail: "settled", kind: "settled" as const, monitorId: "meeting-prep-due", stepId: card.id };
    expect(noticesToReraise({ open: [card], outcome: outcome({ actions: [settled] }) })).toEqual([]);
  });

  it("owes nothing when the monitor no longer fires", () => {
    const card = openCard();
    const clear: MonitorReading = { monitorId: "meeting-prep-due", state: "clear" };
    expect(noticesToReraise({ open: [card], outcome: outcome({ reading: clear }) })).toEqual([]);
  });
});

describe("reraiseLostNotices", () => {
  /* Raise every owed card whose note stands at `where`, recording each raise. */
  function raiseAt({ where, level = "meeting-prep" }: { where: Result<NoteStanding, string>; level?: NoteLevel }): {
    rows: readonly { kind: string; detail: string }[];
    raised: readonly string[];
  } {
    const raised: string[] = [];
    const raiseNote: NoteRaiser = ({ step, level: drawnAt }) => {
      raised.push(`${step.id} ${drawnAt}`);
      return ok("floating, top right");
    };
    const card = openCard();
    const rows = reraiseLostNotices({
      owed: [{ level, monitorId: "meeting-prep-due", step: card }],
      raiseNote,
      standing: () => where,
    });
    return { raised, rows: rows.map((row) => ({ detail: row.detail, kind: row.kind })) };
  }

  it("raises a note that went down without the owner's press, at its level", () => {
    const { raised, rows } = raiseAt({ where: ok("absent") });
    expect(raised).toEqual([`${openCard().id} meeting-prep`]);
    expect(rows).toEqual([{ detail: "raised again, its note was not on screen — floating, top right", kind: "noted" }]);
  });

  it("raises an ordinary notice at the ordinary level", () => {
    expect(raiseAt({ level: "ordinary", where: ok("absent") }).raised).toEqual([`${openCard().id} ordinary`]);
  });

  it("leaves a note still up, and one the owner closed", () => {
    expect(raiseAt({ where: ok("up") })).toEqual({ raised: [], rows: [] });
    expect(raiseAt({ where: ok("dismissed") })).toEqual({ raised: [], rows: [] });
  });

  it("refuses, naming why, when the note's files will not read", () => {
    expect(raiseAt({ where: err("disk gone") })).toEqual({
      raised: [],
      rows: [{ detail: "its note could not be read: disk gone", kind: "refused" }],
    });
  });
});
