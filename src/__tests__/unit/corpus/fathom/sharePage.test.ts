/**
 * Unit: the pure half of `fathom share` — the address it accepts, the page read it trusts, the record it
 * writes, and the links discovery lifts out of a mail. The record's properties are the ones the owner ruled
 * on: raw words by speaker, never Fathom's own action items, keyed on the recording id the API lane uses.
 */
import { describe, expect, it } from "vitest";

import { FATHOM_BUCKET } from "../../../../corpus/fathom/project.js";
import {
  offsetStamp,
  parseFathomShareUrl,
  projectFathomShareCall,
  readFathomShareCapture,
  shareHostName,
  shareTokensIn,
} from "../../../../corpus/fathom/sharePage.js";
import { unwrap } from "../../../../lib/result.js";

const TOKEN = "cPAstBybUhyaoL9wD_xuMQK_byssuMG_";
const URL_OF = `https://fathom.video/share/${TOKEN}`;
const ADDRESS = { token: TOKEN, url: URL_OF };

/** A snippet output as the live page returned it, with the parts a test varies overridable. */
function capture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    finalUrl: URL_OF,
    read: {
      attendees: [
        { email: "felix@vendor.test", name: "Felix" },
        { email: null, name: "Ada" },
      ],
      call: {
        durationMinutes: 58,
        hostEmail: "felix@vendor.test",
        id: 832123640,
        recordingStartedAt: "2026-09-23T00:59:39.542238Z",
        scheduledStartAt: "2026-09-23T01:00:00Z",
        title: "Compliance weekly",
      },
      cues: [
        { email: "felix@vendor.test", speaker: "Felix", startSeconds: 4.7, text: "Shall we start with ISO?" },
        { email: null, speaker: "Ada", startSeconds: 3671, text: "Yes — sixty percent." },
      ],
      droppedNotes: 3,
      present: true,
      ready: true,
    },
    title: "Compliance weekly | Fathom",
    ...over,
  };
}

describe("parseFathomShareUrl", () => {
  it("reduces a copied link with a tracking tail to the canonical address", () => {
    const parsed = unwrap(parseFathomShareUrl({ url: ` ${URL_OF}/?utm_source=email#t=10 ` }));
    expect(parsed).toEqual({ token: TOKEN, url: URL_OF });
  });

  it("refuses another origin, naming it", () => {
    const parsed = parseFathomShareUrl({ url: `https://fathom.video.example/share/${TOKEN}` });
    expect(parsed._unsafeUnwrapErr().code).toBe("URL_INVALID");
    expect(parsed._unsafeUnwrapErr().message).toContain("https://fathom.video.example");
  });

  it("refuses a call page that is not a share link", () => {
    const parsed = parseFathomShareUrl({ url: "https://fathom.video/calls/832123640" });
    expect(parsed._unsafeUnwrapErr().message).toContain("its path is not /share/<token>");
  });

  it("refuses something that is not a URL at all", () => {
    expect(parseFathomShareUrl({ url: "share me" })._unsafeUnwrapErr().message).toContain("it is not a URL");
  });
});

describe("readFathomShareCapture", () => {
  it("reads the call, its cues and the dropped-note count", () => {
    const call = unwrap(readFathomShareCapture({ address: ADDRESS, output: capture() }));
    expect(call.recordingId).toBe(832123640);
    expect(call.recordingStartIso).toBe("2026-09-23T00:59:39.542238Z");
    expect(call.cues.map((cue) => cue.speaker)).toEqual(["Felix", "Ada"]);
    expect(call.droppedNotes).toBe(3);
    expect(call.attendees).toEqual([
      { email: "felix@vendor.test", name: "Felix" },
      { email: null, name: "Ada" },
    ]);
  });

  it("names a sign-in wall as NOT_SHOWN with where the browser landed", () => {
    const landed = `https://fathom.video/users/sign_in?share_token=${TOKEN}`;
    const read = readFathomShareCapture({ address: ADDRESS, output: capture({ finalUrl: landed }) });
    expect(read._unsafeUnwrapErr().code).toBe("NOT_SHOWN");
    expect(read._unsafeUnwrapErr().message).toContain(landed);
  });

  it("names a page with no call element as SHAPE_CHANGED", () => {
    const read = readFathomShareCapture({ address: ADDRESS, output: capture({ read: { present: false } }) });
    expect(read._unsafeUnwrapErr().code).toBe("SHAPE_CHANGED");
    expect(read._unsafeUnwrapErr().message).toContain("no page-call-detail element");
  });

  it("names a page whose cues never arrived as TRANSCRIPT_ABSENT", () => {
    const read = readFathomShareCapture({
      address: ADDRESS,
      output: capture({ read: { present: true, ready: false } }),
    });
    expect(read._unsafeUnwrapErr().code).toBe("TRANSCRIPT_ABSENT");
  });

  it("refuses a cue with no speaker rather than guessing one", () => {
    const base = capture();
    const read = base["read"] as Record<string, unknown>;
    const output = { ...base, read: { ...read, cues: [{ email: null, speaker: "", startSeconds: 1, text: "hi" }] } };
    expect(readFathomShareCapture({ address: ADDRESS, output })._unsafeUnwrapErr().message).toContain(
      "cue 0 is not a spoken line",
    );
  });

  it("refuses a call with no recording start rather than dating it by the clock", () => {
    const base = capture();
    const read = base["read"] as Record<string, unknown>;
    const call = { ...(read["call"] as Record<string, unknown>), recordingStartedAt: null };
    const output = { ...base, read: { ...read, call } };
    expect(readFathomShareCapture({ address: ADDRESS, output })._unsafeUnwrapErr().message).toContain(
      "no recording start",
    );
  });
});

