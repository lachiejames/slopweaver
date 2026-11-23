/*
 * The page's watcher over a false running-list claim, on plain fake seams: the voice's "I've put a revision on your
 * running list" posted as the closed running-list grounding when no offer landed that the owner has not moved on from,
 * and nothing posted when one did.
 */

import { describe, expect, it } from "vitest";

import type { PlanPost } from "../../components/voice/planCallClient";
import type { HeldPlanCall } from "../../components/voice/planWiringHeld";
import type { ToolLine } from "../../components/voice/voiceContext";
import { voiceRecordWatcher } from "../../components/voice/voiceRecordWiring";
import type { VoiceRecordSeams } from "../../components/voice/voiceRecordWiringPoster";
import type { QueueShownCounts } from "../../lib/queueShownCounts";

/** No count is spoken in these calls, so the figures only have to exist. */
const SHOWN: QueueShownCounts = {
  everything: 0,
  otherContext: { context: "slopweaver", count: 0 },
  view: "all",
  views: { all: 0, "check-in": 0, colleague: 0, finding: 0, fleet: 0, review: 0, slack: 0, urgent: 0 },
  waiting: 0,
};

const HELD: HeldPlanCall = { callId: "call-1", claimant: "page-1", follow: new AbortController() };

/** Let every resolved post's `.then` run. */
async function settle(): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    await Promise.resolve();
  }
}

/**
 * A watcher on fake seams that answer each claim grounding post from a script, in order.
 *
 * @param claims what each claim grounding post answers
 * @returns the watcher, every claim grounding it posted and every line it logged by name
 */
function watched({ claims = [] }: { claims?: readonly PlanPost[] }) {
  const claimed: unknown[] = [];
  const lines: ToolLine[] = [];
  const seams: VoiceRecordSeams = {
    after: () => () => undefined,
    claimGrounding: (input) => {
      claimed.push(input);
      return Promise.resolve(claims[claimed.length - 1]);
    },
    countGrounding: () => Promise.resolve({ kind: "taken" }),
    record: () => Promise.resolve({ kind: "taken" }),
  };
  const watcher = voiceRecordWatcher({
    current: () => true,
    heardStamp: () => undefined,
    held: () => HELD,
    note: ({ line }) => {
      lines.push(line);
    },
    openCardDraft: () => undefined,
    recordRead: () => undefined,
    seams,
    shownNow: () => SHOWN,
  });
  return {
    claimed,
    named: ({ name }: { name: string }) =>
      lines.filter((line) => line.name === name).map(({ detail, refused }) => [refused, detail]),
    watcher,
  };
}

describe("voiceRecordWatcher — a running-list claim", () => {
  const revision = " I've put a revision on your running list that quotes lines and responds to them one at a time.";

  // The owner answers a revision claim's FINAL by saying nothing like it was put on their running list.
  it("posts the claim as the closed running-list shape when no offer landed, logged ungrounded then recorded", async () => {
    const w = watched({ claims: [{ kind: "taken" }] });
    w.watcher.speech({ final: true, speech: { id: "v9", text: revision, who: "voice" } });
    await settle();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([
      [{ callId: "call-1", grounding: { key: "v9:1", kind: "running-list" } }],
      [
        [
          true,
          `said "I've put a revision on your running list that quotes lines and responds to them one at a time.": no offer landed on the owner's running list that they have not moved on from`,
        ],
        [
          false,
          `recorded where "I've put a revision on your running list that quotes lines and responds to them one at a time." came from, for the thinking model; the call owes the voice a correction aloud`,
        ],
      ],
    ]);
  });

  it("posts nothing when an offer landed and the owner has not moved on from it", async () => {
    const w = watched({});
    w.watcher.offerLanded();
    w.watcher.speech({ final: true, speech: { id: "v10", text: revision, who: "voice" } });
    await settle();
    expect([w.claimed, w.named({ name: "spoken-grounding" })]).toEqual([[], []]);
  });

  it("takes the owner's sentence's FIRST heard as the boundary, so an offer landing before its FINAL still grounds", async () => {
    const w = watched({});
    w.watcher.speech({ final: false, speech: { id: "h1", text: " Yes", who: "owner" } });
    w.watcher.offerLanded();
    w.watcher.speech({ final: true, speech: { id: "h1", text: " Yes, do that.", who: "owner" } });
    w.watcher.speech({ final: true, speech: { id: "v11", text: revision, who: "voice" } });
    await settle();
    expect(w.claimed).toEqual([]);
  });

  it("posts nothing when the owner only made a sound between the offer landing and the line about it", async () => {
    const w = watched({});
    w.watcher.offerLanded();
    w.watcher.speech({ final: false, speech: { id: "h3", text: " [lip smack]", who: "owner" } });
    w.watcher.speech({ final: true, speech: { id: "v13", text: revision, who: "voice" } });
    await settle();
    expect(w.claimed).toEqual([]);
  });

  it("posts the claim once the owner has started a sentence after the voice answered the offer", async () => {
    const w = watched({ claims: [{ kind: "taken" }] });
    w.watcher.offerLanded();
    w.watcher.speech({ final: true, speech: { id: "v14", text: " Understood.", who: "voice" } });
    w.watcher.speech({ final: false, speech: { id: "h2", text: " That", who: "owner" } });
    w.watcher.speech({ final: true, speech: { id: "v12", text: revision, who: "voice" } });
    await settle();
    expect(w.claimed).toEqual([{ callId: "call-1", grounding: { key: "v12:1", kind: "running-list" } }]);
  });
});
