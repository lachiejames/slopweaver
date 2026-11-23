/**
 * The `onboard` shell, driven through plain fakes — no terminal, no readline, no mocks.
 *
 * The behaviours worth proving are the ones a human could not notice: that a non-interactive run asks
 * nothing instead of hanging, that an invalid answer is re-asked a BOUNDED number of times, that `--json`
 * never mixes a question into a machine lane, and that stdin is always released.
 */
import { describe, expect, it } from "vitest";

import { MAX_ANSWER_ATTEMPTS, type OnboardDeps, runOnboardWith } from "../../../../../cli/commands/onboard/run.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** What one fake run recorded. */
interface Recorded {
  readonly out: string[];
  readonly errors: string[];
  readonly prompts: string[];
  readonly closes: number[];
}

/** Build the deps over a scripted list of answers. */
function fakeDeps({ answers, isTty }: { answers: readonly string[]; isTty: boolean }): {
  deps: OnboardDeps;
  recorded: Recorded;
} {
  const recorded: Recorded = { closes: [], errors: [], out: [], prompts: [] };
  let next = 0;
  const deps: OnboardDeps = {
    ask: ({ prompt }) => {
      recorded.prompts.push(prompt);
      // Asserted rather than defaulted: a run that asks more questions than the test scripted answers for
      // is a behaviour change, and it should fail here rather than be papered over with an empty answer.
      const answer = answers[next]!;
      next += 1;
      return Promise.resolve(answer);
    },
    close: () => {
      recorded.closes.push(recorded.prompts.length);
    },
    isTty: () => isTty,
    logger: {
      error: ({ msg }) => {
        recorded.errors.push(msg);
      },
      out: ({ line }) => {
        recorded.out.push(line);
      },
    },
  };
  return { deps, recorded };
}

/** Run the verb with a scripted terminal, returning the exit code and everything it recorded. */
async function run({
  args,
  answers = [],
  isTty = true,
}: {
  args: readonly string[];
  answers?: readonly string[];
  isTty?: boolean;
}): Promise<{ code: number; recorded: Recorded }> {
  const { deps, recorded } = fakeDeps({ answers, isTty });
  const code = await runOnboardWith({ argv: ["node", "slopweaver", "onboard", ...args], deps });
  return { code, recorded };
}

describe("asking", () => {
  it("asks both questions on a terminal, in the order app name then tier", async () => {
    const { code, recorded } = await run({ answers: ["Team Brain", "restricted"], args: [] });

    expect(code).toBe(EXIT_OK);
    expect(recorded.prompts.length).toBe(2);
    expect(recorded.prompts[0]).toContain("What should the Slack app be called?");
    expect(recorded.prompts[1]).toContain("Which tier?");
  });

  it("uses what was typed, and says the user chose it", async () => {
    const { recorded } = await run({ answers: ["Team Brain", "restricted"], args: [] });
    const text = recorded.out.join("\n");

    expect(text).toContain('"name": "Team Brain"');
    expect(text).toContain("tier      restricted    (you chose this — --tier)");
  });

  it("treats a bare Enter as the recommended tier, and SAYS it was the default", async () => {
    const { recorded } = await run({ answers: ["", ""], args: [] });
    const text = recorded.out.join("\n");

    expect(text).toContain("tier      agent         (the default — --tier)");
    expect(text).toContain('"name": "Slopweaver"');
  });

  it("asks nothing when both answers were given as flags", async () => {
    const { code, recorded } = await run({ args: ["--tier", "restricted", "--app-name", "Team Brain"] });

    expect(code).toBe(EXIT_OK);
    expect(recorded.prompts).toEqual([]);
    expect(recorded.out.join("\n")).toContain("(from the flag — --tier)");
  });

  it("asks only the question the flags left open", async () => {
    const { recorded } = await run({ answers: ["restricted"], args: ["--app-name", "Team Brain"] });

    expect(recorded.prompts.length).toBe(1);
    expect(recorded.prompts[0]).toContain("Which tier?");
  });
});

