/**
 * The read half of what the owner's words answered, over the bare-yes call (`../../answeredTriageHome.ts`) in a
 * throwaway home: a relay anchor found through the call index, a call anchor read straight, and every way a read
 * fails said rather than guessed.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { readAnswerContexts, relayAnswerAtDelivery } from "../../../talk/answerContextRead.js";
import { STILL_SPEAKING_HOLD, TAIL_UNSTATED_HOLD } from "../../../talk/relayCutHold.js";
import {
  ANSWERED_CALL,
  ANSWERED_QUESTION,
  ANSWERED_QUESTION_SEGMENT,
  ANSWERED_TURN,
  writeAnsweredTriageHome,
} from "../../answeredTriageHome.js";

const CALL = ANSWERED_CALL;
const TURN = ANSWERED_TURN;
const QUESTION = {
  beganIso: "2026-10-13T23:38:26.835Z",
  pointer: `talk-call:${CALL}#${ANSWERED_QUESTION_SEGMENT}`,
  text: ANSWERED_QUESTION,
};

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The incident's records in a throwaway home. */
function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), "answer-read-"));
  homes.push(home);
  writeAnsweredTriageHome({ home });
  return home;
}

describe("readAnswerContexts", () => {
  it("finds a relay's call through the index, the question before the owner's words, and the verdict as never recorded", () => {
    const anchor = `talk:${TURN}`;
    expect(readAnswerContexts({ anchors: [anchor], home: fixtureHome() }).get(anchor)).toStrictEqual({
      triage: { kind: "not-recorded", slug: "talk-a00000250000" },
      voice: { kind: "found", turn: QUESTION },
    });
  });

  it("reads a call anchor straight from its call, where no relay ruled", () => {
    const anchor = `call:${CALL}#turn_000000000000000000023`;
    expect(readAnswerContexts({ anchors: [anchor], home: fixtureHome() }).get(anchor)).toStrictEqual({
      triage: { kind: "not-applicable" },
      voice: { kind: "found", turn: QUESTION },
    });
  });

  it("says a relay whose call recorded no relay line was not found, never the nearest question", () => {
    const home = fixtureHome();
    writeFileSync(join(home, "talk", "call-index.txt"), "");
    const anchor = `talk:${TURN}`;
    expect(readAnswerContexts({ anchors: [anchor], home }).get(anchor)!.voice).toStrictEqual({
      kind: "not-found",
      why: `no call records a relay line for turn ${TURN}`,
    });
  });

  it("finds a relay line written in valid JSON with spacing the writer never uses", () => {
    const home = fixtureHome();
    const path = join(home, "talk", "calls", `${CALL}.jsonl`);
    const compact = `"turnId":"${TURN}"`;
    const spaced = readFileSync(path, "utf8").replace(compact, `"turnId": "${TURN}"`);
    expect(spaced.includes(compact)).toBe(false);
    writeFileSync(path, spaced);
    const anchor = `talk:${TURN}`;
    expect(readAnswerContexts({ anchors: [anchor], home }).get(anchor)!.voice).toStrictEqual({
      kind: "found",
      turn: QUESTION,
    });
  });

  it("reads the same turn for an anchor whose UUID is cased otherwise, on any disk", () => {
    const anchor = `talk:${TURN.toUpperCase()}`;
    expect(readAnswerContexts({ anchors: [anchor], home: fixtureHome() }).get(anchor)).toStrictEqual({
      triage: { kind: "not-recorded", slug: "talk-a00000250000" },
      voice: { kind: "found", turn: QUESTION },
    });
  });

  it("finds a relay line whose UUID is cased otherwise than the turn it names", () => {
    const home = fixtureHome();
    const path = join(home, "talk", "calls", `${CALL}.jsonl`);
    const upper = readFileSync(path, "utf8").replace(`"turnId":"${TURN}"`, `"turnId":"${TURN.toUpperCase()}"`);
    expect(upper.includes(TURN.toUpperCase())).toBe(true);
    writeFileSync(path, upper);
    const anchor = `talk:${TURN}`;
    expect(readAnswerContexts({ anchors: [anchor], home }).get(anchor)!.voice).toStrictEqual({
      kind: "found",
      turn: QUESTION,
    });
  });

  it("says a relay turn that kept only the tail of the owner's words cannot name the question, never matching on the tail", () => {
    const home = fixtureHome();
    const path = join(home, "talk", "turns", `${TURN}.json`);
    const turn = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...turn, heardTruncated: true })}\n`);
    const anchor = `talk:${TURN}`;
    expect(readAnswerContexts({ anchors: [anchor], home }).get(anchor)).toStrictEqual({
      triage: { kind: "not-recorded", slug: "talk-a00000250000" },
      voice: {
        kind: "not-found",
        why: "kept only the tail of the owner's words, so where they began cannot be told; read the call",
      },
    });
  });

  it("says a relay turn with no file could not be read, in both halves", () => {
    const anchor = "talk:00000000-0000-4000-8000-000000000000";
    const read = readAnswerContexts({ anchors: [anchor], home: fixtureHome() }).get(anchor)!;
    expect([read.voice.kind, read.triage.kind]).toStrictEqual(["unreadable", "unreadable"]);
  });

  it("calls a call with a torn line unreadable, since the torn line may be the question, never the last that parsed", () => {
    const home = fixtureHome();
    appendFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), '{"kind":"segment","who":"voice","text":"Ship\n');
    const anchor = `call:${CALL}#turn_000000000000000000023`;
    expect(readAnswerContexts({ anchors: [anchor], home }).get(anchor)!.voice).toStrictEqual({
      kind: "unreadable",
      why: `1 line(s) of call ${CALL} do not parse, and the voice turn the owner answered may be one of them`,
    });
  });

  // The scan found the older call's relay line and read its question, past the newer call's torn one.
  it("calls a relay unreadable when a newer call names its turn on a torn line, never the older call's question", () => {
    const home = fixtureHome();
    const newer = "b5cd1f1f-0000-4000-8000-000000000000";
    writeFileSync(join(home, "talk", "calls", `${newer}.jsonl`), `{"kind":"relay","turnId":"${TURN}"\n`);
    appendFileSync(join(home, "talk", "call-index.txt"), `${newer}\n`);
    const anchor = `talk:${TURN}`;
    expect(readAnswerContexts({ anchors: [anchor], home }).get(anchor)!.voice).toStrictEqual({
      kind: "unreadable",
      why: `call ${newer} names turn ${TURN} and 1 line(s) of call ${newer} do not parse, so its relay line may be torn`,
    });
  });

  it("names an anchor that is neither a relay nor a call utterance", () => {
    const anchor = "session:typed-by-the-chair";
    expect(readAnswerContexts({ anchors: [anchor], home: fixtureHome() }).get(anchor)).toStrictEqual({
      triage: { kind: "not-applicable" },
      voice: { kind: "not-found", why: `${anchor} names no call utterance or relay turn` },
    });
  });
});

