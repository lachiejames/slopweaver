/**
 * Unit: which share links a discovery pass reports, and which it calls new. Pure — the mails are literals.
 */
import { describe, expect, it } from "vitest";

import {
  coverageLine,
  discoverLines,
  discoverOutputLines,
  sharesInMail,
} from "../../../../../cli/commands/fathom/discoverCore.js";
import type { FathomShareOutcome } from "../../../../../cli/commands/fathom/shareCore.js";

const A = "ePiRerJ33vCHFeZ1c5dDfMcAniBsMiYm";
const B = "3PMAimxXNiHo_28zAZ33f7ygsVkJCzsx";

const MAILS = [
  {
    id: "m2",
    inInbox: true,
    sentAtIso: "2026-09-23T01:49:01.000Z",
    subject: "Felix shared a recap of your meeting",
    texts: ["View recap", `https://fathom.video/share/${B}?utm_source=email`, `https://fathom.video/share/${A}`],
  },
  {
    id: "m1",
    inInbox: true,
    sentAtIso: "2026-09-23T01:46:24.000Z",
    subject: "recap",
    texts: [`https://fathom.video/share/${A}`],
  },
  { id: "m0", inInbox: true, sentAtIso: undefined, subject: undefined, texts: ["no links in this one"] },
];

describe("sharesInMail", () => {
  it("names each link once, from the first mail carrying it, and marks what is held", () => {
    const shares = sharesInMail({ held: new Set([A]), mails: MAILS });
    expect(shares.map((share) => [share.token, share.mailId, share.held])).toEqual([
      [B, "m2", false],
      [A, "m2", true],
    ]);
    expect(shares[0]!.url).toBe(`https://fathom.video/share/${B}`);
  });

  it("finds nothing in mail with no share link", () => {
    expect(sharesInMail({ held: new Set(), mails: [MAILS[2]!] })).toEqual([]);
  });
});

describe("discoverLines", () => {
  it("heads with the totals and marks each link held or new", () => {
    const lines = discoverLines({ shares: sharesInMail({ held: new Set([A]), mails: MAILS }) });
    expect(lines).toEqual([
      "fathom discover — 2 share link(s) in Fathom's mail, 1 not yet held",
      `  NEW  https://fathom.video/share/${B}  2026-09-23T01:49:01.000Z`,
      `  held https://fathom.video/share/${A}  2026-09-23T01:49:01.000Z`,
    ]);
  });
});

describe("coverageLine", () => {
  it("says the whole match was read when Gmail reported no further page", () => {
    expect(coverageLine({ coverage: { matchingEstimate: 3, more: false, read: 3 } })).toBe(
      "  read all 3 Fathom mail(s)",
    );
  });

  it("says older mail was NOT read, and how to reach it, when Gmail reported more", () => {
    expect(coverageLine({ coverage: { matchingEstimate: 140, more: true, read: 25 } })).toBe(
      "  read the newest 25 of about 140 Fathom mail(s); older ones were NOT read, so a share only they carry is " +
        "not listed — raise --limit (up to 100), or share that link by hand",
    );
  });
});

describe("discoverOutputLines", () => {
  const shares = sharesInMail({ held: new Set([A]), mails: MAILS });
  const coverage = { matchingEstimate: 3, more: false, read: 3 };
  const outcome: FathomShareOutcome = {
    dryRun: false,
    handWrittenLinesRemoved: 0,
    lines: 1,
    providerNotesDropped: 0,
    recordingId: 832123640,
    recordingStartIso: "2026-09-23T00:59:39.542Z",
    speakers: ["Felix"],
    store: null,
    storeWithheldFor: [],
    title: null,
    token: B,
    url: `https://fathom.video/share/${B}`,
    written: true,
  };

  it("prints the discovery report, then each ingested share's own report", () => {
    const report = {
      failures: ["bad link"],
      outcomes: [outcome],
      settle: { store: { retired: 4, stored: 5 }, storeWithheldFor: [] },
    };
    const lines = discoverOutputLines({ coverage, json: false, report, shares });
    expect(lines).toEqual([
      ...discoverLines({ shares }),
      "  read all 3 Fathom mail(s)",
      "fathom share — (untitled call) (recording 832123640), recorded 2026-09-23T00:59:39.542Z",
      "  1 spoken line(s) by Felix",
      `  https://fathom.video/share/${B}`,
      "  bronze: stored",
      "  store: skipped",
      "fathom store: settled, retired 4 row(s), replayed fathom (5 upserted)",
    ]);
  });

  it("prints one JSON document under --json, carrying the failures beside what was ingested", () => {
    const report = { failures: ["bad link"], outcomes: [], settle: null };
    const lines = discoverOutputLines({ coverage, json: true, report, shares });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      coverage,
      failures: ["bad link"],
      settle: null,
      ingested: [],
      shares: JSON.parse(JSON.stringify(shares)),
    });
  });

  it("names an undated mail out loud rather than printing nothing", () => {
    const undated = sharesInMail({ held: new Set(), mails: [{ ...MAILS[1]!, sentAtIso: undefined }] });
    expect(discoverLines({ shares: undated })[1]).toBe(`  NEW  https://fathom.video/share/${A}  (undated)`);
  });
});