describe("a run with nothing to answer it", () => {
  it("takes the defaults instead of hanging when stdin is not a terminal", async () => {
    const { code, recorded } = await run({ args: [], isTty: false });

    expect(code).toBe(EXIT_OK);
    expect(recorded.prompts).toEqual([]);
    expect(recorded.out.join("\n")).toContain("tier      agent         (the default — --tier)");
  });

  it("asks nothing under --json, so a machine lane never gets a question in its output", async () => {
    const { code, recorded } = await run({ args: ["--json"] });

    expect(code).toBe(EXIT_OK);
    expect(recorded.prompts).toEqual([]);
    expect(recorded.out.length).toBe(1);
  });

  it("emits a single JSON document carrying the manifest", async () => {
    const { recorded } = await run({ args: ["--json", "--tier", "restricted"] });
    const parsed: unknown = JSON.parse(recorded.out[0]!);

    expect(parsed).toMatchObject({ answers: { appName: "Slopweaver", tier: "restricted" } });
  });
});

describe("an answer it cannot use", () => {
  it("re-asks after an invalid tier, reporting why", async () => {
    const { code, recorded } = await run({ answers: ["Team Brain", "readonly", "restricted"], args: [] });

    expect(code).toBe(EXIT_OK);
    expect(recorded.prompts.length).toBe(3);
    expect(recorded.errors[0]).toContain("unrecognised tier: readonly");
  });

  it("gives up after a BOUNDED number of invalid answers rather than looping forever", async () => {
    const { code, recorded } = await run({
      answers: ["Slopweaver", "nope", "nope", "nope", "nope"],
      args: [],
    });

    expect(code).toBe(EXIT_USAGE);
    expect(recorded.prompts.length).toBe(1 + MAX_ANSWER_ATTEMPTS);
    expect(recorded.errors.filter((msg) => msg.includes('gave up on "tier"'))).toEqual([
      `gave up on "tier" after ${String(MAX_ANSWER_ATTEMPTS)} invalid answers`,
    ]);
  });

  it("refuses a bad --tier flag outright rather than falling back to the default", async () => {
    const { code, recorded } = await run({ args: ["--tier", "readonly"], isTty: false });

    expect(code).toBe(EXIT_USAGE);
    expect(recorded.out).toEqual([]);
    expect(recorded.errors[0]).toContain("unrecognised tier: readonly");
  });

  it("refuses an unknown flag and prints the usage", async () => {
    const { code, recorded } = await run({ args: ["--workspace", "acme"] });

    expect(code).toBe(EXIT_USAGE);
    expect(recorded.errors[0]).toBe("unknown flag: --workspace");
    expect(recorded.errors.at(-1)).toContain("usage: slopweaver onboard");
  });
});

describe("the shell's contract", () => {
  it("releases stdin on every path, including the one that gave up", async () => {
    const asked = await run({ answers: ["", ""], args: [] });
    const flagged = await run({ args: ["--tier", "agent"], isTty: false });
    const failed = await run({ answers: ["", "nope", "nope", "nope"], args: [] });

    expect(asked.recorded.closes.length).toBe(1);
    expect(flagged.recorded.closes.length).toBe(1);
    expect(failed.recorded.closes.length).toBe(1);
  });

  it("prints the usage and exits clean on --help, asking nothing", async () => {
    const { code, recorded } = await run({ args: ["--help"] });

    expect(code).toBe(EXIT_OK);
    expect(recorded.prompts).toEqual([]);
    expect(recorded.out[0]).toContain("usage: slopweaver onboard");
  });

  it("accepts the explicit `run` verb identically to the bare noun", async () => {
    const bare = await run({ args: ["--tier", "agent"], isTty: false });
    const explicit = await run({ args: ["run", "--tier", "agent"], isTty: false });

    expect(explicit.code).toBe(EXIT_OK);
    expect(explicit.recorded.out).toEqual(bare.recorded.out);
  });
});
