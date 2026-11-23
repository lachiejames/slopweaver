/**
 * Each card a relay also answers is judged against its OWN key and text, never the open card's verdict reused.
 * Pure: the card texts are handed in.
 */
import { describe, expect, it } from "vitest";

import { alsoAnsweredDispositions } from "../../../talk/relayCardDispositions.js";
import { type RelayCardText, type RelayReferents, relayCardDisposition } from "../../../talk/relayChannelSteer.js";

const ALERTS: RelayReferents = { channels: [{ id: "C0SYN000006", name: "dev-alerts" }], draftIds: [] };
const NAMES_ALERTS = "ask:move-the-incident-post";
const SILENT = "ask:split-oversized-files";
const BROKEN = "ask:unreadable-doc";

const TEXTS: Record<string, RelayCardText> = {
  [BROKEN]: { kind: "unreadable", why: "EACCES" },
  [NAMES_ALERTS]: { kind: "read", text: "Post the incident note in #dev-alerts once the owner says so." },
  [SILENT]: { kind: "read", text: "Split every file over the cap." },
};

const readCardText = ({ about }: { readonly about: string }): RelayCardText => TEXTS[about]!;

describe("alsoAnsweredDispositions", () => {
  it("lands the same referents on one card and withholds them from another, in the order named", () => {
    const also = alsoAnsweredDispositions({ keys: [SILENT, NAMES_ALERTS], readCardText, referents: ALERTS });
    expect([...also.entries()]).toEqual([
      [SILENT, { kind: "withheld", why: `the owner's words name #dev-alerts, and ${SILENT} mentions none of them` }],
      [NAMES_ALERTS, { kind: "land" }],
    ]);
  });

  it("withholds an also-answered ask whose doc will not read, while the open card's own disposition stands", () => {
    const open = relayCardDisposition({ about: NAMES_ALERTS, cardText: TEXTS[NAMES_ALERTS]!, referents: ALERTS });
    const also = alsoAnsweredDispositions({ keys: [BROKEN], readCardText, referents: ALERTS });
    expect([open, also.get(BROKEN)]).toEqual([
      { kind: "land" },
      { kind: "withheld", why: `the owner's words name #dev-alerts, and ${BROKEN} would not read to check (EACCES)` },
    ]);
  });

  it("lands every readable card when the owner's words name no draft or channel, never an unreadable one, and judges nothing for no keys", () => {
    const none: RelayReferents = { channels: [], draftIds: [] };
    const also = alsoAnsweredDispositions({ keys: [SILENT, BROKEN], readCardText, referents: none });
    const empty = alsoAnsweredDispositions({ keys: [], readCardText, referents: ALERTS });
    expect([[...also.values()], empty.size]).toEqual([
      [{ kind: "land" }, { kind: "withheld", why: `${BROKEN} would not read, so the relay lands on no card (EACCES)` }],
      0,
    ]);
  });
});
