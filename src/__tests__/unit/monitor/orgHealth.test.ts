/**
 * `org-health` — `monitor/orgHealth.ts`. The rules: a floating note when an incident starts or its
 * severity changes, a quiet resolution, and nothing at all about a healthy organisation.
 */
import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../hand/posting.js";
import { WHAT_CAP } from "../../../hand/step.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { evaluateOrgHealth, ORG_HEALTH, orgHealthKey } from "../../../monitor/orgHealth.js";
import type { MonitorReading, MonitorSubject } from "../../../monitor/types.js";
import { OrgHealthErrors } from "../../../orgHealth/errors.js";
import { keptIncidents, SEVERITY_CAP } from "../../../orgHealth/policy.js";
import type { IncidentSnapshot, LoudMoment, OrgIncident } from "../../../orgHealth/types.js";
import { HOUR_MS, measuredSnapshot, NOW_ISO, NOW_MS, orgIncident } from "../orgHealth/orgIncidentFixture.js";

/** Judge a measured snapshot holding `incidents` at NOW, with nothing dismissed, shown or up unless told. */
function judge({
  incidents,
  dismissed = new Set<string>(),
  shown = new Set<string>(),
  open = new Set<string>(),
  nowMs = NOW_MS,
}: {
  incidents: readonly OrgIncident[];
  dismissed?: ReadonlySet<string>;
  shown?: ReadonlySet<string>;
  open?: ReadonlySet<string>;
  nowMs?: number;
}): MonitorReading {
  return evaluateOrgHealth({
    dismissed,
    nowMs,
    open,
    shown,
    snapshot: ok(measuredSnapshot({ incidents, readIso: new Date(nowMs).toISOString() })),
  });
}

/** The one subject a firing reading carries. */
function subjectOf({ reading }: { reading: MonitorReading }): MonitorSubject {
  const firing = reading as Extract<MonitorReading, { state: "firing" }>;
  expect(firing.subjects.length).toBe(1);
  return firing.subjects[0]!;
}

/** The step a subject posts as. */
function arrival({ subject }: { subject: MonitorSubject }) {
  return unwrap(
    buildArrival({
      address: { consoleBase: "http://localhost:3000", occurrence: 1 },
      definition: ORG_HEALTH,
      nowIso: NOW_ISO,
      postedBy: "supervisor",
      subject,
    }),
  );
}

/** An instant `hours` before NOW. */
const hoursAgo = ({ hours }: { hours: number }): string => new Date(NOW_MS - hours * HOUR_MS).toISOString();

/** A loud moment of `kind`, `hours` before NOW. */
const paged = ({ hours, kind = "new" }: { hours: number; kind?: "new" | "reopened" }): LoudMoment => ({
  iso: hoursAgo({ hours }),
  kind,
});

/** The key an incident's own loud moment is posted under. */
const keyOf = ({ incident }: { incident: OrgIncident }): string => orgHealthKey({ incident, loud: incident.loud! });

/** The clear reading. */
const CLEAR: MonitorReading = { monitorId: "org-health", state: "clear" };

