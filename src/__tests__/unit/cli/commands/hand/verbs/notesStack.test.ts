/**
 * Notes stack across every step: each step's note takes its own slot down the cascade, a closed or failed note
 * frees its slot, and an arrival draws in front of a note already up.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { runHandPush } from "../../../../../../cli/commands/hand/push.js";
import { runHandShow } from "../../../../../../cli/commands/hand/show.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { CLOSED_BEAT } from "../../../../../../hand/note/liveness.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { freshHand, handHarness, stampAtNow, tokenOf } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps, postAs } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/**
 * Stand in for a note that has DRAWN: its beat on this build, at {@link NOW} — what the panel itself writes once
 * its window is up.
 */
function drawn({ id, command }: { id: string; command: NoteCommand }): void {
  const token = tokenOf({ command });
  const panel = readFileSync(join(command.args[2]!, "Contents", "Resources", "panel.js"), "utf8");
  const build = (JSON.parse(panel.split("\n")[0]!.slice("const STEP = ".length, -1)) as { build: string }).build;
  const beat = join(home, "hand-steps", "live", `${id}.${token}.beat`);
  writeFileSync(beat, build);
  stampAtNow({ path: beat });
}

/** The cascade slot one launched note reserved, read off the reservation its raise wrote. */
function slotOf({ command }: { command: NoteCommand }): string {
  return readFileSync(join(home, "hand-steps", "live", `${tokenOf({ command })}.slot`), "utf8").trim();
}

describe("notes stack, across every step", () => {
  it("a second step posted while the first is still starting draws its own note, one slot down the cascade", async () => {
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-a" }) })).toBe(EXIT_OK);
    const first = commands[0]!;
    stampAtNow({ path: join(home, "hand-steps", "live", `${tokenOf({ command: first })}.slot`) });
    out = [];
    commands = [];
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b" }) })).toBe(EXIT_OK);
    expect(commands.map((command) => command.file)).toEqual(["open"]);
    expect(out[2]).toBe(`  note: floating, top right in the cascade (slot 1) — ${commands[0]!.args[2]!}`);
    expect([slotOf({ command: first }), slotOf({ command: commands[0]! })]).toEqual([
      "steer-a 0 ordinary",
      "steer-b 1 ordinary",
    ]);
  });

  it("a post draws beside a note that has DRAWN and beats, and closes nothing of it", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "steer-a" }) });
    const first = commands[0]!;
    drawn({ command: first, id: "steer-a" });
    commands = [];
    await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b" }) });
    expect(commands.map((command) => command.file)).toEqual(["open"]);
    expect(readFileSync(join(home, "hand-steps", "live", "steer-a.want"), "utf8").trim()).toBe(
      tokenOf({ command: first }),
    );
    expect(existsSync(join(home, "hand-steps", "dismiss"))).toBe(true);
    expect(readdirSync(join(home, "hand-steps", "dismiss"))).toEqual([]);
  });

  it("a note the owner closed frees its slot, so the next post takes it", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "steer-a" }) });
    drawn({ command: commands[0]!, id: "steer-a" });
    const beat = join(home, "hand-steps", "live", `steer-a.${tokenOf({ command: commands[0]! })}.beat`);
    writeFileSync(beat, CLOSED_BEAT);
    stampAtNow({ path: beat });
    commands = [];
    await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b" }) });
    expect(slotOf({ command: commands[0]! })).toBe("steer-b 0 ordinary");
  });

  it("show draws the named step beside another step's note, which stays up", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "steer-a" }) });
    const first = commands[0]!;
    drawn({ command: first, id: "steer-a" });
    await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b", tail: ["--quiet"] }) });
    commands = [];
    expect(runHandShow({ deps: deps(), rest: ["steer-b", "--home", home] })).toBe(EXIT_OK);
    expect(commands.length).toBe(1);
    expect(slotOf({ command: commands[0]! })).toBe("steer-b 1 ordinary");
    expect(
      readFileSync(join(home, "hand-steps", "live", `steer-a.${tokenOf({ command: first })}.beat`), "utf8"),
    ).not.toBe(CLOSED_BEAT);
  });

  it("a launch that throws keeps its slot through the startup window, since its panel may still start", async () => {
    // `open` can report failure for a panel LaunchServices starts a moment later.
    expect(await runHandPost({ deps: deps({ throws: true }), rest: postAs({ id: "steer-a" }) })).toBe(EXIT_OK);
    const token = readFileSync(join(home, "hand-steps", "live", "steer-a.want"), "utf8").trim();
    expect(readFileSync(join(home, "hand-steps", "live", `${token}.failed`), "utf8")).toBe("launch failed\n");
    commands = [];
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b" }) })).toBe(EXIT_OK);
    expect(slotOf({ command: commands[0]! })).toBe("steer-b 1 ordinary");
  });

  it("a raise that fails BEFORE the launch draws nothing, and the next post still draws", async () => {
    // The bundle cannot be written: the notes directory is a file.
    mkdirSync(join(home, "hand-steps"), { recursive: true });
    writeFileSync(join(home, "hand-steps", "notes"), "");
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-a" }) })).toBe(EXIT_OK);
    expect(commands).toEqual([]);
    rmSync(join(home, "hand-steps", "notes"));
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b" }) })).toBe(EXIT_OK);
    expect(slotOf({ command: commands[0]! })).toBe("steer-b 0 ordinary");
  });

  it("a raise whose bundle fails AFTER it reserved a slot tombstones that slot, so the next post reuses it", async () => {
    // The notes directory reads but refuses a write, so the sweep passes and the reservation is taken.
    const notes = join(home, "hand-steps", "notes");
    mkdirSync(notes, { recursive: true });
    chmodSync(notes, 0o500);
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-a" }) })).toBe(EXIT_OK);
    chmodSync(notes, 0o700);
    const live = join(home, "hand-steps", "live");
    const reserved = readdirSync(live).filter((name) => name.endsWith(".slot"));
    expect([commands, reserved.length]).toEqual([[], 1]);
    const token = reserved[0]!.slice(0, -".slot".length);
    expect(readFileSync(join(live, `${token}.slot`), "utf8")).toBe("steer-a 0 ordinary\n");
    expect(readFileSync(join(live, `${token}.failed`), "utf8")).toBe("failed before launch\n");
    expect(await runHandPost({ deps: deps(), rest: postAs({ id: "steer-b" }) })).toBe(EXIT_OK);
    expect(slotOf({ command: commands[0]! })).toBe("steer-b 0 ordinary");
  });

  it("push draws an arrival in front of a note already up, and the banner says it is on screen", async () => {
    await runHandPost({ deps: deps(), rest: postAs({ id: "iso-reply", tail: ["--context", "work"] }) });
    drawn({ command: commands[0]!, id: "iso-reply" });
    runHandPush({ deps: deps(), rest: ["--home", home] });
    await runHandPost({ deps: deps(), rest: postAs({ id: "try-the-page", tail: ["--quiet", "--check-in"] }) });
    out = [];
    commands = [];
    expect(runHandPush({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(commands.filter((command) => command.file === "open").length).toBe(1);
    expect(commands.find((command) => command.file === "osascript")!.args.at(-1)).toBe(
      "The note is on screen, top right · 2 waiting in all",
    );
    expect(out[1]).toBe("  notified, and try-the-page is floating top right, in front of any note already up");
  });
});
