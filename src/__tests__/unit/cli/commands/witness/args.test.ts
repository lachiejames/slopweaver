import { describe, expect, it } from "vitest";
import {
  parseWitnessDispatchArgs,
  parseWitnessHelpArgs,
  parseWitnessListArgs,
  parseWitnessResumeArgs,
  parseWitnessReviseArgs,
  parseWitnessSettleArgs,
  parseWitnessStandDownArgs,
  WITNESS_FLAG_NAMES,
} from "../../../../../cli/commands/witness/args.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const COORDS = ["--channel", "C0SYN000000001", "--thread-ts", "1789000000.000100", "--message-ts", "1789000000.000200"];
const KEY = { channel: "C0SYN000000001", messageTs: "1789000000.000200", threadTs: "1789000000.000100" };
const ID = "w-0123456789abcdef";

describe("witness dispatch args", () => {
  it("parses a complete invocation", () => {
    const options = unwrap(
      parseWitnessDispatchArgs({ rest: [...COORDS, "--text", "deploy done", "--model", "sonnet"] }),
    );

    expect(options).toEqual({ home: undefined, json: false, key: KEY, model: "sonnet", text: "deploy done" });
  });

  it("requires --model, with no default", () => {
    const problems = unwrapErr(parseWitnessDispatchArgs({ rest: [...COORDS, "--text", "deploy done"] }));

    expect(problems.join("\n")).toContain("--model is required");
  });

  it("refuses a malformed ts", () => {
    const rest = ["--channel", "C1", "--thread-ts", "nope", "--message-ts", "1789000000.000200", "--text", "x"];
    const problems = unwrapErr(parseWitnessDispatchArgs({ rest: [...rest, "--model", "sonnet"] }));

    expect(problems).toEqual(['--thread-ts must be a Slack ts like 1789000000.000100, got "nope"']);
  });
});

describe("witness help args", () => {
  it("parses the witness line's coordinates, author and text", () => {
    const options = unwrap(
      parseWitnessHelpArgs({ rest: [...COORDS, "--user", " U0SYN000000001 ", "--text", "anything I can do?"] }),
    );

    expect(options).toEqual({
      home: undefined,
      request: { key: KEY, text: "anything I can do?", userId: "U0SYN000000001" },
    });
  });

  it("requires the author and the text, naming both at once", () => {
    expect(unwrapErr(parseWitnessHelpArgs({ rest: COORDS }))).toEqual([
      "--user is required — the witness line's userId — who wrote it",
      "--text is required — the witness line's text — what the card opens on",
    ]);
  });

  it("refuses --json, which help never takes: its stdout is always the emitted ask", () => {
    const problems = unwrapErr(parseWitnessHelpArgs({ rest: [...COORDS, "--user", "U1", "--text", "x", "--json"] }));

    expect(problems.join("\n")).toContain("--json");
  });
});

describe("witness resume args", () => {
  it("parses one witness id", () => {
    expect(unwrap(parseWitnessResumeArgs({ rest: [ID] }))).toEqual({ home: undefined, witnessId: ID });
  });

  it("requires an id", () => {
    expect(unwrapErr(parseWitnessResumeArgs({ rest: [] }))).toEqual([
      "a witness id is required — the pickup line names it",
    ]);
  });

  it("refuses something that is not a witness id", () => {
    expect(unwrapErr(parseWitnessResumeArgs({ rest: ["g-1"] })).join("\n")).toContain('"g-1" is not a witness id');
  });
});

describe("witness settle args", () => {
  it("parses a settle by id", () => {
    const options = unwrap(
      parseWitnessSettleArgs({ rest: [ID, "--as", "posted", "--posted-ts", "1789000002.000300"] }),
    );

    expect(options).toEqual({
      home: undefined,
      json: false,
      outcome: "posted",
      postedTs: "1789000002.000300",
      selector: { kind: "id", witnessId: ID },
      why: undefined,
    });
  });

  it("parses a settle by coordinates", () => {
    const options = unwrap(parseWitnessSettleArgs({ rest: [...COORDS, "--as", "nothing-checkable"] }));

    expect(options.selector).toEqual({ key: KEY, kind: "key" });
  });

  it("refuses an id AND coordinates together", () => {
    const problems = unwrapErr(parseWitnessSettleArgs({ rest: [ID, ...COORDS, "--as", "nothing-checkable"] }));

    expect(problems).toEqual(["name the witness by its id OR by --channel/--thread-ts/--message-ts, never both"]);
  });

  it("refuses a partial coordinate triple", () => {
    const problems = unwrapErr(parseWitnessSettleArgs({ rest: ["--channel", "C1", "--as", "nothing-checkable"] }));

    expect(problems).toEqual([
      "--thread-ts is required — the thread the witnessed message sits in",
      "--message-ts is required — the witnessed message's own ts",
    ]);
  });

  it("refuses an outcome outside the closed set", () => {
    const problems = unwrapErr(parseWitnessSettleArgs({ rest: [ID, "--as", "answered"] }));

    expect(problems).toEqual(["--as must be one of nothing-checkable, nothing-material, posted, failed"]);
  });

  it("refuses --as helped, naming the one verb that journals a help", () => {
    const problems = unwrapErr(parseWitnessSettleArgs({ rest: [ID, "--as", "helped"] }));

    expect(problems).toEqual([
      "--as helped is journalled by slopweaver witness help alone, which writes it before the card goes up — " +
        "settle never records a help",
    ]);
  });

  it("refuses --as stood-down, naming the one verb that journals a stand-down", () => {
    const problems = unwrapErr(parseWitnessSettleArgs({ rest: [ID, "--as", "stood-down"] }));

    expect(problems).toEqual([
      "--as stood-down is journalled by slopweaver witness stand-down alone, which puts the reaction on the " +
        "message first — settle never records one",
    ]);
  });
});

