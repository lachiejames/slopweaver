/*
 * What an append reads off a call file under its lock: the lines it holds, and whether a foreign console's batch
 * would sit under an open it did not write.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { appendUnderLock, foreignUnopened, heldEntries, refusedUnderLock } from "../../../talk/callHeld.js";
import type { CallOrigin } from "../../../talk/callOrigin.js";
import { callQuarantinePath, quarantineLine } from "../../../talk/callQuarantineLedger.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { TalkErrors } from "../../../talk/errors.js";

const SEAT: CallOrigin = { checkoutRoot: "/w/seat", defaultPort: 3000, mainWorktree: false, port: 3001 };
const OWNER: CallOrigin = { checkoutRoot: "/w/main", defaultPort: 3000, mainWorktree: true, port: 3000 };
const SAID: CallEntry = {
  atIso: "2026-10-12T05:04:01.000Z",
  final: true,
  id: "s",
  kind: "segment",
  text: "t",
  who: "owner",
};
const opened = ({ origin }: { origin: CallOrigin }): CallEntry => ({
  atIso: "2026-10-12T05:04:00.000Z",
  kind: "open",
  model: "m",
  origin,
  sessionId: "x",
  voice: "v",
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sw-call-held-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const callFile = ({ entries }: { entries: readonly CallEntry[] }): string => {
  const path = join(dir, "c.jsonl");
  writeFileSync(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return path;
};

describe("heldEntries", () => {
  it("reads a missing file as no lines, and a written one as its lines", () => {
    expect([
      unwrap(heldEntries({ path: join(dir, "absent.jsonl") })),
      unwrap(heldEntries({ path: callFile({ entries: [SAID] }) })),
    ]).toEqual([[], [SAID]]);
  });
});

describe("foreignUnopened", () => {
  it("judges a foreign batch on the open last on disk", () => {
    expect([
      unwrap(
        foreignUnopened({ entries: [SAID], origin: SEAT, path: callFile({ entries: [opened({ origin: SEAT })] }) }),
      ),
      unwrap(
        foreignUnopened({ entries: [SAID], origin: SEAT, path: callFile({ entries: [opened({ origin: OWNER })] }) }),
      ),
    ]).toEqual([false, true]);
  });

  it("never reads the file for the owner's console or a write naming none, so even an unreadable one passes", () => {
    mkdirSync(join(dir, "a-directory.jsonl"));
    const path = join(dir, "a-directory.jsonl");
    expect([
      unwrap(foreignUnopened({ entries: [SAID], origin: OWNER, path })),
      unwrap(foreignUnopened({ entries: [SAID], origin: undefined, path })),
      foreignUnopened({ entries: [SAID], origin: SEAT, path }).isErr(),
    ]).toEqual([false, false, true]);
  });
});

describe("refusedUnderLock", () => {
  const CALL = "a0000090-0000-4000-8000-000000000097";
  const step: CallEntry = {
    atIso: "2026-10-12T05:05:00.000Z",
    event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
    kind: "reconnect",
  };

  it("refuses steps alone for a call with no file, and a foreign line under an open it did not write", () => {
    const absent = join(dir, "absent.jsonl");
    expect([
      refusedUnderLock({ callId: CALL, entries: [step], origin: undefined, path: absent })!.code,
      refusedUnderLock({ callId: CALL, entries: [SAID], origin: SEAT, path: absent }),
      refusedUnderLock({ callId: CALL, entries: [SAID], origin: OWNER, path: absent }),
    ]).toEqual(["CALL_ENTRIES_INVALID", TalkErrors.callOriginUnopened({ callId: CALL }), undefined]);
  });
});

describe("appendUnderLock", () => {
  const CALL = "a0000090-0000-4000-8000-000000000097";

  it("refuses a quarantined call as closed ahead of any other refusal, and writes neither the index nor the file", () => {
    const home = join(dir, "home");
    mkdirSync(join(home, "talk"), { recursive: true });
    const row = { atIso: "2026-10-26T08:00:00.000Z", callId: CALL, reason: "gone", session: null };
    writeFileSync(callQuarantinePath({ home }), `${quarantineLine({ row })}\n`);
    const indexPath = join(home, "talk", "call-index.txt");
    const path = join(dir, "closed.jsonl");
    const append = { callId: CALL, entries: [SAID], home, indexPath, nowIso: () => "2026-10-26T09:00:00.000Z", path };

    expect([
      appendUnderLock({ ...append, origin: SEAT })._unsafeUnwrapErr(),
      appendUnderLock({ ...append, origin: OWNER })._unsafeUnwrapErr(),
    ]).toEqual([TalkErrors.callQuarantined({ callId: CALL }), TalkErrors.callQuarantined({ callId: CALL })]);
    expect([existsSync(indexPath), existsSync(path)]).toEqual([false, false]);
  });
});
