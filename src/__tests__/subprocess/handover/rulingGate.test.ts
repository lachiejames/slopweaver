/**
 * The whole seam, against the SHIPPED binary: record a ruling with a gate, watch a real verb refuse, release
 * it, watch the same verb run.
 *
 * ## Why a subprocess test and not more unit cases
 *
 * `unit/handover/rulingGate.test.ts` proves the verdict; `unit/cli/mainGatePlacement.test.ts` proves the call
 * sits above the route-kind branch. Neither can prove that `slopweaver <noun> <verb>` actually refuses — the
 * gate is read off disk, by a projection a different verb wrote, in a process that resolved its own home.
 * Each of those three is a place the wiring could be absent while every judgement is perfect. AGENTS.md:
 * prove real seams end-to-end, run the CLI, hit the real path.
 *
 * ## The falsifiable witness
 *
 * A "it refused" assertion proves nothing on its own — a verb that had simply failed for an unrelated reason
 * would satisfy it. So the same home, with the gate RELEASED and nothing else changed, must let the same
 * invocation through. The pair is the evidence; either half alone is not.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { CALLER_GATE_HOMES_ENV } from "../../../cli/callerGateHomesEnv.js";
import { accountSandboxChildEnv } from "../../accountHomeSandboxChild.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");

/** Spawning the real CLI four times over is slow; give the suite room rather than a flaky default. */
const CLI_TIMEOUT_MS = 180_000;

const ROW = "a-gated-row";
const ANCHOR = "transcript:a0000036-0000-4000-8000-000000000039#1922fc9e";
const WORDS = "stop posting shit that no one is asking for";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home holding one board row the gate can hang off. */
function stateHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-gate-e2e-"));
  homes.push(home);
  mkdirSync(join(home, "handovers"), { recursive: true });
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(
    join(home, "handovers", `${ROW}.md`),
    [
      "---",
      `slug: ${ROW}`,
      "kind: ask",
      'summary: "a row to hang a gate off"',
      "askedIso: 2026-09-21T03:01:34Z",
      `anchor: ${ANCHOR}`,
      "status: ready",
      "priority: p2",
      "blockedBy: []",
      "artifact: null",
      "doneWhen: []",
      "---",
      "",
      "# a row to hang a gate off",
      "",
      "## What the owner asked for",
      "",
      "a row to hang a gate off",
      "",
      "## How this ends",
      "",
      `\`slopweaver handover settle ${ROW} --as filed --witness x\`.`,
      "",
    ].join("\n"),
    "utf8",
  );
  return home;
}

/**
 * Run the shipped binary against one home, and report what it printed. `argvHome` puts a DIFFERENT home on the
 * command line than the environment names, the shape audit finding 04 used to switch a gate off.
 */
