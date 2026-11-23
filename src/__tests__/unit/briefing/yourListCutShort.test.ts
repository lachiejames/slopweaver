/**
 * The projection from `session-start --json` into the owner's list, for a run cut short at its `--deadline`: the parts
 * it did not read travel to the page, and a whole run carries nothing.
 */
import { describe, expect, it } from "vitest";

import { projectYourList } from "../../../briefing/yourList.js";
import { unwrap } from "../../../lib/result.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";

const NOW = "2026-09-01T04:09:30.684Z";

/** One ranked row, the minimum the projection reads. */
const RANKED = {
  item: {
    doneWhen: "Land the render verb yourself.",
    nativeId: "a-run",
    source: "handover",
    whenIso: "2026-08-31T02:26:50.911Z",
    where: "slopweaver handover resume a-run",
    who: "the session holding it",
  },
  score: 12,
  trace: { verdict: "rank" },
  why: "somebody is stopped waiting on you",
};

/** Project one document holding a single ranked row, plus whatever `extra` fields a test sets. */
const project = ({ extra }: { extra: Record<string, unknown> }) =>
  unwrap(
    projectYourList({
      document: { ...extra, nowIso: NOW, ranking: { ranked: [RANKED] } },
      invocation: "s",
      organisation: ACME_ORGANISATION,
      top: 10,
    }),
  );

describe("projecting a run cut short at its deadline", () => {
  it("carries what the run did not read", () => {
    expect(project({ extra: { cutShort: ["your mail", "the live re-read"] } }).cutShort).toEqual([
      "your mail",
      "the live re-read",
    ]);
  });

  it("carries nothing for a whole run, whether the field is empty or absent", () => {
    expect(project({ extra: { cutShort: [] } }).cutShort).toBe(undefined);
    expect(project({ extra: {} }).cutShort).toBe(undefined);
  });
});
