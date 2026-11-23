/**
 * Unit: `gmail card-mail` — its parser, and its shell over plain fakes: the local read touches no capture, `--fetch`
 * is the one path that does, and each absence exits with the code a caller branches on. All mail is synthetic.
 */
import { describe, expect, it } from "vitest";

import {
  type GmailCardMailDeps,
  parseGmailCardMailArgs,
  runGmailCardMail,
} from "../../../../../cli/commands/gmail/cardMailRun.js";
import { GMAIL_CARD_MAIL_USAGE } from "../../../../../cli/commands/gmail/cardMailUsage.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type CardMailStore, CardMailStoreErrors } from "../../../../../live/gmail/cardMail.js";
import { CardMailCaptureErrors } from "../../../../../live/gmail/cardMailCapture.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import { type GmailTriageCard, TriageCardErrors } from "../../../../../live/gmail/triageCards.js";

const SLUG = "inbox-triage-20261003-notices";
const NOW = "2026-10-04T01:00:00.000Z";

const PIN: GmailTriageCard = {
  ids: ["m1", "m2"],
  key: "from:notices@example.test",
  pinnedAtIso: NOW,
  schemaVersion: 1,
  slug: SLUG,
};

const STORE: CardMailStore = {
  key: PIN.key,
  mails: [
    {
      body: { html: "<p>Hello</p>", htmlTruncated: false, text: "Hello", textTruncated: false },
      cc: [],
      from: "Notices <notices@example.test>",
      id: "m1",
      kind: "message",
      receivedAtIso: NOW,
      subject: "Notice",
      threadId: "t-m1",
      to: ["owner@example.test"],
    },
    { id: "m2", kind: "gone" },
  ],
  omittedCount: 0,
  pinnedCount: 2,
  schemaVersion: 1,
  slug: SLUG,
  storedAtIso: NOW,
};

/** What the fakes saw. */
interface Recorded {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly captures: string[];
  readonly homes: string[];
}

function fresh(): Recorded {
  return { captures: [], diagnostics: [], homes: [], out: [] };
}

function depsFor({
  recorded,
  pinned = true,
  stored = true,
  captureFails = false,
}: {
  recorded: Recorded;
  pinned?: boolean;
  stored?: boolean;
  captureFails?: boolean;
}): GmailCardMailDeps {
  return {
    capture: async ({ pin, home }) => {
      recorded.captures.push(`${pin.slug}@${home}`);
      return captureFails
        ? err(CardMailCaptureErrors.clientUnavailable({ cause: GmailErrors.notConnected() }))
        : ok({ path: `${home}/live/gmail/card-mail/${pin.slug}.json`, store: STORE });
    },
    home: () => "/ambient-home",
    readPin: ({ slug, home }) => {
      recorded.homes.push(home);
      return pinned ? ok(PIN) : err(TriageCardErrors.notPinned({ slug }));
    },
    readStore: ({ pin }) => (stored ? ok(STORE) : err(CardMailStoreErrors.notStored({ slug: pin.slug }))),
    writeDiagnostic: (line) => recorded.diagnostics.push(line),
    writeOut: (line) => recorded.out.push(line),
  };
}

describe("parseGmailCardMailArgs", () => {
  it("takes an inbox-triage slug, then its flags", () => {
    expect(unwrap(parseGmailCardMailArgs({ rest: [SLUG, "--message", "m1", "--json", "--home", "/h"] }))).toEqual({
      fetch: false,
      home: "/h",
      json: true,
      message: "m1",
      slug: SLUG,
    });
  });

  it("refuses no slug, a flag in its place, another board's slug, and a slug that could leave its directory", () => {
    expect(unwrapErr(parseGmailCardMailArgs({ rest: [] })).message).toBe("missing <card-slug>");
    expect(unwrapErr(parseGmailCardMailArgs({ rest: ["--json"] })).code).toBe("ARGUMENT_MISSING");
    for (const slug of ["linear-20261003", "inbox-triage-", "inbox-triage-../x", "inbox-triage-A"]) {
      expect(unwrapErr(parseGmailCardMailArgs({ rest: [slug] })).message).toBe(
        `takes an inbox-triage card's slug — inbox-triage-… in lower-case letters, digits and hyphens — not ${slug}`,
      );
    }
    expect(unwrapErr(parseGmailCardMailArgs({ rest: [SLUG, "--nope"] })).code).toBe("FLAGS_INVALID");
  });
});

