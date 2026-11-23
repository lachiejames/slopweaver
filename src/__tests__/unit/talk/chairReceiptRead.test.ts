/*
 * The effectful half of the chair receipt, round-tripped through a throwaway home: a cursor never marked supplies no
 * coverage, and a marked one holds exactly the relays whose own call lines lie behind its frontier — a relay line
 * after it, still unread, holds nothing.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callsDir } from "../../../talk/callStore.js";
import { readChairReceipt, supervisorCursorCoverage } from "../../../talk/chairReceiptRead.js";
import { SUPERVISOR_UNREAD_CURSOR, writeUnreadCursor } from "../../../talk/unreadCursorStore.js";

const MARKED = "2026-10-19T10:59:16.854Z";
const CALL_ID = "a0000048-0000-4000-8000-000000000051";
const READ_TURN = "a0000087-0000-4000-8000-000000000094";
const UNREAD_TURN = "001469a1-6b69-4c2e-9f1a-0d7a3c5e8b21";

/** One relay call line, as the page writes it. */
const relayLine = ({ turnId }: { turnId: string }): string =>
  JSON.stringify({
    about: "",
    atIso: "2026-10-19T10:58:02.237Z",
    detail: "",
    heard: "I think they're still getting through anyway",
    kind: "relay",
    outcome: "sending",
    say: "",
    turnId,
  });

/** The owner's speech, the line the relay follows. */
const SPEECH = JSON.stringify({
  atIso: "2026-10-19T10:58:01.900Z",
  final: true,
  id: "s1",
  kind: "segment",
  text: "I think they're still getting through anyway",
  who: "owner",
});

describe("chairReceiptRead", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "chair-receipt-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("supplies no coverage when the supervisor cursor was never marked", () => {
    expect(supervisorCursorCoverage({ home })).toBe(undefined);
  });

  it("holds the relay whose call line is behind the frontier, and not the one past it", () => {
    const read = `${SPEECH}\n${relayLine({ turnId: READ_TURN })}\n`;
    mkdirSync(callsDir({ home }), { recursive: true });
    writeFileSync(join(callsDir({ home }), `${CALL_ID}.jsonl`), `${read}${relayLine({ turnId: UNREAD_TURN })}\n`);
    const prefixSha256 = `sha256:${createHash("sha256").update(read).digest("hex")}`;
    const written = writeUnreadCursor({
      cursor: { calls: { [CALL_ID]: { offset: Buffer.byteLength(read), prefixSha256 } }, recordedAtIso: MARKED },
      home,
      name: SUPERVISOR_UNREAD_CURSOR,
    });
    expect(written.isOk()).toBe(true);
    expect(supervisorCursorCoverage({ home })).toEqual({ recordedAtIso: MARKED, relaysRead: new Set([READ_TURN]) });
    const stagedAtIso = "2026-10-19T10:58:02.237Z";
    expect(readChairReceipt({ home, stagedAtIso, turnId: READ_TURN })).toEqual({
      atIso: MARKED,
      kind: "read-unread",
      turnId: READ_TURN,
    });
    expect(readChairReceipt({ home, stagedAtIso, turnId: UNREAD_TURN })).toBe(undefined);
  });
});
