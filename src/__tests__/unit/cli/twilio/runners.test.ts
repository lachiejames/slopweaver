/**
 * The three `twilio` verbs driven end to end over injected seams: a parse refusal exits 2 without opening a
 * session, a missing key exits 3 with the hand step, a provider failure exits 1, and an answer prints delivery
 * facts with no body and no full number.
 */
import { describe, expect, it } from "vitest";

import { runTwilioMessageWith } from "../../../../cli/commands/twilio/messageRun.js";
import { runTwilioMessagesWith } from "../../../../cli/commands/twilio/messagesRun.js";
import type { TwilioSessionOpener, TwilioSink } from "../../../../cli/commands/twilio/shell.js";
import { TWILIO_MESSAGES_USAGE } from "../../../../cli/commands/twilio/usage.js";
import { runTwilioVerifyWith } from "../../../../cli/commands/twilio/verifyRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../cli/exitCodes.js";
import { err, ok } from "../../../../lib/result.js";
import { TwilioReadErrors } from "../../../../live/twilio/errors.js";
import type { TwilioGet } from "../../../../live/twilio/transport.js";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_TO,
  listPage,
  queuedGet,
  SENTINEL_BODY,
  sidOf,
  wireMessage,
} from "../../live/twilio/twilioFixtures.js";

/** A sink recording every line. */
function recordingSink(): { sink: TwilioSink; out: string[]; errors: string[] } {
  const out: string[] = [];
  const errors: string[] = [];
  const sink: TwilioSink = {
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
function openerOver({ get }: { get: TwilioGet }): { open: TwilioSessionOpener; homes: string[] } {
  const homes: string[] = [];
  const open: TwilioSessionOpener = ({ home }) => {
    homes.push(home);
    return ok({ accountSid: FIXTURE_ACCOUNT, get });
  };
  return { homes, open };
}

const NO_KEY: TwilioSessionOpener = () => err(TwilioReadErrors.tokenMissing({ missing: ["twilio-api-key-secret"] }));

/** The argv the router hands a verb. */
function argv({ verb, tail }: { verb: string; tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "twilio", verb, ...tail];
}

describe("twilio messages", () => {
  it("prints each message's delivery facts, never the body nor the full number", async () => {
    const { get } = queuedGet({
      bodies: [
        listPage({
          messages: [wireMessage({ errorCode: 30003, sid: sidOf({ digit: "1" }), status: "undelivered" })],
          nextPageUri: null,
        }),
      ],
    });
    const { open, homes } = openerOver({ get });
    const { sink, out } = recordingSink();
    const code = await runTwilioMessagesWith({
      argv: argv({ tail: ["--to", FIXTURE_TO, "--home", "/h"], verb: "messages" }),
      open,
      sink,
    });
    expect(code).toBe(EXIT_OK);
    expect(homes).toEqual(["/h"]);
    expect(out[0]).toBe("1 message(s), newest first");
    expect(out[1]).toBe(
      `${sidOf({ digit: "1" })}  undelivered (error 30003, https://www.twilio.com/docs/api/errors/30003)`,
    );
    expect(out.join("\n")).not.toContain(SENTINEL_BODY);
    expect(out.join("\n")).not.toContain(FIXTURE_TO);
  });

  it("says so when the limit cut the list short", async () => {
    const next = `/2010-04-01/Accounts/${FIXTURE_ACCOUNT}/Messages.json?PageSize=1&Page=1&PageToken=PA1`;
    const { get } = queuedGet({
      bodies: [
        listPage({
          messages: [wireMessage({ errorCode: null, sid: sidOf({ digit: "1" }), status: "sent" })],
          nextPageUri: next,
        }),
      ],
    });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(await runTwilioMessagesWith({ argv: argv({ tail: ["--limit", "1"], verb: "messages" }), open, sink })).toBe(
      EXIT_OK,
    );
    expect(out.at(-1)).toBe("more messages match than --limit 1 — raise it or narrow the window");
  });

  it("prints the projected views as JSON with --json", async () => {
    const { get } = queuedGet({ bodies: [listPage({ messages: [], nextPageUri: null })] });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(await runTwilioMessagesWith({ argv: argv({ tail: ["--json"], verb: "messages" }), open, sink })).toBe(
      EXIT_OK,
    );
    expect(JSON.parse(out[0]!)).toEqual({ messages: [], moreRemain: false, pages: 1 });
  });

  it("refuses a malformed number with exit 2 and never opens a session", async () => {
    const { get, seen } = queuedGet({ bodies: [] });
    const { open, homes } = openerOver({ get });
    const { sink, errors } = recordingSink();
    expect(await runTwilioMessagesWith({ argv: argv({ tail: ["--to", "0400"], verb: "messages" }), open, sink })).toBe(
      EXIT_USAGE,
    );
    expect(errors).toEqual([
      "--to must be an E.164 number such as +61400000000 (optionally whatsapp:+61…)",
      TWILIO_MESSAGES_USAGE,
    ]);
    expect(homes).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("exits 3 with the hand step when no key is stored", async () => {
    const { sink, errors } = recordingSink();
    expect(await runTwilioMessagesWith({ argv: argv({ tail: [], verb: "messages" }), open: NO_KEY, sink })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(errors[0]).toContain("slopweaver secrets set twilio-api-key-secret");
  });

  it("prints the usage and exits 0 on --help, opening nothing", async () => {
    const { sink, out } = recordingSink();
    expect(
      await runTwilioMessagesWith({ argv: argv({ tail: ["--help"], verb: "messages" }), open: NO_KEY, sink }),
    ).toBe(EXIT_OK);
    expect(out).toEqual([TWILIO_MESSAGES_USAGE]);
  });
});

describe("twilio message", () => {
  it("prints one message's lines", async () => {
    const sid = sidOf({ digit: "2" });
    const { get } = queuedGet({ bodies: [JSON.stringify(wireMessage({ errorCode: null, sid, status: "delivered" }))] });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(await runTwilioMessageWith({ argv: argv({ tail: ["--sid", sid], verb: "message" }), open, sink })).toBe(
      EXIT_OK,
    );
    expect(out[0]).toBe(`${sid}  delivered`);
    expect(out).toHaveLength(3);
  });

  it("exits 1 with Twilio's failure when the read fails", async () => {
    const failure = TwilioReadErrors.transportFailed({ message: "Twilio answered 404 on /x", status: 404 });
    const { get } = queuedGet({ bodies: [failure] });
    const { open } = openerOver({ get });
    const { sink, errors } = recordingSink();
    expect(
      await runTwilioMessageWith({
        argv: argv({ tail: ["--sid", sidOf({ digit: "3" })], verb: "message" }),
        open,
        sink,
      }),
    ).toBe(EXIT_ERROR);
    expect(errors).toEqual(["Twilio answered 404 on /x"]);
  });
});

describe("twilio verify", () => {
  it("says the key reads Messages on the account", async () => {
    const { get } = queuedGet({ bodies: [listPage({ messages: [], nextPageUri: null })] });
    const { open } = openerOver({ get });
    const { sink, out } = recordingSink();
    expect(await runTwilioVerifyWith({ argv: argv({ tail: [], verb: "verify" }), open, sink })).toBe(EXIT_OK);
    expect(out).toEqual([`the stored Twilio key reads Messages on ${FIXTURE_ACCOUNT}`]);
  });

  it("exits 3 when no key is stored", async () => {
    const { sink } = recordingSink();
    expect(await runTwilioVerifyWith({ argv: argv({ tail: [], verb: "verify" }), open: NO_KEY, sink })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
  });
});
