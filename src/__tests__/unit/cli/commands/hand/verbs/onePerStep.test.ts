/**
 * One note per step: a post, push or show that finds the step's note already up or starting draws no second one,
 * and the step addresses and commands a post refuses before it draws anything.
 */
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandPush } from "../../../../../../cli/commands/hand/push.js";
import { runHandShow } from "../../../../../../cli/commands/hand/show.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { CLOSED_BEAT } from "../../../../../../hand/note/liveness.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { NOW, UNLANDED_SECRET } from "./fixtures.js";
import { freshHand, handHarness, stampAtNow, tokenOf } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps, post } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The step's wanted-token file, which only a raise writes. */
function wantPath(): string {
  return join(home, "hand-steps", "live", "gcloud-signin.want");
}

describe("one note per step", () => {
  it("post then push of the same step draws ONE note — the double, reproduced and closed", async () => {
    expect(await runHandPost({ deps: deps(), rest: post() })).toBe(EXIT_OK);
    expect(commands.filter((command) => command.file === "open").length).toBe(1);
    expect(readFileSync(wantPath(), "utf8").trim()).toBe(tokenOf({ command: commands[0]! }));
    // The note is still starting — no beat yet — and was wanted at NOW.
    stampAtNow({ path: wantPath() });
    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(commands.filter((command) => command.file === "open")).toEqual([]);
    expect(commands.filter((command) => command.file === "osascript").length).toBe(1);
    expect(out[1]).toBe("  notified, and gcloud-signin was already floating top right");
  });

  it("re-posting an id whose note is up and beating on this build draws nothing", async () => {
    await runHandPost({ deps: deps(), rest: post() });
    const token = tokenOf({ command: commands[0]! });
    const panel = readFileSync(join(commands[0]!.args[2]!, "Contents", "Resources", "panel.js"), "utf8");
    const build = (JSON.parse(panel.split("\n")[0]!.slice("const STEP = ".length, -1)) as { build: string }).build;
    const beat = join(home, "hand-steps", "live", `gcloud-signin.${token}.beat`);
    writeFileSync(beat, build);
    stampAtNow({ path: beat });
    stampAtNow({ path: wantPath() });
    out = [];
    commands = [];
    expect(await runHandPost({ deps: deps(), rest: post() })).toBe(EXIT_OK);
    expect(commands).toEqual([]);
    expect(out[2]).toBe("  note: already floating — its note is up, so no second one was drawn");
  });

  it("draws again at once after a note closed seconds after its raise — its tombstone is not a starting note", async () => {
    await runHandPost({ deps: deps(), rest: post() });
    const beat = join(home, "hand-steps", "live", `gcloud-signin.${tokenOf({ command: commands[0]! })}.beat`);
    // What the panel writes as it closes on Later, Done or dismiss, five seconds in.
    writeFileSync(beat, CLOSED_BEAT);
    stampAtNow({ path: beat });
    stampAtNow({ path: wantPath() });
    commands = [];
    expect(await runHandPost({ deps: deps(), rest: post() })).toBe(EXIT_OK);
    expect(commands.filter((command) => command.file === "open").length).toBe(1);
  });

  it("draws again once the wanted note has gone quiet past its window", async () => {
    await runHandPost({ deps: deps(), rest: post() });
    const stale = new Date(Date.parse(NOW) - 60_000);
    utimesSync(wantPath(), stale, stale);
    commands = [];
    expect(await runHandPost({ deps: deps(), rest: post() })).toBe(EXIT_OK);
    expect(commands.filter((command) => command.file === "open").length).toBe(1);
  });

  it("show REPLACES a note that is up: it launches under a new token, which becomes the wanted one", async () => {
    await runHandPost({ deps: deps(), rest: post() });
    const first = tokenOf({ command: commands[0]! });
    stampAtNow({ path: wantPath() });
    commands = [];
    expect(runHandShow({ deps: deps(), rest: ["gcloud-signin", "--home", home] })).toBe(EXIT_OK);
    expect(commands.length).toBe(1);
    const second = tokenOf({ command: commands[0]! });
    expect(second).not.toBe(first);
    expect(readFileSync(wantPath(), "utf8").trim()).toBe(second);
  });

  it("a launch that throws marks its own token failed, so it cannot suppress the next raise", async () => {
    expect(await runHandPost({ deps: deps({ throws: true }), rest: post() })).toBe(EXIT_OK);
    const token = readFileSync(wantPath(), "utf8").trim();
    expect(existsSync(join(home, "hand-steps", "live", `${token}.failed`))).toBe(true);
    commands = [];
    expect(await runHandPost({ deps: deps(), rest: post() })).toBe(EXIT_OK);
    expect(commands.filter((command) => command.file === "open").length).toBe(1);
  });

  it("refuses a literal that only opens a page, and records and draws nothing", async () => {
    const page = "file:///Users/someone/.slopweaver/pages/vanta-entry-group/index.html";
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--literal", `open ${page}`] }) })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("pass the address as --url instead");
    expect(commands).toEqual([]);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
  });

  it("takes the page's viewer address as --url, and the note carries it for its Open button", async () => {
    const page = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Fvanta-entry-group%2Findex.html&back=%2Fqueue";
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--url", page] }) })).toBe(EXIT_OK);
    const panel = readFileSync(join(commands[0]!.args[2]!, "Contents", "Resources", "panel.js"), "utf8");
    expect(panel.split("\n")[0]).toContain(`"url":"${page}"`);
  });

  it("refuses the page's file:// address as --url, naming its viewer address, and records nothing", async () => {
    const page = "file:///Users/someone/.slopweaver/pages/vanta-entry-group/index.html";
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--url", page] }) })).toBe(EXIT_ERROR);
    expect(diagnostics.join("\n")).toContain(
      "pass the page's viewer address instead: http://localhost:3000/view?src=%2Fapi%2Fpage%2Fvanta-entry-group%2Findex.html&back=%2Fqueue",
    );
    expect(commands).toEqual([]);
  });

  it("refuses a secrets set the registry lacks, names the branch carrying its row, and records nothing", async () => {
    const tail = ["--literal", `slopweaver secrets set ${UNLANDED_SECRET}`, "--where", "a plain terminal of yours"];
    expect(await runHandPost({ deps: deps(), rest: post({ tail }) })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain(`for ${UNLANDED_SECRET}, and the secrets registry this checkout ships`);
    expect(diagnostics[1]).toBe(
      `  ${UNLANDED_SECRET}: declared on refs/heads/secops-atlas-connect — land that branch first, then pull the main checkout and post the step`,
    );
    expect(commands).toEqual([]);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
  });

  it("refuses a command of the owner's written into --unblocks, pointing at --literal", async () => {
    const rest = post({ tail: ["--quiet"] }).map((arg) =>
      arg === "handover run datadog-monitor-deploy" ? "the deploy; then gcloud auth login" : arg,
    );
    expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("unblocks names a command only the owner's hands run (`gcloud auth login`)");
    expect(diagnostics[0]).toContain("pass the whole command as --literal");
  });
});
