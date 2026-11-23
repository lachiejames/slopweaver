/*
 * What `/api/talk/relay` accepts: a full relay with the voice's reading, a heard-only relay with the reads
 * that dropped it, and a picture that is a bounded WebP — each refusal carrying a body that is otherwise
 * valid, so the one field under test is what refused it.
 */
import { describe, expect, it } from "vitest";

import { RELAY_FRAME_DATA_URL_MAX, RELAY_PICTURE_MAX_BYTES, RELAY_PICTURE_PREFIX } from "../../lib/screenFrame";
import { parseTalkRelayRequest } from "../../lib/talkRelayRequest";
import { RELAY_BODY_MAX_BYTES, RELAY_HEARD_MAX, relayWireForInstance } from "../../lib/talkRelayRequestWire";

const TURN = "a0000017-0000-4000-8000-000000000019";

/** A WebP container — RIFF sized to the file, one `VP8L` chunk sized to a zeroed body. */
const webpBytes = ({ body }: { body: number }): Uint8Array => {
  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(12 + body, 4);
  head.write("WEBPVP8L", 8, "latin1");
  head.writeUInt32LE(body, 16);
  return new Uint8Array(Buffer.concat([head, Buffer.alloc(body)]));
};

/** {@link webpBytes} as the data URL the widget posts. */
const webpUrl = ({ body }: { body: number }): string =>
  `${RELAY_PICTURE_PREFIX}${Buffer.from(webpBytes({ body })).toString("base64")}`;

const FULL = {
  about: "ask:queue-shows-raw-user-id",
  heard: "the queue shows a raw user id, show the name instead",
  readsAfter: [],
  say: "Show the name and channel on the queue row instead of the raw Slack id.",
  screen: { kind: "none", reason: "screen-not-shared" },
  turnId: TURN,
};

/** The same relay with no reading at all — what a heard-only relay starts from. */
const NO_SAY = { about: FULL.about, heard: FULL.heard, readsAfter: [], screen: FULL.screen, turnId: TURN };

const parse = (body: unknown): ReturnType<typeof parseTalkRelayRequest> =>
  parseTalkRelayRequest({ raw: JSON.stringify(body) });

describe("parseTalkRelayRequest — the two modes", () => {
  it("accepts a full relay, carrying the reading and no reads", () => {
    expect(parse(FULL)).toEqual({
      kind: "relay",
      relay: {
        about: "ask:queue-shows-raw-user-id",
        alsoAnswers: [],
        heard: "the queue shows a raw user id, show the name instead",
        readsAfter: [],
        say: "Show the name and channel on the queue row instead of the raw Slack id.",
        screen: { kind: "none", reason: "screen-not-shared" },
        turnId: TURN,
        wordsAlone: false,
      },
    });
  });

  it("accepts a heard-only relay with no reading at all", () => {
    expect(parse({ ...NO_SAY, readsAfter: ["read_screen", "context_pack"] })).toEqual({
      kind: "relay",
      relay: {
        about: "ask:queue-shows-raw-user-id",
        alsoAnswers: [],
        heard: "the queue shows a raw user id, show the name instead",
        readsAfter: ["read_screen", "context_pack"],
        say: undefined,
        screen: { kind: "none", reason: "screen-not-shared" },
        turnId: TURN,
        wordsAlone: false,
      },
    });
  });

  it("refuses a reading beside the reads, rather than dropping it quietly", () => {
    expect(parse({ ...FULL, readsAfter: ["read_page"] })).toEqual({
      kind: "refused",
      status: 400,
      why: "say must be absent when readsAfter is not: after a read only the owner's words travel",
      wordsAloneRetry: true,
    });
  });

  it("accepts a words-alone retry, carrying the owner's words and neither a reading nor reads", () => {
    expect(parse({ ...NO_SAY, wordsAlone: true })).toEqual({
      kind: "relay",
      relay: {
        about: "ask:queue-shows-raw-user-id",
        alsoAnswers: [],
        heard: "the queue shows a raw user id, show the name instead",
        readsAfter: [],
        say: undefined,
        screen: { kind: "none", reason: "screen-not-shared" },
        turnId: TURN,
        wordsAlone: true,
      },
    });
  });

  it("refuses a words-alone retry that is not literally true, or carries a reading or reads", () => {
    const beside = "wordsAlone carries the owner's words only: say must be absent and readsAfter empty";
    expect([
      parse({ ...NO_SAY, wordsAlone: "yes" }),
      parse({ ...FULL, wordsAlone: true }),
      parse({ ...NO_SAY, readsAfter: ["context_pack"], wordsAlone: true }),
    ]).toEqual([
      { kind: "refused", status: 400, why: "wordsAlone must be true when present", wordsAloneRetry: false },
      { kind: "refused", status: 400, why: beside, wordsAloneRetry: false },
      { kind: "refused", status: 400, why: beside, wordsAloneRetry: false },
    ]);
  });

  it("refuses a full relay with no reading", () => {
    expect(parse(NO_SAY)).toEqual({ kind: "refused", status: 400, why: "say must be a string", wordsAloneRetry: true });
  });
});

