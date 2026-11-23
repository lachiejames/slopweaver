import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { donePressSettle } from "../../../hand/donePress.js";
import { HandStepErrors } from "../../../hand/errors.js";
import { laterLedgerDir, laterPressed } from "../../../hand/laterPresses.js";
import { appendHandPost, appendHandSettlements } from "../../../hand/multiAppend.js";
import { dismissHandNote, markerPaths } from "../../../hand/note/markers.js";
import { reconcileHandSteps } from "../../../hand/reconcile.js";
import { buildSettledRow, openHandSteps, parseHandLine } from "../../../hand/row.js";
import { buildHandStep, DID_CAP, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { appendHandRow, handRegisterPath, readOpenHandSteps } from "../../../hand/store.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

const NOW = "2026-09-19T05:01:07.803Z";
const LATER = "2026-09-19T05:09:41.216Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hand-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "gcloud-signin",
        postedBy: "workspace:129",
        postedIso: "2026-09-19T04:35:44.113Z",
        unblocks: "handover run datadog-monitor-deploy",
        url: "https://console.cloud.google.com/",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: "slopweaver hand done gcloud-signin",
        ...over,
      },
    }),
  );
}

/**
 * Write one marker exactly where the panel writes it, creating the directory the note would have made, its
 * file dated at `NOW` so the fixture clock can read the press.
 *
 * @param id the step the marker answers for
 * @param answer `done` or `later`
 * @param stamp the bytes the panel wrote, which the reconcile quotes back
 */
function marker({ id, answer, stamp }: { id: string; answer: "done" | "later"; stamp: string }): void {
  const markerDir = stateHomePaths({ home }).handNoteDismiss;
  mkdirSync(markerDir, { recursive: true });
  const path = join(markerDir, `${id}.${answer}`);
  writeFileSync(path, stamp);
  utimesSync(path, new Date(NOW), new Date(NOW));
}

