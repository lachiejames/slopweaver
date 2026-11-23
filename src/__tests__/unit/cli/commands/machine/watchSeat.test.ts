/**
 * `machine watch`s SEAT — the order it performs and the argv it builds, over plain fake runners.
 *
 * The falsifiable witness this file exists for is `--repo`: remove it from {@link seatRegisterArgv} and two
 * cases here redden. Its absence is what left the watcher unable to seat a single one of 17 dispatches,
 * with this repository's whole unit suite green throughout, because the only seam a test could reach was the
 * seat itself rather than the flags it passes.
 */
import { describe, expect, it } from "vitest";

import {
  exitCodeMeaning,
  openSeat,
  seatRegisterArgv,
  seatSpawnArgv,
} from "../../../../../cli/commands/machine/watchSeat.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import type { DispatchRow } from "../../../../../live/machine/dispatchRow.js";

/** One dispatch, with only the fields a seat reads populated meaningfully. */
const SEATED_ROW: DispatchRow = {
  id: "a65fd1c1-1fe4-4e15-bc73-6c53358f1d53",
  load1: 25.51,
  observedIso: "2026-09-21T12:08:59.990Z",
  seated: { kind: "none", why: "not yet attempted" },
  settled: undefined,
  signature: "hold|hold on cpu|foreign",
  subject: {
    kill: undefined,
    label: "hold on cpu",
    sessionId: undefined,
    tree: [],
    why: "HOLD on cpu — no single process or session is an outlier",
  },
  triggers: ["hold"],
};

describe("seatRegisterArgv", () => {
  it("names the checkout with --repo, which is the flag whose absence seated nothing for 17 dispatches", () => {
    const argv = seatRegisterArgv({
      checkout: "/checkouts/slopweaver",
      home: "/state",
      row: SEATED_ROW,
      slug: "machine-load-hold-on-cpu-a65fd1c1",
    });

    expect([...argv]).toStrictEqual([
      "--ask",
      "anomalous machine load: HOLD on cpu — no single process or session is an outlier",
      "--finding",
      "--evidence",
      "/state/live/machine/dispatches.jsonl#a65fd1c1-1fe4-4e15-bc73-6c53358f1d53",
      "--priority",
      "p1",
      "--slug",
      "machine-load-hold-on-cpu-a65fd1c1",
      "--workspace",
      "self",
      "--workspace-because",
      "anomalous load on the machine this installation runs on",
      "--repo",
      "/checkouts/slopweaver",
      "--home",
      "/state",
    ]);
  });
});

describe("seatSpawnArgv", () => {
  it("pins the model, because AGENTS.md rule 5 forbids a spawn with no pin", () => {
    expect([...seatSpawnArgv({ home: "/state", slug: "machine-load-hold-on-cpu-a65fd1c1" })]).toStrictEqual([
      "machine-load-hold-on-cpu-a65fd1c1",
      "--model",
      "opus",
      "--home",
      "/state",
    ]);
  });
});

describe("exitCodeMeaning", () => {
  it("names a 2 as a refused invocation — the reading nine sessions could not make off the bare number", () => {
    expect(exitCodeMeaning({ code: EXIT_USAGE })).toBe(
      " (usage — the verb refused this invocation before acting, so nothing happened)",
    );
  });

  it("names the other two documented non-fault codes", () => {
    expect(exitCodeMeaning({ code: EXIT_EXPECTED_EMPTY })).toContain("expected-empty");
    expect(exitCodeMeaning({ code: EXIT_DEFERRED })).toContain("deferred");
  });

  it("adds nothing to a plain runtime fault, which the vocabulary does not narrow", () => {
    expect(exitCodeMeaning({ code: EXIT_ERROR })).toBe("");
  });
});

describe("openSeat", () => {
  /** Records what each step was asked to do, so the ORDER is assertable rather than assumed. */
  function steps() {
    const registered: (readonly string[])[] = [];
    const spawned: (readonly string[])[] = [];
    const order: string[] = [];
    return {
      order,
      record: ({ slug }: { slug: string }) => {
        order.push(`record ${slug}`);
      },
      register: ({ argv }: { argv: readonly string[] }) => {
        registered.push(argv);
        order.push("register");
        return Promise.resolve(ok(undefined));
      },
      registered,
      spawn: ({ argv }: { argv: readonly string[] }) => {
        spawned.push(argv);
        order.push("spawn");
        return Promise.resolve(ok(undefined));
      },
      spawned,
    };
  }

  it("registers the row against the resolved checkout, then opens the workspace on it", async () => {
    const step = steps();

    const seated = await openSeat({
      checkoutFor: () => ok("/checkouts/slopweaver"),
      home: "/state",
      recordRegistered: step.record,
      register: step.register,
      row: SEATED_ROW,
      openWorkspace: step.spawn,
    });

    expect(seated).toStrictEqual({
      kind: "seated",
      slug: "machine-load-hold-on-cpu-a65fd1c1",
      workspace: "machine-load-hold-on-cpu-a65fd1c1",
    });
    expect(step.registered[0]!).toContain("/checkouts/slopweaver");
    // The dispatch row is recorded AFTER the board row exists and BEFORE the slow spawn — the order that
    // leaves the id a board row cites in the register when a timeout kills the watch mid-spawn.
    expect(step.order).toStrictEqual(["register", "record machine-load-hold-on-cpu-a65fd1c1", "spawn"]);
    expect(step.spawned[0]![0]!).toBe("machine-load-hold-on-cpu-a65fd1c1");
  });

  it("registers NO board row when the checkout cannot be resolved, and says so in the seat's own words", async () => {
    const step = steps();

    const seated = await openSeat({
      checkoutFor: () => err(["machine watch: no declared main checkout has acme/widgets as its `origin`"]),
      home: "/state",
      recordRegistered: step.record,
      register: step.register,
      row: SEATED_ROW,
      openWorkspace: step.spawn,
    });

    expect(seated).toStrictEqual({
      kind: "none",
      why: "no board row was registered: machine watch: no declared main checkout has acme/widgets as its `origin`",
    });
    expect(step.order).toStrictEqual([]);
  });

  it("reports a failed spawn against the row it already wrote, so the board row is findable", async () => {
    const step = steps();

    const seated = await openSeat({
      checkoutFor: () => ok("/checkouts/slopweaver"),
      home: "/state",
      recordRegistered: step.record,
      register: step.register,
      row: SEATED_ROW,
      openWorkspace: () => Promise.resolve(err(["cmux spawn exited 2 (usage — the verb refused this invocation)"])),
    });

    expect(seated).toStrictEqual({
      kind: "none",
      why:
        "board row machine-load-hold-on-cpu-a65fd1c1 registered, but cmux spawn failed: " +
        "cmux spawn exited 2 (usage — the verb refused this invocation)",
    });
    expect(step.registered.length).toBe(1);
  });

  it("records nothing when the board row could not be registered — no row may name a board row that is not there", async () => {
    const step = steps();

    const seated = await openSeat({
      checkoutFor: () => ok("/checkouts/slopweaver"),
      home: "/state",
      openWorkspace: step.spawn,
      recordRegistered: step.record,
      register: () => Promise.resolve(err(["handover register --finding exited 1"])),
      row: SEATED_ROW,
    });

    expect(seated).toStrictEqual({
      kind: "none",
      why: "could not register a board row: handover register --finding exited 1",
    });
    expect(step.order).toStrictEqual([]);
  });
});
