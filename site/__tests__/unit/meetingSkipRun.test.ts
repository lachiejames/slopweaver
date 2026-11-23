/*
 * `meeting_skip` over plain fake seams: refused before the owner has said anything, refused for a meeting no calendar read
 * named, and otherwise the exact calendar instances added, said again held beside the earlier word, and a call
 * past the cap refused rather than dropping one.
 */
import { describe, expect, it } from "vitest";

import { type MeetingSkipSeams, runMeetingSkip } from "../../components/voice/meetingSkipRun";
import { MEETING_SKIPS_MAX, type MeetingSkip } from "../../lib/meetingDue";

const RETRO = { calendarId: "primary", eventId: "evtfixture01_20261009T043000Z", title: "Fixture team retro" };
const STANDUP = { calendarId: "primary", eventId: "standup_20261009T043100Z", title: "Standup" };

const SAID_MS = Date.parse("2026-10-09T04:00:00.000Z");

/**
 * The runner's seams over a plain list.
 *
 * @param heard the owner's newest final words, `undefined` before any
 * @param held the skips already held
 * @returns the seams, the writes they took, and the instant each call is stamped with
 */
function seamsOf({ heard, held }: { heard: string | undefined; held: readonly MeetingSkip[] }): {
  seams: MeetingSkipSeams;
  writes: (readonly MeetingSkip[])[];
} {
  const writes: (readonly MeetingSkip[])[] = [];
  let skips = held;
  return {
    seams: {
      heard: () => heard,
      nowMs: () => SAID_MS,
      read: () => skips,
      write: ({ skips: next }) => {
        writes.push(next);
        skips = next;
      },
    },
    writes,
  };
}

describe("runMeetingSkip", () => {
  it("holds every meeting the owner ruled out, stamped with the one instant they said it", () => {
    const h = seamsOf({ heard: "I've already had the retro and I'm skipping standup", held: [] });
    const ran = runMeetingSkip({ args: { meetings: [RETRO, STANDUP] }, seams: h.seams });
    expect(ran).toEqual({
      answer: {
        note: "say in a few words that you will not flag it, nothing more",
        skipped: ["Fixture team retro", "Standup"],
      },
      detail: "skipped: Fixture team retro, Standup",
      refused: false,
    });
    expect(h.writes).toEqual([
      [
        { ...RETRO, saidAtMs: SAID_MS },
        { ...STANDUP, saidAtMs: SAID_MS },
      ],
    ]);
  });

  it("refuses before the owner has said anything final, and holds nothing", () => {
    const why = "the owner has said nothing on this call yet: a meeting is only skipped on their own words";
    const silent = seamsOf({ heard: undefined, held: [] });
    const blank = seamsOf({ heard: "   ", held: [] });
    expect([
      runMeetingSkip({ args: { meetings: [RETRO] }, seams: silent.seams }),
      runMeetingSkip({ args: { meetings: [RETRO] }, seams: blank.seams }),
    ]).toEqual([
      { answer: { refused: why }, detail: why, refused: true },
      { answer: { refused: why }, detail: why, refused: true },
    ]);
    expect([silent.writes, blank.writes]).toEqual([[], []]);
  });

  it.each([
    ["no list", { meetings: RETRO }],
    ["an empty list", { meetings: [] }],
    ["more meetings than one call may skip", { meetings: Array.from({ length: 9 }, () => RETRO) }],
    ["a meeting that is not an object", { meetings: ["Fixture team retro"] }],
  ])("refuses %s", (_label, args) => {
    const h = seamsOf({ heard: "skip it", held: [] });
    const why = "meetings must list 1 to 8 meetings, each off a calendar read";
    expect(runMeetingSkip({ args, seams: h.seams })).toEqual({ answer: { refused: why }, detail: why, refused: true });
    expect(h.writes).toEqual([]);
  });

  it.each([
    ["a meeting named by title alone", { title: "Fixture team retro" }],
    ["a meeting with an empty event id", { ...RETRO, eventId: "" }],
    ["a meeting with no calendar id", { eventId: RETRO.eventId, title: RETRO.title }],
    ["a meeting with a title past the cap", { ...RETRO, title: "x".repeat(201) }],
  ])("refuses %s, holding none of the call's meetings", (_label, meeting) => {
    const h = seamsOf({ heard: "skip it", held: [] });
    const why = "every meeting needs the calendarId, eventId and title a calendar read printed for it";
    expect(runMeetingSkip({ args: { meetings: [STANDUP, meeting] }, seams: h.seams })).toEqual({
      answer: { refused: why },
      detail: why,
      refused: true,
    });
    expect(h.writes).toEqual([]);
  });

  it("keeps the same event id on another calendar as its own meeting", () => {
    const work: MeetingSkip = { ...RETRO, calendarId: "team@group.calendar.google.com", saidAtMs: SAID_MS - 60_000 };
    const h = seamsOf({ heard: "had it", held: [work] });
    runMeetingSkip({ args: { meetings: [RETRO] }, seams: h.seams });
    expect(h.writes).toEqual([[work, { ...RETRO, saidAtMs: SAID_MS }]]);
  });

  it("refuses, evicting nothing, once the page holds as many skips as it may", () => {
    const held: MeetingSkip[] = Array.from({ length: MEETING_SKIPS_MAX }, (_, index) => ({
      calendarId: "primary",
      eventId: `event-${String(index)}`,
      saidAtMs: SAID_MS - index,
      title: `Meeting ${String(index)}`,
    }));
    const h = seamsOf({ heard: "had it", held });
    const why = "the page already holds 64 meetings off, and holds at most 64";
    expect(runMeetingSkip({ args: { meetings: [RETRO] }, seams: h.seams })).toEqual({
      answer: { refused: why },
      detail: why,
      refused: true,
    });
    expect(h.writes).toEqual([]);
  });

  it("holds a meeting said again beside its earlier word, dropping and replacing nothing", () => {
    const earlier: MeetingSkip = { ...RETRO, saidAtMs: SAID_MS - 13 * 60 * 60_000, title: "Retro" };
    const other: MeetingSkip = { ...STANDUP, saidAtMs: SAID_MS - 30_000 };
    const h = seamsOf({ heard: "yeah, done with the retro", held: [earlier, other] });
    runMeetingSkip({ args: { meetings: [RETRO, RETRO] }, seams: h.seams });
    expect(h.writes).toEqual([[earlier, other, { ...RETRO, saidAtMs: SAID_MS }]]);
  });

  it("writes nothing new for a meeting already held at the same instant", () => {
    const held: MeetingSkip = { ...RETRO, saidAtMs: SAID_MS };
    const h = seamsOf({ heard: "had it", held: [held] });
    runMeetingSkip({ args: { meetings: [RETRO] }, seams: h.seams });
    expect(h.writes).toEqual([[held]]);
  });
});
