/**
 * `session close-done` keeping an at-rest seat whose run's own pull request is still open — landing it is the seat's
 * work — and keeping it too when GitHub could not say. MEASURED: a seat NEXT on the lap lock
 * was parked twice in an hour while it held for the lap seat's GO.
 */
import { afterEach, describe, expect, it } from "vitest";

import { closeDoneWithClient } from "../../../../../cli/commands/session/closeDone.js";
import type { ParkSeatDeps } from "../../../../../cli/commands/session/closeDoneParkLook.js";
import { readRunJournal } from "../../../../../handover/runStore.js";
import { unwrap } from "../../../../../lib/result.js";
import { ownPullRequestKeep, QUIET_PARK_KEEPS } from "../../../../../sessions/parkSeat.js";
import { fakeClient } from "./closeDoneFakeCmux.js";
import { deps, outcomesOf, registry, removeFixtureDirs, sessionRecord } from "./closeDoneHarness.js";
import { AT_REST, parkedFixture, predecessorPark, SEAT, SEAT_TREE } from "./closeDoneParkFixture.js";

afterEach(removeFixtureDirs);

const PR_URL = "https://github.com/acme/widget/pull/3784";
const OPEN_WHY = `its run's own pull request is open, and landing it is its work: ${PR_URL}`;

/** A GitHub read of the run's branches, counting how often it is asked. */
function pulls({ answer }: { answer: Awaited<ReturnType<ParkSeatDeps["ownPullRequests"]>> }): {
  readonly read: ParkSeatDeps["ownPullRequests"];
  readonly asked: () => readonly string[];
} {
  const slugs: string[] = [];
  return {
    asked: () => slugs,
    read: async ({ slug }) => {
      slugs.push(slug);
      return answer;
    },
  };
}

/** A whole read finding the run's own pull request open. */
const OPEN_ANSWER: Awaited<ReturnType<ParkSeatDeps["ownPullRequests"]>> = {
  branches: ["parked-doc"],
  kind: "read",
  pulls: [{ number: 3784, state: "OPEN", url: PR_URL }],
  repo: "acme/widget",
};

describe("closeDoneWithClient — a seat landing its own pull request", () => {
  it("keeps an at-rest holder whose run's pull request is open, journalling and closing nothing", async () => {
    const { fixture, runsDir } = parkedFixture();
    const before = unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.length;
    const github = pulls({ answer: OPEN_ANSWER });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        parkSeat: registry({ ownPullRequests: github.read, records: [sessionRecord()] }),
      }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "own-pull-request",
        why: OPEN_WHY,
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(before);
    expect(github.asked()).toEqual(["parked-doc"]);
  });

  it("keeps the seat when GitHub could not be read", async () => {
    const { fixture, runsDir } = parkedFixture();
    const before = unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.length;
    const github = pulls({ answer: { kind: "unread", why: "HTTP 502" } });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        parkSeat: registry({ ownPullRequests: github.read, records: [sessionRecord()] }),
      }),
    });
    expect(outcomesOf(swept)).toEqual([
      {
        item: { kind: "park-candidate", row: expect.anything(), workspace: SEAT },
        kind: "park-kept",
        reason: "own-pull-request-unreadable",
        why: "its own pull requests did not read — HTTP 502",
      },
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(before);
  });

  it("keeps a seat a park already journalled and left open, once its pull request is open", async () => {
    const { fixture, runsDir } = parkedFixture();
    predecessorPark({ runsDir });
    const before = unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events.length;
    const github = pulls({ answer: OPEN_ANSWER });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        parkSeat: registry({ ownPullRequests: github.read, records: [sessionRecord()] }),
      }),
    });
    expect(outcomesOf(swept).map((outcome) => (outcome.kind === "park-kept" ? outcome.reason : outcome.kind))).toEqual([
      "own-pull-request",
    ]);
    expect(fake.closed).toEqual([]);
    expect(unwrap(readRunJournal({ runsDir, slug: "parked-doc" })).events).toHaveLength(before);
  });

  it("never asks GitHub about a seat whose screen shows it working", async () => {
    const { fixture } = parkedFixture();
    const github = pulls({ answer: OPEN_ANSWER });
    const busy = ["✻ Vibing… (19s)", "❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt"];
    const fake = fakeClient({
      screens: { "id-1": busy.join("\n") },
      trees: { "id-1": [SEAT_TREE] },
      workspaces: [SEAT],
    });
    await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        parkSeat: registry({ ownPullRequests: github.read, records: [sessionRecord()] }),
      }),
    });
    expect(github.asked()).toEqual([]);
    expect(fake.closed).toEqual([]);
  });

  it("parks as before when the read is whole and every pull request on the branch has ended", async () => {
    const { fixture } = parkedFixture();
    const github = pulls({
      answer: {
        branches: ["parked-doc"],
        kind: "read",
        pulls: [{ number: 3700, state: "MERGED", url: "https://github.com/acme/widget/pull/3700" }],
        repo: "acme/widget",
      },
    });
    const fake = fakeClient({ screens: { "id-1": AT_REST }, trees: { "id-1": [SEAT_TREE] }, workspaces: [SEAT] });
    const swept = await closeDoneWithClient({
      deps: deps({
        client: fake.client,
        fixture,
        parkSeat: registry({ ownPullRequests: github.read, records: [sessionRecord()] }),
      }),
    });
    expect(outcomesOf(swept).map((outcome) => outcome.kind)).toEqual(["parked"]);
    expect(fake.closed).toEqual(["id-1"]);
  });
});

describe("ownPullRequestKeep", () => {
  it("keeps on an open pull request, a draft included, naming every open one", () => {
    expect(
      ownPullRequestKeep({
        answer: {
          branches: ["b"],
          kind: "read",
          pulls: [
            { number: 1, state: "OPEN", url: "https://github.com/acme/widget/pull/1" },
            { number: 2, state: "CLOSED", url: "https://github.com/acme/widget/pull/2" },
          ],
          repo: "acme/widget",
        },
      }),
    ).toStrictEqual({
      reason: "own-pull-request",
      why: "its run's own pull request is open, and landing it is its work: https://github.com/acme/widget/pull/1",
    });
  });

  it("lets the park go on when the read is whole and found nothing", () => {
    expect(
      ownPullRequestKeep({ answer: { branches: ["b"], kind: "read", pulls: [], repo: "acme/widget" } }),
    ).toBeUndefined();
  });

  it("keeps on an unasked read rather than reading it as none", () => {
    expect(ownPullRequestKeep({ answer: { kind: "not-asked" } })).toStrictEqual({
      reason: "own-pull-request-unreadable",
      why: "its own pull requests were not asked for",
    });
  });

  it("prints the unreadable keep and stays quiet on the open one", () => {
    expect([QUIET_PARK_KEEPS.has("own-pull-request"), QUIET_PARK_KEEPS.has("own-pull-request-unreadable")]).toEqual([
      true,
      false,
    ]);
  });
});
