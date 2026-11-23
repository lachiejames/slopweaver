/**
 * `listen`'s flag surface and the acknowledgement text. The text has an assertion of its own because the
 * one thing it must never do is read like an answer.
 */
import { describe, expect, it } from "vitest";

import {
  acknowledgementText,
  LISTEN_FLAG_NAMES,
  listenOptions,
  parseListenArgs,
  validateDeadlineMode,
  validateListenModes,
} from "../../../../../cli/commands/listen/core.js";
import { ListenErrors, listenErrorLines } from "../../../../../cli/commands/listen/errors.js";
import { LISTEN_USAGE } from "../../../../../cli/commands/listen/listenUsage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseListenArgs", () => {
  it("defaults to a live listener with no home override", () => {
    expect(listenOptions({ parsed: unwrap(parseListenArgs({ rest: [] })) })).toEqual({
      check: false,
      emit: false,
      follow: false,
      home: undefined,
      json: false,
      once: false,
      queuePath: undefined,
    });
  });

  it("reads every flag it advertises", () => {
    const rest = ["--check", "--once", "--emit", "--json", "--home", "/tmp/home", "--queue", "/tmp/queue.jsonl"];
    const parsed = unwrap(parseListenArgs({ rest }));

    expect(listenOptions({ parsed })).toEqual({
      check: true,
      emit: true,
      follow: false,
      home: "/tmp/home",
      json: true,
      once: true,
      queuePath: "/tmp/queue.jsonl",
    });
  });

  it("stays connected under --follow, folding once to false even though --emit would otherwise imply it", () => {
    const parsed = unwrap(parseListenArgs({ rest: ["--follow", "--emit", "--json"] }));

    expect(listenOptions({ parsed })).toEqual({
      check: false,
      emit: true,
      follow: true,
      home: undefined,
      json: true,
      once: false,
      queuePath: undefined,
    });
  });

  it("treats an empty --queue as no override", () => {
    const parsed = unwrap(parseListenArgs({ rest: ["--queue", ""] }));

    expect(listenOptions({ parsed }).queuePath).toBe(undefined);
  });

  /**
   * `--emit` implies `--once`, and it is folded in HERE rather than left to the caller.
   *
   * The mention IS the output. A second one would be printed into a stream whose reader has already left to
   * do the turn with the first — so `--emit` without `--once` has no coherent meaning, and the option type
   * should not be able to express it.
   */
  it("folds --once into --emit, so an emitting listener cannot be left running", () => {
    expect(listenOptions({ parsed: unwrap(parseListenArgs({ rest: ["--emit"] })) }).once).toBe(true);
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    expect(unwrapErr(parseListenArgs({ rest: ["--channel", "C1"] }))).toEqual([
      "unknown flag: --channel",
      "unexpected argument: C1",
    ]);
  });

  it("refuses --home with no value", () => {
    expect(unwrapErr(parseListenArgs({ rest: ["--home"] }))).toEqual(["--home requires a value"]);
  });

  it("refuses a stray positional, because a listener takes no target", () => {
    expect(unwrapErr(parseListenArgs({ rest: ["C0LISTEN"] }))).toEqual(["unexpected argument: C0LISTEN"]);
  });

  it("treats an empty --home as no override", () => {
    const parsed = unwrap(parseListenArgs({ rest: ["--home", ""] }));

    expect(listenOptions({ parsed }).home).toBe(undefined);
  });
});