describe("runGmailCardMail", () => {
  it("--json prints every header and no body, from this home alone", async () => {
    const recorded = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ recorded }), rest: [SLUG, "--json"] })).toBe(EXIT_OK);
    expect(recorded.captures).toEqual([]);
    const printed = JSON.parse(recorded.out[0]!) as { mails: { id: string; kind: string }[]; pinnedCount: number };
    expect([printed.mails.map((mail) => [mail.id, mail.kind]), printed.pinnedCount]).toEqual([
      [
        ["m1", "message"],
        ["m2", "gone"],
      ],
      2,
    ]);
    expect(recorded.out[0]).not.toContain("Hello");
  });

  it("--message --json prints that one message with its sanitised body", async () => {
    const recorded = fresh();
    const code = await runGmailCardMail({ deps: depsFor({ recorded }), rest: [SLUG, "--message", "m1", "--json"] });
    expect(code).toBe(EXIT_OK);
    const printed = JSON.parse(recorded.out[0]!) as {
      header: { id: string };
      body: { kind: string; document: string };
    };
    expect([printed.header.id, printed.body.kind]).toEqual(["m1", "html"]);
    expect(printed.body.document).toContain("<body><p>Hello</p></body>");
  });

  it("the text reading names ids and states, never a subject or a body", async () => {
    const recorded = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ recorded }), rest: [SLUG, "--home", "/h"] })).toBe(EXIT_OK);
    expect(recorded.homes).toEqual(["/h"]);
    expect(recorded.out[0]!.split("\n")).toEqual([
      `card ${SLUG} · key from:notices@example.test · stored ${NOW}`,
      "2 messages stored of 2 pinned",
      `  m1 · received ${NOW}`,
      "  m2 · gone from Gmail before it was stored",
      "headers are in --json; one body is --message <id> --json",
    ]);
  });

  it("exits 3 for no pin, no stored mail, or a message it holds no readable copy of", async () => {
    const unpinned = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ pinned: false, recorded: unpinned }), rest: [SLUG] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    const unstored = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ recorded: unstored, stored: false }), rest: [SLUG] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(unstored.diagnostics).toEqual([
      `gmail card-mail: no stored mail for ${SLUG} — run slopweaver gmail card-mail ${SLUG} --fetch`,
    ]);
    const gone = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ recorded: gone }), rest: [SLUG, "--message", "m2"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect([unpinned.captures, unstored.captures, gone.captures, gone.out]).toEqual([[], [], [], []]);
  });

  it("--json on a card that pinned nothing prints that it pinned nothing, still exit 3; --message prints nothing", async () => {
    const index = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ pinned: false, recorded: index }), rest: [SLUG, "--json"] })).toBe(
      EXIT_EXPECTED_EMPTY,
    );
    expect(index.out.map((line) => JSON.parse(line) as unknown)).toEqual([
      { pinned: false, schemaVersion: 1, slug: SLUG },
    ]);
    expect(index.diagnostics).toEqual([
      `gmail card-mail: no ids are pinned for card ${SLUG} — act on nothing, and card the group again`,
    ]);
    const message = fresh();
    expect(
      await runGmailCardMail({
        deps: depsFor({ pinned: false, recorded: message }),
        rest: [SLUG, "--message", "m1", "--json"],
      }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect(message.out).toEqual([]);
  });

  it("--fetch --json is the index form too: it captures nothing and prints that the card pinned nothing", async () => {
    const fetched = fresh();
    expect(
      await runGmailCardMail({
        deps: depsFor({ pinned: false, recorded: fetched }),
        rest: [SLUG, "--fetch", "--json"],
      }),
    ).toBe(EXIT_EXPECTED_EMPTY);
    expect([fetched.captures, fetched.out.map((line) => JSON.parse(line) as unknown)]).toEqual([
      [],
      [{ pinned: false, schemaVersion: 1, slug: SLUG }],
    ]);
  });

  it("exits 1 on a stored copy that is not what the pin holds", async () => {
    const recorded = fresh();
    const deps = {
      ...depsFor({ recorded }),
      readStore: () => err(CardMailStoreErrors.pinMismatch({ slug: SLUG, why: "its counts disagree" })),
    };
    expect(await runGmailCardMail({ deps, rest: [SLUG] })).toBe(EXIT_ERROR);
  });

  it("--fetch captures over the pin, under --home, then prints what it stored", async () => {
    const recorded = fresh();
    const code = await runGmailCardMail({ deps: depsFor({ recorded }), rest: [SLUG, "--fetch", "--home", "/h"] });
    expect([code, recorded.captures]).toEqual([EXIT_OK, [`${SLUG}@/h`]]);
    expect(recorded.diagnostics).toEqual([
      `gmail card-mail: stored 2 messages at /h/live/gmail/card-mail/${SLUG}.json`,
    ]);
  });

  it("--fetch that cannot reach Gmail exits 1 and says the stored copy is unchanged", async () => {
    const recorded = fresh();
    const code = await runGmailCardMail({ deps: depsFor({ captureFails: true, recorded }), rest: [SLUG, "--fetch"] });
    expect([code, recorded.out]).toEqual([EXIT_ERROR, []]);
    expect(recorded.diagnostics).toEqual([
      `gmail card-mail: could not reach Gmail to read the pinned mail: ${GmailErrors.notConnected().message} — ` +
        "the stored mail is unchanged",
    ]);
  });

  it("refuses a bad invocation with its usage before reading anything", async () => {
    const recorded = fresh();
    expect(await runGmailCardMail({ deps: depsFor({ recorded }), rest: ["nope"] })).toBe(EXIT_USAGE);
    expect([recorded.diagnostics.at(-1), recorded.homes]).toEqual([GMAIL_CARD_MAIL_USAGE, []]);
  });
});
