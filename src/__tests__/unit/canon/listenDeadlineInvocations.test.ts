/**
 * The `listen --deadline-ms` help-truth binding, in the two-describe shape `staleReferences.test.ts`
 * established: the first blocks drive the PURE extractor and the pure offender computation on inline
 * fixtures and never touch disk; the last reads THIS repository's real working tree and pushes every
 * advertised invocation through the REAL validators — `validateDeadlineMode` for bare `listen`,
 * `recoverOptions` for `listen recover`.
 *
 * What it holds down: `skills/loop/SKILL.md` instructed `listen --follow … --deadline-ms` for weeks while
 * `core.ts` refused exactly that combination, and `scheduledRecover.ts` claimed parity with it. Nothing
 * failed, because live loops simply ran `--follow` alone — the documented door was unopenable and only a
 * hand audit found it. See `src/canon/listenDeadline.ts` for the criterion and its two deliberate bounds.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  type AdvertisedInvocation,
  bareToken,
  type DeadlineVerbContract,
  deadlineArgvFor,
  formatDeadlineOffender,
  type ListenDeadlineVerb,
  listenDeadlineOffenders,
  logicalLines,
  scanAdvertisedDeadlineInvocations,
} from "../../../canon/listenDeadline.js";
import { LISTEN_FLAG_SPEC, parseListenArgs, validateDeadlineMode } from "../../../cli/commands/listen/core.js";
import { listenErrorLines } from "../../../cli/commands/listen/errors.js";
import { LISTEN_RECOVER_FLAG_SPEC, parseRecoverArgs, recoverOptions } from "../../../cli/commands/listen/recover.js";
import { repoRootOf, workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { scanTextFiles } from "../../../lib/textFileScan.js";

/** A plausible epoch-ms value, so a rejection is never about the NUMBER. */
const DEADLINE = "1786000000000";

/** A pinned instant, so `--since`'s default is not read off a wall clock. */
const NOW_MS = Date.parse("2026-08-07T00:00:00.000Z");

/** `listen`'s own declared booleans, read off the shipped spec rather than restated here. */
const { boolean: LISTEN_BOOLEAN_FLAGS = [] } = LISTEN_FLAG_SPEC;

/**
 * The binding's own two files, held out of the tree scan.
 *
 * Both quote `listen --follow --deadline-ms` on purpose — the module header to say what went wrong, this
 * file to feed it in as the fixture that proves the gate fires. A gate cannot be its own subject: those are
 * INPUTS, not advertisements. The hold-out is not free, though, so the test directly below asserts each of
 * these files STILL produces a refused invocation — delete the example and the exclusion reddens rather
 * than quietly covering an empty fixture.
 */
const SELF_DECLARING: readonly string[] = [
  "src/canon/listenDeadline.ts",
  "src/__tests__/unit/canon/listenDeadlineInvocations.test.ts",
];

/** The REAL `listen` contract: its canonical accepted argv, its declared booleans, its shipped validator. */
const LISTEN_CONTRACT: DeadlineVerbContract = {
  baseline: ["--emit", "--json", "--deadline-ms", DEADLINE],
  booleanFlags: LISTEN_BOOLEAN_FLAGS,
  validate: ({ argv }) => {
    const parsed = parseListenArgs({ rest: argv });
    if (parsed.isErr()) {
      return parsed.error;
    }
    const validated = validateDeadlineMode({ parsed: parsed.value });
    if (validated.isErr()) {
      return listenErrorLines({ error: validated.error });
    }
    return [];
  },
};