describe("evaluateOrgHealth", () => {
  it("says nothing about a healthy organisation", () => {
    expect(judge({ incidents: [] })).toEqual(CLEAR);
  });

  it("fires one subject naming a new incident, keyed on its severity and the read that first saw it", () => {
    const subject = subjectOf({ reading: judge({ incidents: [orgIncident()] }) });
    expect(subject).toEqual({
      address: "https://app.incident.io/example-org/incidents/98",
      details: ["INC-98 Critical · Payment checkout regression — Investigating 1.0h: no update since it was declared"],
      id: "INC-98",
      incident: {
        line: { ref: "INC-98 Critical", tail: "A new incident", title: "Payment checkout regression" },
        others: 0,
      },
      key: "inc98-critical-20261004080000000",
      label: "INC-98 Critical, new at 2026-10-04T08:00:00.000Z",
    });
  });

  it("keeps the key through a phase move, so the card stands and nothing posts", () => {
    const fixing = orgIncident({
      over: { phase: "identified", phaseChangedIso: hoursAgo({ hours: 0.2 }), status: "Fixing" },
    });
    expect([keyOf({ incident: orgIncident() }), subjectOf({ reading: judge({ incidents: [fixing] }) }).key]).toEqual([
      "inc98-critical-20261004080000000",
      "inc98-critical-20261004080000000",
    ]);
  });

  it("pages a severity change as a new key, naming what it changed from", () => {
    const raised = orgIncident({
      over: {
        loud: { fromSeverity: "Minor", iso: hoursAgo({ hours: 0.5 }), kind: "severity-changed" },
        severity: "Major",
      },
    });
    const subject = subjectOf({ reading: judge({ incidents: [raised] }) });
    expect([subject.key, arrival({ subject }).what]).toEqual([
      "inc98-major-20261004083000000",
      "Severity changed from Minor: Payment checkout regression (INC-98 Major)",
    ]);
  });

  it("keys a severity gone A→B→A as three pages, never holding the return as already shown", () => {
    const first = orgIncident({ over: { loud: paged({ hours: 3 }) } });
    const back = orgIncident({
      over: { loud: { fromSeverity: "Minor", iso: hoursAgo({ hours: 1 }), kind: "severity-changed" } },
    });
    const shown = new Set([keyOf({ incident: first }), "inc98-minor-20261004070000000"]);
    const subject = subjectOf({ reading: judge({ incidents: [back], shown }) });
    expect([subject.key, subject.delivery]).toEqual(["inc98-critical-20261004080000000", undefined]);
  });

  it("heads with the newest page, counting the rest open as of the moment it floats", () => {
    const older = orgIncident({ over: { loud: paged({ hours: 5 }), ref: "INC-7", title: "Billing export delay" } });
    const newer = orgIncident({
      over: {
        lastUpdate: { author: "Riley Lead", iso: hoursAgo({ hours: 0.5 }), status: "Fixing", text: "Rolled back." },
        loud: paged({ hours: 0.5 }),
        phase: "identified",
        phaseChangedIso: hoursAgo({ hours: 0.5 }),
        status: "Fixing",
      },
    });
    const subject = subjectOf({ reading: judge({ incidents: [older, newer] }) });
    expect(arrival({ subject }).what).toBe(
      "A new incident: Payment checkout regression (INC-98 Critical) · +1 more open",
    );
    expect(subject.details).toEqual([
      "INC-98 Critical · Payment checkout regression — Fixing 30.0m: last update 30.0m ago, Riley Lead: Rolled back.",
      "INC-7 Critical · Billing export delay — Investigating 1.0h: no update since it was declared",
    ]);
  });

  it("reads clear when the incident that paged last resolves, never promoting an older open one", () => {
    const older = orgIncident({ over: { loud: paged({ hours: 5 }), ref: "INC-7" } });
    const resolved = orgIncident({
      over: {
        loud: paged({ hours: 1 }),
        phase: "resolved",
        phaseChangedIso: hoursAgo({ hours: 0.1 }),
        status: "Closed",
      },
    });
    expect(judge({ incidents: [older, resolved] })).toEqual(CLEAR);
  });

  it("reads clear when the only incident resolves — the quiet resolution", () => {
    const resolved = orgIncident({
      over: { phase: "resolved", phaseChangedIso: hoursAgo({ hours: 0.1 }), status: "Closed" },
    });
    expect(judge({ incidents: [resolved] })).toEqual(CLEAR);
  });

  it("never pages an open incident a week late once the newer page that outranked it ages out", () => {
    const older = orgIncident({ over: { loud: paged({ hours: 5 }), ref: "INC-7" } });
    const posted = new Set(["inc98-critical-20261004080000000"]);
    expect(judge({ incidents: [older], shown: posted })).toEqual(CLEAR);
  });

  it("ranks an incident first seen resolved below every open page", () => {
    const open = orgIncident({ over: { loud: paged({ hours: 5 }), ref: "INC-7" } });
    const neverOpen = orgIncident({ over: { loud: undefined, phase: "resolved", status: "Closed" } });
    expect(subjectOf({ reading: judge({ incidents: [open, neverOpen] }) }).id).toBe("INC-7");
  });

  it("names a reopened incident as reopened", () => {
    const reopened = orgIncident({ over: { loud: paged({ hours: 0.2, kind: "reopened" }) } });
    expect(arrival({ subject: subjectOf({ reading: judge({ incidents: [reopened] }) }) }).what).toBe(
      "Reopened: Payment checkout regression (INC-98 Critical)",
    );
  });

  it("holds the note the owner closed while nothing has paged, and floats the next page", () => {
    const key = keyOf({ incident: orgIncident() });
    const held = subjectOf({ reading: judge({ dismissed: new Set([key]), incidents: [orgIncident()] }) });
    expect(held.delivery).toEqual({ kind: "hold", why: "you closed the INC-98 note, and nothing has paged since" });
    const raised = orgIncident({
      over: { loud: { fromSeverity: "Major", iso: hoursAgo({ hours: 0.2 }), kind: "severity-changed" } },
    });
    expect(subjectOf({ reading: judge({ dismissed: new Set([key]), incidents: [raised] }) }).delivery).toBe(undefined);
  });

  it("holds a page already shown and taken down", () => {
    const subject = subjectOf({
      reading: judge({ incidents: [orgIncident()], shown: new Set([keyOf({ incident: orgIncident() })]) }),
    });
    expect(subject.delivery).toEqual({
      kind: "hold",
      why: "the INC-98 note was already shown, and nothing has paged since",
    });
  });

  it("floats a page newer than every key shown before it", () => {
    const shown = new Set(["inc7-major-20261004070000000"]);
    expect(subjectOf({ reading: judge({ incidents: [orgIncident()], shown }) }).delivery).toBe(undefined);
  });

  it("keeps the card up standing, with no hold, while its key is still the page", () => {
    const key = keyOf({ incident: orgIncident() });
    const subject = subjectOf({ reading: judge({ incidents: [orgIncident()], open: new Set([key]) }) });
    expect([subject.key, subject.delivery]).toEqual([key, undefined]);
  });

  it("never replaces the card up with an older key for the same page, as a read with no memory re-dates it", () => {
    // Paged at 08:00 and still up; a read with no sightings file then dated the same start by its 06:00 declaration.
    const reDated = orgIncident({ over: { loud: paged({ hours: 3 }) } });
    expect(judge({ incidents: [reDated], open: new Set(["inc98-critical-20261004080000000"]) })).toEqual(CLEAR);
  });

  it("is unmeasurable, never clear, with no read, a failed read, a read under way or a stale one", () => {
    const at = ({ snapshot }: { snapshot: Parameters<typeof evaluateOrgHealth>[0]["snapshot"] }) =>
      evaluateOrgHealth({ dismissed: new Set(), nowMs: NOW_MS, open: new Set(), shown: new Set(), snapshot });
    const marker: IncidentSnapshot = {
      attemptedIso: NOW_ISO,
      because: "a read is under way",
      schemaVersion: 1,
      state: "unmeasurable",
    };
    const readings = [
      at({ snapshot: ok(null) }),
      at({ snapshot: err(OrgHealthErrors.fileMalformed({ detail: "bad", path: "/h/incidents.json" })) }),
      at({ snapshot: ok(marker) }),
      at({ snapshot: ok(measuredSnapshot({ incidents: [], readIso: hoursAgo({ hours: 1 }) })) }),
    ];
    expect(readings.map((reading) => reading.state)).toEqual([
      "unmeasurable",
      "unmeasurable",
      "unmeasurable",
      "unmeasurable",
    ]);
    expect((readings[3] as Extract<MonitorReading, { state: "unmeasurable" }>).because).toBe(
      "the last complete incident read was 1.0h ago (2026-10-04T08:00:00.000Z), past the 45m it is believed for",
    );
  });
});

