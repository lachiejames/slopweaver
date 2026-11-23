/**
 * `fleet-unhealthy` and the listener beside it: an unmeasurable listener is never a trip; one NEVER ARMED on this
 * install (arm record, heartbeat and arm journal all read, the journal empty) is an INFO line on the note rather than the blind spot that
 * would refuse every `--fire`; any other unmeasurable listener stays a blind spot.
 */
import { describe, expect, it } from "vitest";

import { err, ok } from "../../../lib/result.js";
import { ListenerStateErrors } from "../../../live/listen/supervise/errors.js";
import type { ListenerHeartbeat } from "../../../live/listen/supervise/heartbeat.js";
import type { ListenerArm } from "../../../live/listen/supervise/liveness.js";
import { evaluateFleetUnhealthy, listenerNeverArmed, NEVER_ARMED_LINE } from "../../../monitor/fleetHealth.js";
import type { MonitorReading } from "../../../monitor/types.js";

import { BOT_CLEAR, DIED_BY_LEASE, many, NO_FATES, NOW, subjectOf } from "./fleetHealthFixtures.js";

/** `bot-off-the-air` on an install whose listener heartbeat was never written. */
const BOT_NO_BEAT: MonitorReading = {
  because: "no listener heartbeat has ever been written on this install",
  monitorId: "bot-off-the-air",
  state: "unmeasurable",
};

/** Two deaths of one row — `deaths` trips on them alone. */
const TWO_DEATHS = many({ count: 2, shape: DIED_BY_LEASE });

const DEATHS_LINE =
  "NEW   resync-corpus-slack — 5h ago, 2× in 24h: died mid-run, never settled before its lease ran out";

describe("evaluateFleetUnhealthy over the listener", () => {
  it("posts over a never-armed listener: no blind spot, one INFO line at the foot of the note", () => {
    // `listen status` reads unarmed, the heartbeat has never been written, and every
    // `--fire` must not refuse on "the listener could not be judged" while 4 of 10 scheduled runs have failed.
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_DEATHS,
        blindSpot: undefined,
        bot: BOT_NO_BEAT,
        fates: NO_FATES,
        listenerNeverArmed: true,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    const subject = subjectOf({ reading });
    expect([reading.state, "blindSpot" in reading, subject.key, subject.checkIn]).toEqual([
      "firing",
      false,
      "deaths",
      true,
    ]);
    expect(subject.detailsInFull).toEqual([DEATHS_LINE, NEVER_ARMED_LINE]);
    expect(subject.details).toEqual([DEATHS_LINE, NEVER_ARMED_LINE]);
  });

  it("keeps a listener whose heartbeat file would not read a blind spot, never excused as by design", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_DEATHS,
        blindSpot: undefined,
        bot: {
          because: "the listener heartbeat could not be read: EACCES",
          monitorId: "bot-off-the-air",
          state: "unmeasurable",
        },
        fates: NO_FATES,
        listenerNeverArmed: false,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toMatchObject({
      blindSpot: "the listener could not be judged: the listener heartbeat could not be read: EACCES",
      state: "firing",
    });
    expect(subjectOf({ reading }).detailsInFull).toEqual([DEATHS_LINE]);
  });

  it("keeps the ledger's own blind spot over a never-armed listener — only the listener is excused", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_DEATHS,
        blindSpot: "1 slot-attempt file(s) did not read",
        bot: BOT_NO_BEAT,
        fates: NO_FATES,
        listenerNeverArmed: true,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toMatchObject({ blindSpot: "1 slot-attempt file(s) did not read", state: "firing" });
    expect(subjectOf({ reading }).detailsInFull).toEqual([DEATHS_LINE, NEVER_ARMED_LINE]);
  });

  it("adds no INFO line when the listener reads at all, whatever the flag says", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: TWO_DEATHS,
        blindSpot: undefined,
        bot: BOT_CLEAR,
        fates: NO_FATES,
        listenerNeverArmed: true,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(subjectOf({ reading }).detailsInFull).toEqual([DEATHS_LINE]);
  });

  it("reads clear over a never-armed listener when no job signal trips", () => {
    const reading = evaluateFleetUnhealthy({
      inputs: {
        attempts: many({ count: 5, shape: {} }),
        blindSpot: undefined,
        bot: BOT_NO_BEAT,
        fates: NO_FATES,
        listenerNeverArmed: true,
        noteUp: false,
        repairing: 0,
        shown: undefined,
      },
      nowIso: NOW,
    });
    expect(reading).toEqual({ monitorId: "fleet-unhealthy", state: "clear" });
  });
});

describe("listenerNeverArmed", () => {
  const unreadable = err(ListenerStateErrors.unreadable({ cause: "EACCES", path: "/home/live/listener/x.json" }));
  const arm: ListenerArm = {
    armId: "arm-1",
    logPath: "/home/live/listener/arm-1.log",
    pid: 4242,
    scope: { channels: ["D0SYN000001"], kind: "channels" },
    startedAtIso: NOW,
    threadReplyChannels: [],
  };
  const beat: ListenerHeartbeat = {
    armId: "arm-1",
    lastSocketEventAtIso: undefined,
    pid: 4242,
    socketState: "connected",
    socketStateSinceIso: NOW,
    writtenAtIso: NOW,
  };

  it("is true only when the arm record and the heartbeat both read and are both absent", () => {
    const arms = [ok(undefined), ok(arm), unreadable] as const;
    const beats = [ok(undefined), ok(beat), unreadable] as const;
    const pairs = arms.flatMap((one) => beats.map((other) => ({ arm: one, heartbeat: other })));
    expect(pairs.map((pair) => listenerNeverArmed({ ...pair, journalBytes: ok(0) }))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("is false over two absent files when the journal holds any byte, or would not read", () => {
    // A supervised listener that armed, lost its first beat, died and was cleared leaves both
    // current files absent — only the journal still says it armed.
    const journals = [ok(0), ok(1), ok(240), err(["arms.jsonl could not be read: EACCES"])] as const;
    const verdicts = journals.map((journalBytes) =>
      listenerNeverArmed({ arm: ok(undefined), heartbeat: ok(undefined), journalBytes }),
    );
    expect(verdicts).toEqual([true, false, false, false]);
  });
});
