/**
 * The six `knock` verbs driven end to end over injected seams: a parse refusal exits 2 without opening a session,
 * a missing key exits 3 with the hand step, a provider failure exits 1, and an answer prints delivery facts with
 * no recipient, payload or body.
 */
import { describe, expect, it } from "vitest";

import { runKnockMessageWith } from "../../../../cli/commands/knock/messageRun.js";
import { runKnockMessagesWith } from "../../../../cli/commands/knock/messagesRun.js";
import type { KnockSessionOpener, KnockSink } from "../../../../cli/commands/knock/shell.js";
import { KNOCK_MESSAGE_USAGE } from "../../../../cli/commands/knock/usage.js";
import { runKnockVerifyWith } from "../../../../cli/commands/knock/verifyRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok } from "../../../../lib/result.js";
import { KNOCK_KEY_HAND_STEP, KnockReadErrors } from "../../../../live/knock/errors.js";
import type { KnockGet } from "../../../../live/knock/transport.js";
import {
  listPage,
  queuedGet,
  SENTINEL_PAYLOAD,
  SENTINEL_PHONE,
  SENTINEL_RECIPIENT,
  wireDeliveryLog,
  wireEvent,
  wireListMessage,
  wireMessage,
} from "../../live/knock/knockFixtures.js";

/** A sink recording every line. */
function recordingSink(): { sink: KnockSink; out: string[]; errors: string[] } {
  const out: string[] = [];
  const errors: string[] = [];
  const sink: KnockSink = {
    error: ({ msg }) => {
      errors.push(msg);
    },
    out: ({ line }) => {
      out.push(line);
    },
  };
  return { errors, out, sink };
}

/** An opener handing back a session over `get`, recording the home it was asked for. */
function openerOver({ get }: { get: KnockGet }): { open: KnockSessionOpener; homes: string[] } {
  const homes: string[] = [];
  const open: KnockSessionOpener = ({ home }) => {
    homes.push(home);
    return ok({ get });
  };
  return { homes, open };
}

const NO_KEY: KnockSessionOpener = () => err(KnockReadErrors.tokenMissing());

/** The argv the router hands a verb. */
function argv({ verb, tail }: { verb: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "knock", verb, ...tail];
}

describe("knock verify", () => {
  /** An empty list page. */
  const EMPTY = listPage({ after: null, items: [] });

  /** A page holding one list-shaped message. */
  const ONE = listPage({ after: "c-2", items: [wireListMessage({ id: "m-1", status: "sent" })] });

  it("says the key reads messages and the first one returned read cleanly", async () => {
    const { get } = queuedGet({ bodies: [EMPTY, ONE] });
    const { open, homes } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(await runKnockVerifyWith({ argv: argv({ tail: ["--home", "/h"], verb: "verify" }), open, sink })).toBe(
      EXIT_OK,
    );
    expect(homes).toEqual(["/h"]);
    expect(out).toEqual([
      "the stored Knock key reads messages in its environment, and the first message returned read cleanly",
    ]);
  });

  it("says plainly when no message came back, so no shape was tested", async () => {
    const { get } = queuedGet({ bodies: [EMPTY, EMPTY] });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(await runKnockVerifyWith({ argv: argv({ tail: [], verb: "verify" }), open, sink })).toBe(EXIT_OK);
    expect(out).toEqual([
      "the stored Knock key reads messages in its environment; it returned no message, so no message shape was tested",
    ]);
  });

  it("answers both verdicts as JSON, carrying nothing of the message", async () => {
    const lines = await Promise.all(
      [ONE, EMPTY].map(async (second) => {
        const { open } = openerOver({ get: queuedGet({ bodies: [EMPTY, second] }).get });
        const { sink, out } = recordingSink();
        await runKnockVerifyWith({ argv: argv({ tail: ["--json"], verb: "verify" }), open, sink });
        return out;
      }),
    );
    expect(lines.map((out) => out.map((line) => JSON.parse(line) as unknown))).toEqual([
      [{ messageShape: "exercised", readsMessages: true }],
      [{ messageShape: "unexercised", readsMessages: true }],
    ]);
  });

  it("exits 1, printing nothing to stdout, when the message returned will not read", async () => {
    const drifted = { ...wireListMessage({ id: "m-1", status: "sent" }), recipient_phone: SENTINEL_PHONE };
    const { get } = queuedGet({ bodies: [EMPTY, listPage({ after: null, items: [drifted] })] });
    const { open } = openerOver({ get });
    const { sink, out, errors } = recordingSink();
    expect(await runKnockVerifyWith({ argv: argv({ tail: [], verb: "verify" }), open, sink })).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(errors.join("\n")).toContain("recipient_phone");
    expect(errors.join("\n")).not.toContain(SENTINEL_PHONE);
  });

  it("exits 3 with the hand step when no key is stored", async () => {
    const { sink, errors } = recordingSink();
    expect(await runKnockVerifyWith({ argv: argv({ tail: [], verb: "verify" }), open: NO_KEY, sink })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(errors.join("\n")).toContain(KNOCK_KEY_HAND_STEP);
  });

  it("exits 1 when Knock refuses the key", async () => {
    const { get } = queuedGet({
      bodies: [KnockReadErrors.transportFailed({ operation: "knock.messages.list", status: 401 })],
    });
    const { open } = openerOver({ get });
    const { sink, errors } = recordingSink();
    expect(await runKnockVerifyWith({ argv: argv({ tail: [], verb: "verify" }), open, sink })).toBe(EXIT_ERROR);
    expect(errors).toEqual(["Knock answered 401 to knock.messages.list"]);
  });
});

describe("knock messages and user-messages", () => {
  it("prints each message's delivery facts, never a recipient, payload or number", async () => {
    const { get } = queuedGet({
      bodies: [listPage({ after: null, items: [wireMessage({ id: "m-1", status: "undelivered" })] })],
    });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    const code = await runKnockMessagesWith({
      argv: argv({ tail: ["--status", "undelivered"], verb: "messages" }),
      open,
      sink,
      withUser: false,
    });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual([
      "1 message(s), in the order Knock answered",
      "m-1  undelivered  sms via twilio",
      "    workflow booking-reminder step sms_1  inserted 2026-10-11T03:12:00.000000Z  updated 2026-10-11T03:12:09.000000Z",
    ]);
    const printed = out.join("\n");
    expect(printed).not.toContain(SENTINEL_RECIPIENT);
    expect(printed).not.toContain(SENTINEL_PAYLOAD);
    expect(printed).not.toContain(SENTINEL_PHONE);
  });

  it("says when the limit cut the list short", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          after: "c-1",
          items: [wireMessage({ id: "m-1", status: "sent" }), wireMessage({ id: "m-2", status: "sent" })],
        }),
      ],
    });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    await runKnockMessagesWith({
      argv: argv({ tail: ["--user-id", "user_0123", "--limit", "1"], verb: "user-messages" }),
      open,
      sink,
      withUser: true,
    });
    expect(out.at(-1)).toBe("more match than --limit 1 — raise it or narrow the filters");
  });

  it("refuses a bad status with exit 2 and never opens a session", async () => {
    const { open, homes } = openerOver({ get: queuedGet({ bodies: [] }).get });
    const { sink, errors } = recordingSink();
    const code = await runKnockMessagesWith({
      argv: argv({ tail: ["--status", "opened"], verb: "messages" }),
      open,
      sink,
      withUser: false,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(homes).toEqual([]);
    expect(errors[0]).toContain("--status must be one of");
  });

  it("prints the whole list as JSON under --json", async () => {
    const { get } = queuedGet({ bodies: [listPage({ after: null, items: [] })] });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    await runKnockMessagesWith({
      argv: argv({ tail: ["--user-id", "user_0123", "--json"], verb: "user-messages" }),
      open,
      sink,
      withUser: true,
    });
    expect(out.map((line) => JSON.parse(line) as unknown)).toEqual([{ items: [], moreRemain: false, pages: 1 }]);
  });
});

