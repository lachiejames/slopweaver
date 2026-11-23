/*
 * A writer's intent held for its whole run: a transcript run announces on its call and on the
 * landing ledger before it reads anything, and the console route's own intent, written by the site, is a handoff the
 * fence's reader counts while the route runs and for `HANDOFF_MS` after it is gone — and a run spawned under a
 * lapsed handoff writes nothing.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { callsDir } from "../../../talk/callStore.js";
import { HANDOFF_MS, pendingCallWrites } from "../../../talk/callWriteIntent.js";
import type { StartOf } from "../../../talk/relayLease.js";
import { announceTranscriptRun } from "../../../talk/writerRunIntent.js";

const CALL = "0f8fad5b-d9cb-469f-a165-70867728950e";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-writer-run-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** This test process running, unstamped; every other pid gone. */
const self: StartOf = (pid) => ({ running: pid === process.pid, start: undefined });

/** Every process gone — the route that wrote a handoff included. */
const gone: StartOf = () => ({ running: false, start: undefined });

/** A clock past a handoff written now by more than {@link HANDOFF_MS}. */
const lapsed = (): number => Date.now() + HANDOFF_MS + 60_000;

/** The paths a transcript run writes: its call's file, and the landing ledger. */
function written(): { call: string; ledger: string } {
  return { call: join(callsDir({ home }), `${CALL}.jsonl`), ledger: join(home, "talk", "card-landings.jsonl") };
}

/**
 * Load one sibling tree's module at run time: `src` cannot import `site/` statically.
 *
 * @param relative the module's path from this file
 * @returns the module's exports
 */
async function loadSibling({ relative }: { relative: string }): Promise<Record<string, unknown>> {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return (await import(path)) as Record<string, unknown>;
}

/** The route's handoff on a path, written by the site's own module. */
async function routeHandoff({ path }: { path: string }): Promise<{ intent: string; withdraw: () => void }> {
  const site = await loadSibling({ relative: "../../../../site/lib/writerIntent.ts" });
  const announce = site["announceWriterIntent"] as (options: { path: string }) => {
    intent: string;
    withdraw: () => void;
  };
  return announce({ path });
}

describe("announceTranscriptRun", () => {
  it("is waiting on the call and the ledger from its start, and on neither once withdrawn", () => {
    const { call, ledger } = written();
    const withdraw = unwrap(announceTranscriptRun({ callId: CALL, handoff: undefined, home }));
    const during = [
      pendingCallWrites({ path: call, startOf: self }),
      pendingCallWrites({ path: ledger, startOf: self }),
    ];
    withdraw();
    const after = [
      pendingCallWrites({ path: call, startOf: self }),
      pendingCallWrites({ path: ledger, startOf: self }),
    ];
    expect([during, after]).toEqual([
      [1, 1],
      [0, 0],
    ]);
  });

  it("refuses a call id that is no call's and writes nothing", () => {
    const announced = announceTranscriptRun({ callId: "../escape", handoff: undefined, home });
    expect([unwrapErr(announced).code, readdirSync(home)]).toEqual(["CALL_INVALID", []]);
  });

  it("runs under a route handoff still open", async () => {
    const handoff = await routeHandoff({ path: written().call });
    const withdraw = unwrap(announceTranscriptRun({ callId: CALL, handoff: handoff.intent, home }));
    withdraw();
    expect(readdirSync(callsDir({ home }))).toEqual([basename(handoff.intent)]);
  });

  it("refuses under a lapsed or withdrawn handoff, leaving none of its own intents", async () => {
    const stale = await routeHandoff({ path: written().call });
    const late = announceTranscriptRun({ callId: CALL, handoff: stale.intent, home, now: lapsed });
    const remaining = readdirSync(callsDir({ home }));
    stale.withdraw();
    const after = announceTranscriptRun({ callId: CALL, handoff: stale.intent, home });
    expect([
      unwrapErr(late).code,
      remaining,
      unwrapErr(after).code,
      readdirSync(callsDir({ home })),
      readdirSync(join(home, "talk")),
    ]).toEqual(["HANDOFF_LAPSED", [basename(stale.intent)], "HANDOFF_LAPSED", [], ["calls"]]);
  });
});

describe("the console route's handoff", () => {
  it("counts while the route waits on the verb, and not once withdrawn", async () => {
    const { call } = written();
    const handoff = await routeHandoff({ path: call });
    const during = pendingCallWrites({ path: call, startOf: self });
    handoff.withdraw();
    expect([during, pendingCallWrites({ path: call, startOf: self })]).toEqual([1, 0]);
  });

  it("counts once the route is gone until it is HANDOFF_MS old, never after", async () => {
    const { call } = written();
    await routeHandoff({ path: call });
    expect([
      pendingCallWrites({ path: call, startOf: gone }),
      pendingCallWrites({ now: lapsed, path: call, startOf: gone }),
    ]).toEqual([1, 0]);
  });

  it("lasts as long as the route's own bound on the verb it spawns", async () => {
    const site = await loadSibling({ relative: "../../../../site/lib/talkCallAppend.ts" });
    expect([site["TRANSCRIPT_TIMEOUT_MS"], HANDOFF_MS]).toStrictEqual([120_000, 120_000]);
  });
});
