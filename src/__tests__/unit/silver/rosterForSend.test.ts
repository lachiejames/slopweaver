/**
 * The just-in-time roster a send sees, judged against the moment the send was asked for — over a real temp
 * home, with the real derive pipeline, so the stamp read back is the one the shipped code wrote.
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HeapGuard } from "#lib/heapBudget.js";
import { bronzeFile } from "../../../corpus/corpusPaths.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { readFreshnessStamp } from "../../../silver/derive/stamp.js";
import type { IdentityRosterSnapshot } from "../../../silver/identityRoster.js";
import { rosterForSend } from "../../../silver/rosterForSend.js";

/** The roster as a store with no row reads it. */
const NO_ROW: IdentityRosterSnapshot = { records: [], retiredFile: undefined, revision: null };

const window = { since: "2026-01-01", until: "2026-02-01" };

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One slack bronze record, serialised as one line. */
function slackLine({ sourceId }: { sourceId: string }): string {
  const record: CorpusRecord = {
    author: "U1",
    container: "slack/c",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId,
    text: "a slack message",
    tsIso: "2026-01-11T00:00:00Z",
    url: `https://example.test/${sourceId}`,
  };
  return `${JSON.stringify(record)}\n`;
}

/** A temp home holding one slack bronze window and no derived roster at all. */
function seedHome(): { home: string; slackWindow: string } {
  const home = mkdtempSync(join(tmpdir(), "roster-for-send-"));
  fixtureDirs.push(home);
  mkdirSync(join(home, "corpus", "bronze", "slack"), { recursive: true });
  const slackWindow = bronzeFile({ home, source: "slack", window });
  writeFileSync(slackWindow, slackLine({ sourceId: "s1" }), "utf8");
  return { home, slackWindow };
}

// Both fixed: one long before any derive this file runs, one long after. Neither reads the wall clock.
const ASKED_BEFORE_THE_DERIVE = "2026-01-01T00:00:00.000Z";
const ASKED_AFTER_THE_DERIVE = "2099-01-01T00:00:00.000Z";

describe("rosterForSend — freshness is judged against the ask", () => {
  it("uses its own just-in-time roster when bronze grows after the ask, without deriving again", () => {
    const { home, slackWindow } = seedHome();

    const first = rosterForSend({
      affectsOutput: true,
      askedAtIso: ASKED_BEFORE_THE_DERIVE,
      home,
      identityRoster: NO_ROW,
    });
    expect(first.freshness).toEqual({ kind: "fresh" });
    const stampedBytes = readFreshnessStamp({ home })!.sources.slack.bronzeBytes;
    expect(stampedBytes).toBe(slackLine({ sourceId: "s1" }).length);

    // A refresh in another workspace appends while this send is still resolving its mentions.
    appendFileSync(slackWindow, slackLine({ sourceId: "s2" }), "utf8");
    const second = rosterForSend({
      affectsOutput: true,
      askedAtIso: ASKED_BEFORE_THE_DERIVE,
      home,
      identityRoster: NO_ROW,
    });

    expect(second.freshness).toEqual({ kind: "fresh" });
    // The witness that no second derive ran: the stamp still records the pre-append bronze.
    expect(readFreshnessStamp({ home })!.sources.slack.bronzeBytes).toBe(stampedBytes);
  });

  it("gives a LATER ask in the same process its own derive, rather than the earlier send's roster", () => {
    const { home, slackWindow } = seedHome();
    rosterForSend({ affectsOutput: true, askedAtIso: ASKED_BEFORE_THE_DERIVE, home, identityRoster: NO_ROW });
    appendFileSync(slackWindow, slackLine({ sourceId: "s2" }), "utf8");
    const grownBytes = slackLine({ sourceId: "s1" }).length + slackLine({ sourceId: "s2" }).length;

    // `automation run-due`'s shape: the next row's send is asked for after the bytes landed.
    const later = rosterForSend({
      affectsOutput: true,
      askedAtIso: ASKED_AFTER_THE_DERIVE,
      home,
      identityRoster: NO_ROW,
    });

    expect(later.freshness).toEqual({ kind: "fresh" });
    expect(readFreshnessStamp({ home })!.sources.slack.bronzeBytes).toBe(grownBytes);
  });

  it("never settles growth that landed BEFORE the ask", () => {
    const { home, slackWindow } = seedHome();
    rosterForSend({ affectsOutput: true, askedAtIso: ASKED_BEFORE_THE_DERIVE, home, identityRoster: NO_ROW });
    appendFileSync(slackWindow, slackLine({ sourceId: "s2" }), "utf8");

    // A send that does not address anyone never pays for a derive, so the growth is reported, not settled.
    const unaddressed = rosterForSend({
      affectsOutput: false,
      askedAtIso: ASKED_AFTER_THE_DERIVE,
      home,
      identityRoster: NO_ROW,
    });

    expect(unaddressed.freshness.kind).toBe("stale");
  });
});

describe("rosterForSend — a derive the heap cannot hold", () => {
  it("hands back the unusable verdict, so the send refuses instead of dying at the ceiling", () => {
    const { home } = seedHome();
    const refusing: HeapGuard = ({ projectedBytes }) => ({
      collected: true,
      fits: false,
      limitBytes: 4288 * 1024 * 1024,
      projectedBytes,
      shortfallBytes: 1,
      suggestedLimitMib: 5632,
      usedBytes: 3456 * 1024 * 1024,
    });

    const sent = rosterForSend({
      affectsOutput: true,
      askedAtIso: ASKED_BEFORE_THE_DERIVE,
      heapGuard: refusing,
      home,
      identityRoster: NO_ROW,
    });

    // `absent` is what every send path's stale-roster refusal reads; no derive wrote silver to vouch for it.
    expect(sent.freshness.kind).toBe("absent");
    expect(readFreshnessStamp({ home })).toBeUndefined();
  });
});
