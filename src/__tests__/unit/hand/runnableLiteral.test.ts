/*
 * A hand step never carries a command the fleet can run (the owner's rule). Every literal below is one the
 * hand register actually carried, home paths shortened: the refused ones put a command the owner did not need to run on
 * the owner's pasteboard, the passing ones need the owner's secret, the owner's approval, a grant only the owner's account holds, or a sign-in
 * listener that must live in the owner's own terminal.
 */
import { describe, expect, it } from "vitest";

import {
  fleetRunnableLiteral,
  fleetRunnableSegment,
  isShellCommand,
  OWNER_HANDS_COMMANDS,
  whereKind,
} from "../../../hand/runnableLiteral.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A step built by the real builder, carrying the literal and where a case gives it. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "dd-backtest-shot-signin",
        postedBy: "workspace:12",
        postedIso: "2026-10-01T10:34:58.274Z",
        unblocks: "backtest-shot capture for the monitor port pull requests",
        what: "Sign in to Datadog once in the browser window this command opens",
        where: "a terminal",
        witness: "slopweaver hand done dd-backtest-shot-signin --did signed-in",
        ...over,
      },
    }),
  );
}

describe("fleetRunnableLiteral", () => {
  it.each([
    [
      "the backtest-shot sign-in",
      "yarn nx run @acme/cloud-datadog:backtest-shot -- --login --profile /Users/owner/.agents/out/profile",
      "yarn nx run @acme/cloud-datadog:backtest-shot -- --login --profile /Users/owner/.agents/out/profile",
    ],
    [
      "its re-cut behind a cd",
      "cd /Users/owner/dev/acme-admin && yarn nx run @acme/cloud-datadog:backtest-shot -- --login",
      "yarn nx run @acme/cloud-datadog:backtest-shot -- --login",
    ],
    [
      "the resync pin",
      "/Users/owner/.slopweaver/chrome-pin.sh https://go.xero.com",
      "/Users/owner/.slopweaver/chrome-pin.sh https://go.xero.com",
    ],
    [
      "a Slack delete",
      "slopweaver slack delete --channel C0SYN000006 --ts 1789960189.076859",
      "slopweaver slack delete --channel C0SYN000006 --ts 1789960189.076859",
    ],
    ["a handover resume", "slopweaver handover resume store-backup", "slopweaver handover resume store-backup"],
  ])("refuses %s, naming the segment the fleet can run", (_case, literal, segment) => {
    expect(fleetRunnableSegment({ literal })).toBe(segment);
    // The refusal quotes the segment from its first word, capped at 100 characters.
    expect(fleetRunnableLiteral({ step: step({ literal }) })!.message).toContain(`(\`${segment.slice(0, 50)}`);
  });

  it("reads a $'…' word decoded, so an encoded fleet command is refused and an encoded sign-in of the owner's passes", () => {
    expect([
      fleetRunnableSegment({ literal: "$'\\x73lopweaver' handover resume store-backup" }),
      fleetRunnableSegment({ literal: "bash -c $'\\x73lopweaver handover resume store-backup'" }),
      fleetRunnableSegment({ literal: "$'\\x67cloud' auth application-default login" }),
    ]).toEqual(["slopweaver handover resume store-backup", "slopweaver handover resume store-backup", undefined]);
  });

  it("refuses a runnable command pasted with its shell prompt's marker", () => {
    const literal = "$ yarn nx run @acme/cloud-datadog:backtest-shot -- --login";
    expect(fleetRunnableLiteral({ step: step({ literal, where: "any terminal" }) })!.message).toContain(
      "(`yarn nx run @acme/cloud-datadog:backtest-shot -- --login`)",
    );
  });

  it("says what to do instead — run it, then post only the sign-in in the window it opened", () => {
    const refused = fleetRunnableLiteral({ step: step({ literal: "slopweaver handover resume store-backup" }) })!;
    expect(refused.message).toBe(
      "literal is a command the fleet can run itself (`slopweaver handover resume store-backup`) — run it from the " +
        "session, in the background when it waits on the owner (a browser it opens for a sign-in), then post only what is " +
        "left for the owner's hands: sign in in the window it opened, with --opened <the page> and --where naming that " +
        "window. A literal command carries only the owner's secret, password or approval, a grant only the owner's " +
        "account holds, or a sign-in listener that must live in the owner's own terminal (OWNER_HANDS_COMMANDS, src/hand/runnableLiteral.ts)",
    );
  });

  it.each([
    ["the owner's password", "sudo killall fseventsd"],
    [
      "the owner's password, wrapping a shell",
      "sudo /bin/sh -c '/bin/launchctl disable system/com.apple.metadata.mds || exit 1'",
    ],
    ["the owner's 1Password", "op account add --shorthand atlas"],
    ["a secret only the owner has", "slopweaver secrets set openai-api-key"],
    [
      "a secret, through a worktree's own bin",
      "/Users/owner/dev/slopweaver/.claude/worktrees.noindex/x/bin/slopweaver secrets set onepassword-atlas-password",
    ],
    ["the owner's approval token", "slopweaver slack post --as me --draft sd-f22b82b2 --approve 40490b98f3c438fee50b"],
    ["the Google Cloud sign-in", "gcloud auth login"],
    ["the application-default sign-in", "gcloud auth application-default login"],
    [
      "the application-default sign-in under a config path with a space",
      "CLOUDSDK_CONFIG='/Users/owner/My Config' gcloud auth application-default login",
    ],
    [
      "a Codex sign-in that creates its home first",
      "mkdir -p /Users/owner/.codex-one && CODEX_HOME=/Users/owner/.codex-one codex login",
    ],
    [
      "an IAM grant only the owner's account holds",
      "gcloud storage buckets add-iam-policy-binding gs://bucket --member x",
    ],
    [
      "two Codex sign-ins, chained",
      "CODEX_HOME=/Users/owner/.codex-one codex login; CODEX_HOME=/Users/owner/.codex-two codex login",
    ],
    ["a GitHub CLI scope refresh", "gh auth refresh -h github.com -s workflow"],
    ["a Claude sign-out ahead of a sign-in", "env -u CLAUDE_SECURESTORAGE_CONFIG_DIR claude auth logout"],
    ["a Claude plan sign-in", "/Users/owner/dev/slopweaver/bin/slopweaver claude signin --plan plan-one"],
    ["a Codex sign-in behind an export", "export CODEX_HOME=~/.codex-2; codex login"],
    ["a secret fed from the owner's pasteboard", "pbpaste | slopweaver secrets set openai-api-key"],
    ["a secret fed by printf", "printf %s 'tok' | slopweaver secrets set openai-api-key"],
    ["a sign-in under a comment line", "# paste this\ngcloud auth login"],
    ["a sign-in in a subshell", "(cd ~ && codex login)"],
    ["a secret through npx", "npx slopweaver secrets set openai-api-key"],
    ["a secret through yarn", "yarn slopweaver secrets set openai-api-key"],
    ["a sign-in under a $0 wrapper", "sh -c 'codex login' sh"],
  ])("passes %s", (_case, literal) => {
    expect(fleetRunnableLiteral({ step: step({ literal }) })).toBeUndefined();
  });

  it.each([
    ["a voice phrase", "what did I say about the codex cap today?", "the console voice"],
    ["an approval code", "123456", "the prompt on the laptop"],
    ["an email block", "email: owner+slopweaver@example.com   sign-in address: team.1password.com", "1Password's form"],
  ])("passes %s, which is a value the owner pastes and no command", (_case, literal, where) => {
    expect(fleetRunnableLiteral({ step: step({ literal, where }) })).toBeUndefined();
  });

  it("passes a step with no literal at all", () => {
    expect(fleetRunnableLiteral({ step: step({ literal: undefined }) })).toBeUndefined();
  });
});