describe("the register round trip", () => {
  it("writes one line per row and reads back the identical step", async () => {
    const posted = step({ literal: 'echo "});"' });
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: posted } }));
    const open = unwrap(readOpenHandSteps({ home }));
    expect(open.steps).toEqual([posted]);
    expect(open.unparsed).toEqual([]);
    expect(readFileSync(handRegisterPath({ home }), "utf8").trimEnd().split("\n").length).toBe(1);
  });

  it("is IDEMPOTENT on an identical re-post, so a retry writes nothing", async () => {
    const row = { kind: "posted", step: step() } as const;
    expect(unwrap(await appendHandRow({ home, nowIso: NOW, row })).appended).toBe(true);
    expect(unwrap(await appendHandRow({ home, nowIso: NOW, row })).appended).toBe(false);
    expect(unwrap(readOpenHandSteps({ home })).steps.length).toBe(1);
  });

  it("refuses a second posting of one id that DISAGREES, naming the field", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const error = unwrapErr(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { kind: "posted", step: step({ what: "Sign in somewhere else" }) },
      }),
    );
    expect(error.code).toBe("STEP_ID_CONFLICT");
    expect(error.message).toContain("disagree about what");
  });

  it("settles a step, and it stops being open", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "workspace:129", did: "signed in", id: "gcloud-signin", kind: "settled", settledIso: NOW },
      }),
    );
    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([]);
  });

  it("refuses a settling of an id nothing open carries, INSIDE the store", async () => {
    const error = unwrapErr(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "x", did: "done", id: "never-posted", kind: "settled", settledIso: NOW },
      }),
    );
    expect(error).toEqual(HandStepErrors.unknownStep({ id: "never-posted" }));
  });

  it("reports an install with no register as empty, never as a failure", () => {
    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([]);
  });

  it("REPORTS a line it cannot parse and still reads the rest, naming the line", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const good = readFileSync(handRegisterPath({ home }), "utf8").trimEnd();
    writeFileSync(handRegisterPath({ home }), `{not json}\n${good}\n`);
    const read = unwrap(readOpenHandSteps({ home }));
    expect(read.steps.map((s) => s.id)).toEqual(["gcloud-signin"]);
    expect(read.unparsed.length).toBe(1);
    expect(read.unparsed[0]!.code).toBe("CORRUPT_ROW");
    expect(read.unparsed[0]!.message).toBe("line 1 of the hand-step register is not a complete row: it is not JSON");
  });

  it("still REFUSES a register whose FILE it cannot reach, never reporting it empty", () => {
    mkdirSync(handRegisterPath({ home }), { recursive: true });
    const error = unwrapErr(readOpenHandSteps({ home }));
    expect(error.code).toBe("STORE_UNREADABLE");
    expect(error.message).toContain("refusing rather than reporting it empty");
  });

  it("reads back an account the length of the one that bricked the live register", async () => {
    const account = `NOBODY DID IT — the step was wrong and is withdrawn. ${"x".repeat(430)}`;
    expect(account.length).toBe(483);
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "s", did: account, id: "gcloud-signin", kind: "settled", settledIso: NOW },
      }),
    );
    const read = unwrap(readOpenHandSteps({ home }));
    expect(read.unparsed).toEqual([]);
    expect(read.steps).toEqual([]);
  });

  it("REFUSES to write a row its own reader could not read back, and writes nothing", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const before = readFileSync(handRegisterPath({ home }), "utf8");
    const error = unwrapErr(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "s", did: "x".repeat(DID_CAP + 1), id: "gcloud-signin", kind: "settled", settledIso: NOW },
      }),
    );
    expect(error.code).toBe("UNWRITABLE_ROW");
    expect(error.message).toContain("could not read it back");
    expect(error.message).toContain("2001 characters and the cap is 2000");
    expect(readFileSync(handRegisterPath({ home }), "utf8")).toBe(before);
  });

  it("carries the unparseable lines out on an APPEND receipt too", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const good = readFileSync(handRegisterPath({ home }), "utf8").trimEnd();
    writeFileSync(handRegisterPath({ home }), `${good}\n{not json}\n`);
    const receipt = unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "second-step" }) } }),
    );
    expect(receipt.appended).toBe(true);
    expect(receipt.unparsed.map((problem) => problem.code)).toEqual(["CORRUPT_ROW"]);
  });

  it("treats adding a context to a held step as a CONFLICT, never as an amendment", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const error = unwrapErr(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ context: "work" }) } }),
    );
    expect(error.code).toBe("STEP_ID_CONFLICT");
    expect(error.message).toContain("disagree about context");
  });

  it("carries a stated context back off the wire, so the console reads a field and not the prose", () => {
    const line =
      '{"kind":"posted","step":{"id":"policy-pack","what":"Give your word on the policy pack","unblocks":"x",' +
      '"witness":"y","postedIso":"i","postedBy":"b","context":"work"}}';
    const row = unwrap(parseHandLine({ line, lineNumber: 1 }));
    expect(row.kind).toBe("posted");
    expect(openHandSteps({ rows: [row] })[0]!.context).toBe("work");
  });

  it("reads a line with no unaddressed of its own as absent, whatever the prototype carries", () => {
    const line =
      '{"kind":"posted","step":{"id":"policy-pack","what":"Give your word on the policy pack","unblocks":"x",' +
      '"witness":"y","postedIso":"i","postedBy":"b"}}';
    const prototype: Record<string, unknown> = Object.prototype as Record<string, unknown>;
    prototype["unaddressed"] = 7;
    try {
      const row = unwrap(parseHandLine({ line, lineNumber: 1 }));
      expect(openHandSteps({ rows: [row] }).map((open) => [open.id, Object.hasOwn(open, "unaddressed")])).toEqual([
        ["policy-pack", false],
      ]);
    } finally {
      delete prototype["unaddressed"];
    }
  });

  it("refuses a line whose context is a third value, rather than reading it as absence", () => {
    const line =
      '{"kind":"posted","step":{"id":"policy-pack","what":"Give your word","unblocks":"x","witness":"y",' +
      '"postedIso":"i","postedBy":"b","context":"acme"}}';
    const error = unwrapErr(parseHandLine({ line, lineNumber: 7 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 7");
    expect(error.message).toContain("context is `slopweaver` or `work`");
  });

  it("carries a check-in back off the wire, so every surface can rank it last", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ checkIn: true }) } }));
    const read = readFileSync(handRegisterPath({ home }), "utf8").trimEnd();
    const row = unwrap(parseHandLine({ line: read, lineNumber: 1 }));
    expect(openHandSteps({ rows: [row] })[0]!.checkIn).toBe(true);
  });

  it("carries a step's details back off the wire, line for line", async () => {
    const details = [
      "NEW   atlas-hex — 12:00Z, 2× in 24h: exit 1",
      "STILL resync-corpus-slack — 10:00Z, once: died mid-run",
    ];
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ details }) } }));
    expect(unwrap(readOpenHandSteps({ home })).steps.map((open) => open.details)).toEqual([details]);
  });

  it("treats changing a held step's details as a CONFLICT, never as an amendment", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ details: ["NEW   a"] }) } }));
    const error = unwrapErr(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ details: ["NEW   b"] }) } }),
    );
    expect(error.code).toBe("STEP_ID_CONFLICT");
    expect(error.message).toContain("disagree about details");
  });

  it("refuses a line whose details break the schema's cap, rather than reading a cut list", () => {
    const line =
      '{"kind":"posted","step":{"id":"fleet","what":"Check fleet health","unblocks":"x","witness":"y",' +
      `"postedIso":"i","postedBy":"b","details":${JSON.stringify(Array.from({ length: 13 }, () => "x"))}}}`;
    const error = unwrapErr(parseHandLine({ line, lineNumber: 4 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("details carries 13 lines and the cap is 12");
  });

  it("treats marking a held step a check-in as a CONFLICT, never as an amendment", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const error = unwrapErr(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ checkIn: true }) } }),
    );
    expect(error.code).toBe("STEP_ID_CONFLICT");
    expect(error.message).toContain("disagree about checkIn");
  });

  it("refuses a line whose checkIn is anything but true, rather than reading it as absence", () => {
    const line =
      '{"kind":"posted","step":{"id":"try-now-page","what":"Try the Now page","unblocks":"x","witness":"y",' +
      '"postedIso":"i","postedBy":"b","checkIn":false}}';
    const error = unwrapErr(parseHandLine({ line, lineNumber: 3 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("checkIn is `true` or absent");
  });

  it("re-validates on READ, so a hand-written row breaking a rule is refused", () => {
    const shoutingId =
      '{"kind":"posted","step":{"id":"NOT A SLUG","what":"Sign in","unblocks":"x","witness":"y","postedIso":"i","postedBy":"b"}}';
    const error = unwrapErr(parseHandLine({ line: shoutingId, lineNumber: 4 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 4");
    expect(error.message).toContain("is not a step id");
  });
});

describe("openHandSteps — oldest first, by no other key", () => {
  it("orders by postedIso and by nothing else", () => {
    const later = step({ id: "later-one", postedIso: "2026-09-19T09:00:00.000Z" });
    const earlier = step({ id: "earlier-one", postedIso: "2026-09-19T01:00:00.000Z" });
    const open = openHandSteps({
      rows: [
        { kind: "posted", step: later },
        { kind: "posted", step: earlier },
      ],
    });
    expect(open.map((s) => s.id)).toEqual(["earlier-one", "later-one"]);
  });
});

describe("donePressSettle — a Done settles at the owner's press, not at the reconcile", () => {
  it("stamps the settle at the press instant the marker carries", () => {
    expect(
      unwrap(
        donePressSettle({ nowIso: NOW, stamp: "2026-09-19T04:00:00.000Z", writtenIso: "2026-09-19T04:30:00.000Z" }),
      ),
    ).toEqual({
      did: "the owner pressed Done on the note (2026-09-19T04:00:00.000Z)",
      settledIso: "2026-09-19T04:00:00.000Z",
    });
  });

  it("settles at the marker's write time when its stamp is no date or none", () => {
    expect(unwrap(donePressSettle({ nowIso: NOW, stamp: "stamp", writtenIso: "2026-09-19T04:30:00.000Z" }))).toEqual({
      did: "the owner pressed Done on the note (stamp)",
      settledIso: "2026-09-19T04:30:00.000Z",
    });
    expect(unwrap(donePressSettle({ nowIso: NOW, stamp: "", writtenIso: "2026-09-19T04:30:00.000Z" }))).toEqual({
      did: "the owner pressed Done on the note",
      settledIso: "2026-09-19T04:30:00.000Z",
    });
  });

  it("refuses rather than settling at now when neither instant reads, or both are later than now", () => {
    expect(unwrapErr(donePressSettle({ nowIso: NOW, stamp: "stamp", writtenIso: null })).code).toBe("INVALID_FIELD");
    expect(
      unwrapErr(
        donePressSettle({ nowIso: NOW, stamp: "2026-09-20T00:00:00.000Z", writtenIso: "2026-09-20T00:00:00.000Z" }),
      ).message,
    ).toContain("a Done marker's press instant reads from neither");
  });
});

describe("reconcileHandSteps — the owner's click becomes a row", () => {
  it("settles a step on a `done` marker, quoting the marker's own stamp", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    marker({ answer: "done", id: "gcloud-signin", stamp: "2026-09-19 04:54:19 +0000\n" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "workspace:129", home, nowIso: NOW }));
    expect(outcome.settled).toEqual(["gcloud-signin"]);
    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([]);
    expect(readFileSync(handRegisterPath({ home }), "utf8")).toContain(
      '"did":"the owner pressed Done on the note (2026-09-19 04:54:19 +0000)"',
    );
    expect(readFileSync(handRegisterPath({ home }), "utf8")).toContain('"settledIso":"2026-09-19T04:54:19.000Z"');
  });

  it("CONSUMES a `later` marker and records nothing — a closed window is not finished work", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(dismissHandNote({ home, id: "gcloud-signin", nowIso: NOW }));
    const outcome = unwrap(reconcileHandSteps({ bySession: "workspace:129", home, nowIso: NOW }));
    expect(outcome.deferred).toEqual(["gcloud-signin"]);
    expect(outcome.settled).toEqual([]);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["gcloud-signin"]);
  });

  it("remembers a consumed Later in the ledger while the step is open, and drops it once the step settles", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(dismissHandNote({ home, id: "gcloud-signin", nowIso: NOW }));
    unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect([...unwrap(laterPressed({ home }))]).toEqual(["gcloud-signin"]);
    marker({ answer: "done", id: "gcloud-signin", stamp: "stamp\n" });
    unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect([...unwrap(laterPressed({ home }))]).toEqual([]);
  });

  it("keeps the `later` marker when the ledger will not take it, and names the failure once", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(dismissHandNote({ home, id: "gcloud-signin", nowIso: NOW }));
    writeFileSync(laterLedgerDir({ home }), "not a directory");
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.unrecordedLaters.map((problem) => problem.code)).toEqual(["LATER_LEDGER"]);
    expect(existsSync(join(stateHomePaths({ home }).handNoteDismiss, "gcloud-signin.later"))).toBe(true);
  });

  it("consumes each marker, so a second reconcile is a no-op", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(dismissHandNote({ home, id: "gcloud-signin", nowIso: NOW }));
    unwrap(reconcileHandSteps({ bySession: "workspace:129", home, nowIso: NOW }));
    const again = unwrap(reconcileHandSteps({ bySession: "workspace:129", home, nowIso: NOW }));
    expect(again.deferred).toEqual([]);
    expect(again.settled).toEqual([]);
  });

  it("skips a `done` marker naming a step already settled in a terminal", () => {
    marker({ answer: "done", id: "never-posted", stamp: "stamp\n" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "workspace:129", home, nowIso: NOW }));
    expect(outcome.settled).toEqual([]);
    expect(outcome.deferred).toEqual([]);
  });

  it("names every one of one step's marker paths, snoozes and kind answers included, so a raise can clear a stale one", () => {
    const suffixes = ["done", "later", "snooze-1h", "snooze-3h", "snooze-tomorrow", "mute-kind", "when-worse"];
    expect(markerPaths({ id: "gcloud-signin", markerDir: "/tmp/m" })).toEqual(
      suffixes.map((suffix) => `/tmp/m/gcloud-signin.${suffix}`),
    );
  });

  it("writes a `later` and never a `done` when a verb takes the note down", () => {
    const path = unwrap(dismissHandNote({ home, id: "gcloud-signin", nowIso: NOW }));
    expect(path).toBe(join(stateHomePaths({ home }).handNoteDismiss, "gcloud-signin.later"));
    expect(readFileSync(path, "utf8")).toBe(`${NOW}\n`);
  });

  it("reports no markers on an install where the note has never run", () => {
    const outcome = unwrap(reconcileHandSteps({ bySession: "workspace:129", home, nowIso: NOW }));
    expect(outcome.settled).toEqual([]);
    expect(outcome.deferred).toEqual([]);
  });
});

