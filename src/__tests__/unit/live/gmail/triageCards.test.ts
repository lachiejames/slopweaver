/**
 * Unit: the triage card pins — written once, owner-only, and refused on read when they are not a pin.
 *
 * Ids here are synthetic. Every case is a real round trip into a `mkdtempSync` home.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type GmailTriageCard, pinTriageCard, readTriageCard } from "../../../../live/gmail/triageCards.js";
import { stateHomePaths } from "../../../../stateHome.js";

const CARD: GmailTriageCard = {
  ids: ["m-1", "m-2"],
  key: "from:a@example.test",
  pinnedAtIso: "2026-09-30T08:00:00.000Z",
  schemaVersion: 1,
  slug: "inbox-triage-1",
};

describe("pinTriageCard / readTriageCard", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  function newHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-triage-cards-"));
    homes.push(home);
    return home;
  }

  it("pins 0600 in a directory forced to 0700 even when it stood open, and reads the pin back whole", () => {
    const home = newHome();
    const directory = stateHomePaths({ home }).live.gmail.triageCards;
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o755);
    const { path } = unwrap(pinTriageCard({ card: CARD, home }));
    expect(path).toBe(join(directory, "inbox-triage-1.json"));
    expect([statSync(path).mode & 0o777, statSync(directory).mode & 0o777]).toEqual([0o600, 0o700]);
    expect(unwrap(readTriageCard({ home, slug: "inbox-triage-1" }))).toEqual(CARD);
  });

  it("refuses a second pin under the same slug and keeps the first", () => {
    const home = newHome();
    unwrap(pinTriageCard({ card: CARD, home }));
    const again = unwrapErr(pinTriageCard({ card: { ...CARD, ids: ["m-3"] }, home }));
    expect(again.code).toBe("CARD_ALREADY_PINNED");
    expect(unwrap(readTriageCard({ home, slug: "inbox-triage-1" })).ids).toEqual(["m-1", "m-2"]);
  });

  it("reads an absent pin as not pinned, and a file that is not a pin as malformed", () => {
    const home = newHome();
    expect(unwrapErr(readTriageCard({ home, slug: "inbox-triage-1" })).code).toBe("CARD_NOT_PINNED");
    const directory = stateHomePaths({ home }).live.gmail.triageCards;
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "not-json.json"), "{");
    writeFileSync(join(directory, "no-ids.json"), JSON.stringify({ ...CARD, ids: [], slug: "no-ids" }));
    writeFileSync(join(directory, "other-slug.json"), JSON.stringify(CARD));
    const codes = ["not-json", "no-ids", "other-slug"].map((slug) => unwrapErr(readTriageCard({ home, slug })).code);
    expect(codes).toEqual(["CARD_MALFORMED", "CARD_MALFORMED", "CARD_MALFORMED"]);
  });
});
