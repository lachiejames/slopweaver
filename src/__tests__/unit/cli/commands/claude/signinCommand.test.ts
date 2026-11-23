import { describe, expect, it } from "vitest";

import { ClaudeCommandErrors } from "../../../../../cli/commands/claude/errors.js";
import {
  CLAUDE_SIGNIN_FLAG_NAMES,
  parseClaudeSigninArgs,
  signinRoute,
} from "../../../../../cli/commands/claude/signinArgs.js";
import { claudeSigninCommand, loginLaunchRefusal } from "../../../../../cli/commands/claude/signinRun.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseClaudeSigninArgs", () => {
  it("defaults to the walk: no status, no page, no json, nothing narrowed", () => {
    const args = unwrap(parseClaudeSigninArgs({ rest: [] }));

    expect(args.wantsStatus).toBe(false);
    expect(args.wantsPage).toBe(false);
    expect(args.wantsJson).toBe(false);
    expect(args.only).toBeUndefined();
    expect(args.enroll).toBeUndefined();
    expect(args.reenroll).toBeUndefined();
  });

  it("reads the narrowing flags", () => {
    const args = unwrap(parseClaudeSigninArgs({ rest: ["--plan", "plan-two"] }));

    expect(args.only).toBe("plan-two");
  });

  it("reads the page target", () => {
    const args = unwrap(parseClaudeSigninArgs({ rest: ["--page", "--out", "/tmp/x.html"] }));

    expect(args.wantsPage).toBe(true);
    expect(args.out).toBe("/tmp/x.html");
  });

  // A trailing `--plan` is the shape that shipped a whole-fleet probe under a narrowing flag on `claude
  // gauge`. Going through `parseFlags` rather than scanning argv is what makes it a rejection here.
  it("REFUSES a trailing --plan rather than silently widening to every store", () => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--plan"] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.flagsRefused({ reasons: ["--plan requires a value"] }));
  });

  it("refuses signing in and enrolling in one invocation, since they are different acts", () => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--plan", "plan-two", "--enroll", "plan-three"] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.planAndEnrollTogether());
    expect(problems.message).toBe(
      "`--plan` signs a store in and `--enroll` binds one already live; pass one, not both",
    );
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--force"] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.flagsRefused({ reasons: ["unknown flag: --force"] }));
  });

  it("reads the deliberate re-enroll", () => {
    expect(unwrap(parseClaudeSigninArgs({ rest: ["--reenroll", "plan-two"] })).reenroll).toEqual(["plan-two"]);
  });

  it("reads several stores to re-enroll together, since a swap among them is one act", () => {
    const args = unwrap(parseClaudeSigninArgs({ rest: ["--reenroll", "plan-two, plan-three,plan-four"] }));

    expect(args.reenroll).toEqual(["plan-two", "plan-three", "plan-four"]);
  });

  it("REFUSES a repeated --reenroll, which the stdlib parser would collapse to its last value", () => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--reenroll", "plan-two", "--reenroll", "plan-three"] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.reenrollRepeated());
    expect(problems.message).toBe(
      "`--reenroll` takes one comma-separated list; pass it once, e.g. --reenroll plan-two,plan-three",
    );
  });

  it("REFUSES an empty entry in the list rather than guessing what was meant", () => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--reenroll", "plan-two,,plan-three"] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.reenrollEmptyEntry({ got: "plan-two,,plan-three" }));
    expect(problems.message).toBe(
      "`--reenroll` names stores as a comma-separated list with no empty entry, e.g. plan-two,plan-three",
    );
  });

  it("REFUSES a trailing --reenroll that names no store", () => {
    expect(unwrapErr(parseClaudeSigninArgs({ rest: ["--reenroll"] }))).toStrictEqual(
      ClaudeCommandErrors.flagsRefused({ reasons: ["--reenroll requires a value"] }),
    );
  });

  // A replacement riding along with any other flag would be one act the operator did not look at. Every
  // pairing is refused with the same line, so there is no combination in which `--reenroll` is half-read.
  it.each([
    ["--enroll", "plan-three"],
    ["--plan", "plan-three"],
    ["--out", "/tmp/x.html"],
    ["--status"],
    ["--page"],
    ["--json"],
  ])("REFUSES --reenroll alongside %s", (...pairing) => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--reenroll", "plan-two", ...pairing] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.reenrollNotAlone());
    expect(problems.message).toBe("`--reenroll` deliberately replaces standing enrollments; pass it on its own");
  });

  // MEASURED: `--status --plan plan-five` routed to the sign-in and launched `claude auth login`,
  // opening a browser tab for a session that asked only to read. A read beside a store act is refused outright.
  it.each([["--status"], ["--json"], ["--page"], ["--out", "/tmp/x.html"]])(
    "REFUSES the read flag %s beside --plan, so a read can never launch a sign-in",
    (...read) => {
      const problems = unwrapErr(parseClaudeSigninArgs({ rest: [...read, "--plan", "plan-five"] }));

      expect(problems).toStrictEqual(ClaudeCommandErrors.readBesideStoreAct({ flag: "--plan" }));
      expect(problems.code).toBe("FLAG_COMBINATION_REFUSED");
    },
  );

  it.each([["--status"], ["--json"], ["--page"], ["--out", "/tmp/x.html"]])(
    "REFUSES the read flag %s beside --enroll",
    (...read) => {
      const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--enroll", "plan-five", ...read] }));

      expect(problems).toStrictEqual(ClaudeCommandErrors.readBesideStoreAct({ flag: "--enroll" }));
    },
  );

  it("REFUSES --out without --page, which would otherwise fall through to the sign-in walk", () => {
    const problems = unwrapErr(parseClaudeSigninArgs({ rest: ["--out", "/tmp/x.html"] }));

    expect(problems).toStrictEqual(ClaudeCommandErrors.outWithoutPage());
  });
});