describe("a settling the register could not read back is refused at the WRITE", () => {
  it("refuses an empty `did` by name, not as 'empty or past its cap'", () => {
    const error = unwrapErr(buildSettledRow({ draft: { bySession: "s", did: "   ", id: "x", settledIso: NOW } }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toBe("did is required and was empty");
  });

  it("refuses an over-cap `did` by name, quoting both numbers", () => {
    const error = unwrapErr(
      buildSettledRow({ draft: { bySession: "s", did: "x".repeat(DID_CAP + 1), id: "x", settledIso: NOW } }),
    );
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("is 2001 characters and the cap is 2000");
  });

  it("accepts a paragraph, which is what the field is for", () => {
    const row = unwrap(
      buildSettledRow({ draft: { bySession: "s", did: "  signed in, twice.  ", id: "x", settledIso: NOW } }),
    );
    expect(row.did).toBe("signed in, twice.");
  });
});

describe("a done marker is HELD, never thrown away, while the register has a line it cannot read", () => {
  it("leaves the marker on disk and names the id it held", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    const good = readFileSync(handRegisterPath({ home }), "utf8").trimEnd();
    writeFileSync(handRegisterPath({ home }), `{not json}\n${good}\n`);
    marker({ answer: "done", id: "not-readable-yet", stamp: "stamp\n" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.held).toEqual(["not-readable-yet"]);
    expect(outcome.settled).toEqual([]);
    expect(existsSync(join(stateHomePaths({ home }).handNoteDismiss, "not-readable-yet.done"))).toBe(true);
  });

  it("CONSUMES the same marker once the register reads clean, because then the id really is absent", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    marker({ answer: "done", id: "not-readable-yet", stamp: "stamp\n" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.held).toEqual([]);
    expect(existsSync(join(stateHomePaths({ home }).handNoteDismiss, "not-readable-yet.done"))).toBe(false);
  });
});

describe("one Done press that will not record never stops the others", () => {
  it("settles the good press, keeps the bad marker and names it", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "a-step" }) } }));
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "z-step" }) } }));
    marker({ answer: "done", id: "a-step", stamp: "stamp\n" });
    marker({ answer: "done", id: "z-step", stamp: `${"x".repeat(DID_CAP)}\n` });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.settled).toEqual(["a-step"]);
    expect(outcome.unsettledMarkers.map((entry) => [entry.id, entry.problem.code])).toEqual([
      ["z-step", "INVALID_FIELD"],
    ]);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["z-step"]);
    expect(existsSync(join(stateHomePaths({ home }).handNoteDismiss, "a-step.done"))).toBe(false);
    expect(existsSync(join(stateHomePaths({ home }).handNoteDismiss, "z-step.done"))).toBe(true);
  });
});