describe("validateDeadlineMode", () => {
  /** Validate `--deadline-ms` alongside the one valid mode it is ever accepted in. */
  function deadlineMode({ rest }: { rest: readonly string[] }): ReturnType<typeof validateDeadlineMode> {
    return validateDeadlineMode({ parsed: unwrap(parseListenArgs({ rest })) });
  }

  it("defaults to undefined when not given", () => {
    expect(unwrap(deadlineMode({ rest: ["--emit", "--json"] }))).toBe(undefined);
  });

  it("accepts a valid epoch-ms value alongside --emit --json", () => {
    expect(unwrap(deadlineMode({ rest: ["--emit", "--json", "--deadline-ms", "1786000000000"] }))).toBe(
      1_786_000_000_000,
    );
  });

  it("accepts 1", () => {
    expect(unwrap(deadlineMode({ rest: ["--emit", "--json", "--deadline-ms", "1"] }))).toBe(1);
  });

  it("accepts Number.MAX_SAFE_INTEGER", () => {
    expect(unwrap(deadlineMode({ rest: ["--emit", "--json", "--deadline-ms", String(Number.MAX_SAFE_INTEGER)] }))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([
    ["zero", "0"],
    ["negative", "-5"],
    ["a fraction", "1.5"],
    ["not a number", "soon"],
    ["Infinity", "Infinity"],
    ["one past MAX_SAFE_INTEGER", String(Number.MAX_SAFE_INTEGER + 2)],
  ])("rejects %s", (_label, raw) => {
    expect(
      listenErrorLines({ error: unwrapErr(deadlineMode({ rest: ["--emit", "--json", "--deadline-ms", raw] })) }),
    ).toEqual([`--deadline-ms must be a positive integer number of milliseconds, got '${raw}'`]);
  });

  it("rejects an empty value", () => {
    expect(
      listenErrorLines({ error: unwrapErr(deadlineMode({ rest: ["--emit", "--json", "--deadline-ms", ""] })) }),
    ).toEqual(["--deadline-ms requires a value"]);
  });

  it.each([
    ["missing --emit", ["--json", "--deadline-ms", "1786000000000"]],
    ["missing --json", ["--emit", "--deadline-ms", "1786000000000"]],
    ["with --check", ["--emit", "--json", "--check", "--deadline-ms", "1786000000000"]],
    ["with --follow", ["--follow", "--json", "--deadline-ms", "1786000000000"]],
  ])("rejects %s", (_label, rest) => {
    expect(listenErrorLines({ error: unwrapErr(deadlineMode({ rest })) })).toEqual([
      "--deadline-ms is only valid together with --emit --json, and never with --check or --follow",
    ]);
  });

  it("does not require a literal --once to accept the flag — --once is listenOptions's own concern, not this validator's", () => {
    expect(unwrap(deadlineMode({ rest: ["--emit", "--json", "--deadline-ms", "1786000000000"] }))).toBe(
      1_786_000_000_000,
    );
  });
});

describe("LISTEN_USAGE", () => {
  it("advertises exactly the flags the parser accepts", () => {
    expect(LISTEN_FLAG_NAMES).toEqual([
      "--channels",
      "--check",
      "--deadline-ms",
      "--dm-only",
      "--emit",
      "--follow",
      "--heartbeat",
      "--home",
      "--json",
      "--once",
      "--queue",
      "--thread-replies",
    ]);
    expect([...new Set(LISTEN_USAGE.match(/--[a-z][a-z0-9-]*/g))].toSorted()).toEqual(LISTEN_FLAG_NAMES);
  });

  it("says the listener wakes only when ADDRESSED, which is the constraint a reader most needs", () => {
    expect(LISTEN_USAGE).toContain("ADDRESSED");
  });

  /**
   * The usage must say it does NOT compose an answer, for either outcome of the responder whitelist.
   *
   * This verb answered for its whole life before now, and its own help text was where a reader learned that.
   * Leaving the old absolute "it does NOT answer" in place would now be FALSE rather than merely stale: a
   * non-whitelisted identity gets a real reply — fixed and deterministic, never model-composed, but a reply
   * all the same. The claim that survives is narrower and still true: nothing here ever composes an answer.
   */
  it("states that an admitted address is emitted, not answered, and names what does the answering", () => {
    expect(LISTEN_USAGE).toContain("emitted, not answered");
    expect(LISTEN_USAGE).toContain("/slopweaver:loop");
  });

  it("states that a non-whitelisted identity gets a fixed refusal reply, never silence and never a model answer", () => {
    expect(LISTEN_USAGE).toContain("fixed, deterministic refusal reply");
    expect(LISTEN_USAGE).toContain("never a model-composed answer and never silence");
  });

  it("says address means an EXPLICIT tag on both surfaces, because a DM raises no app_mention", () => {
    expect(LISTEN_USAGE).toContain("EXPLICIT tag");
    expect(LISTEN_USAGE).toContain("an app_mention in a channel, or a 1:1 DM whose text tags the bot");
  });

  it("says what still does NOT wake it, so widening the rule reads as bounded", () => {
    expect(LISTEN_USAGE).toContain("not a group DM, not an untagged channel message, and not an untagged DM");
  });

  it("says --follow is mutually exclusive with --once, which is the constraint a caller must not miss", () => {
    expect(LISTEN_USAGE.replace(/\s+/g, " ")).toContain("Mutually exclusive with --once.");
  });
});

describe("validateListenModes", () => {
  it("refuses --follow together with --once, naming both", () => {
    expect(unwrapErr(validateListenModes({ follow: true, once: true }))).toEqual(ListenErrors.followWithOnce());
    expect(listenErrorLines({ error: unwrapErr(validateListenModes({ follow: true, once: true })) })).toEqual([
      "--follow and --once are mutually exclusive: --follow stays connected indefinitely, --once stops after the first tag",
    ]);
  });

  it("allows --follow alone", () => {
    expect(validateListenModes({ follow: true, once: false }).isOk()).toBe(true);
  });

  it("allows --once alone", () => {
    expect(validateListenModes({ follow: false, once: true }).isOk()).toBe(true);
  });

  it("allows neither", () => {
    expect(validateListenModes({ follow: false, once: false }).isOk()).toBe(true);
  });
});

describe("acknowledgementText", () => {
  it("tags the human back by id, an exact match rather than a name", () => {
    expect(acknowledgementText({ userId: "U0HUMAN" }).startsWith("<@U0HUMAN> ")).toBe(true);
  });

  it("says it is not an answer, so a stub can never be mistaken for one", () => {
    expect(acknowledgementText({ userId: "U0HUMAN" })).toContain("not an answer");
  });

  it("no longer claims nothing else in the thread wakes it, which a DM made false", () => {
    expect(acknowledgementText({ userId: "U0HUMAN" })).not.toContain("Nothing else in this thread will wake me");
  });

  it("does NOT emit live mention syntax for a peer bot's bot_id, which is not a valid Slack mention target", () => {
    expect(acknowledgementText({ userId: "B0SYN000011" }).startsWith("`B0SYN000011` ")).toBe(true);
    expect(acknowledgementText({ userId: "B0SYN000011" })).not.toContain("<@B0SYN000011>");
  });
});
