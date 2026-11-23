/**
 * The shared resolver and guards every `handover` lifecycle verb runs through, driven over a real temp board
 * and journal. No clock is read: `recordText`'s event builder is handed a fixed instant, and every other path
 * here stops before an append.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { recordText } from "../../../../../cli/commands/handover/lifecycleRecordText.js";
import {
  HANDOVER_LIFECYCLE_FLAG_NAMES,
  holderLiveness,
  lifecycleUsage,
  mutationRefusal,
  ownershipAmbiguityRefusal,
  parseLifecycleArgs,
  phaseRefusalFor,
  type Resolved,
  resolve,
  routedValue,
  routingFlagSuffix,
  stringFlag,
  VERB_ARG_OFFSET,
} from "../../../../../cli/commands/handover/lifecycleRunCore.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { ALLOW_STALE_JOURNAL_ENV } from "../../../../../handover/staleReader.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  clearSessionEnv,
  journalEvents,
  lifecycleHome,
  restoreSessionEnv,
  STARTED,
  snapshotTree,
  verbArgv,
} from "./lifecycleRunFixture.js";

const SLUG = "core-run";
const homes: string[] = [];
const savedHatch = process.env[ALLOW_STALE_JOURNAL_ENV];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
  restoreSessionEnv();
  if (savedHatch === undefined) {
    delete process.env[ALLOW_STALE_JOURNAL_ENV];
  } else {
    process.env[ALLOW_STALE_JOURNAL_ENV] = savedHatch;
  }
});

const QUESTION: RunEvent = { atIso: "2026-10-01T09:05:00.000Z", kind: "question", question: "Which base?" };

const CLAIMED: RunEvent = {
  atIso: "2026-10-01T09:01:00.000Z",
  host: "claude-code",
  kind: "claimed",
  pid: 4242,
  sessionId: "holder-session",
  why: "the holder took it",
  worktree: "/wt/holder",
};

const RELEASED: RunEvent = {
  atIso: "2026-10-01T09:02:00.000Z",
  kind: "released",
  sessionId: "holder-session",
  why: "handing it on",
};

/** Resolve one verb against a seeded home, failing the test if resolution did not produce a context. */
function resolvedOver({
  verb,
  events,
  rawLines = [],
}: {
  verb: string;
  events: readonly RunEvent[];
  rawLines?: readonly string[];
}): { resolved: Resolved; home: string; runsDir: string } {
  const { home, runsDir } = lifecycleHome({ events, homes, rawLines, slug: SLUG });
  const resolved = resolve({ argv: verbArgv({ rest: [SLUG, "--home", home], verb }), verb });
  if (typeof resolved === "number") {
    throw new Error(`fixture did not resolve: exit ${String(resolved)}`);
  }
  return { home, resolved, runsDir };
}

describe("VERB_ARG_OFFSET", () => {
  it("is 4", () => {
    expect(VERB_ARG_OFFSET).toBe(4);
  });
});

describe("HANDOVER_LIFECYCLE_FLAG_NAMES", () => {
  it("lists claim's and release's flags whole and sorted, with --force on claim alone", () => {
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["claim"]).toEqual(["--base", "--dir", "--force", "--home", "--why"]);
    expect(HANDOVER_LIFECYCLE_FLAG_NAMES["release"]).toEqual(["--base", "--dir", "--home", "--why"]);
  });
});

describe("lifecycleUsage", () => {
  it("renders a value placeholder for a string flag and a bare switch for a boolean one", () => {
    expect(lifecycleUsage({ verb: "resume" })).toBe(
      "usage: slopweaver handover resume <slug> [--base <value>] [--dir <value>] [--home <value>] [--probe]",
    );
    expect(lifecycleUsage({ verb: "release" })).toBe(
      "usage: slopweaver handover release <slug> [--base <value>] [--dir <value>] [--home <value>] [--why <value>]",
    );
  });

  it("names no flag for an undeclared verb, since it declares none", () => {
    expect(lifecycleUsage({ verb: "no-such-verb" })).toBe("usage: slopweaver handover no-such-verb <slug> ");
  });
});