// Whether the owner was still speaking when the voice relayed, so a cut relay is never a whole yes.
describe("parseTalkRelayRequest — whether the owner was still speaking", () => {
  it("carries cut and whole as the page stated them, and nothing when it stated neither", () => {
    expect([parse({ ...FULL, heardTail: "cut" }), parse({ ...FULL, heardTail: "whole" }), parse(FULL)]).toMatchObject([
      { kind: "relay", relay: { heardTail: "cut" } },
      { kind: "relay", relay: { heardTail: "whole" } },
      { kind: "relay", relay: { heardTail: undefined } },
    ]);
  });

  it("refuses any other value rather than reading it as whole", () => {
    const why = "heardTail must be cut or whole when present";
    expect([parse({ ...FULL, heardTail: true }), parse({ ...FULL, heardTail: "open" })]).toEqual([
      { kind: "refused", status: 400, why, wordsAloneRetry: false },
      { kind: "refused", status: 400, why, wordsAloneRetry: false },
    ]);
  });
});

describe("parseTalkRelayRequest — the other cards the owner's words answer", () => {
  it("carries the keys in the order posted, through a words-alone retry too", () => {
    const also = ["draft:abc-1", "ask:split-files"];
    expect([
      parse({ ...FULL, alsoAnswers: also }),
      parse({ ...NO_SAY, alsoAnswers: also, wordsAlone: true }),
    ]).toMatchObject([
      { kind: "relay", relay: { alsoAnswers: also } },
      { kind: "relay", relay: { alsoAnswers: also, wordsAlone: true } },
    ]);
  });

  it("refuses the card the relay is about, a hand step, and a list past the bound, never as words alone", () => {
    expect([
      parse({ ...FULL, alsoAnswers: [FULL.about] }),
      parse({ ...FULL, alsoAnswers: ["hand:sign-in"] }),
      parse({ ...FULL, alsoAnswers: ["ask:a", "ask:b", "ask:c", "ask:d", "ask:e", "ask:f"] }),
    ]).toEqual([
      {
        kind: "refused",
        status: 400,
        why: `${FULL.about} is the open card: answers_open_card says whether the owner's words answer it`,
        wordsAloneRetry: false,
      },
      {
        kind: "refused",
        status: 400,
        why: "hand:sign-in is a kind the owner's words never answer as another card",
        wordsAloneRetry: false,
      },
      {
        kind: "refused",
        status: 400,
        why: "also_answers names 6 cards; one relay names at most 5",
        wordsAloneRetry: false,
      },
    ]);
  });
});