describe("isShellCommand", () => {
  it("reads a program-shaped line as a command when its where sends the owner to a terminal", () => {
    expect(isShellCommand({ literal: "backtest-shot --login", where: "your own terminal" })).toBe(true);
  });

  it("reads a single word as a value, even at a terminal prompt, unless it is a known program", () => {
    expect([
      isShellCommand({ literal: "y", where: "the prompt in your terminal" }),
      isShellCommand({ literal: "owner@example.com", where: "the shell's login prompt" }),
      isShellCommand({ literal: "/Users/owner/Downloads/report.pdf", where: "the file picker" }),
      isShellCommand({ literal: "codex", where: "your terminal" }),
    ]).toEqual([false, false, false, true]);
  });

  it("reads a known program with a shell's shape as a command even when where names no command line", () => {
    expect([
      isShellCommand({ literal: "curl -fsS https://x", where: "the acme-admin checkout" }),
      isShellCommand({ literal: "open ~/.slopweaver/pages/x/index.html", where: "the Queue" }),
      isShellCommand({ literal: "open file:///Users/x/pages/y/index.html", where: "the Queue" }),
      isShellCommand({ literal: "slopweaver handover resume x", where: "the supervisor chat" }),
    ]).toEqual([true, true, true, true]);
  });

  it("reads a value opening on a known program's name as a value outside a command line, four cases", () => {
    expect([
      isShellCommand({
        literal: "slopweaver gmail desktop",
        where: "the OAuth client name field in the Google Cloud console",
      }),
      isShellCommand({ literal: "gcloud adc acme-admin", where: "the key description field" }),
      isShellCommand({ literal: "git is down for maintenance", where: "your Slack status" }),
      isShellCommand({ literal: "node 22 upgrade", where: "the Linear issue title" }),
    ]).toEqual([false, false, false, false]);
  });

  it("reads punctuation in a value as no shell syntax, five cases", () => {
    expect([
      isShellCommand({ literal: "node 22 -> 24 upgrade", where: "the Linear issue title field" }),
      isShellCommand({ literal: "claude <> slack integration", where: "the Notion page title" }),
      isShellCommand({ literal: "docker hub; read-only", where: "the token description" }),
      isShellCommand({ literal: "curl rate limits / retries", where: "the Linear issue title" }),
      isShellCommand({ literal: "git outage, see https://www.githubstatus.com", where: "your Slack status" }),
      isShellCommand({ literal: "git is back, thanks", where: "the Slack reply box in the supervisor-fleet thread" }),
    ]).toEqual([false, false, false, false, false, false]);
  });

  it("reads a flag past a known program's first argument, and a where's subject, as no command line, five cases", () => {
    expect([
      isShellCommand({ literal: "git push --force is blocked on main", where: "the Linear issue title field" }),
      isShellCommand({ literal: "node ~2 rollout", where: "the Linear project name" }),
      isShellCommand({
        literal: "cmux sidebar drops rows on reload",
        where: "the Linear issue title for the cmux sidebar bug",
      }),
      isShellCommand({ literal: "shell hook hangs", where: "the Linear issue title for the shell hook bug" }),
      isShellCommand({ literal: "correct horse battery staple", where: "the passphrase prompt in your terminal" }),
    ]).toEqual([false, false, false, false, false]);
  });

  it("reads the owner's word in the supervisor chat as words, a tool's name opening it included", () => {
    expect([
      isShellCommand({ literal: "merge #403 tonight", where: "the supervisor chat" }),
      isShellCommand({ literal: "go ahead with option B", where: "the supervisor" }),
      isShellCommand({ literal: "codex review it first, then land it", where: "the supervisor chat" }),
      isShellCommand({ literal: "open a draft PR for it", where: "the supervisor chat" }),
      isShellCommand({ literal: "slopweaver PRs can auto-merge", where: "the supervisor chat" }),
      isShellCommand({ literal: "~/dev/acme-admin is the checkout to use", where: "the supervisor chat" }),
    ]).toEqual([false, false, false, false, false, false]);
  });

  it("reads a real slopweaver verb as a command anywhere, the supervisor chat included", () => {
    expect([
      isShellCommand({ literal: "slopweaver handover resume x", where: "the supervisor chat" }),
      isShellCommand({ literal: "npx slopweaver slack delete x", where: "the Queue" }),
      isShellCommand({ literal: "slopweaver gmail desktop", where: "the OAuth client name field" }),
    ]).toEqual([true, true, false]);
  });

  it("reads a flag straight after a known program as a command wherever it is pasted — the residue the rule names", () => {
    expect(isShellCommand({ literal: "curl -k removed from the health check", where: "the PR title" })).toBe(true);
  });

  it("reads a known program as a command behind a terminal by any name, a prompt mentioned or not", () => {
    expect([
      isShellCommand({ literal: "slopweaver gmail connect", where: "your terminal; it will prompt you" }),
      isShellCommand({ literal: "slopweaver handover resume x", where: "any command line" }),
      isShellCommand({ literal: "yarn nx run x", where: "a cmux pane" }),
      isShellCommand({ literal: "yarn nx run x", where: "iTerm" }),
      isShellCommand({ literal: "slopweaver handover resume x", where: "the supervisor" }),
      isShellCommand({ literal: "make deploy", where: "the terminal prompt" }),
    ]).toEqual([true, true, true, true, true, true]);
  });

  it("reads what the owner types at a program's prompt as a value, and a versioned program as a program", () => {
    expect([
      isShellCommand({ literal: "fix the flaky staging test", where: "the commit message prompt in your terminal" }),
      isShellCommand({ literal: "python3.11 -m pip install requests", where: "your terminal" }),
    ]).toEqual([false, true]);
  });

  it("reads a script's path or an environment assignment as a command, and any path behind a terminal", () => {
    expect([
      isShellCommand({ literal: "/Users/owner/.slopweaver/chrome-pin.sh https://x", where: undefined }),
      isShellCommand({ literal: "CODEX_HOME=/x codex login", where: undefined }),
      isShellCommand({ literal: "$HOME/bin/reseed --all", where: "your own terminal" }),
    ]).toEqual([true, true, true]);
  });

  it("reads a price, a file to pick and a host with an address as values, the r3 review's three", () => {
    expect([
      isShellCommand({ literal: "$155/month for the Standard plan", where: "the Slack thread" }),
      isShellCommand({ literal: "/Users/x/report final.pdf", where: "the file picker" }),
      isShellCommand({
        literal: "acme.1password.com owner@example.com",
        where: "the op prompt in your terminal",
      }),
    ]).toEqual([false, false, false]);
  });

  it("reads a sentence as no command", () => {
    expect(isShellCommand({ literal: "Payment was not approved on chatgpt.com", where: "the console" })).toBe(false);
  });
});

