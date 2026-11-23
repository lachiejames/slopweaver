/**
 * `orgHealth/standing.ts` — the one judgement both channels read. A red indicator beside the
 * count of incidents ongoing, a yellow one for an incident suspected and under investigation.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "../../../lib/result.js";
import type { Acknowledgement } from "../../../orgHealth/acknowledgement.js";
import { OrgHealthErrors } from "../../../orgHealth/errors.js";
import { orgHealthStanding, orgHealthStatus } from "../../../orgHealth/standing.js";
import type { OrgIncident } from "../../../orgHealth/types.js";
import { HOUR_MS, measuredSnapshot, NOW_ISO, NOW_MS, orgIncident } from "./orgIncidentFixture.js";

/** The `org-health status` document for a fresh snapshot holding `incidents`. */
const statusOf = ({
  incidents,
  acknowledgements = new Map([["INC-98", { state: "none" }]]),
}: {
  incidents: readonly OrgIncident[];
  acknowledgements?: ReadonlyMap<string, Acknowledgement>;
}) =>
  orgHealthStatus({
    acknowledgements,
    investigations: new Map([["INC-98", { state: "none" }]]),
    standing: orgHealthStanding({ nowMs: NOW_MS, snapshot: ok(measuredSnapshot({ incidents })) }),
  });

/** INC-97, its cause confirmed and a fix on the way. */
const FIXING = orgIncident({
  over: {
    phase: "identified",
    phaseChangedIso: "2026-10-04T08:30:00.000Z",
    ref: "INC-97",
    status: "Fixing",
    title: "Login loop",
  },
});

describe("orgHealthStatus", () => {
  it("is healthy with nothing open, a resolution included", () => {
    const resolved = orgIncident({ over: { phase: "resolved", status: "Closed" } });
    expect(statusOf({ incidents: [resolved] })).toEqual({
      incidents: [],
      investigating: 0,
      ongoing: 0,
      readIso: NOW_ISO,
      schemaVersion: 1,
      state: "measured",
      tone: "healthy",
    });
  });

  it("is yellow while every open incident is still under investigation", () => {
    const status = statusOf({ incidents: [orgIncident()] });
    expect(status).toEqual({
      incidents: [
        {
          acknowledgement: { state: "none" },
          investigation: { state: "none" },
          line: "INC-98 Critical · Payment checkout regression — investigating, root cause unknown so far",
          ref: "INC-98",
          url: "https://app.incident.io/example-org/incidents/98",
        },
      ],
      investigating: 1,
      ongoing: 1,
      readIso: NOW_ISO,
      schemaVersion: 1,
      state: "measured",
      tone: "yellow",
    });
  });

  it("is red, counting every incident ongoing, once any is past investigating — newest phase change first", () => {
    const status = statusOf({ incidents: [orgIncident(), FIXING] });
    expect(status).toMatchObject({ investigating: 1, ongoing: 2, tone: "red" });
    expect((status as Extract<typeof status, { state: "measured" }>).incidents.map((one) => one.line)).toEqual([
      "INC-97 Critical · Login loop — root cause confirmed, fix dispatching",
      "INC-98 Critical · Payment checkout regression — investigating, root cause unknown so far",
    ]);
  });

  it("is unmeasurable, never healthy, with no read, a failed read, a read under way or a stale one", () => {
    const at = ({ snapshot }: { snapshot: Parameters<typeof orgHealthStanding>[0]["snapshot"] }) =>
      orgHealthStatus({
        acknowledgements: new Map(),
        investigations: new Map(),
        standing: orgHealthStanding({ nowMs: NOW_MS, snapshot }),
      });
    const stale = measuredSnapshot({ incidents: [], readIso: new Date(NOW_MS - HOUR_MS).toISOString() });
    const statuses = [
      at({ snapshot: ok(null) }),
      at({ snapshot: err(OrgHealthErrors.fileMalformed({ detail: "bad", path: "/h/incidents.json" })) }),
      at({
        snapshot: ok({
          attemptedIso: NOW_ISO,
          because: "a read is under way",
          schemaVersion: 1,
          state: "unmeasurable",
        }),
      }),
      at({ snapshot: ok(stale) }),
    ];
    expect(statuses.map((status) => status.state)).toEqual([
      "unmeasurable",
      "unmeasurable",
      "unmeasurable",
      "unmeasurable",
    ]);
    expect(statuses[2]).toEqual({ because: "a read is under way", schemaVersion: 1, state: "unmeasurable" });
  });

  it("reads an incident the investigation reading holds nothing for as unmeasured, never as nobody looking", () => {
    const status = statusOf({ incidents: [orgIncident(), FIXING] });
    expect((status as Extract<typeof status, { state: "measured" }>).incidents.map((one) => one.investigation)).toEqual(
      [{ because: "no investigation reading was taken for INC-97", state: "unmeasured" }, { state: "none" }],
    );
  });

  it("carries each incident's acknowledgement, a missing one unmeasured, and an acknowledgement never moves the tone", () => {
    const status = statusOf({
      acknowledgements: new Map([["INC-98", { atIso: NOW_ISO, state: "acknowledged" }]]),
      incidents: [orgIncident(), FIXING],
    });
    expect(status).toMatchObject({ investigating: 1, ongoing: 2, tone: "red" });
    expect(
      (status as Extract<typeof status, { state: "measured" }>).incidents.map((one) => one.acknowledgement),
    ).toEqual([
      { because: "no acknowledgement reading was taken for INC-97", state: "unmeasured" },
      { atIso: NOW_ISO, state: "acknowledged" },
    ]);
  });
});