describe("parseTalkRelayRequest — the copy-tray offer the owner reacted to", () => {
  const OFFER = {
    belowFold: "\n```\nfence inside ```` the fold\n```",
    id: "offer-12",
    label: "reply to Ari",
    made: "12",
    text: "  Merged — `#2209`, thanks <@U07ABC>  ",
  };
  const SHAPE = "offered must carry made as canonical digits and id as offer-<made>";
  const PARTS = "offered.text, belowFold and label must be nonblank whole characters, the label a few words";

  it("carries the offer byte for byte, whitespace and fences included, and keeps only its five fields", () => {
    // `toEqual` fails on a defined key the expectation lacks, so a kept `extra` would redden it.
    expect(parse({ ...FULL, offered: { ...OFFER, extra: "dropped" } })).toEqual({
      kind: "relay",
      relay: { ...FULL, alsoAnswers: [], offered: OFFER, wordsAlone: false },
    });
  });

  it("carries the offer beside a heard-only relay", () => {
    expect(parse({ ...NO_SAY, offered: OFFER, readsAfter: ["context_pack"] })).toEqual({
      kind: "relay",
      relay: {
        ...NO_SAY,
        alsoAnswers: [],
        offered: OFFER,
        readsAfter: ["context_pack"],
        say: undefined,
        wordsAlone: false,
      },
    });
  });

  it("refuses a malformed offer as a refusal the owner's words alone would pass", () => {
    expect([
      parse({ ...FULL, offered: "Merged" }),
      parse({ ...FULL, offered: { ...OFFER, id: "offer-13" } }),
      parse({ ...FULL, offered: { ...OFFER, made: "012", id: "offer-012" } }),
      parse({ ...FULL, offered: { ...OFFER, text: "   " } }),
      parse({ ...FULL, offered: { ...OFFER, belowFold: "" } }),
      parse({ ...FULL, offered: { ...OFFER, label: "x".repeat(81) } }),
      parse({ ...FULL, offered: { ...OFFER, text: "half \ud800 a pair" } }),
      parse({ ...FULL, offered: { ...OFFER, belowFold: "y".repeat(8192) } }),
    ]).toEqual([
      { kind: "refused", status: 400, why: "offered must be the copy-tray offer as an object", wordsAloneRetry: true },
      { kind: "refused", status: 400, why: SHAPE, wordsAloneRetry: true },
      { kind: "refused", status: 400, why: SHAPE, wordsAloneRetry: true },
      { kind: "refused", status: 400, why: PARTS, wordsAloneRetry: true },
      { kind: "refused", status: 400, why: PARTS, wordsAloneRetry: true },
      { kind: "refused", status: 400, why: PARTS, wordsAloneRetry: true },
      { kind: "refused", status: 400, why: PARTS, wordsAloneRetry: true },
      { kind: "refused", status: 400, why: "offered is over the list's 8192 characters", wordsAloneRetry: true },
    ]);
  });

  it("refuses an offer beside the owner's words alone, which carry nothing the voice wrote", () => {
    expect(parse({ ...NO_SAY, offered: OFFER, wordsAlone: true })).toEqual({
      kind: "refused",
      status: 400,
      why: "wordsAlone carries the owner's words only: offered must be absent",
      wordsAloneRetry: false,
    });
  });

  it("refuses a read name that is not tool-shaped, and more than thirty-two, as a refusal the owner's words alone would pass", () => {
    expect([
      parse({ ...NO_SAY, readsAfter: ["--say"] }),
      parse({ ...NO_SAY, readsAfter: Array.from({ length: 33 }, () => "read_page") }),
    ]).toEqual([
      {
        kind: "refused",
        status: 400,
        why: "readsAfter must be a list of up to 32 read-tool names, each lowercase letters and underscores",
        wordsAloneRetry: true,
      },
      {
        kind: "refused",
        status: 400,
        why: "readsAfter must be a list of up to 32 read-tool names, each lowercase letters and underscores",
        wordsAloneRetry: true,
      },
    ]);
  });

  it("accepts fifteen distinct reads at once, as many as the gate could name when the cap was raised", () => {
    const every = Array.from({ length: 15 }, (_, index) => `read_${"abcdefghijklmno"[index]}`);
    expect(parse({ ...NO_SAY, readsAfter: every }).kind).toBe("relay");
  });

  it("offers the words-alone retry for a reading the route refuses, never for a field the retry still carries", () => {
    expect([
      parse({ ...FULL, say: "- fix the tab, then merge" }),
      parse({ ...FULL, turnId: "not-a-turn" }),
    ]).toMatchObject([
      { kind: "refused", status: 400, wordsAloneRetry: true },
      { kind: "refused", status: 400, wordsAloneRetry: false },
    ]);
  });

  it("keeps a leading hyphen, and a stretch of nothing else: the owner's words ride stdin, where no flag parser reads them", () => {
    expect(parse({ ...FULL, heard: "-- show the name" })).toMatchObject({ relay: { heard: "-- show the name" } });
    expect(parse({ ...FULL, heard: "---" })).toMatchObject({ relay: { heard: "---" } });
  });

  it("makes a control character a space, so none reaches the row or the chair's terminal", () => {
    expect(parse({ ...FULL, heard: "\u0000- ship\u0000it\u001bnow" })).toMatchObject({
      relay: { heard: " - ship it now" },
    });
  });

  it("refuses a relay whose words are control characters alone, which carry no words", () => {
    expect(parse({ ...FULL, heard: "\u0000\u001b" })).toEqual({
      kind: "refused",
      status: 400,
      why: "heard carries no words once its control characters are spaces",
      wordsAloneRetry: false,
    });
  });

  it("passes on a lone surrogate as the U+FFFD the verb's UTF-8 would read, so the route and the record agree", () => {
    expect(parse({ ...FULL, heard: "pa\ud800ssword" })).toMatchObject({ relay: { heard: "pa�ssword" } });
  });
});

