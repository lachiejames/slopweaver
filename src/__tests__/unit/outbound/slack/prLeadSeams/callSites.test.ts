import { describe, expect, it } from "vitest";

import { PR_LEAD_CALL_SITES } from "../../../../../outbound/slack/prLeadCallSites.js";
import {
  ADMITTED,
  countCallSites,
  ROWS,
  WATCHED_FILES,
  WRITE_CALLEES,
  WRITE_MENTION,
  walk,
  walked,
  writeKeyOf,
} from "./prLeadSeamsHarness.js";

describe("PR_LEAD_CALL_SITES", () => {
  // Parses about 200 files: 1.3s here, past the 20s default on a loaded CI shard (run 38880562244, unit-2). Measure
  // with `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/outbound/slack/prLeadSeams --reporter verbose`.
  it("counts every word-carrying Slack write call per file and function, so a new or moved one fails here", () => {
    expect(WRITE_CALLEES.length).toBeGreaterThan(0);
    expect(writeKeyOf({ keys: [".runCompositeSend", "slack.runCompositeSend"] })).toBe("runCompositeSend");
    expect(countCallSites()).toEqual(PR_LEAD_CALL_SITES);
  }, 60_000);

  it("finds no invocation whose callee names a write but is outside the grammar", () => {
    const unread = ADMITTED.flatMap((path) =>
      walk({ path }).flatMap(({ keys, within }) =>
        keys.filter((key) => key.startsWith("?") && WRITE_MENTION.test(key)).map((key) => `${path} ${within}: ${key}`),
      ),
    );
    expect(ADMITTED.length).toBeGreaterThan(0);
    expect(WRITE_MENTION.test('?api[pick("postCard")]')).toBe(true);
    expect(unread).toEqual([]);
  }, 60_000);

  it("finds no write method stored, passed, bound or destructured, nor a write entry imported under another name", () => {
    expect(WATCHED_FILES.length).toBeGreaterThan(0);
    const uses = WATCHED_FILES.flatMap((path) =>
      walked({ path }).uses.map(({ key, within }) => `${path} ${within}: ${key}`),
    );
    expect(uses).toEqual([]);
  }, 60_000);

  it("classifies exactly the files it counts", () => {
    expect(Object.keys(PR_LEAD_CALL_SITES).toSorted()).toEqual(ROWS.map(([file]) => file).toSorted());
  });
});