describe("offsetStamp", () => {
  it("drops fractions and carries hours", () => {
    expect(offsetStamp({ seconds: 3671.9 })).toBe("01:01:11");
    expect(offsetStamp({ seconds: 0 })).toBe("00:00:00");
  });
});

describe("projectFathomShareCall", () => {
  const record = projectFathomShareCall({
    address: ADDRESS,
    call: unwrap(readFathomShareCapture({ address: ADDRESS, output: capture() })),
  });

  it("keys on the recording id, cited by the share URL, dated by the recording", () => {
    expect(record.source).toBe("fathom");
    expect(record.kind).toBe("transcript");
    expect(record.container).toBe(FATHOM_BUCKET);
    expect(record.sourceId).toBe("832123640");
    expect(record.url).toBe(URL_OF);
    expect(record.tsIso).toBe("2026-09-23T00:59:39.542238Z");
    expect(record.author).toBe("Felix");
    expect(record.title).toBe("Compliance weekly");
  });

  it("holds the raw words by speaker and offset, one line per cue", () => {
    expect(record.text).toBe("[00:00:04] Felix: Shall we start with ISO?\n[01:01:11] Ada: Yes — sixty percent.");
  });

  it("carries the token discovery asks about and the count of notes it never read", () => {
    expect(record.attrs!["shareToken"]).toBe(TOKEN);
    expect(record.attrs!["via"]).toBe("share-page");
    expect(record.attrs!["providerNotesDropped"]).toBe(3);
    expect(record.attrs!["speakers"]).toEqual(["Felix", "Ada"]);
    expect(Object.keys(record.attrs!).filter((key) => key.startsWith("action"))).toEqual([]);
  });

  it("is private", () => {
    expect(record.visibility).toBe("private");
  });
});

describe("shareHostName", () => {
  const base = unwrap(readFathomShareCapture({ address: ADDRESS, output: capture() }));

  it("names the host by the attendee row carrying their address, whatever its case", () => {
    expect(shareHostName({ call: { ...base, hostEmail: "Felix@Vendor.test" } })).toBe("Felix");
  });

  it("falls back to the address's local part when no attendee row carries it, never the address", () => {
    expect(shareHostName({ call: { ...base, hostEmail: "zoe.host@vendor.test" } })).toBe("zoe.host");
  });

  it("names nobody when the page named no host", () => {
    expect(shareHostName({ call: { ...base, hostEmail: null } })).toBeUndefined();
  });
});

describe("shareTokensIn", () => {
  it("finds each token once, in first-seen order, across body and link targets", () => {
    const other = "ePiRerJ33vCHFeZ1c5dDfMcAniBsMiYm";
    const texts = [
      `View the call: https://fathom.video/share/${TOKEN}?utm_source=email and again ${URL_OF}`,
      `https://fathom.video/share/${other}`,
    ];
    expect(shareTokensIn({ texts })).toEqual([TOKEN, other]);
  });

  it("ignores a lookalike host and a non-share Fathom link", () => {
    const texts = [`https://fathom.video.example/share/${TOKEN}`, "https://fathom.video/calls/832123640"];
    expect(shareTokensIn({ texts })).toEqual([]);
  });
});
