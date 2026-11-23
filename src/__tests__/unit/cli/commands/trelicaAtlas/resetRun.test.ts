import { describe, expect, it } from "vitest";

import type { TrelicaResetOutcome } from "../../../../../atlas/trelica/reset.js";
import { type TrelicaAtlasPaths, trelicaAtlasPaths } from "../../../../../atlas/trelica/store.js";
import { TRELICA_RESET_USAGE } from "../../../../../cli/commands/trelicaAtlas/core.js";
import { runTrelicaAtlasReset, type TrelicaAtlasResetDeps } from "../../../../../cli/commands/trelicaAtlas/resetRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, type Result } from "../../../../../lib/result.js";

/** Everything the fake effects observed, in order. */
type Event =
  | { readonly kind: "now" }
  | { readonly kind: "paths"; readonly home: string }
  | { readonly kind: "reset"; readonly at: string; readonly paths: TrelicaAtlasPaths }
  | { readonly kind: "out"; readonly line: string }
  | { readonly kind: "error"; readonly msg: string };

const INSTANT = "2026-10-13T01:02:03.000Z";

/**
 * Plain effects over a fixed clock and a fixed reset answer, recording every call into one log.
 *
 * @returns the dependencies and the log
 */
function recordingDeps({ answer }: { answer: Result<TrelicaResetOutcome> }): {
  readonly deps: TrelicaAtlasResetDeps;
  readonly events: Event[];
} {
  const events: Event[] = [];
  return {
    deps: {
      error: ({ msg }) => {
        events.push({ kind: "error", msg });
      },
      now: () => {
        events.push({ kind: "now" });
        return INSTANT;
      },
      out: ({ line }) => {
        events.push({ kind: "out", line });
      },
      paths: ({ home }) => {
        events.push({ home, kind: "paths" });
        return trelicaAtlasPaths({ home });
      },
      reset: ({ at, paths }) => {
        events.push({ at, kind: "reset", paths });
        return answer;
      },
    },
    events,
  };
}

const OUTCOME: TrelicaResetOutcome = {
  archiveId: "archive-alpha",
  archivedTo: "/home-bravo/atlas/_superseded/trelica/archive-alpha",
};

/**
 * A reset invocation's argv.
 *
 * @returns the whole process argv for `atlas trelica reset` with the given tail
 */
function argvWith({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "atlas", "trelica", "reset", ...tail];
}

describe("runTrelicaAtlasReset", () => {
  it("prints only the usage for --help and touches neither the clock, the paths nor the reset", () => {
    const { deps, events } = recordingDeps({ answer: ok(OUTCOME) });
    expect(runTrelicaAtlasReset({ argv: argvWith({ tail: ["--help"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([{ kind: "out", line: TRELICA_RESET_USAGE }]);
  });

  it("treats -h as help too", () => {
    const { deps, events } = recordingDeps({ answer: ok(OUTCOME) });
    expect(runTrelicaAtlasReset({ argv: argvWith({ tail: ["-h", "--confirm", "archive"] }), deps })).toBe(EXIT_OK);
    expect(events).toEqual([{ kind: "out", line: TRELICA_RESET_USAGE }]);
  });

  it("refuses a missing confirmation with the parser's line then the usage, and resets nothing", () => {
    const { deps, events } = recordingDeps({ answer: ok(OUTCOME) });
    expect(runTrelicaAtlasReset({ argv: argvWith({ tail: ["--home", "/home-bravo"] }), deps })).toBe(EXIT_USAGE);
    expect(events).toEqual([
      { kind: "error", msg: "reset needs --confirm archive, spelled out, so a generation is never replaced by a typo" },
      { kind: "error", msg: TRELICA_RESET_USAGE },
    ]);
  });

  it("refuses a mistyped confirmation the same way", () => {
    const { deps, events } = recordingDeps({ answer: ok(OUTCOME) });
    const code = runTrelicaAtlasReset({
      argv: argvWith({ tail: ["--confirm", "delete", "--home", "/home-bravo"] }),
      deps,
    });
    expect(code).toBe(EXIT_USAGE);
    expect(events.map((event) => event.kind)).toEqual(["error", "error"]);
  });

  it("resets under the explicit home at the injected instant and prints the archive line", () => {
    const { deps, events } = recordingDeps({ answer: ok(OUTCOME) });
    const code = runTrelicaAtlasReset({
      argv: argvWith({ tail: ["--confirm", "archive", "--home", "/home-bravo"] }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(events).toEqual([
      { kind: "now" },
      { home: "/home-bravo", kind: "paths" },
      { at: INSTANT, kind: "reset", paths: trelicaAtlasPaths({ home: "/home-bravo" }) },
      { kind: "out", line: "trelica atlas reset — archived to /home-bravo/atlas/_superseded/trelica/archive-alpha" },
    ]);
  });

  it("prints the outcome as one-space-indented JSON under --json", () => {
    const { deps, events } = recordingDeps({ answer: ok(OUTCOME) });
    const code = runTrelicaAtlasReset({
      argv: argvWith({ tail: ["--confirm", "archive", "--home", "/home-bravo", "--json"] }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(events.at(-1)).toEqual({ kind: "out", line: JSON.stringify(OUTCOME, null, 1) });
    expect(events.at(-1)).toEqual({
      kind: "out",
      line: '{\n "archiveId": "archive-alpha",\n "archivedTo": "/home-bravo/atlas/_superseded/trelica/archive-alpha"\n}',
    });
  });

  it("reports every line of a failed reset on stderr and answers EXIT_ERROR, printing nothing to stdout", () => {
    const { deps, events } = recordingDeps({ answer: err(["lock held by pid 42", "nothing was archived"]) });
    const code = runTrelicaAtlasReset({
      argv: argvWith({ tail: ["--confirm", "archive", "--home", "/home-bravo"] }),
      deps,
    });
    expect(code).toBe(EXIT_ERROR);
    expect(events.slice(3)).toEqual([
      { kind: "error", msg: "lock held by pid 42" },
      { kind: "error", msg: "nothing was archived" },
    ]);
    expect(events.filter((event) => event.kind === "out")).toEqual([]);
  });
});
