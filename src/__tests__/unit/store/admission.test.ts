/**
 * The streaming half of rule D — the deferral that makes it independent of the order lines arrive in.
 *
 * The decisive property is the pair of cases at the top: the SAME three records, in two orders, must keep
 * the same set. A locally-correct filter passes the reply-first case and silently orphans the conversation
 * in the parent-first one, which is the failure the Codex planning pass named and the reason this module
 * holds candidates instead of judging each line as it goes.
 */
import { describe, expect, it } from "vitest";

import { parseSyncExclusionLines, type SyncExclusion } from "../../../corpus/syncExclusion.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap } from "../../../lib/result.js";
import { admitRecord, MAX_DEFERRED_RECORDS, openAdmission, releaseDeferred } from "../../../store/admission.js";

/** One Slack record, with only the fields a case cares about spelled out. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    attrs: { channel: "#monitor-feed" },
    container: "slack/C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "C1:1.0",
    text: "hello",
    tsIso: "2026-09-01T00:00:00.000Z",
    url: "https://example.invalid/1",
    ...over,
  };
}

/** An alert from the denied app, optionally in a thread. */
function alert({ threadTs, id = "a" }: { threadTs?: string; id?: string } = {}): CorpusRecord {
  return record({
    raw: { app_id: "AAPP", bot_id: "BBOT", ...(threadTs === undefined ? {} : { thread_ts: threadTs }) },
    sourceId: `C1:${id}`,
  });
}

/** A message a person wrote in a thread. */
function human({ threadTs }: { threadTs: string }): CorpusRecord {
  return record({ author: "UHUMAN", raw: { thread_ts: threadTs, user: "UHUMAN" }, sourceId: "C1:h" });
}

/** The denylist scoping the app to this channel. */
const DENYLIST: SyncExclusion = unwrap(parseSyncExclusionLines({ lines: ["AAPP @ #monitor-feed"], path: "/fixture" }));

describe("order independence — the property the whole module exists for", () => {
  it("rescues the parent when the human reply arrives AFTER it", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    const parent = alert({ threadTs: "1.0" });
    expect(admitRecord({ admission, record: parent })).toBe("hold");
    expect(admitRecord({ admission, record: human({ threadTs: "1.0" }) })).toBe("take");
    expect(releaseDeferred({ admission })).toStrictEqual([parent]);
    expect(admission.rescued).toBe(1);
    expect(admission.excluded).toBe(0);
  });

  it("rescues the parent when the human reply arrives BEFORE it, with no deferral at all", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    expect(admitRecord({ admission, record: human({ threadTs: "1.0" }) })).toBe("take");
    expect(admitRecord({ admission, record: alert({ threadTs: "1.0" }) })).toBe("take");
    expect(releaseDeferred({ admission })).toStrictEqual([]);
    expect(admission.excluded).toBe(0);
  });
});

describe("what is dropped", () => {
  it("drops an alert in no thread outright, without holding it — the million-row path", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    expect(admitRecord({ admission, record: alert() })).toBe("drop");
    expect(admission.deferred.length).toBe(0);
    expect(admission.excluded).toBe(1);
  });

  it("drops a held candidate whose thread no human ever spoke in", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    admitRecord({ admission, record: alert({ threadTs: "1.0" }) });
    expect(releaseDeferred({ admission })).toStrictEqual([]);
    expect(admission.excluded).toBe(1);
    expect(admission.rescued).toBe(0);
  });

  it("does not let a bot reply in the thread rescue the thread", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    admitRecord({ admission, record: alert({ id: "a", threadTs: "1.0" }) });
    admitRecord({ admission, record: alert({ id: "b", threadTs: "1.0" }) });
    expect(releaseDeferred({ admission })).toStrictEqual([]);
    expect(admission.excluded).toBe(2);
  });

  it("takes an undenied record without touching any counter", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    expect(admitRecord({ admission, record: human({ threadTs: "1.0" }) })).toBe("take");
    expect(admission.excluded).toBe(0);
    expect(admission.rescued).toBe(0);
  });
});

describe("the hold is bounded, and it fails towards keeping data", () => {
  it("ADMITS a candidate past the cap rather than dropping it, and counts the relaxation", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    // Fill the hold directly: minting fifty thousand records through the public path would make this test
    // about allocation rather than about the rule.
    admission.deferred.push(...Array.from({ length: MAX_DEFERRED_RECORDS }, () => alert({ threadTs: "9.0" })));
    expect(admitRecord({ admission, record: alert({ threadTs: "1.0" }) })).toBe("take");
    expect(admission.deferralOverflow).toBe(1);
    expect(admission.excluded).toBe(0);
  });

  it("pins the cap, because it is the number that decides when policy relaxes", () => {
    expect(MAX_DEFERRED_RECORDS).toBe(50_000);
  });
});

describe("releasing twice", () => {
  it("empties the hold, so a second release cannot write the same record again", () => {
    const admission = openAdmission({ exclusion: DENYLIST });
    admitRecord({ admission, record: alert({ threadTs: "1.0" }) });
    admitRecord({ admission, record: human({ threadTs: "1.0" }) });
    expect(releaseDeferred({ admission }).length).toBe(1);
    expect(releaseDeferred({ admission })).toStrictEqual([]);
    expect(admission.rescued).toBe(1);
  });
});

describe("an empty denylist", () => {
  it("takes everything and holds nothing", () => {
    const admission = openAdmission({ exclusion: { ids: new Set(), path: "", scoped: [] } });
    expect(admitRecord({ admission, record: alert({ threadTs: "1.0" }) })).toBe("take");
    expect(admission.deferred.length).toBe(0);
    expect(admission.excluded).toBe(0);
  });
});
