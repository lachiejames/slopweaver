/*
 * The as-bot card send's reservation half (`sendCard`) and the override-token parse the door shares with it.
 * Every case runs over a throwaway home and a recording fake Slack API, so the reservation each send leaves is
 * read back through the production reader rather than inferred from the fake.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { overrideTokens, sendCard } from "../../../../../cli/commands/slack/cardSend.js";
import {
  buildSlackWritePlan,
  parseSlackForm,
  type SlackCardOptions,
  type SlackWritePlan,
} from "../../../../../cli/commands/slack/core.js";
import type { SlackWriteApi } from "../../../../../corpus/slack/writeApi.js";
import { SlackCompositeSendError } from "../../../../../corpus/slack/writeSendSteps.js";
import { unwrap } from "../../../../../lib/result.js";
import { confirmSend, peekSend } from "../../../../../outbound/slack/sendReservation.js";
import type { SlackCardChrome } from "../../../../../outbound/slack/types.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

const FORM = JSON.stringify({
  detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

/** The instant the send is judged at, and the later one the clock seam answers after the Slack attempt. */
const JUDGED_ISO = "2026-10-13T12:00:00.000Z";
const AFTER_ISO = "2026-10-13T12:00:05.000Z";
/** When the reservation is read back: inside the 24h window of both instants above. */
const READ_ISO = "2026-10-13T13:00:00.000Z";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "card-send-"));
  fixtureDirs.push(dir);
  return dir;
}

function planFor({ home }: { home: string }): SlackWritePlan {
  const options: SlackCardOptions = {
    actor: "bot",
    allowUnresolvedOwner: false,
    channel: "C0SYNCARDSEND",
    dryRun: false,
    formJson: FORM,
    home,
    json: false,
    media: [],
    resendUnconfirmed: false,
    verb: "post",
  };
  return buildSlackWritePlan({
    artifact: unwrap(parseSlackForm({ json: FORM })).artifact,
    chrome: CHROME,
    formKind: "update",
    mentions: { groups: new Map(), people: new Map() },
    options,
  });
}

type ClockSeam = NonNullable<Parameters<typeof sendCard>[0]["clockIso"]>;

/**
 * A fake Slack API recording every method call, and a clock recording every read, into ONE ordered log — so a
 * case can assert the clock was read after the Slack attempt and that no other method was reached.
 */
function harness({ sendOutcome }: { sendOutcome: { ts: string } | { error: unknown } }): {
  readonly clockIso: ClockSeam;
  readonly log: string[];
  readonly apiArgs: { home: string; token: string }[];
  readonly makeApi: Parameters<typeof sendCard>[0]["deps"]["makeApi"];
} {
  const log: string[] = [];
  const apiArgs: { home: string; token: string }[] = [];
  const api: SlackWriteApi = {
    deleteOwnMessage: async () => {
      log.push("deleteOwnMessage");
      return true;
    },
    readOwnMessage: async () => {
      log.push("readOwnMessage");
      return undefined;
    },
    sendComposite: async ({ channel }) => {
      log.push("sendComposite");
      if ("error" in sendOutcome) {
        throw sendOutcome.error;
      }
      return { channel, fileIds: [], missingMedia: [], ok: true, ts: sendOutcome.ts };
    },
    sendDripMessage: async ({ channel }) => {
      log.push("sendDripMessage");
      return { channel, fileIds: [], ts: "0" };
    },
    sendNoFold: async ({ channel }) => {
      log.push("sendNoFold");
      return { channel, fileIds: [], missingMedia: [], ok: true, ts: "0" };
    },
  };
  const clockIso: ClockSeam = () => {
    log.push("clock");
    return AFTER_ISO;
  };
  const makeApi: Parameters<typeof sendCard>[0]["deps"]["makeApi"] = (args) => {
    apiArgs.push(args);
    return api;
  };
  return { apiArgs, clockIso, log, makeApi };
}