describe("parseTalkRelayRequest — the stated workspace", () => {
  const because = "the owner's words answer ask:queue-shows-raw-user-id, which is placed in team";

  it("carries the workspace the page placed the owner's words in, and none when it stated none", () => {
    const stated = parse({ ...FULL, workspace: { because, workspace: "team" } });
    const bare = parse(FULL) as Extract<ReturnType<typeof parse>, { kind: "relay" }>;
    expect(stated).toMatchObject({ kind: "relay", relay: { workspace: { because, workspace: "team" } } });
    expect(bare.relay.workspace).toBe(undefined);
  });

  it("refuses a workspace that is not one of the two, and a reason that is empty, multi-line or too long", () => {
    const refusedWhy = (workspace: unknown): unknown =>
      (parse({ ...FULL, workspace }) as Extract<ReturnType<typeof parse>, { kind: "refused" }>).why;
    const reasonWhy = "workspace.because must be one line of up to 300 characters";
    expect([
      refusedWhy({ because, workspace: "work" }),
      refusedWhy("acme"),
      refusedWhy({ because: " ", workspace: "team" }),
      refusedWhy({ because: "one\ntwo", workspace: "team" }),
      refusedWhy({ because: "x".repeat(301), workspace: "team" }),
    ]).toEqual([
      "workspace.workspace must be team or self",
      "workspace must be an object with workspace and because",
      reasonWhy,
      reasonWhy,
      reasonWhy,
    ]);
  });
});

describe("parseTalkRelayRequest — the discuss-first question", () => {
  const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";
  const PRIOR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

  it("carries the question the voice put, and the owner's answer past one, and none when the page sent none", () => {
    const put = { repository: "acme/acme-admin", status: "put", thread: THREAD };
    const override = { priorTurnId: PRIOR, repository: "acme/acme-admin", status: "override" };
    const bare = parse(FULL) as Extract<ReturnType<typeof parse>, { kind: "relay" }>;
    expect([parse({ ...FULL, discussFirst: put }), parse({ ...FULL, discussFirst: override })]).toMatchObject([
      { kind: "relay", relay: { discussFirst: put } },
      { kind: "relay", relay: { discussFirst: override } },
    ]);
    expect(bare.relay.discussFirst).toBe(undefined);
  });

  it("leaves whose repository it is to `talk relay`, which reads the organisation, and checks only its shape", () => {
    const put = { repository: "octo-self/slopweaver", status: "put" };
    expect(parse({ ...FULL, discussFirst: put })).toMatchObject({ kind: "relay", relay: { discussFirst: put } });
  });

  it("refuses a repository not spelt owner/name, a thread that is not Slack's, and a prior turn out of place", () => {
    const refusedWhy = (discussFirst: unknown): unknown =>
      (parse({ ...FULL, discussFirst }) as Extract<ReturnType<typeof parse>, { kind: "refused" }>).why;
    const notShape = "discussFirst.repository must be a repository as lower-case owner/name";
    expect([
      refusedWhy("put"),
      refusedWhy({ repository: "https://github.com/acme/acme-admin", status: "put" }),
      refusedWhy({ repository: "Acme/acme-admin", status: "put" }),
      refusedWhy({ repository: 7, status: "put" }),
      refusedWhy({ repository: "acme/acme-admin.git", status: "put" }),
      refusedWhy({ repository: "acme/acme-admin", status: "put", thread: "https://example.com/t" }),
      refusedWhy({ priorTurnId: PRIOR, repository: "acme/acme-admin", status: "put" }),
      refusedWhy({ repository: "acme/acme-admin", status: "override" }),
      refusedWhy({ repository: "acme/acme-admin", status: "held" }),
      refusedWhy({ extra: 1, repository: "acme/acme-admin", status: "put" }),
    ]).toEqual([
      "discussFirst must be an object",
      notShape,
      notShape,
      notShape,
      notShape,
      "discussFirst.thread must be a Slack message link",
      "discussFirst.priorTurnId goes only with status override",
      "discussFirst.priorTurnId must be the v4 UUID of the relay that put the question",
      "discussFirst.status must be put or override",
      "discussFirst carries status, repository, thread and priorTurnId only",
    ]);
  });
});