describe("a marker that will not come off disk", () => {
  it("is reported beside the pass, never thrown out of it", () => {
    mkdirSync(join(stateHomePaths({ home }).handNoteDismiss, "not-a-file.later"), { recursive: true });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.unremovedMarkers.map((problem) => problem.code)).toEqual(["STORE_UNREADABLE"]);
  });
});

describe("a register line written before board rows reads back as it always printed", () => {
  it("keeps cites before context, the order `hand list --json` has always shown", () => {
    const line = JSON.stringify({
      kind: "posted",
      step: {
        ...step({ id: "legacy-step" }),
        cites: ["https://github.com/lachiejames/slopweaver/pull/1420"],
        context: "work",
      },
    });
    mkdirSync(dirname(handRegisterPath({ home })), { recursive: true });
    writeFileSync(handRegisterPath({ home }), `${line}\n`);
    expect(JSON.stringify(unwrap(readOpenHandSteps({ home })).steps[0])).toContain(
      '"cites":["https://github.com/lachiejames/slopweaver/pull/1420"],"context":"work"',
    );
  });
});

describe("the posting form is fenced at the store, so no writer can skip it", () => {
  it("refuses a directly appended decision that opens and carries nothing, and writes no bytes", async () => {
    const decision = step({
      id: "mon-recipe-store-backup-daily",
      unaddressed: "the backup runs on this machine and has no page",
      url: undefined,
      what: "Choose restart, repair, or retire for store-backup-daily — stopped firing",
    });

    const error = unwrapErr(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: decision } }));

    expect(error.code).toBe("DECISION_WITHOUT_ASK");
    expect(existsSync(handRegisterPath({ home }))).toBe(false);
  });

  it("checks the line it RECORDS, so a step rewritten on its way to the file is refused", async () => {
    const plain = step({ unaddressed: "the backup runs on this machine and has no page", url: undefined });
    const disguised = {
      ...plain,
      toJSON: () => ({ ...plain, what: "Choose restart, repair, or retire for backup — stopped firing" }),
    };

    const error = unwrapErr(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: disguised } }));

    expect(error.code).toBe("DECISION_WITHOUT_ASK");
    expect(existsSync(handRegisterPath({ home }))).toBe(false);
  });

  it("round-trips a step that carries its decision", async () => {
    const carried = step({
      decision: {
        lean: "Repair, then restart.",
        options: [
          { letter: "A", option: "Restart it now", tradeoff: "output returns first, may stop again" },
          { letter: "B", option: "Repair, then restart it", tradeoff: "promise holds, output absent meanwhile" },
        ],
        problem: "store-backup-daily stopped firing.",
        stakes: { blastRadius: "store-backup-daily", risk: "It stays silent.", stillReal: "This pass read it." },
      },
      id: "mon-recipe-store-backup-daily",
      url: "http://localhost:3000/queue?open=hand%3Amon-recipe-store-backup-daily",
      what: "Choose restart, repair, or retire for store-backup-daily — stopped firing",
    });
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: carried } }));

    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([carried]);
  });

  it.each([
    [
      "a go-ahead carrying nothing to weigh",
      { unaddressed: "said on the call", url: undefined, what: "Say the word if you want the stale lease cleared" },
      "go-ahead",
    ],
    [
      "a step saying nowhere it happens",
      { url: undefined, what: "Tell Sadie the cutover moved to Monday" },
      "say where",
    ],
  ])("refuses %s appended directly, and writes no bytes", async (_shape, over, fragment) => {
    const error = unwrapErr(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step(over) } }));

    expect(error.message).toContain(fragment);
    expect(existsSync(handRegisterPath({ home }))).toBe(false);
  });

  it("treats a changed reason for having no address as a CONFLICT, never as an amendment", async () => {
    const why = { url: undefined, what: "Tell Sadie the cutover moved to Monday, so she can plan" } as const;
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { kind: "posted", step: step({ ...why, unaddressed: "said on the call" }) },
      }),
    );
    const error = unwrapErr(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { kind: "posted", step: step({ ...why, unaddressed: "said in person" }) },
      }),
    );
    expect(error.code).toBe("STEP_ID_CONFLICT");
    expect(error.message).toContain("disagree about unaddressed");
  });
});

