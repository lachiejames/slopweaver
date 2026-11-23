/*
 * `slack edit --as bot` over a POLL: re-drawn by the poll renderer under the pollId the message carries, the
 * record's question and reason following it; the ballot frozen, the opening judged, the record checked.
 */
import { chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ballotChangeRefusal,
  editablePollRecord,
  runEditPoll,
} from "../../../../../cli/commands/slack/lifecycleRunEditPoll.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type PollArtifact, pollBallot } from "../../../../../outbound/slack/pollForm.js";
import {
  claimPollRecord,
  confirmPollRecord,
  type PollRecord,
  readPollRecord,
} from "../../../../../outbound/slack/pollStore.js";
import type { SlackPollPayload } from "../../../../../outbound/slack/types.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import {
  editDeps,
  editOptions,
  editTransport,
  freshHome,
  ownMessage,
  type RecordedUpdate,
  TEST_POLL_TYPE,
} from "./editKindFakes.js";

const minted: string[] = [];
const homes = { fresh: (): string => freshHome({ dirs: minted }) };
afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const TS = "1700000000.000400";
const POLL_ID = "poll-fixture-1";

const POSTED: PollArtifact = {
  kind: "poll",
  options: ["Tuesday", "Thursday"],
  question: "Which day suits the retro?",
  why: "The usual slot clashes with the release.",
};

/** A home holding the confirmed record of {@link POSTED}, at `channel`/`ts`. */
function homeWithPoll({ channel = "C0EDIT", ts = TS }: { channel?: string; ts?: string } = {}): string {
  const home = homes.fresh();
  const ballot = pollBallot({ options: POSTED.options });
  const record: PollRecord = {
    channel,
    createdIso: "2026-11-05T00:00:00.000Z",
    emojiNames: ballot.map(({ emojiName }) => emojiName),
    options: ballot.map(({ label }) => label),
    pollId: POLL_ID,
    question: POSTED.question,
    schemaVersion: 1,
    why: POSTED.why,
  };
  expect(claimPollRecord({ home, record })).toEqual({ kind: "claimed" });
  expect(confirmPollRecord({ home, nowIso: "2026-11-05T00:00:01.000Z", pollId: POLL_ID, ts })).toEqual({
    kind: "confirmed",
  });
  return home;
}

const POLL_MESSAGE = ownMessage({
  eventType: TEST_POLL_TYPE,
  extra: { pollId: POLL_ID },
  renderer: "slack-poll-v1",
  ts: TS,
});

describe("ballotChangeRefusal", () => {
  const record = (): PollRecord => {
    const ballot = pollBallot({ options: POSTED.options });
    return {
      channel: "C0EDIT",
      createdIso: "2026-11-05T00:00:00.000Z",
      emojiNames: ballot.map(({ emojiName }) => emojiName),
      options: ballot.map(({ label }) => label),
      pollId: POLL_ID,
      question: POSTED.question,
      schemaVersion: 1,
      why: POSTED.why,
    };
  };

  it("accepts the recorded ballot exactly", () => {
    expect(ballotChangeRefusal({ ballot: pollBallot({ options: POSTED.options }), record: record() })).toBeUndefined();
  });

  it("refuses a ballot whose emoji differ under the same labels", () => {
    const ballot = pollBallot({ options: POSTED.options }).map((entry) => ({ ...entry, emojiName: "x" }));

    expect(ballotChangeRefusal({ ballot, record: record() })!.code).toBe("EDIT_POLL_BALLOT_CHANGED");
  });
});

describe("editablePollRecord", () => {
  it("refuses an id the store has never held, naming it absent", () => {
    const result = editablePollRecord({ home: homes.fresh(), pollId: "ghost", posted: { channel: "C0EDIT", ts: TS } });

    expect(unwrapErr(result).message).toContain("its record ghost is absent");
  });

  it("returns the record that names this exact message", () => {
    const home = homeWithPoll();

    expect(unwrap(editablePollRecord({ home, pollId: POLL_ID, posted: { channel: "C0EDIT", ts: TS } })).pollId).toBe(
      POLL_ID,
    );
  });
});

