/**
 * The Queue card currency's strict reader: it drops a whole document rather than a row it cannot read,
 * and reads a reply's link only when it is a Slack message link. Split from `./cardCurrency.test.ts`, which holds the
 * mark itself.
 */
import { describe, expect, it } from "vitest";

import { readCurrency } from "../../components/live/readCurrency";
import type { CurrencyCardRow, CurrencyReading } from "../../lib/cardCurrency";

const ASKED = "2026-10-02T10:00:00.000Z";
const CHECKED = "2026-10-02T12:00:00.000Z";
const READ = "2026-10-02T12:30:00.000Z";
const REPLY = "https://acme.slack.com/archives/C1/p1785114518000200";

/** A legacy ask row; every case below replaces its done-check with the one it reads. */
const base: CurrencyCardRow = {
  askedIso: ASKED,
  done: { kind: "not-yet", readAtIso: READ },
  floorIso: ASKED,
  key: "ask:mirror",
  since: { gaps: [], standing: [], words: [] },
};

const readingOf = (): CurrencyReading => ({
  checkedIso: CHECKED,
  readFromIso: "2026-10-01T12:00:00.000Z",
  rows: [base],
  sources: { chair: "132 turns read", relays: "0 undelivered", voice: "0 unread call words" },
});

describe("readCurrency", () => {
  it("drops the whole document when one row will not read, rather than losing the row", () => {
    const broken = { ...readingOf(), rows: [{ ...base, done: { kind: "replied" } }] };

    expect(readCurrency(broken)).toBeUndefined();
  });

  it("reads a reply's link only when it is a Slack message link, the one reading string a line prints", () => {
    const replied = ({ permalink }: { permalink: string }) => ({
      ...readingOf(),
      rows: [{ ...base, done: { atIso: CHECKED, kind: "replied", permalink } }],
    });

    expect(readCurrency(replied({ permalink: REPLY }))!.rows[0].done).toEqual({
      atIso: CHECKED,
      kind: "replied",
      permalink: REPLY,
    });
    expect(readCurrency(replied({ permalink: "producer reason: path /secret/checks.txt" }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: "http://acme.slack.com/archives/C1/p1" }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: "https://slack.com.evil.test/archives/C1/p1" }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: "https://acme.slack.com/not-a-message?why=reason" }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: `${REPLY}?why=reason` }))).toBeUndefined();
    // An allowed key carrying prose is the same smuggle as an unknown key.
    const smuggled = `${REPLY}?thread_ts=1785114518.000200&cid=producer reason: gap /secret/checks.txt`;
    expect(readCurrency(replied({ permalink: smuggled }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: `${REPLY}?thread_ts=see /secret` }))).toBeUndefined();
    // Anything the checks do not look at is refused because the link must equal its own rebuild.
    const credentialed = "https://producer-reason:secret@acme.slack.com/archives/C1/p1785114518000200";
    expect(readCurrency(replied({ permalink: credentialed }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: "https://acme.slack.com:8443/archives/C1/p1" }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: `${REPLY}#producer-reason` }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: `${REPLY}?` }))).toBeUndefined();
    expect(readCurrency(replied({ permalink: `${REPLY}?thread_ts=%31.2&cid=C1` }))).toBeUndefined();
    const threaded = `${REPLY}?thread_ts=1785114518.000200&cid=C1`;
    expect(readCurrency(replied({ permalink: threaded }))!.rows[0].done).toEqual({
      atIso: CHECKED,
      kind: "replied",
      permalink: threaded,
    });
  });
});
