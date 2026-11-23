/**
 * `hand post`: what it records and draws, what it carries into `hand list --json`, and the steps it refuses before
 * anything is written or drawn.
 */
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { freshHand, handHarness } from "./harness.js";

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

describe("hand post", () => {
  it("records the step and launches the note with a NEW instance", async () => {
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--literal", "gcloud auth login"] }) })).toBe(EXIT_OK);
    expect(commands.length).toBe(1);
    expect(commands[0]!.file).toBe("open");
    expect(commands[0]!.args.slice(0, 2)).toEqual(["-n", "-a"]);
    // One bundle per raise, named for its token, so two raises close together can never share a program.
    expect(dirname(dirname(commands[0]!.args[2]!))).toBe(join(home, "hand-steps", "notes"));
    expect(commands[0]!.args[2]!.endsWith("/note.app")).toBe(true);
    expect(out[0]).toBe("hand post: gcloud-signin recorded — Sign in to Google Cloud so the monitor deploy can finish");
  });

  it("writes the composed program into the bundle it is about to open", async () => {
    await runHandPost({ deps: deps(), rest: post({ tail: ["--literal", "gcloud auth login"] }) });
    const panel = readFileSync(join(commands[0]!.args[2]!, "Contents", "Resources", "panel.js"), "utf8");
    expect(panel.split("\n")[0]).toContain('"literal":"gcloud auth login"');
    expect(panel.includes("registerSubclass")).toBe(false);
  });

  it("carries --context through the real verb into what `hand list --json` publishes", async () => {
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--context", "work"] }) })).toBe(EXIT_OK);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).context).toBe("work");
  });

  it("refuses a third context value before anything is written or drawn", async () => {
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--context", "acme"] }) })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("hand post: context is `slopweaver` or `work` and nothing else");
    expect(commands.length).toBe(0);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
  });

  it("mints the queue deep link from --open, carrying --context so the row opens in its own context", async () => {
    const tail = ["--quiet", "--context", "slopweaver", "--open", "ask:a-round-two-row-is-seated-and-opens"];
    expect(await runHandPost({ deps: deps(), rest: post({ tail }) })).toBe(EXIT_OK);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).url).toBe(
      "http://localhost:3000/queue?open=ask%3Aa-round-two-row-is-seated-and-opens&context=slopweaver",
    );
  });

  it("carries --context onto a hand-built queue link that names none — the link the owner's note opened", async () => {
    const url = "http://localhost:3000/queue?open=ask%3Aa-round-two-row-is-seated-and-opens";
    expect(
      await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet", "--context", "slopweaver", "--url", url] }) }),
    ).toBe(EXIT_OK);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).url).toBe(`${url}&context=slopweaver`);
  });

  it("refuses --open beside --url before anything is written", async () => {
    const tail = ["--open", "ask:x", "--url", "https://example.com/"];
    expect(await runHandPost({ deps: deps(), rest: post({ tail }) })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toBe("hand post: --open mints the link --url would carry — pass one of the two, never both");
    expect(commands.length).toBe(0);
  });

  it("refuses an --open that names no queue row kind", async () => {
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--open", "board:x"] }) })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain(
      'hand post: --open wants a queue row key, <kind>:<id> with kind one of hand|ask|draft|post|review|import|pr|act (a pull request\'s is pr:<owner>.<repo>.<n>) — got "board:x"',
    );
  });

  it("draws nothing under --quiet, and still records", async () => {
    expect(await runHandPost({ deps: deps(), rest: post({ tail: ["--quiet"] }) })).toBe(EXIT_OK);
    expect(commands).toEqual([]);
    expect(out[2]).toBe("  note: not drawn (--quiet)");
  });

  it("records the step and says so when the machine has no floating note", async () => {
    expect(await runHandPost({ deps: deps({ platform: "linux" }), rest: post() })).toBe(EXIT_OK);
    expect(commands).toEqual([]);
    expect(out[2]).toContain("this is linux");
    expect(runHandList({ deps: deps({ platform: "linux" }), rest: ["--home", home] })).toBe(EXIT_OK);
  });

  it("keeps the record when the launch itself throws", async () => {
    expect(await runHandPost({ deps: deps({ throws: true }), rest: post() })).toBe(EXIT_OK);
    expect(out[2]).toContain("could not be raised");
    expect(out[2]).toContain("nothing was lost");
  });

  it("refuses a step naming the fleet as the actor, and records nothing", async () => {
    const rest = [
      "--home",
      home,
      "--id",
      "rotate",
      "--what",
      "The session rotates the Datadog key",
      "--unblocks",
      "x",
      "--witness",
      "y",
      "--standalone",
      "--blocks",
    ];
    expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain("names the fleet as the actor");
    expect(runHandList({ deps: deps(), rest: ["--home", home] })).toBe(EXIT_OK);
    expect(out[0]).toBe("hand list: nothing is waiting on the owner");
  });

  it("carries --cites through the real verb into what `hand list --json` publishes", async () => {
    const pr = "https://github.com/acme/acme-admin/pull/16672";
    const issue = "https://linear.app/acme/issue/EEEE-840";
    const rest = [...post({ tail: ["--quiet", "--cites", `${pr},${issue}`] })];
    rest[rest.indexOf("--what") + 1] =
      "Should we close the booking-error issue (EEEE-840) now that its fix (#16672) ships?";
    expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_OK);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!).cites).toEqual([pr, issue]);
  });

  it("refuses a step naming a pull request it does not cite, before anything is written or drawn", async () => {
    const rest = [...post()];
    rest[rest.indexOf("--what") + 1] = "Say whether to hold the post until #16672 lands";
    expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
    expect(diagnostics[0]).toContain(
      'hand post: cites names a pull request its queue card may not draw as a chip: "#16672" names no one pull request it carries',
    );
    expect(commands.length).toBe(0);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
  });

  it("refuses a step naming a Slack draft the register does not hold, before anything is written or drawn", async () => {
    const rest = [...post()];
    rest[rest.indexOf("--what") + 1] = "Say whether the release-note draft (sd-a0615cb5) goes to #delivery";
    expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_USAGE);
    expect(diagnostics[0]).toContain("slopweaver hand post blocked because the card names a parked Slack draft");
    expect(diagnostics[1]).toBe(
      "  - sd-a0615cb5 is not in the drafts register — a typo, or a draft never recorded on this home",
    );
    expect(commands.length).toBe(0);
    out = [];
    expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
    expect(out).toEqual([]);
  });

  it("refuses a post missing one of the four required flags", async () => {
    expect(await runHandPost({ deps: deps(), rest: ["--home", home, "--id", "x", "--what", "Sign in"] })).toBe(
      EXIT_USAGE,
    );
    expect(diagnostics[0]).toBe("hand post: --id, --what, --unblocks and --witness are all required");
  });
});
