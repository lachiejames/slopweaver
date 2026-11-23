import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { witnessIdempotencyKey } from "../../../../live/witness/instructions.js";
import { witnessReplyReserved } from "../../../../live/witness/replyReserved.js";
import type { WitnessKey } from "../../../../live/witness/types.js";
import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";
import { duplicateKey } from "../../../../outbound/slack/fingerprint.js";
import { DUPLICATE_WINDOW_HOURS, reserveSend } from "../../../../outbound/slack/sendReservation.js";

const KEY: WitnessKey = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };
const REPLIED_AT = "2026-10-05T01:00:00.000Z";
const A_MONTH_LATER = "2026-11-05T01:00:00.000Z";

function artifact(): UpdateArtifact {
  return {
    citations: [],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  };
}

/** Reserve the way `slack reply --as bot --idempotency-key witness:…` does: the reply path's own key function. */
function reserveReply({ home, key }: { home: string; key: WitnessKey }): void {
  reserveSend({
    duplicateKey: duplicateKey({
      actor: "bot",
      artifact: artifact(),
      channel: key.channel,
      idempotencyKey: witnessIdempotencyKey({ channel: key.channel, messageTs: key.messageTs }),
      threadTs: key.threadTs,
    }),
    home,
    nowIso: REPLIED_AT,
    windowHours: DUPLICATE_WINDOW_HOURS,
  });
}

describe("witnessReplyReserved", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "witness-reply-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("finds a reply reserved under the reply path's own key", () => {
    reserveReply({ home, key: KEY });

    expect(witnessReplyReserved({ home, key: KEY, nowIso: REPLIED_AT })).toBe(true);
  });

  it("still finds it long after the door's duplicate window has lapsed", () => {
    reserveReply({ home, key: KEY });

    expect(witnessReplyReserved({ home, key: KEY, nowIso: A_MONTH_LATER })).toBe(true);
  });

  it("finds nothing for a message no reply was reserved for", () => {
    reserveReply({ home, key: KEY });
    const other: WitnessKey = { ...KEY, messageTs: "1789000000.000300" };

    expect(witnessReplyReserved({ home, key: other, nowIso: REPLIED_AT })).toBe(false);
  });

  it("finds nothing in an empty send ledger", () => {
    expect(witnessReplyReserved({ home, key: KEY, nowIso: REPLIED_AT })).toBe(false);
  });
});