describe("the org-health note", () => {
  it("is a notice on no list whose Open button is the incident's page", () => {
    const step = arrival({ subject: subjectOf({ reading: judge({ incidents: [orgIncident()] }) }) });
    expect(step.what).toBe("A new incident: Payment checkout regression (INC-98 Critical)");
    expect([step.notice, step.url, step.unaddressed, step.context]).toEqual([
      true,
      "https://app.incident.io/example-org/incidents/98",
      undefined,
      undefined,
    ]);
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("still floats an incident whose own title names a bare code, on the plain line", () => {
    const coded = orgIncident({ over: { title: "Deploy a3f9c2d1 broke checkout" } });
    const step = arrival({ subject: subjectOf({ reading: judge({ incidents: [coded] }) }) });
    expect([step.what, step.url]).toEqual([
      "A new or changed incident on the organisation's incident system — Open shows its page",
      "https://app.incident.io/example-org/incidents/98",
    ]);
    expect(postingRefusal({ step })).toBeUndefined();
  });

  it("reads a title with its own sentence breaks as one sentence the register accepts", () => {
    const titled = orgIncident({ over: { title: "Checkout down. Again? Yes!  Still  failing" } });
    const step = arrival({ subject: subjectOf({ reading: judge({ incidents: [titled] }) }) });
    expect(step.what).toBe("A new incident: Checkout down; Again; Yes; Still failing (INC-98 Critical)");
  });

  it("fits a long title into the cap, keeping the page and the count whole", () => {
    const long = orgIncident({ over: { title: "Ü".repeat(300) } });
    const other = orgIncident({ over: { loud: paged({ hours: 4 }), ref: "INC-7" } });
    const step = arrival({ subject: subjectOf({ reading: judge({ incidents: [long, other] }) }) });
    expect(step.what.length).toBe(WHAT_CAP);
    expect(step.what.startsWith("A new incident: ÜÜÜ")).toBe(true);
    expect(step.what.endsWith("Ü (INC-98 Critical) · +1 more open")).toBe(true);
  });

  it("fits the longest severities and ref the snapshot keeps beside the count, still naming the title", () => {
    const [kept] = keptIncidents({
      incidents: [
        orgIncident({
          over: {
            loud: { fromSeverity: "F".repeat(300), iso: hoursAgo({ hours: 0.5 }), kind: "severity-changed" },
            ref: "INC-123456",
            severity: "S".repeat(300),
            title: "Checkout down",
          },
        }),
      ],
      nowMs: NOW_MS,
    });
    const other = orgIncident({ over: { loud: paged({ hours: 4 }), ref: "INC-7" } });
    const step = arrival({ subject: subjectOf({ reading: judge({ incidents: [kept!, other] }) }) });
    expect(step.what).toBe(
      `Severity changed from ${"F".repeat(SEVERITY_CAP - 1)}…: Checkout down (INC-123456 ${"S".repeat(SEVERITY_CAP - 1)}…) · +1 more open`,
    );
  });

  it("floats at the ordinary level and has no lapse, since a current key that lapsed would re-post every pass", () => {
    expect([ORG_HEALTH.floats, ORG_HEALTH.noteLevel, ORG_HEALTH.perSubject, ORG_HEALTH.lapsesAt]).toEqual([
      true,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