describe("sendCard", () => {
  it("posts through `sendComposite` alone, then confirms the reservation at the clock read AFTER the post with Slack's ts", async () => {
    const home = freshHome();
    const plan = planFor({ home });
    const { apiArgs, clockIso, log, makeApi } = harness({ sendOutcome: { ts: "1700000000.000100" } });

    const result = await sendCard({
      clockIso,
      deps: { makeApi },
      home,
      nowIso: JUDGED_ISO,
      plan,
      resend: { landed: false, unconfirmed: false },
      token: "xoxb-test",
      uploads: [],
    });

    expect(result).toEqual({
      channel: "C0SYNCARDSEND",
      fileIds: [],
      missingMedia: [],
      ok: true,
      ts: "1700000000.000100",
    });
    expect(log).toEqual(["sendComposite", "clock"]);
    expect(apiArgs).toEqual([{ home, token: "xoxb-test" }]);
    expect(peekSend({ duplicateKey: plan.duplicateKey, home, nowIso: READ_ISO, windowHours: 24 })).toEqual({
      firstSentIso: AFTER_ISO,
      kind: "duplicate",
      sentTs: "1700000000.000100",
    });
  });

  it("rethrows a composite failure that left a message visible, and confirms the reservation at that message's ts", async () => {
    const home = freshHome();
    const plan = planFor({ home });
    const failure = new SlackCompositeSendError({
      deletedMessage: false,
      message: "media would not attach and the retraction failed",
      posted: { channel: "C0SYNCARDSEND", ts: "1700000000.000200" },
      uploadedFileIds: [],
    });
    const { clockIso, log, makeApi } = harness({ sendOutcome: { error: failure } });

    await expect(
      sendCard({
        clockIso,
        deps: { makeApi },
        home,
        nowIso: JUDGED_ISO,
        plan,
        resend: { landed: false, unconfirmed: false },
        token: "xoxb-test",
        uploads: [],
      }),
    ).rejects.toThrow("media would not attach and the retraction failed");
    expect(log).toEqual(["sendComposite", "clock"]);
    expect(peekSend({ duplicateKey: plan.duplicateKey, home, nowIso: READ_ISO, windowHours: 24 })).toEqual({
      firstSentIso: AFTER_ISO,
      kind: "duplicate",
      sentTs: "1700000000.000200",
    });
  });

  it("releases the reservation when the composite failure retracted what it posted, so the next attempt is fresh", async () => {
    const home = freshHome();
    const plan = planFor({ home });
    const failure = new SlackCompositeSendError({
      deletedMessage: true,
      message: "media would not attach; the message was deleted",
      posted: { channel: "C0SYNCARDSEND", ts: "1700000000.000300" },
      uploadedFileIds: [],
    });
    const { clockIso, makeApi } = harness({ sendOutcome: { error: failure } });

    await expect(
      sendCard({
        clockIso,
        deps: { makeApi },
        home,
        nowIso: JUDGED_ISO,
        plan,
        resend: { landed: false, unconfirmed: false },
        token: "xoxb-test",
        uploads: [],
      }),
    ).rejects.toThrow("media would not attach; the message was deleted");
    expect(peekSend({ duplicateKey: plan.duplicateKey, home, nowIso: READ_ISO, windowHours: 24 })).toEqual({
      kind: "fresh",
    });
  });

  it("refuses an identical card that already landed, reaching no Slack method or clock, and keeps the landed reservation", async () => {
    const home = freshHome();
    const plan = planFor({ home });
    confirmSend({ duplicateKey: plan.duplicateKey, home, nowIso: JUDGED_ISO, sentTs: "1699999999.000900" });
    const { apiArgs, clockIso, log, makeApi } = harness({ sendOutcome: { ts: "1700000000.000100" } });

    await expect(
      sendCard({
        clockIso,
        deps: { makeApi },
        home,
        nowIso: JUDGED_ISO,
        plan,
        resend: { landed: false, unconfirmed: false },
        token: "xoxb-test",
        uploads: [],
      }),
    ).rejects.toThrow(
      "an identical message already landed as ts 1699999999.000900 — if the repeat is deliberate, re-run with " +
        "SLOPWEAVER_DOOR_OVERRIDE=slack.duplicate-send:v1. Nothing was sent.",
    );
    expect(log).toEqual([]);
    expect(apiArgs).toEqual([]);
    expect(peekSend({ duplicateKey: plan.duplicateKey, home, nowIso: READ_ISO, windowHours: 24 })).toEqual({
      firstSentIso: JUDGED_ISO,
      kind: "duplicate",
      sentTs: "1699999999.000900",
    });
  });
});

describe("overrideTokens", () => {
  it("reads no token when SLOPWEAVER_DOOR_OVERRIDE is unset", () => {
    expect(overrideTokens({ env: {} })).toEqual([]);
  });

  it("reads one token, and splits a comma list trimming whitespace around each entry", () => {
    expect([
      overrideTokens({ env: { SLOPWEAVER_DOOR_OVERRIDE: "slack.duplicate-send:v1" } }),
      overrideTokens({ env: { SLOPWEAVER_DOOR_OVERRIDE: " slack.duplicate-send:v1 , voice-rules " } }),
    ]).toEqual([["slack.duplicate-send:v1"], ["slack.duplicate-send:v1", "voice-rules"]]);
  });

  it("carries an empty segment between two commas, and an empty variable, as an empty-string token", () => {
    expect([
      overrideTokens({ env: { SLOPWEAVER_DOOR_OVERRIDE: "a,,b" } }),
      overrideTokens({ env: { SLOPWEAVER_DOOR_OVERRIDE: "" } }),
    ]).toEqual([["a", "", "b"], [""]]);
  });
});