/** The REAL `listen recover` contract. `--bot-user`/`--channels` are required by the verb, never by this. */
const RECOVER_CONTRACT: DeadlineVerbContract = {
  baseline: ["--bot-user", "U0BOT", "--channels", "C0CHAN", "--scheduled", "--json", "--deadline-ms", DEADLINE],
  booleanFlags: LISTEN_RECOVER_FLAG_SPEC.boolean,
  validate: ({ argv }) => {
    const parsed = parseRecoverArgs({ rest: argv });
    if (parsed.isErr()) {
      return parsed.error;
    }
    const options = recoverOptions({ nowMs: NOW_MS, values: parsed.value.values });
    if (options.isErr()) {
      return listenErrorLines({ error: options.error });
    }
    return [];
  },
};

const CONTRACTS: Readonly<Record<ListenDeadlineVerb, DeadlineVerbContract>> = {
  listen: LISTEN_CONTRACT,
  "listen recover": RECOVER_CONTRACT,
};

/** One invocation, for the pure-offender fixtures. */
function invocation({
  flags,
  verb = "listen",
}: {
  flags: readonly string[];
  verb?: ListenDeadlineVerb;
}): AdvertisedInvocation {
  return { flags, line: 1, path: "fixture.md", text: `listen ${flags.map((f) => `--${f}`).join(" ")}`, verb };
}

describe("logicalLines", () => {
  it("folds a backslash continuation into the line it continues, keeping the FIRST line number", () => {
    const folded = logicalLines({ content: "one \\\n  two\nthree\n" });
    expect(folded).toEqual([
      { line: 1, text: "one two" },
      { line: 3, text: "three" },
      { line: 4, text: "" },
    ]);
  });

  it("folds a run of continuations, not just one", () => {
    expect(logicalLines({ content: "a \\\nb \\\nc" })).toEqual([{ line: 1, text: "a b c" }]);
  });

  it("keeps a trailing unterminated continuation rather than dropping the line", () => {
    // The final empty line IS the continuation here, so the fold ends with the separating space it added.
    expect(logicalLines({ content: "a \\\n" })).toEqual([{ line: 1, text: "a " }]);
  });
});

describe("bareToken", () => {
  it("strips the backticks prose wraps a command in", () => {
    expect(bareToken({ raw: "`listen" })).toBe("listen");
  });

  it("strips a trailing backtick and the sentence punctuation after it", () => {
    expect(bareToken({ raw: "--deadline-ms`," })).toBe("--deadline-ms");
  });

  it("strips a usage line's square brackets", () => {
    expect(bareToken({ raw: "[--follow]" })).toBe("--follow");
  });

  it("leaves a plain flag alone", () => {
    expect(bareToken({ raw: "--emit" })).toBe("--emit");
  });
});