describe("witness stand-down args", () => {
  it("parses the message's coordinates and a trimmed why", () => {
    const options = unwrap(parseWitnessStandDownArgs({ rest: [...COORDS, "--why", " told to shut up "] }));

    expect(options).toEqual({ home: undefined, request: { key: KEY, why: "told to shut up" }, scope: "message" });
  });

  it("reads no --message-ts as a whole-thread stand-down, tied to no message", () => {
    const rest = ["--channel", "C0SYN000000001", "--thread-ts", "1789000000.000100", "--why", " owner: stop "];

    expect(unwrap(parseWitnessStandDownArgs({ rest }))).toEqual({
      home: undefined,
      request: { channel: "C0SYN000000001", threadTs: "1789000000.000100", why: "owner: stop" },
      scope: "thread",
    });
  });

  it("requires the thread and a non-blank why", () => {
    expect(unwrapErr(parseWitnessStandDownArgs({ rest: ["--channel", "C1", "--why", "  "] }))).toEqual([
      "--thread-ts is required — the thread to stand down (add --message-ts to react on one message)",
      "--why is required — what was said that told the bot to stand down",
    ]);
  });

  it("still requires --thread-ts beside a --message-ts", () => {
    const rest = ["--channel", "C1", "--message-ts", "1789000000.000200", "--why", "x"];

    expect(unwrapErr(parseWitnessStandDownArgs({ rest }))).toEqual([
      "--thread-ts is required — the thread the witnessed message sits in",
    ]);
  });

  it("refuses --json, which stand-down never takes", () => {
    expect(unwrapErr(parseWitnessStandDownArgs({ rest: [...COORDS, "--why", "x", "--json"] })).join("\n")).toContain(
      "--json",
    );
  });
});

describe("witness list args", () => {
  it("parses --home and --json", () => {
    expect(unwrap(parseWitnessListArgs({ rest: ["--home", "/tmp/h", "--json"] }))).toEqual({
      home: "/tmp/h",
      json: true,
    });
  });
});

describe("witness revise args", () => {
  const PERMALINK = "https://example.slack.com/archives/C0SYN000000001/p1789000000000300";
  const FLAGS = ["--wrong", "the deploy finished", "--correction", "it rolled back.", "--because", PERMALINK];

  it("parses a complete invocation, keeping --wrong exactly as given", () => {
    expect(unwrap(parseWitnessReviseArgs({ rest: [ID, ...FLAGS, "--dry-run"] }))).toEqual({
      home: undefined,
      request: {
        because: PERMALINK,
        correction: "it rolled back.",
        dryRun: true,
        witnessId: ID,
        wrong: "the deploy finished",
      },
    });
  });

  it("requires the witness id", () => {
    expect(unwrapErr(parseWitnessReviseArgs({ rest: FLAGS }))).toEqual([
      "a witness id is required — the posted witness to revise (slopweaver witness list)",
    ]);
  });

  it("refuses a --because that is not a Slack permalink", () => {
    const rest = [ID, "--wrong", "x", "--correction", "y.", "--because", "see above"];
    expect(unwrapErr(parseWitnessReviseArgs({ rest }))).toEqual([
      '--because must be a Slack message permalink, got "see above"',
    ]);
  });

  it("takes no target of the caller's: --ts is not a flag it knows", () => {
    expect(
      unwrapErr(parseWitnessReviseArgs({ rest: [ID, ...FLAGS, "--ts", "1789000000.000300"] })).join("\n"),
    ).toContain("--ts");
  });
});

describe("WITNESS_FLAG_NAMES", () => {
  it("lists every verb's accepted flags", () => {
    expect(WITNESS_FLAG_NAMES).toEqual({
      dispatch: ["--channel", "--home", "--json", "--message-ts", "--model", "--text", "--thread-ts"],
      help: ["--channel", "--home", "--message-ts", "--text", "--thread-ts", "--user"],
      list: ["--home", "--json"],
      resume: ["--home"],
      revise: ["--because", "--correction", "--dry-run", "--home", "--wrong"],
      settle: ["--as", "--channel", "--home", "--json", "--message-ts", "--posted-ts", "--thread-ts", "--why"],
      "stand-down": ["--channel", "--home", "--message-ts", "--thread-ts", "--why"],
    });
  });
});
