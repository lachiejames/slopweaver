/*
 * No workstream in the store yet is an answer, never a failed read, since the warning triangles it
 * drew on the sidebar and the Queue made everything look broken. The runner half (exit 3 becomes a typed payload) and the reader half (that payload becomes the absent arm) are both
 * here, with every consumer that used to mark it.
 */
import { describe, expect, it } from "vitest";

import type { LiveState } from "../../lib/liveState";
import { liveResultOf } from "../../lib/liveVerbRun";
import { type LiveVerb, liveVerbFor } from "../../lib/liveVerbs";
import { focusGap, queueFocuses } from "../../lib/queueFocus";
import { NO_REGISTER_TITLE, unfinishedWorkstreamsReadingOf } from "../../lib/sidebarCounts";
import {
  isWorkstreamsAbsent,
  readWorkstreamsReading,
  type WorkstreamsReading,
  workstreamsOf,
} from "../../lib/workstreamsReading";
import { documentWith, linked } from "./workstreamTilesFixture";

const ROW: LiveVerb = liveVerbFor({ slug: "workstreams" })!;
const AT = "2026-11-02T12:00:00.000Z";
const ABSENT_SENTENCE =
  "slopweaver workstreams list --json exited 3: workstreams list: no workstreams yet — the store holds none and no register document";
const ABSENT_PAYLOAD = { code: "NO_WORKSTREAMS", kind: "expected-empty", why: ABSENT_SENTENCE };

/** The register's reading, arrived, as `useLive` holds it. */
function readyOf({ value }: { value: WorkstreamsReading }): LiveState<WorkstreamsReading> {
  return { fixture: undefined, observedAtIso: AT, phase: "ready", stampedByRoute: true, value };
}

describe("the workstreams allowlist row", () => {
  it("declares exit 3 as NO_WORKSTREAMS", () => {
    expect(ROW.expectedEmpty).toEqual({ code: "NO_WORKSTREAMS", exitCode: 3 });
  });

  it("answers exit 3 with a typed expected-empty payload carrying the verb's sentence", () => {
    const result = liveResultOf({
      outcome: { err: "", exitCode: 3, notMeasured: ABSENT_SENTENCE, ok: false, out: "", tookMs: 410 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ observedAtIso: AT, ok: true, payload: ABSENT_PAYLOAD, stampedByRoute: true });
  });

  it("keeps exit 1 a failure: an unreadable register is a fault, not an absent one", () => {
    const result = liveResultOf({
      outcome: { err: "", exitCode: 1, notMeasured: "workstreams list exited 1", ok: false, out: "", tookMs: 5 },
      receivedAtIso: AT,
      verb: ROW,
    });
    expect(result).toEqual({ notMeasured: "workstreams list exited 1", observedAtIso: AT, ok: false });
  });
});

describe("readWorkstreamsReading", () => {
  it("reads the NO_WORKSTREAMS payload as the absent arm, with the verb's sentence", () => {
    expect(readWorkstreamsReading({ payload: ABSENT_PAYLOAD })).toEqual({ kind: "absent", why: ABSENT_SENTENCE });
  });

  it("refuses an expected-empty payload naming another code, or carrying no sentence", () => {
    expect([
      readWorkstreamsReading({ payload: { ...ABSENT_PAYLOAD, code: "ORG_NOT_CONFIGURED" } }),
      readWorkstreamsReading({ payload: { code: "NO_WORKSTREAMS", kind: "expected-empty" } }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses an envelope-shaped document carrying any key beyond the runner's three", () => {
    expect([
      readWorkstreamsReading({ payload: { ...ABSENT_PAYLOAD, workstreams: 42 } }),
      readWorkstreamsReading({ payload: { ...ABSENT_PAYLOAD, generatedAt: AT } }),
    ]).toEqual([undefined, undefined]);
  });

  it("reads a document through the strict reader, never as absent", () => {
    const reading = readWorkstreamsReading({ payload: documentWith({ workstreams: [linked] }) })!;
    expect(isWorkstreamsAbsent(reading)).toBe(false);
    expect(workstreamsOf({ reading }).map((one) => one.id)).toEqual([linked.id]);
  });

  it("keeps a view decorated with any `kind`, `absent` included, a view with its workstreams", () => {
    const base = readWorkstreamsReading({ payload: documentWith({ workstreams: [linked] }) })!;
    const decorated = ["present", "absent"].map((kind) => ({ ...base, kind }) as WorkstreamsReading);
    expect(decorated.map((reading) => isWorkstreamsAbsent(reading))).toEqual([false, false]);
    expect(decorated.map((reading) => workstreamsOf({ reading }).map((one) => one.id))).toEqual([
      [linked.id],
      [linked.id],
    ]);
  });

  it("holds no workstream when absent", () => {
    expect(workstreamsOf({ reading: { kind: "absent", why: ABSENT_SENTENCE } })).toEqual([]);
  });
});

describe("every consumer that marked it", () => {
  const absent = readyOf({ value: { kind: "absent", why: ABSENT_SENTENCE } });

  it("the Queue draws no priorities gap and lifts no focus", () => {
    expect([focusGap({ workstreams: absent }), queueFocuses({ workstreams: absent })]).toEqual([undefined, []]);
  });

  it("the sidebar badge counts a measured zero, saying why", () => {
    expect(
      unfinishedWorkstreamsReadingOf({ context: "work", reading: { kind: "absent", why: ABSENT_SENTENCE } }),
    ).toEqual({ count: { count: 0, title: NO_REGISTER_TITLE }, phase: "measured" });
  });

  it("the sidebar badge still counts a document as before", () => {
    const reading = readWorkstreamsReading({ payload: documentWith({ workstreams: [] }) })!;
    expect(unfinishedWorkstreamsReadingOf({ context: "work", reading })).toEqual({
      count: {
        count: 0,
        title: "no unfinished workstream in this context; 0 done, abandoned or kept here only not counted",
      },
      phase: "measured",
    });
  });
});