describe("runEditPoll", () => {
  it("re-draws a poll in place under its inherited pollId, and the record's question follows", async () => {
    const home = homeWithPoll();
    const updates: RecordedUpdate[] = [];
    const out: string[] = [];
    const deps = editDeps({ out, transport: editTransport({ message: POLL_MESSAGE, updates }) });
    const form: PollArtifact = { ...POSTED, question: "Which day suits the sprint retro?" };

    expect(await runEditPoll({ deps, form, options: editOptions({ home, ts: TS }) })).toBe(EXIT_OK);

    expect(updates.map(({ method, posted }) => ({ method, posted }))).toEqual([
      { method: "updateCard", posted: { channel: "C0EDIT", ts: TS } },
    ]);
    const payload = updates[0]!.payload as SlackPollPayload;
    expect(payload.metadata.event_type).toBe(TEST_POLL_TYPE);
    expect(payload.metadata.event_payload.pollId).toBe(POLL_ID);
    expect(JSON.stringify(payload.attachments)).toContain("Which day suits the sprint retro?");
    const read = readPollRecord({ home, pollId: POLL_ID });
    expect(read.kind).toBe("found");
    expect((read as { record: PollRecord }).record.question).toBe("Which day suits the sprint retro?");
    expect((read as { record: PollRecord }).record.options).toEqual([
      "Tuesday",
      "Thursday",
      "Other — explain in replies",
    ]);
    expect(out).toEqual([`edited — channel=C0EDIT ts=${TS} as a poll`]);
  });

  it.each([
    { name: "a relabelled option", options: ["Tuesday", "Friday"] },
    { name: "a reordered ballot", options: ["Thursday", "Tuesday"] },
    { name: "an added option", options: ["Tuesday", "Thursday", "Friday"] },
  ])("refuses $name, updating nothing and leaving the record", async ({ options }) => {
    const home = homeWithPoll();
    const updates: RecordedUpdate[] = [];
    const deps = editDeps({ out: [], transport: editTransport({ message: POLL_MESSAGE, updates }) });

    const code = await runEditPoll({
      deps,
      form: { ...POSTED, options, question: "Changed?" },
      options: editOptions({ home, ts: TS }),
    });

    expect(code).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
    expect((readPollRecord({ home, pollId: POLL_ID }) as { record: PollRecord }).record.question).toBe(POSTED.question);
  });

  it("refuses a poll edit whose question opens on a pull request, updating nothing", async () => {
    const home = homeWithPoll();
    const updates: RecordedUpdate[] = [];
    const deps = editDeps({ out: [], transport: editTransport({ message: POLL_MESSAGE, updates }) });
    const form: PollArtifact = { ...POSTED, question: "Approve the fix in https://github.com/acme/app/pull/12?" };

    expect(await runEditPoll({ deps, form, options: editOptions({ home, ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
    expect((readPollRecord({ home, pollId: POLL_ID }) as { record: PollRecord }).record.question).toBe(POSTED.question);
  });

  it("refuses a poll whose record names another message, updating nothing", async () => {
    const home = homeWithPoll({ ts: "1700000000.999999" });
    const updates: RecordedUpdate[] = [];
    const deps = editDeps({ out: [], transport: editTransport({ message: POLL_MESSAGE, updates }) });

    expect(await runEditPoll({ deps, form: POSTED, options: editOptions({ home, ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
  });

  it("puts the record's question back when the Slack update throws, saying the outcome is unknown", async () => {
    const home = homeWithPoll();
    const updates: RecordedUpdate[] = [];
    const out: string[] = [];
    const transport = editTransport({ message: POLL_MESSAGE, updateFails: new Error("ratelimited"), updates });
    const deps = editDeps({ out, transport });
    const form: PollArtifact = { ...POSTED, question: "Which day suits the sprint retro?" };

    await expect(runEditPoll({ deps, form, options: editOptions({ home, ts: TS }) })).rejects.toThrow("ratelimited");
    expect(updates).toEqual([]);
    expect(out.join("\n")).toContain("if Slack applied the update anyway, the message and its record now disagree");
    expect((readPollRecord({ home, pollId: POLL_ID }) as { record: PollRecord }).record.question).toBe(POSTED.question);
  });

  it("leaves the message alone when the record cannot be written, so the two never disagree", async () => {
    const home = homeWithPoll();
    const pollsDir = join(stateHomePaths({ home }).ledgers, "slack-polls");
    chmodSync(pollsDir, 0o555);
    const updates: RecordedUpdate[] = [];
    const out: string[] = [];
    const deps = editDeps({ out, transport: editTransport({ message: POLL_MESSAGE, updates }) });
    const form: PollArtifact = { ...POSTED, question: "Which day suits the sprint retro?" };

    try {
      expect(await runEditPoll({ deps, form, options: editOptions({ home, ts: TS }) })).toBe(EXIT_ERROR);
    } finally {
      chmodSync(pollsDir, 0o755);
    }
    expect(updates).toEqual([]);
    expect(out.join("\n")).toContain(`not edited — the poll record ${POLL_ID} could not be updated`);
    expect((readPollRecord({ home, pollId: POLL_ID }) as { record: PollRecord }).record.question).toBe(POSTED.question);
  });

  it("refuses a poll-typed message laid out by the card renderer, its record untouched", async () => {
    const home = homeWithPoll();
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({
      eventType: TEST_POLL_TYPE,
      extra: { pollId: POLL_ID },
      renderer: "slack-card-v1",
      ts: TS,
    });
    const deps = editDeps({ out: [], transport: editTransport({ message, updates }) });
    const form: PollArtifact = { ...POSTED, question: "Which day suits the sprint retro?" };

    expect(await runEditPoll({ deps, form, options: editOptions({ home, ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
    expect((readPollRecord({ home, pollId: POLL_ID }) as { record: PollRecord }).record.question).toBe(POSTED.question);
  });

  it("refuses a poll carrying no pollId rather than deriving one, updating nothing", async () => {
    const home = homeWithPoll();
    const updates: RecordedUpdate[] = [];
    const message = ownMessage({ eventType: TEST_POLL_TYPE, renderer: "slack-poll-v1", ts: TS });
    const deps = editDeps({ out: [], transport: editTransport({ message, updates }) });

    expect(await runEditPoll({ deps, form: POSTED, options: editOptions({ home, ts: TS }) })).toBe(EXIT_USAGE);
    expect(updates).toEqual([]);
  });
});