describe("scanAdvertisedDeadlineInvocations", () => {
  it("takes the flags of a backticked prose invocation and stops at the first prose word", () => {
    const found = scanAdvertisedDeadlineInvocations({
      content: "raced the same way `listen --follow --deadline-ms` already does.\n",
      path: "scheduledRecover.ts",
    });
    expect(found).toEqual([
      {
        flags: ["follow", "deadline-ms"],
        line: 1,
        path: "scheduledRecover.ts",
        text: "listen --follow --deadline-ms",
        verb: "listen",
      },
    ]);
  });

  it("reads `recover` as its own verb, and consumes a multi-token <…> placeholder", () => {
    const found = scanAdvertisedDeadlineInvocations({
      content:
        "slopweaver listen recover --bot-user <the bot's USER id> \\\n  --scheduled --json --deadline-ms <now + 500>\n",
      path: "SKILL.md",
    });
    expect(found.map((one) => one.verb)).toEqual(["listen recover"]);
    expect(found[0]!.flags).toEqual(["bot-user", "scheduled", "json", "deadline-ms"]);
    expect(found[0]!.line).toBe(1);
  });

  it("ignores an invocation that never names --deadline-ms", () => {
    expect(scanAdvertisedDeadlineInvocations({ content: "run `listen --follow` yourself", path: "a.md" })).toEqual([]);
  });

  it("collects nothing from a usage LINE, whose flags are bracketed alternatives rather than a combination", () => {
    const usage = "usage: slopweaver listen [--check] [--once] [--emit] [--json] [--follow] [--deadline-ms <epoch>]";
    expect(scanAdvertisedDeadlineInvocations({ content: usage, path: "core.ts" })).toEqual([]);
  });

  it("ENDS at a bracketed optional, so a line mixing usage syntax with real flags is missed, not judged", () => {
    const mixed = "listen [--follow] --emit --json --deadline-ms <n>";
    expect(scanAdvertisedDeadlineInvocations({ content: mixed, path: "a.md" })).toEqual([]);
  });

  it("reads the same line without the bracket, so the miss above is the BRACKET and nothing else", () => {
    const plain = "listen --follow --emit --json --deadline-ms <n>";
    expect(scanAdvertisedDeadlineInvocations({ content: plain, path: "a.md" })[0]!.flags).toEqual([
      "follow",
      "emit",
      "json",
      "deadline-ms",
    ]);
  });

  it("does not reach past a prose word to absorb a flag named later in the same sentence", () => {
    const line = "the next `listen --deadline-ms` call, unlike `--follow`, returns at once";
    expect(scanAdvertisedDeadlineInvocations({ content: line, path: "a.md" })[0]!.flags).toEqual(["deadline-ms"]);
  });

  it("ends at an UNTERMINATED placeholder, keeping what was read before it", () => {
    const truncated = "listen --emit --json --deadline-ms <epoch and then prose that never closes";
    expect(scanAdvertisedDeadlineInvocations({ content: truncated, path: "a.md" })).toEqual([
      {
        flags: ["emit", "json", "deadline-ms"],
        line: 1,
        path: "a.md",
        text: "listen --emit --json --deadline-ms",
        verb: "listen",
      },
    ]);
  });

  it("is verb-scoped: `events tail --follow --deadline-ms` is a different verb and is never extracted", () => {
    const line = "  --follow              keep reading as the file grows, until interrupted or --deadline-ms elapses.";
    expect(scanAdvertisedDeadlineInvocations({ content: line, path: "tail.ts" })).toEqual([]);
  });

  it("finds two invocations on one line rather than stopping at the first", () => {
    const line = "`listen --deadline-ms` differs from `listen --follow --deadline-ms` entirely";
    expect(scanAdvertisedDeadlineInvocations({ content: line, path: "a.md" }).map((one) => one.flags)).toEqual([
      ["deadline-ms"],
      ["follow", "deadline-ms"],
    ]);
  });
});

describe("deadlineArgvFor", () => {
  it("carries an extra BOOLEAN flag the prose wrote onto the verb's canonical argv", () => {
    expect(
      deadlineArgvFor({ contract: LISTEN_CONTRACT, invocation: invocation({ flags: ["follow", "deadline-ms"] }) }),
    ).toEqual(["--emit", "--json", "--deadline-ms", DEADLINE, "--follow"]);
  });

  it("never repeats a flag the baseline already spells", () => {
    expect(
      deadlineArgvFor({
        contract: LISTEN_CONTRACT,
        invocation: invocation({ flags: ["emit", "json", "deadline-ms"] }),
      }),
    ).toEqual(["--emit", "--json", "--deadline-ms", DEADLINE]);
  });

  it("drops a flag that takes a VALUE — a value is never a mode a validator branches on", () => {
    expect(
      deadlineArgvFor({ contract: LISTEN_CONTRACT, invocation: invocation({ flags: ["queue", "deadline-ms"] }) }),
    ).toEqual(["--emit", "--json", "--deadline-ms", DEADLINE]);
  });
});