describe("relayAnswerAtDelivery", () => {
  it("takes the verdict from the record in hand and the question from the call", () => {
    const record = {
      heardTailCut: false,
      slug: "talk-a00000250000",
      triageRuling: { label: undefined, verdict: "needs-more-info" },
      turnId: TURN,
      typed: false,
    } as const;
    expect(relayAnswerAtDelivery({ home: fixtureHome(), record })).toStrictEqual({
      triage: { kind: "stored", ruling: { label: undefined, verdict: "needs-more-info" } },
      voice: { kind: "found", turn: QUESTION },
    });
  });

  // The chair line stated a cut relay's verdict as though it took effect.
  it("reads a stored verdict on words not stated whole as unreadable, cut or unstated, naming why", () => {
    const ruling = { label: undefined, verdict: "send-it" } as const;
    const base = { slug: "talk-a00000250000", triageRuling: ruling, turnId: TURN, typed: false } as const;
    expect([
      relayAnswerAtDelivery({ home: fixtureHome(), record: { ...base, heardTailCut: true } }).triage,
      relayAnswerAtDelivery({ home: fixtureHome(), record: base }).triage,
      relayAnswerAtDelivery({ home: fixtureHome(), record: { ...base, heardTailCut: true, triageRuling: null } })
        .triage,
    ]).toStrictEqual([
      { kind: "unreadable", why: `send-it heard but not applied: ${STILL_SPEAKING_HOLD}` },
      { kind: "unreadable", why: `send-it heard but not applied: ${TAIL_UNSTATED_HOLD}` },
      { kind: "none" },
    ]);
  });

  it("reads no call for a typed steer, which followed no voice turn", () => {
    const record = { slug: "talk-x", triageRuling: null, turnId: TURN, typed: true } as const;
    expect(relayAnswerAtDelivery({ home: fixtureHome(), record })).toStrictEqual({
      triage: { kind: "none" },
      voice: { kind: "not-found", why: "the owner typed it on the console, after no voice turn" },
    });
  });
});
