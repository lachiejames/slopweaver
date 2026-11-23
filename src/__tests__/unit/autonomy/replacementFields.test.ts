/*
 * `slopweaver autonomy adopt` carries no field name on its `<actionId>=<value>` positional: the VALUE says
 * whether it repairs `subject` or `doneIso`. That is only safe while the two value spaces cannot overlap,
 * and the rules that make them disjoint live in two files — `ISO_INSTANT` in `autonomy/row.ts`, and the
 * three subject forms in `autonomy/subject.ts`. Nothing stops one of them widening under the other, so this
 * file is the witness rather than a comment claiming it.
 */
import { describe, expect, it } from "vitest";

import { isAutonomyInstant, isCheckableSubject } from "../../../autonomy/fields.js";

/** Every instant spelling `ISO_INSTANT` admits, one per shape it allows. */
const INSTANTS: readonly string[] = [
  "2026-09-14T01:15:00Z",
  "2026-09-14T01:15:00.1Z",
  "2026-09-14T01:15:00.123456789Z",
  "2026-09-14T11:15:00+10:00",
  "2026-09-14T11:15:00.123456-07:00",
  "2026-01-01T00:00:00Z",
];

/** One checkable subject of each of the three forms `classifyAutonomySubject` accepts. */
const SUBJECTS: readonly string[] = [
  "https://github.com/lachiejames/slopweaver/pull/636",
  "http://localhost:3000/x",
  "state:ledgers/autonomy.pre-adopt-2026-09-13T15-20-27-700Z.jsonl",
  "acquireoperationlock-s-stale-lock-takeover-is-not-mutually",
  "257-1-dogfood-bugs-636-landed",
];

describe("the two replacement value spaces are disjoint", () => {
  it("declares both registries non-empty, so the guards below are not vacuously true", () => {
    expect(INSTANTS.length).toBeGreaterThan(0);
    expect(SUBJECTS.length).toBeGreaterThan(0);
  });

  it("reads every instant spelling as an instant", () => {
    expect(INSTANTS.filter((value) => !isAutonomyInstant({ value }))).toEqual([]);
  });

  it("reads no instant spelling as a checkable subject, so a doneIso repair can never land on subject", () => {
    expect(INSTANTS.filter((subject) => isCheckableSubject({ subject }))).toEqual([]);
  });

  it("reads every checkable subject as a checkable subject", () => {
    expect(SUBJECTS.filter((subject) => !isCheckableSubject({ subject }))).toEqual([]);
  });

  it("reads no checkable subject as an instant, so a subject repair can never land on doneIso", () => {
    expect(SUBJECTS.filter((value) => isAutonomyInstant({ value }))).toEqual([]);
  });
});

describe("isAutonomyInstant", () => {
  it("refuses the placeholder an earlier row carried, which took the whole register off the page", () => {
    expect(isAutonomyInstant({ value: "2026-09-14T01:1xZ" })).toBe(false);
  });

  it("refuses a spelling Date parses but this register does not, so query.ts's fraction scan stays total", () => {
    expect(isAutonomyInstant({ value: "2026.09.12 00:00:00 GMT" })).toBe(false);
  });

  it("refuses a shaped instant naming a month no clock has", () => {
    expect(isAutonomyInstant({ value: "2026-13-01T00:00:00Z" })).toBe(false);
  });

  it("refuses a date with no time at all", () => {
    expect(isAutonomyInstant({ value: "2026-09-14" })).toBe(false);
  });

  it("refuses an empty value", () => {
    expect(isAutonomyInstant({ value: "" })).toBe(false);
  });

  it("refuses a padded instant rather than trimming it, so the wire and the record cannot disagree", () => {
    // `requireInstant` trims before asking, so validation is unchanged. What this refuses is the adopt
    // classifier taking a padded value and writing it into the register's line still padded, while the
    // record read back off that line carried the trimmed spelling of the same act's instant.
    expect(isAutonomyInstant({ value: "  2026-09-14T01:15:00Z  " })).toBe(false);
  });
});