describe("listenDeadlineOffenders — against the REAL validators", () => {
  it("reports `listen --follow --deadline-ms`, with the shipped validator's own words", () => {
    const offenders = listenDeadlineOffenders({
      contracts: CONTRACTS,
      invocations: [invocation({ flags: ["follow", "deadline-ms"] })],
    });
    expect(offenders.length).toBe(1);
    expect(offenders[0]!.rejections).toEqual([
      "--deadline-ms is only valid together with --emit --json, and never with --check or --follow",
    ]);
  });

  it("reports `--check` the same way, so the binding is not a one-flag special case", () => {
    const offenders = listenDeadlineOffenders({
      contracts: CONTRACTS,
      invocations: [invocation({ flags: ["check", "deadline-ms"] })],
    });
    expect(offenders[0]!.rejections).toEqual([
      "--deadline-ms is only valid together with --emit --json, and never with --check or --follow",
    ]);
  });

  it("accepts the one-shot invocation this repo settled on", () => {
    expect(
      listenDeadlineOffenders({
        contracts: CONTRACTS,
        invocations: [invocation({ flags: ["emit", "json", "deadline-ms"] })],
      }),
    ).toEqual([]);
  });

  it("accepts a bare `listen --deadline-ms` prose fragment, which advertises no combination at all", () => {
    expect(
      listenDeadlineOffenders({ contracts: CONTRACTS, invocations: [invocation({ flags: ["deadline-ms"] })] }),
    ).toEqual([]);
  });

  it("accepts the scheduled recovery invocation, on its own verb's own validator", () => {
    expect(
      listenDeadlineOffenders({
        contracts: CONTRACTS,
        invocations: [invocation({ flags: ["bot-user", "scheduled", "json", "deadline-ms"], verb: "listen recover" })],
      }),
    ).toEqual([]);
  });
});

describe("formatDeadlineOffender", () => {
  it("prints the site, the advertised text, the argv validated and the refusal", () => {
    const [offender] = listenDeadlineOffenders({
      contracts: CONTRACTS,
      invocations: [invocation({ flags: ["follow", "deadline-ms"] })],
    });
    expect(formatDeadlineOffender({ offender: offender! })).toBe(
      "fixture.md:1  advertises `listen --follow --deadline-ms`\n" +
        `    validated as: --emit --json --deadline-ms ${DEADLINE} --follow\n` +
        "    refused with: --deadline-ms is only valid together with --emit --json, and never with --check or --follow",
    );
  });
});

describe("this repository's own canon and comments", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const readText = ({ path }: { path: string }): string => readFileSync(`${root}/${path}`, "utf8");
  const paths = workingTreeFilesOf({ root }).filter(
    (path) => (path.endsWith(".md") || path.endsWith(".ts")) && !SELF_DECLARING.includes(path),
  );
  const scan = scanTextFiles({ paths, readText, scan: scanAdvertisedDeadlineInvocations });

  it("read every file it selected — a gate reporting clean over an unread file is the defect one level up", () => {
    expect(scan.unreadable).toEqual([]);
    expect(scan.scanned).toBeGreaterThan(0);
  });

  it("still holds a live refused example in each self-excluded file, so the exclusion cannot hide a rot", () => {
    const found = SELF_DECLARING.map((path) => {
      const invocations = scanAdvertisedDeadlineInvocations({ content: readText({ path }), path });
      return listenDeadlineOffenders({ contracts: CONTRACTS, invocations }).length;
    });
    expect(found.length).toBe(2);
    expect(found.filter((count) => count === 0)).toEqual([]);
  });

  it("found the real invocations, so an empty result below is a clean tree and not a broken filter", () => {
    expect(scan.hits.length).toBeGreaterThan(0);
    expect(scan.hits.some((hit) => hit.path === "skills/loop/SKILL.md" && hit.verb === "listen recover")).toBe(true);
    expect(scan.hits.some((hit) => hit.path === "src/cli/commands/listen/scheduledRecover.ts")).toBe(true);
  });

  it("advertises no `listen` invocation the shipped validator refuses", () => {
    const offenders = listenDeadlineOffenders({ contracts: CONTRACTS, invocations: scan.hits });
    expect(offenders.map((offender) => formatDeadlineOffender({ offender }))).toEqual([]);
  });
});
