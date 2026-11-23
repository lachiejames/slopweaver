/*
 * The open card a `gmail triage` group is marked with — on the text's key line, and as `carded` in the reading's
 * JSON — and that the persisted document carries none of it.
 */
import { describe, expect, it } from "vitest";

import { buildGmailTriage } from "../../../../../live/gmail/triage.js";
import type { TriageCardStanding } from "../../../../../live/gmail/triageCarded.js";
import {
  presentGmailTriageGroup,
  renderGmailTriageJson,
  renderGmailTriageReadingJson,
  renderGmailTriageText,
} from "../../../../../live/gmail/triageRender.js";
import { EVERY_LANE_POLICY, message, READ_AT } from "./harness.js";

const KEY = "from:alerts@example.test";
const CARD = "inbox-triage-20261028-from-alerts-example-test";

const document = buildGmailTriage({
  account: "owner@example.test",
  complete: true,
  inboxEstimate: 1,
  policy: EVERY_LANE_POLICY,
  inviteFileIds: new Set<string>(),
  messages: [message({ atIso: "2026-09-29T10:00:00.000Z", from: "Alerts <alerts@example.test>", id: "a-1" })],
  readAtIso: READ_AT,
  repliedThreadIds: new Set<string>(),
});

/** One key's standing, carded or not. */
function scan({ carded, filedInto }: { carded: boolean; filedInto: string | null }) {
  const standing: TriageCardStanding = {
    carded,
    filedInto,
    key: KEY,
    line: "a line",
    reason: carded ? "open-row" : "terminal",
    slug: CARD,
  };
  return new Map([[KEY, standing]]);
}

/** The key line the text prints for the reading's one group. */
function keyLine({ carded }: { carded: ReadonlyMap<string, TriageCardStanding> }): string {
  const lines = renderGmailTriageText({ carded, document, only: undefined }).split("\n");
  return lines.find((line) => line.startsWith("     key "))!;
}

describe("renderGmailTriageText marks a group an open card stands for", () => {
  it("names the open card on the key line, and the open row it was filed into", () => {
    expect([
      keyLine({ carded: scan({ carded: true, filedInto: null }) }),
      keyLine({ carded: scan({ carded: true, filedInto: "a-row" }) }),
    ]).toEqual([
      `     key ${KEY} · already carded as ${CARD}`,
      `     key ${KEY} · already carded as ${CARD}, filed into a-row (still open)`,
    ]);
  });

  it("marks nothing for a key whose card is closed", () => {
    expect(keyLine({ carded: scan({ carded: false, filedInto: null }) })).toBe(`     key ${KEY}`);
  });
});

describe("presentGmailTriageGroup and the reading's JSON", () => {
  it("sets carded only when a card is proven open", () => {
    const group = document.groups[0]!;
    expect(presentGmailTriageGroup({ carded: scan({ carded: true, filedInto: "a-row" }), group }).carded).toEqual({
      filedInto: "a-row",
      slug: CARD,
    });
    expect(presentGmailTriageGroup({ carded: scan({ carded: false, filedInto: null }), group }).carded).toBe(null);
    expect(presentGmailTriageGroup({ carded: new Map(), group }).carded).toBe(null);
  });

  it("prints the document with every group carrying carded, and nothing else changed", () => {
    const printed = JSON.parse(
      renderGmailTriageReadingJson({ carded: scan({ carded: true, filedInto: null }), document }),
    ) as { groups: { carded: unknown }[] };
    expect(printed.groups.map((group) => group.carded)).toEqual([{ filedInto: null, slug: CARD }]);
    const raw = JSON.parse(JSON.stringify(document)) as { groups: object[] };
    expect({ ...printed, groups: printed.groups.map(({ carded: _carded, ...rest }) => rest) }).toEqual(raw);
  });

  it("persists no carded field — the stored document is the mailbox's alone", () => {
    expect(renderGmailTriageJson({ document })).not.toContain('"carded"');
    expect(renderGmailTriageJson({ document })).toContain(`"key": "${KEY}"`);
  });
});