describe("parseLifecycleArgs", () => {
  it("refuses a flag the verb does not declare, and accepts the one it does", () => {
    expect(unwrapErr(parseLifecycleArgs({ rest: [SLUG, "--note", "x"], verb: "amend" }))).toEqual([
      "unknown flag: --note",
    ]);
    expect(unwrap(parseLifecycleArgs({ rest: [SLUG, "--note", "x"], verb: "sign-off" })).values["note"]).toBe("x");
  });

  it("parses an undeclared verb with the common routing flags only", () => {
    expect(unwrap(parseLifecycleArgs({ rest: [SLUG, "--home", "/h"], verb: "no-such-verb" })).values["home"]).toBe(
      "/h",
    );
    expect(unwrapErr(parseLifecycleArgs({ rest: [SLUG, "--why", "x"], verb: "no-such-verb" }))).toEqual([
      "unknown flag: --why",
    ]);
  });
});

describe("stringFlag", () => {
  it("returns a string flag's value and undefined for a boolean or absent one", () => {
    const parsed = unwrap(parseLifecycleArgs({ rest: [SLUG, "--probe", "--base", "main"], verb: "resume" }));

    expect([
      stringFlag({ name: "base", parsed }),
      stringFlag({ name: "probe", parsed }),
      stringFlag({ name: "dir", parsed }),
    ]).toEqual(["main", undefined, undefined]);
  });
});

describe("routingFlagSuffix", () => {
  it("is empty when the invocation ran on the default home and board", () => {
    const parsed = unwrap(parseLifecycleArgs({ rest: [SLUG], verb: "resume" }));

    expect(routingFlagSuffix({ cwd: "/work", parsed })).toBe("");
  });

  it("spells a relative --home and --dir absolute against the injected cwd", () => {
    const parsed = unwrap(parseLifecycleArgs({ rest: [SLUG, "--home", "state", "--dir", "../board"], verb: "resume" }));

    expect(routingFlagSuffix({ cwd: "/work/tree", parsed })).toBe(" --home /work/tree/state --dir /work/board");
  });

  it("spells an empty --home as the cwd and an empty --dir as a quoted empty string", () => {
    const parsed = unwrap(parseLifecycleArgs({ rest: [SLUG, "--home", "", "--dir", ""], verb: "resume" }));

    expect(routingFlagSuffix({ cwd: "/work", parsed })).toBe(" --home /work --dir ''");
  });
});

describe("routedValue", () => {
  it("single-quotes a path a shell would split, and leaves a plain path bare", () => {
    expect(routedValue({ cwd: "/work", emptyResolvesToCwd: true, value: "my board" })).toBe("'/work/my board'");
    expect(routedValue({ cwd: "/work", emptyResolvesToCwd: true, value: "/abs/board" })).toBe("/abs/board");
  });
});

describe("resolve", () => {
  it("answers 0 for --help and 2 for the same argv with neither --help nor a slug", () => {
    expect(resolve({ argv: verbArgv({ rest: ["--help"], verb: "amend" }), verb: "amend" })).toBe(0);
    expect(resolve({ argv: verbArgv({ rest: [], verb: "amend" }), verb: "amend" })).toBe(2);
  });

  it("answers 2 for a flag the verb does not declare", () => {
    expect(resolve({ argv: verbArgv({ rest: [SLUG, "--nope", "x"], verb: "amend" }), verb: "amend" })).toBe(2);
  });

  it("resolves the doc, journal, board and home a verb reads from an explicit --home", () => {
    const { home, resolved } = resolvedOver({ events: [STARTED], verb: "amend" });

    expect([
      resolved.home,
      resolved.runsDir,
      resolved.context.doc.slug,
      resolved.context.run.phase,
      resolved.context.events,
      resolved.all.map((doc) => doc.slug),
      resolved.parsed.positionals,
    ]).toEqual([home, join(home, "runs"), SLUG, "open", [STARTED], [SLUG], [SLUG]]);
  });
});