describe("knock message, message-events and delivery-logs", () => {
  it("prints one message", async () => {
    const { get } = queuedGet({ bodies: [JSON.stringify(wireMessage({ id: "m-9", status: "delivered" }))] });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(
      await runKnockMessageWith({
        argv: argv({ tail: ["--id", "m-9"], verb: "message" }),
        open,
        read: "message",
        sink,
      }),
    ).toBe(EXIT_OK);
    expect(out[0]).toBe("m-9  delivered  sms via twilio");
  });

  it("prints each event as time, type and id", async () => {
    const { get } = queuedGet({
      bodies: [listPage({ after: null, items: [wireEvent({ id: "e-1", type: "message.undelivered" })] })],
    });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    await runKnockMessageWith({
      argv: argv({ tail: ["--id", "m-1"], verb: "message-events" }),
      open,
      read: "message-events",
      sink,
    });
    expect(out).toEqual([
      "1 event(s), in the order Knock answered",
      "2026-10-11T03:12:05.000000Z  message.undelivered  e-1",
    ]);
  });

  it("prints each delivery log's service and status, never its bodies", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          after: null,
          items: [wireDeliveryLog({ id: "d-1", status: 400 }), wireDeliveryLog({ id: "d-2", status: undefined })],
        }),
      ],
    });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    await runKnockMessageWith({
      argv: argv({ tail: ["--id", "m-1"], verb: "delivery-logs" }),
      open,
      read: "delivery-logs",
      sink,
    });
    expect(out).toEqual([
      "2 delivery log(s), in the order Knock answered",
      "2026-10-11T03:12:02.000000Z  twilio  answered 400  d-1",
      "2026-10-11T03:12:02.000000Z  twilio  no response status  d-2",
    ]);
    expect(out.join("\n")).not.toContain("SENTINEL");
  });

  it("refuses a missing --id with exit 2 and the usage", async () => {
    const { sink, errors } = recordingSink();
    expect(
      await runKnockMessageWith({ argv: argv({ tail: [], verb: "message" }), open: NO_KEY, read: "message", sink }),
    ).toBe(EXIT_USAGE);
    expect(errors).toEqual(["--id is required: the Knock message id from a `knock messages` row", KNOCK_MESSAGE_USAGE]);
  });

  it("exits 1 when Knock answers a body the boundary will not read", async () => {
    const { get } = queuedGet({ bodies: ["{}"] });
    const { open } = openerOver({ get });
    const { sink, errors } = recordingSink();
    expect(
      await runKnockMessageWith({
        argv: argv({ tail: ["--id", "m-1"], verb: "message" }),
        open,
        read: "message",
        sink,
      }),
    ).toBe(EXIT_ERROR);
    expect(errors[0]).toContain("GET /v1/messages/{message_id} answered a body this door will not read");
  });
});