describe("parseTalkRelayRequest — the picture", () => {
  it("decodes an attached WebP to its bytes", () => {
    const parsed = parse({ ...FULL, screen: { dataUrl: webpUrl({ body: 4 }), kind: "attached" } });
    expect(parsed).toMatchObject({
      kind: "relay",
      relay: { screen: { bytes: webpBytes({ body: 4 }), kind: "attached" } },
    });
  });

  it("refuses a PNG data URL, however valid", () => {
    expect(parse({ ...FULL, screen: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", kind: "attached" } })).toEqual({
      kind: "refused",
      status: 400,
      why: `screen.dataUrl must start ${RELAY_PICTURE_PREFIX}`,
      wordsAloneRetry: false,
    });
  });

  it("refuses base64 that is not canonical", () => {
    expect(parse({ ...FULL, screen: { dataUrl: `${RELAY_PICTURE_PREFIX}UklGRg*=`, kind: "attached" } })).toEqual({
      kind: "refused",
      status: 400,
      why: "screen.dataUrl is not canonical base64",
      wordsAloneRetry: false,
    });
  });

  it("refuses RIFF that is not WEBP", () => {
    const wave = `${RELAY_PICTURE_PREFIX}${btoa("RIFF\0\0\0\0WAVEfmt ")}`;
    expect(parse({ ...FULL, screen: { dataUrl: wave, kind: "attached" } })).toEqual({
      kind: "refused",
      status: 400,
      why: "the picture is not a WebP image (no RIFF/WEBP container around an image chunk)",
      wordsAloneRetry: false,
    });
  });

  it("accepts a picture exactly at the byte bound", () => {
    const parsed = parse({
      ...FULL,
      screen: { dataUrl: webpUrl({ body: RELAY_PICTURE_MAX_BYTES - 20 }), kind: "attached" },
    });
    expect(parsed.kind).toBe("relay");
  });

  it("refuses a data URL past the bound before decoding it", () => {
    const past = `${RELAY_PICTURE_PREFIX}${"A".repeat(RELAY_FRAME_DATA_URL_MAX - RELAY_PICTURE_PREFIX.length + 4)}`;
    expect(parse({ ...FULL, screen: { dataUrl: past, kind: "attached" } })).toMatchObject({
      kind: "refused",
      status: 413,
    });
  });
});

describe("parseTalkRelayRequest — the envelope", () => {
  it("measures the body in UTF-8 bytes, so the owner's non-ASCII words are counted as what they weigh", () => {
    const heavy = "é".repeat(Math.ceil(RELAY_BODY_MAX_BYTES / 2));
    expect(parseTalkRelayRequest({ raw: heavy })).toMatchObject({ kind: "refused", status: 413 });
  });

  // A long stretch is refused as "heard is 15357 characters; this route carries 8000".
  it("carries a long stretch of the owner's whole, beside a picture at its bound", () => {
    const heard = `start ${"word ".repeat(3_070)}end`;
    const parsed = parse({
      ...FULL,
      heard,
      screen: { dataUrl: webpUrl({ body: RELAY_PICTURE_MAX_BYTES - 20 }), kind: "attached" },
    });
    expect(parsed.kind).toBe("relay");
    expect(parsed).toMatchObject({ relay: { heard } });
  });

  it("carries the owner's words at RELAY_HEARD_MAX in non-ASCII beside a picture at its bound, and refuses one past it", () => {
    const screen = { dataUrl: webpUrl({ body: RELAY_PICTURE_MAX_BYTES - 20 }), kind: "attached" };
    const at = parse({ ...FULL, heard: "é".repeat(RELAY_HEARD_MAX), screen });
    expect(at).toMatchObject({ kind: "relay", relay: { heard: "é".repeat(RELAY_HEARD_MAX) } });
    expect(parse({ ...FULL, heard: "a".repeat(RELAY_HEARD_MAX + 1) })).toEqual({
      kind: "refused",
      status: 413,
      why: `heard is ${String(RELAY_HEARD_MAX + 1)} characters; this route carries ${String(RELAY_HEARD_MAX)}`,
      wordsAloneRetry: false,
    });
  });

  it("refuses a turn id the widget did not mint, an about that is not a key, and no words of the owner's", () => {
    expect(parse({ ...FULL, turnId: "../../etc" }).kind).toBe("refused");
    expect(parse({ ...FULL, about: "../passwd" }).kind).toBe("refused");
    expect(parse({ ...FULL, heard: "  " }).kind).toBe("refused");
  });
});

// The owner's verdict on a check-in the voice read clears every card of its rule.
describe("parseTalkRelayRequest — a verdict on a check-in", () => {
  it("carries how far the owner's verdict reaches when the relay is about a check-in", () => {
    const parsed = parse({ ...FULL, about: "act:ev-2", covers: "rule" });
    expect(parsed.kind).toBe("relay");
    const relay = (parsed as Extract<typeof parsed, { kind: "relay" }>).relay;
    expect([relay.about, relay.covers]).toEqual(["act:ev-2", "rule"]);
    const plain = parse(FULL) as Extract<ReturnType<typeof parse>, { kind: "relay" }>;
    expect(plain.relay.covers).toBeUndefined();
  });

  it("refuses a reach outside the two, and one on a relay that is not about a check-in", () => {
    expect(parse({ ...FULL, about: "act:ev-2", covers: "everything" })).toEqual({
      kind: "refused",
      status: 400,
      why: "covers must be rule or this",
      wordsAloneRetry: false,
    });
    expect(parse({ ...FULL, covers: "this" })).toEqual({
      kind: "refused",
      status: 400,
      why: "covers records the owner's word on a check-in, so about must be act:<actionId>",
      wordsAloneRetry: false,
    });
  });
});

// The owner's spoken ruling on a candidate is written onto the candidate.
describe("parseTalkRelayRequest — a ruling on a workstream candidate", () => {
  it("carries the candidate and the owner's word as a pair, and none when the relay names none", () => {
    const parsed = parse({ ...FULL, candidate: "c-105", reaction: "no" }) as Extract<
      ReturnType<typeof parse>,
      { kind: "relay" }
    >;
    expect(parsed.relay.candidateRuling).toEqual({ candidate: "c-105", reaction: "no" });
    const plain = parse(FULL) as Extract<ReturnType<typeof parse>, { kind: "relay" }>;
    expect(plain.relay.candidateRuling).toBeUndefined();
  });

  it("refuses half a pair, an id that is not one, a word not the owner's, and a ruling beside a check-in's reach", () => {
    const refusal = (why: string): unknown => ({ kind: "refused", status: 400, why, wordsAloneRetry: false });
    expect(parse({ ...FULL, reaction: "no" })).toEqual(
      refusal("candidate must be a candidate id such as c-105, beside reaction"),
    );
    expect(parse({ ...FULL, candidate: "--home /tmp", reaction: "no" })).toEqual(
      refusal("candidate must be a candidate id such as c-105, beside reaction"),
    );
    // Eighty-one characters, the last a newline: the candidates file refuses it, so the relay must too.
    expect(parse({ ...FULL, candidate: `${"a".repeat(80)}\n`, reaction: "no" })).toEqual(
      refusal("candidate must be a candidate id such as c-105, beside reaction"),
    );
    expect(parse({ ...FULL, candidate: "c-105" })).toEqual(
      refusal("reaction must be one of yes, no, sort-of, not-sure, lets-talk, done, abandoned, beside candidate"),
    );
    expect(parse({ ...FULL, about: "act:ev-2", candidate: "c-105", covers: "rule", reaction: "no" })).toEqual(
      refusal("a relay carries one ruling: candidate with reaction, or covers, never both"),
    );
  });
});

// The owner's triage verdict and label on the card the pass has open.
describe("parseTalkRelayRequest — a triage ruling", () => {
  it("carries the verdict with its label, a verdict alone, and none when the relay names none", () => {
    const relayOf = (body: unknown) => (parse(body) as Extract<ReturnType<typeof parse>, { kind: "relay" }>).relay;
    expect([
      relayOf({ ...FULL, label: "waiting-on-them", triage: "park-slow-triage" }).triageRuling,
      relayOf({ ...FULL, triage: "rewrite" }).triageRuling,
      relayOf(FULL).triageRuling,
    ]).toEqual([
      { label: "waiting-on-them", verdict: "park-slow-triage" },
      { label: undefined, verdict: "rewrite" },
      undefined,
    ]);
  });

  it("refuses a label alone, a word not the owner's, and a triage ruling beside another ruling", () => {
    const refusal = (why: string): unknown => ({ kind: "refused", status: 400, why, wordsAloneRetry: false });
    expect([
      parse({ ...FULL, label: "action-now" }),
      parse({ ...FULL, triage: "bin-it" }),
      parse({ ...FULL, label: "someday", triage: "send-it" }),
      parse({ ...FULL, about: "act:ev-2", covers: "rule", triage: "send-it" }),
    ]).toEqual([
      refusal("triage must be one of the owner's triage verdicts; label and feedback ride only beside it"),
      refusal("triage must be one of the owner's triage verdicts; label and feedback ride only beside it"),
      refusal("label must be one of the owner's inbox-zero labels"),
      refusal("a relay carries one ruling: triage, candidate or covers, never two"),
    ]);
  });

  // What was wrong with a card the owner sent back travels as a class, never as prose to mine.
  it("carries the owner's named feedback beside a verdict that sends the card back, and refuses it anywhere else", () => {
    const relayOf = (body: unknown) => (parse(body) as Extract<ReturnType<typeof parse>, { kind: "relay" }>).relay;
    const refusal = (why: string): unknown => ({ kind: "refused", status: 400, why, wordsAloneRetry: false });
    expect(relayOf({ ...FULL, feedback: "no-receipts", triage: "needs-more-info" }).triageRuling).toEqual({
      feedback: "no-receipts",
      label: undefined,
      verdict: "needs-more-info",
    });
    expect([
      parse({ ...FULL, feedback: "no-receipts" }),
      parse({ ...FULL, feedback: "too-long", triage: "rewrite" }),
      parse({ ...FULL, feedback: "no-receipts", triage: "send-it" }),
    ]).toEqual([
      refusal("triage must be one of the owner's triage verdicts; label and feedback ride only beside it"),
      refusal("feedback must be one of no-receipts, not-at-a-glance"),
      refusal("feedback names what to fix on a sent-back card, so it rides only beside needs-more-info or rewrite"),
    ]);
  });
});

// `slopweaver desktop e2e --call`: a relay types the owner's steer into the chair, and the walk's speech is never the owner's.
describe("parseTalkRelayRequest — the desktop test instance", () => {
  it("refuses a marked relay outright, never offering the words-alone retry", () => {
    expect(parse({ ...FULL, instance: "e2e" })).toEqual({
      kind: "refused",
      status: 403,
      why: "the desktop e2e test instance relays nothing: its speech is the walk's, never the owner's steer",
      wordsAloneRetry: false,
    });
  });

  it("refuses a marker that is not exactly e2e, rather than reading the relay as the owner's", () => {
    expect([parse({ ...FULL, instance: "E2E" }), parse({ ...FULL, instance: null })]).toEqual([
      { kind: "refused", status: 400, why: "instance must be e2e when present", wordsAloneRetry: false },
      { kind: "refused", status: 400, why: "instance must be e2e when present", wordsAloneRetry: false },
    ]);
  });

  it("marks only the test instance's relay as the page posts it", () => {
    const wire = { ...FULL, screen: { kind: "none", reason: "screen-not-shared" } } as const;
    expect(relayWireForInstance({ instance: "e2e", wire })).toStrictEqual({ ...wire, instance: "e2e" });
    expect(relayWireForInstance({ instance: undefined, wire })).toStrictEqual(wire);
  });
});

describe("the relay picture", () => {
  it("refuses a body carrying the header-shaped WebP shell, before a byte of it is written", () => {
    const shell = `${RELAY_PICTURE_PREFIX}UklGRgAAAABXRUJQ`;
    expect(parse({ ...FULL, screen: { dataUrl: shell, kind: "attached" } })).toEqual({
      kind: "refused",
      status: 400,
      why: "the picture is not a WebP image (no RIFF/WEBP container around an image chunk)",
      wordsAloneRetry: false,
    });
  });
});