describe("phaseRefusalFor", () => {
  it("refuses an answer on an open run with no question, and admits an ask on the same run", () => {
    const { resolved } = resolvedOver({ events: [STARTED], verb: "answer" });

    expect(phaseRefusalFor({ resolved, verb: "answer" })).toBe("this run has no recorded question to answer");
    expect(phaseRefusalFor({ resolved, verb: "ask" })).toBeUndefined();
  });
});

describe("mutationRefusal", () => {
  it("admits a write on a run no session ever claimed", () => {
    clearSessionEnv();
    const { resolved } = resolvedOver({ events: [STARTED], verb: "amend" });

    expect(mutationRefusal({ resolved, verb: "amend" })).toBeUndefined();
  });

  it("refuses with 1 a write on a run another session released", () => {
    clearSessionEnv();
    const { resolved } = resolvedOver({ events: [STARTED, CLAIMED, RELEASED], verb: "amend" });

    expect(mutationRefusal({ resolved, verb: "amend" })).toBe(1);
  });
});

describe("ownershipAmbiguityRefusal", () => {
  it("refuses with 1 over an undecodable journal line, and admits it once the stale-journal hatch is 1", () => {
    delete process.env[ALLOW_STALE_JOURNAL_ENV];
    const { resolved } = resolvedOver({ events: [STARTED], rawLines: ["{not json"], verb: "amend" });

    expect(ownershipAmbiguityRefusal({ context: resolved.context, verb: "handover amend" })).toBe(1);
    process.env[ALLOW_STALE_JOURNAL_ENV] = "1";
    expect(ownershipAmbiguityRefusal({ context: resolved.context, verb: "handover amend" })).toBeUndefined();
  });
});

describe("holderLiveness", () => {
  it("measures nothing for unowned, mine and released ownership", () => {
    const writer = { atIso: "2026-10-01T09:01:00.000Z", pid: 1, sessionId: "s", worktree: "/wt" };

    expect([
      holderLiveness({ ownership: { kind: "unowned" } }),
      holderLiveness({ ownership: { kind: "mine", writer } }),
      holderLiveness({
        ownership: { kind: "released", releasedAtIso: "2026-10-01T09:02:00.000Z", why: "w", writer },
      }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("recordText", () => {
  const FIXED_ISO = "2026-10-01T10:00:00.000Z";
  const build: Parameters<typeof recordText>[0]["build"] = ({ value }) => ({
    answer: value,
    atIso: FIXED_ISO,
    kind: "answered",
  });

  it("appends the built event over the TRIMMED flag value and answers 0", async () => {
    clearSessionEnv();
    const { home, runsDir } = lifecycleHome({ events: [STARTED, QUESTION], homes, slug: SLUG });

    const code = await recordText({
      argv: verbArgv({ rest: [SLUG, "--home", home, "--answer", "  main  "], verb: "answer" }),
      build,
      flag: "answer",
      said: "recorded",
      verb: "answer",
    });

    expect(code).toBe(0);
    expect(journalEvents({ runsDir, slug: SLUG })).toEqual([
      STARTED,
      QUESTION,
      { answer: "main", atIso: FIXED_ISO, kind: "answered" },
    ]);
  });

  it("answers 2 for a blank flag value and 1 for a phase refusal, leaving the home byte-identical", async () => {
    clearSessionEnv();
    const { home } = lifecycleHome({ events: [STARTED], homes, slug: SLUG });
    const before = snapshotTree({ root: home });
    const run = async ({ answer }: { answer: string }): Promise<number> =>
      recordText({
        argv: verbArgv({ rest: [SLUG, "--home", home, "--answer", answer], verb: "answer" }),
        build,
        flag: "answer",
        said: "recorded",
        verb: "answer",
      });

    expect([await run({ answer: "   " }), await run({ answer: "main" })]).toEqual([2, 1]);
    expect(snapshotTree({ root: home })).toEqual(before);
  });
});