const ROW = "store-backup-daily-stopped-firing-the-pass-643";

/** A board doc for `slug` under this home, with a journal closing it when `closed`. */
function boardRow({ slug, closed }: { slug: string; closed: boolean }): void {
  const paths = stateHomePaths({ home });
  mkdirSync(paths.handovers, { recursive: true });
  mkdirSync(paths.runs, { recursive: true });
  writeFileSync(join(paths.handovers, `${slug}.md`), `---\nslug: ${slug}\nstatus: ready\n---\n# doc\n`);
  if (closed) {
    writeFileSync(
      join(paths.runs, `${slug}.jsonl`),
      `${JSON.stringify({ atIso: "2026-09-27T05:04:35.000Z", kind: "closed", residue: [], summary: "merged as #1398" })}\n`,
    );
  }
}

/** Every line the register holds, in order. */
function registerLines(): readonly string[] {
  return readFileSync(handRegisterPath({ home }), "utf8").trim().split("\n");
}

describe("one open card per board row", () => {
  it("refuses a second open step naming the same row, writing nothing", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "first-card", row: ROW }) } }),
    );
    const before = registerLines();
    const refused = unwrapErr(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "second-card", row: ROW }) } }),
    );
    expect(refused).toEqual(HandStepErrors.rowAlreadyOpen({ existingId: "first-card", row: ROW }));
    expect(registerLines()).toEqual(before);
  });

  it("keeps an exact re-post of the same step the idempotent no-op it was", async () => {
    const posted = step({ id: "first-card", row: ROW });
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: posted } }));
    expect(unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: posted } })).appended).toBe(
      false,
    );
  });

  it("reads a register row naming a row back byte for byte, and one naming none with no row key", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "with-row", row: ROW }) } }),
    );
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "no-row" }) } }));
    const open = unwrap(readOpenHandSteps({ home })).steps;
    expect(open.map((s) => s.row)).toEqual([ROW, undefined]);
    expect(registerLines()[1]!.includes('"row"')).toBe(false);
  });

  it("refuses a row that is not a board slug, on read as on write", () => {
    expect(
      unwrapErr(parseHandLine({ line: JSON.stringify({ kind: "posted", step: { ...step(), row: 7 } }), lineNumber: 3 }))
        .code,
    ).toBe("CORRUPT_ROW");
  });

  it("refuses a row-naming post while the register holds a line it could not read", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "other" }) } }));
    writeFileSync(handRegisterPath({ home }), `${readFileSync(handRegisterPath({ home }), "utf8")}{torn\n`);
    expect(
      unwrapErr(
        await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "row-card", row: ROW }) } }),
      ),
    ).toEqual(HandStepErrors.registerIncomplete({ lineNumbers: [2] }));
  });
});