describe("whereKind", () => {
  it.each([
    ["Your own terminal — it opens the page in your work Chrome profile", "terminal"],
    ["paste it in any terminal", "terminal"],
    ["Run in a terminal", "terminal"],
    ["the acme-admin checkout, in a terminal", "terminal"],
    ["the shell prompt in any terminal", "terminal"],
    ["a cmux pane in acme-admin", "terminal"],
    ["another terminal", "terminal"],
    ["the acme-admin checkout's terminal", "terminal"],
    ["a zsh session in acme-admin", "terminal"],
    ["the supervisor chat; the daily store backup stopped firing", "page"],
    ["the GitHub issue body, pasted from your terminal", "page"],
    ["the commit message prompt in your terminal", "page"],
    ["the terminal passphrase prompt", "page"],
    ["the supervisor-fleet Slack thread", "page"],
    ["the terminal-access request form in Vanta", "page"],
    ["the cmux workspace name field", "page"],
    ["the Linear issue title for the cmux sidebar bug", "page"],
    ["the Queue", "page"],
  ])("reads %s as a %s", (where, kind) => {
    expect(whereKind({ where })).toBe(kind);
  });
});

describe("OWNER_HANDS_COMMANDS", () => {
  it("declares every row once, each with a reason", () => {
    expect(OWNER_HANDS_COMMANDS.length).toBeGreaterThan(0);
    const ids = OWNER_HANDS_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