describe("loginLaunchRefusal", () => {
  it("lets a login launch when a terminal sits on stdin, which narrows the launch and proves no human", () => {
    expect(loginLaunchRefusal({ stdinIsTty: true })).toBeUndefined();
  });

  it("refuses a login from a process with no terminal, since `claude auth login` opens a browser", () => {
    expect(loginLaunchRefusal({ stdinIsTty: false })).toContain("refused to launch `claude auth login`");
  });
});

describe("signinRoute", () => {
  const routeOf = ({ rest }: { rest: readonly string[] }): ReturnType<typeof signinRoute> =>
    signinRoute({ args: unwrap(parseClaudeSigninArgs({ rest })) });

  it("sends --reenroll, and only --reenroll, down the replacing path", () => {
    expect(routeOf({ rest: ["--reenroll", "plan-two"] })).toEqual({ aliases: ["plan-two"], kind: "reenroll" });
    expect(routeOf({ rest: ["--enroll", "plan-two"] })).toEqual({ alias: "plan-two", kind: "enroll" });
    expect(routeOf({ rest: ["--plan", "plan-two"] })).toEqual({ alias: "plan-two", kind: "plan" });
    expect(routeOf({ rest: ["--status"] })).toEqual({ kind: "report" });
    expect(routeOf({ rest: [] })).toEqual({ kind: "walk" });
  });
});

describe("the advertised flags", () => {
  it("are derived from the spec the parser actually uses", () => {
    expect([...CLAUDE_SIGNIN_FLAG_NAMES].toSorted()).toEqual([
      "--enroll",
      "--json",
      "--out",
      "--page",
      "--plan",
      "--reenroll",
      "--status",
    ]);
  });

  it("every advertised flag parses", () => {
    expect(CLAUDE_SIGNIN_FLAG_NAMES.length).toBeGreaterThan(0);
    for (const flag of CLAUDE_SIGNIN_FLAG_NAMES) {
      const valued = ["--plan", "--enroll", "--reenroll", "--out"].includes(flag) ? [flag, "value"] : [flag];
      // `--out` only names where `--page` writes, so it is advertised as `--page`'s companion.
      const rest = flag === "--out" ? ["--page", ...valued] : valued;
      expect(parseClaudeSigninArgs({ rest }).isOk()).toBe(true);
    }
  });
});

describe("the command module", () => {
  // The manifest dispatches this export directly, so what matters is that it is callable and takes an argv.
  // Asserting its arity rather than its typeof keeps the claim about the real contract.
  it("is wired to a runner the manifest can dispatch", () => {
    expect(claudeSigninCommand.length).toBe(1);
  });
});