describe("appendHandPost --supersedes — a re-cut replaces the card it supersedes", () => {
  it("writes the new posting carrying the old step's settling as ONE line, then that settling plain", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    const receipt = unwrap(
      await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply", row: ROW }), supersedes: "iso-drafts" }),
    );
    expect(receipt.superseded).toBe("iso-drafts");
    const lines = registerLines();
    const settling = {
      bySession: "workspace:129",
      did: "superseded by iso-reply",
      id: "iso-drafts",
      kind: "settled",
      settledIso: NOW,
    };
    expect(lines.length).toBe(3);
    expect(JSON.parse(lines[1]!).step.id).toBe("iso-reply");
    expect(JSON.parse(lines[1]!).settles).toEqual(settling);
    expect(JSON.parse(lines[2]!)).toEqual(settling);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-reply"]);
  });

  it("refuses to supersede a step that is not open, and posts nothing", async () => {
    expect(
      unwrapErr(await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "gone" })),
    ).toEqual(HandStepErrors.unknownStep({ id: "gone" }));
    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([]);
  });

  it("reads as replaced to a reader built before `settles`, which folds one row per line and ignores the field", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }));
    const olderRows = registerLines().map((line) => {
      const { settles: _ignored, ...rest } = JSON.parse(line) as Record<string, unknown>;
      return unwrap(parseHandLine({ line: JSON.stringify(rest), lineNumber: 0 }));
    });
    expect(openHandSteps({ rows: olderRows }).map((s) => s.id)).toEqual(["iso-reply"]);
  });

  it("refuses a re-cut that drops the row the old card named", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    const refused = unwrapErr(
      await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }),
    );
    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toContain(`must stay ${ROW}`);
    expect(registerLines().length).toBe(1);
  });

  it("refuses a re-cut that ADDS a row, so neither half is left where evidence cannot reach it", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "row-card", row: ROW }) } }),
    );
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "unrelated" }) } }));
    const refused = unwrapErr(
      await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply", row: ROW }), supersedes: "unrelated" }),
    );
    expect(refused.code).toBe("INVALID_FIELD");
    expect(refused.message).toContain("must stay --standalone, as unrelated has it");
    expect(registerLines().length).toBe(2);
  });

  it("does not let superseding an UNRELATED step on the same row bypass that row's own open card", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "row-card", row: ROW }) } }),
    );
    expect(
      unwrapErr(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: "another-row" }),
          supersedes: "row-card",
        }),
      ).message,
    ).toContain(`must stay ${ROW}`);
  });

  it("refuses a re-cut onto an id already posted and settled, rather than reading it as a cut-short retry", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-reply", row: ROW }) } }),
    );
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: unwrap(buildSettledRow({ draft: { bySession: "s", did: "done", id: "iso-reply", settledIso: NOW } })),
      }),
    );
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    expect(
      unwrapErr(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      ),
    ).toEqual(
      HandStepErrors.invalidField({
        field: "id",
        why: "iso-reply was posted and settled before — a re-cut needs a fresh id",
      }),
    );
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-drafts"]);
  });

  it("refuses a re-cut onto an id the register holds a settling for with no posting of it", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    const settled = unwrap(
      buildSettledRow({ draft: { bySession: "s", did: "done", id: "iso-reply", settledIso: NOW } }),
    );
    appendFileSync(handRegisterPath({ home }), `${JSON.stringify(settled)}\n`);
    expect(
      unwrapErr(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      ).message,
    ).toContain("iso-reply was posted and settled before");
    expect(registerLines().length).toBe(2);
  });

  it("completes a two-line re-cut an earlier build tore between its lines, on the same retry", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-reply" }) } }));
    const receipt = unwrap(
      await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }),
    );
    expect(receipt.appended).toBe(false);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-reply"]);
  });

  it("refuses a re-cut retry when a later posting under the new id disagrees with the one it matches", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    const landed = { kind: "posted", step: step({ id: "iso-reply", row: ROW }) };
    const raced = { kind: "posted", step: step({ id: "iso-reply", row: ROW, what: "A raced second posting" }) };
    appendFileSync(handRegisterPath({ home }), `${JSON.stringify(landed)}\n${JSON.stringify(raced)}\n`);
    expect(
      unwrapErr(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      ),
    ).toEqual(HandStepErrors.stepIdConflict({ field: "what", id: "iso-reply" }));
    expect(registerLines().length).toBe(3);
  });

  it("completes that re-cut when the retry stamps a fresh posting instant, as hand post does by default", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-reply" }) } }));
    const again = step({ id: "iso-reply", postedIso: "2026-09-19T05:01:08.803Z" });
    const receipt = unwrap(await appendHandPost({ home, nowIso: NOW, step: again, supersedes: "iso-drafts" }));
    expect(receipt.appended).toBe(false);
    expect(registerLines().length).toBe(3);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => [s.id, s.postedIso])).toEqual([
      ["iso-reply", step().postedIso],
    ]);
  });

  it("still refuses a different step reusing the landed posting's id", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-reply" }) } }));
    const other = step({ id: "iso-reply", postedIso: "2026-09-19T05:01:08.803Z", what: "Something else entirely" });
    expect(unwrapErr(await appendHandPost({ home, nowIso: NOW, step: other, supersedes: "iso-drafts" }))).toEqual(
      HandStepErrors.stepIdConflict({ field: "what", id: "iso-reply" }),
    );
    expect(registerLines().length).toBe(2);
  });

  it("is an idempotent no-op when retried after it landed whole", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }));
    expect(
      unwrap(await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }))
        .appended,
    ).toBe(false);
    expect(registerLines().length).toBe(3);
  });

  it("refuses, as a corrupt line, a posting whose settling settles the posting itself", () => {
    const settles = unwrap(buildSettledRow({ draft: { bySession: "s", did: "x", id: "iso-reply", settledIso: NOW } }));
    const line = JSON.stringify({ kind: "posted", settles, step: step({ id: "iso-reply" }) });
    expect(unwrapErr(parseHandLine({ line, lineNumber: 4 }))).toEqual(
      HandStepErrors.corruptRow({ lineNumber: 4, why: "a posting of iso-reply cannot settle itself" }),
    );
  });
});

describe("appendHandSettlements — what another writer settled first is skipped, never a refusal of the rest", () => {
  const settling = ({ id }: { id: string }) =>
    unwrap(buildSettledRow({ draft: { bySession: "s", did: "done", id, settledIso: NOW } }));

  it("writes the open ids and names the one no longer open", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "open-one" }) } }));
    const receipt = unwrap(
      appendHandSettlements({
        home,
        nowIso: NOW,
        rows: [settling({ id: "settled-first" }), settling({ id: "open-one" })],
      }),
    );
    expect([receipt.ids, receipt.skipped]).toEqual([["open-one"], ["settled-first"]]);
    expect(registerLines().length).toBe(2);
  });

  it("writes one settling of an id offered twice", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "open-one" }) } }));
    const receipt = unwrap(
      appendHandSettlements({ home, nowIso: NOW, rows: [settling({ id: "open-one" }), settling({ id: "open-one" })] }),
    );
    expect([receipt.ids, receipt.skipped]).toEqual([["open-one"], ["open-one"]]);
    expect(registerLines().length).toBe(2);
  });

  it("writes no bytes when every id was already settled", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "open-one" }) } }));
    const receipt = unwrap(appendHandSettlements({ home, nowIso: NOW, rows: [settling({ id: "gone" })] }));
    expect([receipt.ids, receipt.skipped]).toEqual([[], ["gone"]]);
    expect(registerLines().length).toBe(1);
  });
});

