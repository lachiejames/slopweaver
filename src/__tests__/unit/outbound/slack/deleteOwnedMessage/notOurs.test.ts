/*
 * The ownership refusals: a person's message, another app's, a bare one without the opt-in, a foreign kind, an
 * unknown renderer and an absent target.
 *
 * Each refusal case seeds a target and asserts it is still standing — `deletes` empty — rather than only
 * asserting the error. A domain error with the delete already performed is exactly the defect these
 * refusals exist to prevent, and nothing about the returned value would show it.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { deleteOwnedMessage } from "../../../../../outbound/slack/deleteOwnedMessage.js";
import type { ReadSlackMessage } from "../../../../../outbound/slack/lifecycleGuards.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { ACCEPTED, fakeTransport, freshHome, freshLog, OURS, TARGET, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("deleteOwnedMessage — a message that is not ours is left standing", () => {
  it("refuses a human's message, naming the absent bot id", async () => {
    const log = freshLog();
    const human: ReadSlackMessage = { fileIds: [], ts: TARGET.ts, userId: "U_PERSON" };
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: human }),
    });

    expect(unwrapErr(outcome).code).toBe("NOT_OURS");
    expect(unwrapErr(outcome).message).toContain("a person posted it");
    expect(log.deletes).toEqual([]);
  });

  it("refuses another Slack app's message, carrying the bot id it actually has", async () => {
    const log = freshLog();
    const other: ReadSlackMessage = { ...OURS, botId: "B_OTHER" };
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: other }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("NOT_OURS");
    expect(error.message).toContain("B_OTHER");
    expect(log.deletes).toEqual([]);
  });

  it("refuses our own message when it carries no slopweaver metadata", async () => {
    const log = freshLog();
    const bare: ReadSlackMessage = { botId: "B_SELF", fileIds: [], ts: TARGET.ts, userId: "U_SELF" };
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: bare }),
    });

    expect(unwrapErr(outcome).code).toBe("MISSING_METADATA");
    expect(log.deletes).toEqual([]);
  });

  it("deletes our own bare message when the caller opts in, as slack delete does", async () => {
    // `C0SYN000018`/`1791889582.262339`: the stranded lane's re-dispatch notice, posted with no metadata,
    // which every other verb refused to delete.
    const log = freshLog();
    const bare: ReadSlackMessage = { botId: "B_SELF", fileIds: [], ts: TARGET.ts, userId: "U_SELF" };
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: true,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: bare }),
    });

    expect(unwrap(outcome)).toEqual({ kind: "deleted", posted: TARGET });
    expect(log.calls).toEqual(["readMessage", "whoAmI", "deleteMessageOnce"]);
  });

  it("still refuses a human's, another app's, a foreign kind, an unknown renderer and partial metadata when the caller opts in", async () => {
    const refused: { case: string; code: string; deletes: number }[] = [];
    const cases: { name: string; message: ReadSlackMessage }[] = [
      { message: { fileIds: [], ts: TARGET.ts, userId: "U_PERSON" }, name: "human" },
      { message: { botId: "B_OTHER", fileIds: [], ts: TARGET.ts }, name: "other app, bare" },
      { message: { ...OURS, metadataEventType: "other_app_card_v1" }, name: "foreign kind" },
      { message: { ...OURS, renderer: "slack-answer-v9" }, name: "unknown renderer" },
      // An empty event type alone reads `no-slopweaver-metadata`; a renderer beside it is still a shape.
      {
        message: { botId: "B_SELF", fileIds: [], renderer: "slack-answer-v9", ts: TARGET.ts },
        name: "renderer, no type",
      },
      {
        message: { botId: "B_SELF", fileIds: [], stored: { metadata: { event_type: "" } }, ts: TARGET.ts },
        name: "stored metadata, no type",
      },
    ];
    for (const { name, message } of cases) {
      const log = freshLog();
      const outcome = await deleteOwnedMessage({
        acceptUnmarked: true,
        actor: "bot",
        dryRun: false,
        expectedEventTypes: ACCEPTED,
        home: freshHome(),
        ledger: memoryDoorLedger().port,
        posted: TARGET,
        transport: fakeTransport({ log, message }),
      });
      refused.push({ case: name, code: unwrapErr(outcome).code, deletes: log.deletes.length });
    }

    expect(refused).toEqual([
      { case: "human", code: "NOT_OURS", deletes: 0 },
      { case: "other app, bare", code: "NOT_OURS", deletes: 0 },
      { case: "foreign kind", code: "WRONG_EVENT_TYPE", deletes: 0 },
      { case: "unknown renderer", code: "UNKNOWN_RENDERER", deletes: 0 },
      { case: "renderer, no type", code: "MISSING_METADATA", deletes: 0 },
      { case: "stored metadata, no type", code: "MISSING_METADATA", deletes: 0 },
    ]);
  });

  it("refuses a metadata kind this caller did not name, reporting the kind found", async () => {
    const log = freshLog();
    const otherKind: ReadSlackMessage = { ...OURS, metadataEventType: "some_other_card_v1" };
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: otherKind }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("WRONG_EVENT_TYPE");
    expect(error.message).toContain("some_other_card_v1");
    expect(log.deletes).toEqual([]);
  });

  it("refuses a renderer this build does not recognise", async () => {
    const log = freshLog();
    const strange: ReadSlackMessage = { ...OURS, renderer: "slack-from-the-future-v9" };
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: TARGET,
      transport: fakeTransport({ log, message: strange }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("UNKNOWN_RENDERER");
    expect(error.message).toContain("slack-from-the-future-v9");
    expect(log.deletes).toEqual([]);
  });

  it("refuses a target that is not there rather than acting on the nearest message", async () => {
    const log = freshLog();
    const outcome = await deleteOwnedMessage({
      acceptUnmarked: false,
      actor: "bot",
      dryRun: false,
      expectedEventTypes: ACCEPTED,
      home: freshHome(),
      ledger: memoryDoorLedger().port,
      posted: { channel: TARGET.channel, ts: "1790000000.000001" },
      transport: fakeTransport({ log, message: OURS }),
    });

    const error = unwrapErr(outcome);
    expect(error.code).toBe("TARGET_ABSENT");
    expect(error.message).toContain("1790000000.000001");
    expect(log.deletes).toEqual([]);
  });
});
