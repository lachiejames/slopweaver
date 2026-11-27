/**
 * The `supervisor hand-off` verb entry's argv, parsed into what `runChairHandOff` acts on — with every seam that could
 * reach a socket, the harness or a spawn replaced by one that fails the test if touched. The entry is otherwise not
 * run end to end: the done proof (`./chairHandOffRun.test.ts`) drives `runChairHandOff` over fakes.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NOTE_WAIT_SECONDS,
  parseChairHandOffArgs,
} from "../../../../../cli/commands/supervisor/chairHandOffArgs.js";
import type { ChairHandOffDeps } from "../../../../../cli/commands/supervisor/chairHandOffContext.js";
import { runChairHandOff } from "../../../../../cli/commands/supervisor/chairHandOffRun.js";
import { verbTail } from "../../../../../cli/optionParsers.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { untouchable } from "./chairHandOffFixtures.js";

/** The tail the router hands the verb, from a whole argv. */
function tailOf({ args }: { args: readonly string[] }): readonly string[] {
  return verbTail({ argv: ["node", "slopweaver", "supervisor", "hand-off", ...args], verbs: ["hand-off"] });
}

describe("supervisor hand-off argv", () => {
  it("parses every run flag into the options", () => {
    const rest = tailOf({
      args: ["--home", "/h", "--plan", "plan-four", "--now", "--reason", "tonight", "--note-wait", "30"],
    });
    expect(unwrap(parseChairHandOffArgs({ rest }))).toEqual({
      kind: "run",
      options: {
        home: "/h",
        namedHome: "/h",
        noteWaitSeconds: 30,
        now: "tonight",
        plan: "plan-four",
        reason: undefined,
      },
    });
  });

  it("defaults the note wait, and carries --reason beside --plan alone as the plan's reason", () => {
    const rest = tailOf({ args: ["--home", "/h", "--plan", "plan-four", "--reason", "more room"] });
    expect(unwrap(parseChairHandOffArgs({ rest }))).toEqual({
      kind: "run",
      options: {
        home: "/h",
        namedHome: "/h",
        noteWaitSeconds: DEFAULT_NOTE_WAIT_SECONDS,
        now: undefined,
        plan: "plan-four",
        reason: "more room",
      },
    });
  });

  it("refuses --now without a reason, and a bad --note-wait", () => {
    expect(unwrapErr(parseChairHandOffArgs({ rest: tailOf({ args: ["--now"] }) }))).toEqual([
      '--now needs --reason "<why>": an override carries its reason',
    ]);
    expect(unwrapErr(parseChairHandOffArgs({ rest: tailOf({ args: ["--note-wait", "soon"] }) })).length).toBe(1);
  });

  it("routes hold, release and note to their own bodies with their own tails", () => {
    expect(unwrap(parseChairHandOffArgs({ rest: tailOf({ args: ["hold", "--reason", "demo"] }) }))).toEqual({
      kind: "hold",
      rest: ["--reason", "demo"],
    });
    expect(unwrap(parseChairHandOffArgs({ rest: tailOf({ args: ["release", "--reason", "done"] }) }))).toEqual({
      kind: "release",
      rest: ["--reason", "done"],
    });
    expect(
      unwrap(
        parseChairHandOffArgs({
          rest: tailOf({ args: ["note", "--episode", "chair-hand-off:x", "--file", "/n.md", "--home", "/h"] }),
        }),
      ),
    ).toEqual({ episodeId: "chair-hand-off:x", file: "/n.md", home: "/h", kind: "note" });
  });

  it("refuses a note missing --episode or --file, each naming the flag it lacks", () => {
    expect([
      unwrapErr(parseChairHandOffArgs({ rest: tailOf({ args: ["note", "--file", "/n.md"] }) })),
      unwrapErr(parseChairHandOffArgs({ rest: tailOf({ args: ["note", "--episode", "chair-hand-off:x"] }) })),
    ]).toEqual([
      ["note needs --episode <id>, as the hand-off request names it"],
      ["note needs --file <path>, as the hand-off request names it"],
    ]);
  });

  it("hands hold and release their tails without touching the harness, the watch or a spawn", async () => {
    const seen: string[] = [];
    const deps: ChairHandOffDeps = {
      hold: ({ rest }) => {
        seen.push(`hold ${rest.join(" ")}`);
        return 0;
      },
      nowIso: () => "2026-11-27T08:00:00.000Z",
      out: ({ line }) => {
        seen.push(line);
      },
      readHold: untouchable,
      release: ({ rest }) => {
        seen.push(`release ${rest.join(" ")}`);
        return 0;
      },
      repo: untouchable,
      sleep: untouchable,
      spawn: untouchable,
      watch: untouchable,
      withHarness: untouchable,
    };
    expect(await runChairHandOff({ deps, rest: tailOf({ args: ["hold", "--reason", "demo"] }) })).toBe(0);
    expect(await runChairHandOff({ deps, rest: tailOf({ args: ["release", "--reason", "done"] }) })).toBe(0);
    expect(seen).toEqual(["hold --reason demo", "release --reason done"]);
  });
});