describe("reconcileHandSteps — a card whose row finished leaves on evidence", () => {
  it("settles a step whose row closed, with no marker directory at all, and tells its note to close", async () => {
    boardRow({ closed: true, slug: ROW });
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { kind: "posted", step: step({ id: "store-backup-lease", row: ROW }) },
      }),
    );
    const outcome = unwrap(reconcileHandSteps({ bySession: "workspace:374", home, nowIso: NOW }));
    expect(outcome.evidenceSettled).toEqual(["store-backup-lease"]);
    expect(outcome.evidenceProblems).toEqual([]);
    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([]);
    expect(JSON.parse(registerLines()[1]!).did).toBe(`retracted by evidence — row ${ROW} is done, no hand touched it`);
    expect(existsSync(join(stateHomePaths({ home }).handNoteDismiss, "store-backup-lease.later"))).toBe(true);
  });

  it("takes down both halves of a re-cut cut short before its settling, once the row they name finishes", async () => {
    boardRow({ closed: false, slug: ROW });
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    // The posting half of an interrupted `--supersedes` append, written as the torn append left it.
    const posting = JSON.stringify({ kind: "posted", step: step({ id: "iso-reply", row: ROW }) });
    writeFileSync(handRegisterPath({ home }), `${readFileSync(handRegisterPath({ home }), "utf8")}${posting}\n`);
    boardRow({ closed: true, slug: ROW });
    const outcome = unwrap(reconcileHandSteps({ bySession: "workspace:374", home, nowIso: NOW }));
    expect(outcome.evidenceSettled).toEqual(["iso-drafts", "iso-reply"]);
    expect(unwrap(readOpenHandSteps({ home })).steps).toEqual([]);
  });

  it("keeps a step whose row is still open, and one that names no row", async () => {
    boardRow({ closed: false, slug: ROW });
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "row-card", row: ROW }) } }),
    );
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "standalone-card" }) } }));
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.evidenceSettled).toEqual([]);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["row-card", "standalone-card"]);
  });

  it("keeps a step whose row is missing and reports the row, never reading absence as done", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "row-card", row: ROW }) } }),
    );
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.evidenceSettled).toEqual([]);
    expect(outcome.evidenceProblems.map((problem) => problem.code)).toEqual(["ROW_MISSING"]);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["row-card"]);
  });

  it("is a no-op on the second pass", async () => {
    boardRow({ closed: true, slug: ROW });
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "row-card", row: ROW }) } }),
    );
    unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    const lines = registerLines().length;
    expect(unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW })).evidenceSettled).toEqual([]);
    expect(registerLines().length).toBe(lines);
  });

  it("settles a Done press and a finished row in the same pass, each once", async () => {
    boardRow({ closed: true, slug: ROW });
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "pressed", row: ROW }) } }),
    );
    marker({ answer: "done", id: "pressed", stamp: "stamp\n" });
    const outcome = unwrap(reconcileHandSteps({ bySession: "s", home, nowIso: NOW }));
    expect(outcome.settled).toEqual(["pressed"]);
    expect(outcome.evidenceSettled).toEqual([]);
    expect(registerLines().length).toBe(2);
  });
});

