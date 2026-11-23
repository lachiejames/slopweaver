/**
 * `fenceCallWrites` — the call's append lock, and the landing ledger's for a card landing, held by `slack draft
 * approve` from its fenced read of the owner's words through the register append.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { fenceCallWrites } from "../../../talk/callFence.js";
import { callsDir } from "../../../talk/callStore.js";
import { announceCallWrite } from "../../../talk/callWriteIntent.js";
import { announceCardLanding } from "../../../talk/cardLandingStore.js";
import { processStartOf } from "../../../talk/relayLease.js";

const CALL = "a0000041-0000-4000-8000-000000000044";
const SAID = "2026-09-26T21:04:00.000Z";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "call-fence-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Whether the call's append lock, and the landing ledger's, are on disk. */
const locked = (): readonly [boolean, boolean] => [
  existsSync(join(home, "talk", "calls", `${CALL}.jsonl.lock`)),
  existsSync(join(dirname(stateHomePaths({ home }).talkTurns), "card-landings.jsonl.lock")),
];

describe("fenceCallWrites", () => {
  it("holds a card landing's call and the landing ledger, a talk-call: stretch's call alone, until released", () => {
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    const seen = [`call:${CALL}#s-1`, `talk-call:${CALL}#s-1`].map((anchor) => {
      const { release } = unwrap(fenceCallWrites({ anchor, atIso: SAID, home }));
      const held = locked();
      release();
      return [held, locked()];
    });
    expect(seen).toEqual([
      [
        [true, true],
        [false, false],
      ],
      [
        [true, false],
        [false, false],
      ],
    ]);
  });

  it("holds nothing for an anchor on no call", () => {
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    const { recheck, release } = unwrap(
      fenceCallWrites({ anchor: "transcript:a0000005-0000-4000-8000-000000000005", atIso: SAID, home }),
    );
    expect([locked(), recheck()]).toEqual([[false, false], undefined]);
    release();
  });

  it("rechecks clear until a write of the call or the ledger is announced while the fence is held", () => {
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    const start = processStartOf({ pid: process.pid }).start;
    const seen = [`call:${CALL}#s-1`, `talk-call:${CALL}#s-1`].map((anchor) => {
      const { recheck, release } = unwrap(fenceCallWrites({ anchor, atIso: SAID, home }));
      const clear = recheck();
      const onCall = announceCallWrite({ path: join(callsDir({ home }), `${CALL}.jsonl`), pid: process.pid, start });
      const callSeen = recheck();
      onCall();
      const onLedger = unwrap(announceCardLanding({ home }));
      const ledgerSeen = recheck();
      onLedger();
      const after = recheck();
      release();
      return [clear, callSeen, ledgerSeen, after];
    });
    const refused = "1 transcript or landing write(s) were announced while the approval was read: re-run it";
    expect(seen).toEqual([
      [undefined, refused, refused, undefined],
      [undefined, refused, refused, undefined],
    ]);
  });

  it("refuses, naming the call, when its lock cannot be taken, and a relay no one call holds", () => {
    const relay = "talk:a0000015-0000-4000-8000-000000000016";
    expect([
      unwrapErr(fenceCallWrites({ anchor: `call:${CALL}#s-1`, atIso: SAID, home })),
      unwrapErr(fenceCallWrites({ anchor: relay, atIso: SAID, home })),
    ]).toEqual([
      {
        code: "CALL_FENCE_UNHELD",
        message: expect.stringContaining(`the call ${CALL} could not be held still while the approval was recorded`),
        subject: `the call ${CALL}`,
      },
      {
        code: "CALL_FENCE_UNHELD",
        message: expect.stringContaining(`the call ${relay} was said on could not be held still`),
        subject: `the call ${relay} was said on`,
      },
    ]);
  });
});