async function cli({
  args,
  home,
  argvHome,
  extraEnv = {},
}: {
  args: readonly string[];
  home: string;
  argvHome?: string;
  /** Variables a calling process would add, such as the caller gate homes run-due hands its verb child. */
  extraEnv?: Readonly<Record<string, string>>;
}): Promise<{ status: number; stdout: string; stderr: string }> {
  let named = home;
  if (argvHome !== undefined) {
    named = argvHome;
  }
  const child = spawn(BIN, [...args, "--home", named], {
    cwd: home,
    env: {
      ...accountSandboxChildEnv(),
      ...extraEnv,
      HOME: home,
      PATH: process.env["PATH"]!,
      SLOPWEAVER_HOME: home,
      TMPDIR: process.env["TMPDIR"]!,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (stdout += chunk));
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  // A null exit code means the child was SIGNALLED rather than exiting; report it as 1 rather than
  // coalescing a killed process into a clean run.
  const status = await new Promise<number>((resolveExit) => {
    child.on("close", (code) => {
      if (code === null) {
        resolveExit(1);
        return;
      }
      resolveExit(code);
    });
  });
  return { status, stderr, stdout };
}

/** The gate id the `handover rule` run printed, so the release names what was actually written. */
function gateIdFrom({ stdout }: { stdout: string }): string {
  const found = /id (\S+#\S+)/u.exec(stdout);
  // Fail loud: an empty id would sail into `gate release` and fail there, naming the wrong thing.
  return found![1]!;
}

describe("a recorded ruling gates the verb it rules on", { timeout: CLI_TIMEOUT_MS }, () => {
  it("refuses the gated verb, then runs it once the gate is released", async () => {
    const home = stateHome();

    const ruled = await cli({
      args: ["handover", "rule", ROW, "--anchor", ANCHOR, "--words", WORDS, "--gates", "handover reap"],
      home,
    });
    expect(ruled.status).toBe(0);
    expect(ruled.stdout).toContain("it now GATES handover reap");

    const refused = await cli({ args: ["handover", "reap"], home });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("refused: ruling-gate: cannot slopweaver handover reap");
    // The owner's own words and the anchor travel with the refusal — that is what a bespoke gate cannot give.
    expect(refused.stderr).toContain(WORDS);
    expect(refused.stderr).toContain(ANCHOR);
    expect(refused.stderr).toContain("no escape hatch and no environment override");

    const id = gateIdFrom({ stdout: ruled.stdout });
    expect(id).toContain(`${ROW}#`);

    const released = await cli({
      args: ["handover", "gate", "release", id, "--anchor", `${ANCHOR}-later`, "--words", "ok, go ahead"],
      home,
    });
    expect(released.status).toBe(0);
    expect(released.stdout).toContain("is lifted");

    // The falsifiable half: the SAME invocation, same home, nothing else changed.
    const after = await cli({ args: ["handover", "reap"], home });
    expect(after.stderr).not.toContain("refused: ruling-gate");
  });

  it("refuses only the SUBJECT a scoped gate names, and lets its sibling through", async () => {
    const home = stateHome();

    const ruled = await cli({
      args: [
        "handover",
        "rule",
        ROW,
        "--anchor",
        ANCHOR,
        "--words",
        WORDS,
        "--gates",
        "handover resume",
        "--gate-subject",
        ROW,
      ],
      home,
    });
    expect(ruled.status).toBe(0);

    const refused = await cli({ args: ["handover", "resume", ROW], home });
    expect(refused.stderr).toContain("refused: ruling-gate: cannot slopweaver handover resume");
    expect(refused.stderr).toContain(`scoped to: ${ROW}`);

    // The falsifiable half: the same gated VERB, the same home, a subject the gate does not name.
    const sibling = await cli({ args: ["handover", "resume", "a-row-the-gate-never-named"], home });
    expect(sibling.stderr).not.toContain("refused: ruling-gate");
  });

  // Measured by hand before it was a test: `--doc <path>` was refused and
  // `--doc=<path>` reached the verb's own "cannot read" error. Both spellings reach every verb, because
  // `src/cli/parseFlags.ts` is `node:util`'s `parseArgs`, so one character switched the owner's ruling off.
  it("refuses a flag-valued subject in BOTH spellings, not only the spaced one", async () => {
    const home = stateHome();
    const doc = join(home, "gated-doc.md");

    const ruled = await cli({
      args: [
        "handover",
        "rule",
        ROW,
        "--anchor",
        ANCHOR,
        "--words",
        WORDS,
        "--gates",
        "handover check",
        "--gate-subject",
        doc,
      ],
      home,
    });
    expect(ruled.status).toBe(0);

    const spaced = await cli({ args: ["handover", "check", "--doc", doc], home });
    expect(spaced.stderr).toContain("refused: ruling-gate: cannot slopweaver handover check");

    const glued = await cli({ args: ["handover", "check", `--doc=${doc}`], home });
    expect(glued.stderr).toContain("refused: ruling-gate: cannot slopweaver handover check");

    // The falsifiable half: the same verb, the same home, the same spelling, a doc the gate never named.
    const other = await cli({ args: ["handover", "check", `--doc=${join(home, "some-other-doc.md")}`], home });
    expect(other.stderr).not.toContain("refused: ruling-gate");
  });

  // r3 of this change, measured by hand first: one appended line whose kind this build has no case for made
  // `handover gate release` exit 1 while `handover gate list` still printed the gate as in force and the
  // gated verb was still refused. That is reachable without a hand edit — every checkout on the machine
  // shares one home, and a newer event kind is `unreadable` to an older decoder.
  it("still lifts a gate on a journal carrying a line this build cannot decode", async () => {
    const home = stateHome();

    const ruled = await cli({
      args: ["handover", "rule", ROW, "--anchor", ANCHOR, "--words", WORDS, "--gates", "handover reap"],
      home,
    });
    expect(ruled.status).toBe(0);
    const id = gateIdFrom({ stdout: ruled.stdout });

    appendFileSync(
      join(home, "runs", `${ROW}.jsonl`),
      `${JSON.stringify({ atIso: "2026-09-21T09:00:00.000Z", kind: "a-kind-this-build-has-no-case-for" })}\n`,
      "utf8",
    );

    const released = await cli({
      args: ["handover", "gate", "release", id, "--anchor", `${ANCHOR}-later`, "--words", "ok, go ahead"],
      home,
    });
    expect(released.status).toBe(0);
    expect(released.stdout).toContain("is lifted");
    // The witness that the journal really is undecodable to this build: the release names the line it skipped
    // and the word. Without this the release could pass for a reason that has nothing to do with r3.
    expect(released.stdout).toContain("did not decode and were skipped");
    expect(released.stdout).toContain("`a-kind-this-build-has-no-case-for`");

    const after = await cli({ args: ["handover", "reap"], home });
    expect(after.stderr).not.toContain("refused: ruling-gate");
  });

  // Audit finding 04: the boundary read ONLY the argv home, so `--home <empty>` switched every gate off.
  it("still refuses when argv names a different, empty home than the environment's", async () => {
    const home = stateHome();
    const empty = stateHome();

    const ruled = await cli({
      args: ["handover", "rule", ROW, "--anchor", ANCHOR, "--words", WORDS, "--gates", "handover reap"],
      home,
    });
    expect(ruled.status).toBe(0);

    const repointed = await cli({ args: ["handover", "reap"], argvHome: empty, home });
    expect(repointed.status).toBe(1);
    expect(repointed.stderr).toContain("refused: ruling-gate: cannot slopweaver handover reap");

    // The falsifiable half: the same re-pointed invocation, from an environment home with no ruling in it.
    const ungated = await cli({ args: ["handover", "reap"], argvHome: empty, home: stateHome() });
    expect(ungated.stderr).not.toContain("refused: ruling-gate");
  });

  // automation run-due runs a row's verb in a child, and the tick's home reaches that child's boundary only here.
  it("refuses in a process whose caller handed it the gated home through the environment", async () => {
    const gated = stateHome();
    const ruled = await cli({
      args: ["handover", "rule", ROW, "--anchor", ANCHOR, "--words", WORDS, "--gates", "handover reap"],
      home: gated,
    });
    expect(ruled.status).toBe(0);

    const handed = await cli({
      args: ["handover", "reap"],
      extraEnv: { [CALLER_GATE_HOMES_ENV]: JSON.stringify([gated]) },
      home: stateHome(),
    });
    expect(handed.status).toBe(1);
    expect(handed.stderr).toContain("refused: ruling-gate: cannot slopweaver handover reap");

    // The falsifiable half: the same invocation from the same kind of empty home, handed no caller home.
    const unhanded = await cli({ args: ["handover", "reap"], home: stateHome() });
    expect(unhanded.stderr).not.toContain("refused: ruling-gate");
  });

  it("refuses every verb when the handed homes are unreadable, rather than reading them as none", async () => {
    const malformed = await cli({
      args: ["handover", "reap"],
      extraEnv: { [CALLER_GATE_HOMES_ENV]: "/not/json" },
      home: stateHome(),
    });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain("SLOPWEAVER_CALLER_GATE_HOMES is set but unreadable (");
  });

  it("answers --help on a gated verb, because help is not an action", async () => {
    const home = stateHome();
    await cli({
      args: ["handover", "rule", ROW, "--anchor", ANCHOR, "--words", WORDS, "--gates", "handover reap"],
      home,
    });

    const help = await cli({ args: ["handover", "reap", "--help"], home });

    expect(help.status).toBe(0);
    expect(help.stderr).not.toContain("refused: ruling-gate");
  });

  it("refuses to gate the verb that records a ruling, rather than recording one that would wedge the register", async () => {
    const home = stateHome();

    const ruled = await cli({
      args: ["handover", "rule", ROW, "--anchor", ANCHOR, "--words", WORDS, "--gates", "handover rule"],
      home,
    });

    expect(ruled.status).toBe(2);
    expect(ruled.stderr).toContain("can never be gated");
  });
});