describe("a re-cut a crash cut short, and the lock that keeps two writers from interleaving", () => {
  /** A whole re-cut of `iso-drafts` as `iso-reply` on ROW, then its last `cut` bytes taken off, as a crash would. */
  async function cutShortRecut({ cut }: { cut: number }): Promise<void> {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    unwrap(
      await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply", row: ROW }), supersedes: "iso-drafts" }),
    );
    const path = handRegisterPath({ home });
    truncateSync(path, statSync(path).size - cut);
  }

  /** How many bytes the trailing plain settling takes, newline included, so a cut can land past it. */
  async function settlingBytes(): Promise<number> {
    await cutShortRecut({ cut: 0 });
    const bytes = registerLines().at(-1)!.length + 1;
    rmSync(handRegisterPath({ home }));
    return bytes;
  }

  it.each([2, 60, 300])(
    "leaves only the old card up after a crash %i bytes into the re-cut line, and its retry writes the re-cut whole",
    async (into) => {
      await cutShortRecut({ cut: (await settlingBytes()) + into });
      expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-drafts"]);
      const fragment = readFileSync(handRegisterPath({ home }), "utf8").split("\n").at(-1)!;
      const receipt = unwrap(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      );
      expect([receipt.appended, receipt.droppedTornBytes]).toEqual([true, fragment.length]);
      expect(registerLines().length).toBe(3);
      const read = unwrap(readOpenHandSteps({ home }));
      expect(read.postedIds).toEqual(["iso-drafts", "iso-reply"]);
      expect(read).toEqual({ postedIds: read.postedIds, steps: [step({ id: "iso-reply", row: ROW })], unparsed: [] });
    },
  );

  it.each([
    ["at the re-cut line's end", 0],
    ["2 bytes into the trailing plain settling", 2],
    ["12 bytes into the trailing plain settling", 12],
  ])(
    "reads the re-cut whole after a crash %s, and its retry writes back the settling the re-cut line carries",
    async (_where, into) => {
      const whole = await settlingBytes();
      const cut = into === 0 ? whole : into;
      await cutShortRecut({ cut });
      expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-reply"]);
      // Retried later, as a real retry is: the plain line repeats the carried settling, never restamps it.
      const receipt = unwrap(
        await appendHandPost({
          home,
          nowIso: LATER,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      );
      expect([receipt.appended, receipt.droppedTornBytes]).toEqual([false, whole - cut]);
      const lines = registerLines();
      expect(lines.length).toBe(3);
      expect(JSON.parse(lines[1]!).settles.settledIso).toBe(NOW);
      expect(JSON.parse(lines[2]!)).toEqual(JSON.parse(lines[1]!).settles);
      const again = unwrap(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      );
      expect([again.appended, again.droppedTornBytes, registerLines().length]).toEqual([false, 0, 3]);
    },
  );

  it("refuses to adopt a posting that already re-cut a different step, and writes nothing", async () => {
    for (const id of ["old-a", "old-b"]) {
      unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id }) } }));
    }
    unwrap(await appendHandPost({ home, nowIso: NOW, step: step({ id: "new" }), supersedes: "old-b" }));
    const before = readFileSync(handRegisterPath({ home }), "utf8");
    const refused = unwrapErr(
      await appendHandPost({ home, nowIso: LATER, step: step({ id: "new" }), supersedes: "old-a" }),
    );
    expect([refused.code, readFileSync(handRegisterPath({ home }), "utf8")]).toEqual(["STEP_ID_CONFLICT", before]);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["old-a", "new"]);
  });

  it("reads an equal posting beside an old step closed for another reason as no re-cut, and writes nothing", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "old" }) } }));
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "s", did: "done", id: "old", kind: "settled", settledIso: NOW },
      }),
    );
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "new" }) } }));
    const before = readFileSync(handRegisterPath({ home }), "utf8");
    const refused = unwrapErr(
      await appendHandPost({ home, nowIso: LATER, step: step({ id: "new" }), supersedes: "old" }),
    );
    expect([refused.code, readFileSync(handRegisterPath({ home }), "utf8")]).toEqual(["UNKNOWN_STEP", before]);
  });

  it("gives a whole last row that lost only its newline the newline, so the next append is not glued onto it", async () => {
    await cutShortRecut({ cut: 1 });
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "other" }) } }));
    expect(registerLines().length).toBe(4);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-reply", "other"]);
  });

  it("writes nothing, the torn fragment included, when the retry is refused", async () => {
    await cutShortRecut({ cut: (await settlingBytes()) + 12 });
    const before = readFileSync(handRegisterPath({ home }), "utf8");
    expect(
      unwrapErr(
        await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply", row: ROW }), supersedes: "gone" }),
      ),
    ).toEqual(HandStepErrors.unknownStep({ id: "gone" }));
    expect(readFileSync(handRegisterPath({ home }), "utf8")).toBe(before);
  });

  it("still refuses a re-cut beside an unread line that is not the torn tail", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    appendFileSync(handRegisterPath({ home }), "not json\n");
    expect(
      unwrapErr(
        await appendHandPost({
          home,
          nowIso: NOW,
          step: step({ id: "iso-reply", row: ROW }),
          supersedes: "iso-drafts",
        }),
      ),
    ).toEqual(HandStepErrors.registerIncomplete({ lineNumbers: [2] }));
  });

  it("refuses a torn re-cut's retry once its row has finished, leaving the old card for evidence to take down", async () => {
    await cutShortRecut({ cut: (await settlingBytes()) + 12 });
    const finished = (): string => "--row gone: that row is already done";
    const retried = await appendHandPost({
      admitRow: finished,
      home,
      nowIso: NOW,
      step: step({ id: "iso-reply", row: ROW }),
      supersedes: "iso-drafts",
    });
    expect(unwrapErr(retried)).toEqual(
      HandStepErrors.rowNotNameable({ row: ROW, why: "--row gone: that row is already done" }),
    );
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-drafts"]);
  });

  it("asks the row only of a write that opens the new card, so an earlier build's torn re-cut still completes", async () => {
    unwrap(
      await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts", row: ROW }) } }),
    );
    // The posting half of a two-line re-cut an earlier build wrote, torn before its settling.
    appendFileSync(
      handRegisterPath({ home }),
      `${JSON.stringify({ kind: "posted", step: step({ id: "iso-reply", row: ROW }) })}\n`,
    );
    const finished = (): string => "--row gone: that row is already done";
    const retried = await appendHandPost({
      admitRow: finished,
      home,
      nowIso: NOW,
      step: step({ id: "iso-reply", row: ROW }),
      supersedes: "iso-drafts",
    });
    expect(unwrap(retried).appended).toBe(false);
    expect(unwrap(readOpenHandSteps({ home })).steps.map((s) => s.id)).toEqual(["iso-reply"]);
    const fresh = await appendHandPost({
      admitRow: finished,
      home,
      nowIso: NOW,
      step: step({ id: "iso-next", row: ROW }),
      supersedes: "iso-reply",
    });
    expect(unwrapErr(fresh)).toEqual(
      HandStepErrors.rowNotNameable({ row: ROW, why: "--row gone: that row is already done" }),
    );
    expect(registerLines().length).toBe(3);
  });

  it("recovers the register's lock from a dead holder whose pid another process has since been given", async () => {
    unwrap(acquireOperationLock({ home, key: "hand-step-register", nowIso: "2026-09-19T00:00:00.000Z" }));
    const locks = join(stateHomePaths({ home }).ledgers, "operation-locks");
    const lockDir = join(
      locks,
      readdirSync(locks).find((name) => name.endsWith(".lock"))!,
    );
    const token = join(lockDir, readdirSync(lockDir)[0]!);
    const recycled = {
      acquiredAtIso: "2026-09-19T00:00:00.000Z",
      pid: process.ppid,
      start: "Thu Jan  1 00:00:00 1970",
    };
    writeFileSync(token, JSON.stringify(recycled));
    expect(unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } })).appended).toBe(
      true,
    );
  });

  it("recovers a lock a build before start stamps left, once past the ordinary window, though its pid is alive", async () => {
    unwrap(acquireOperationLock({ home, key: "hand-step-register", nowIso: "2026-09-19T00:00:00.000Z" }));
    const locks = join(stateHomePaths({ home }).ledgers, "operation-locks");
    const lockDir = join(
      locks,
      readdirSync(locks).find((name) => name.endsWith(".lock"))!,
    );
    writeFileSync(
      join(lockDir, readdirSync(lockDir)[0]!),
      JSON.stringify({ acquiredAtIso: "2026-09-19T00:00:00.000Z", pid: process.ppid }),
    );
    expect(unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } })).appended).toBe(
      true,
    );
  });

  it("never takes the register's lock from a live holder, however long it has held it", async () => {
    const held = unwrap(acquireOperationLock({ home, key: "hand-step-register", nowIso: "2026-09-19T00:00:00.000Z" }));
    const refused = await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } });
    held.release();
    expect(unwrapErr(refused).code).toBe("REGISTER_BUSY");
  });
});
