import { describe, expect, it } from "vitest";

import {
  runTrelicaAtlasRefresh,
  type TrelicaAtlasRefreshDeps,
} from "../../../../../cli/commands/trelicaAtlas/refreshRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

/** Everything the fake halves and the diagnostic sink observed, in the order it happened. */
type Event =
  | { readonly kind: "sync"; readonly argv: readonly string[] }
  | { readonly kind: "walk"; readonly argv: readonly string[] }
  | { readonly kind: "error"; readonly msg: string };

/**
 * Plain fake halves that answer fixed codes and record every call into one ordered log.
 *
 * @returns the dependencies and the log they write
 */
function recordingDeps({ syncCode, walkCode }: { syncCode: number; walkCode: number }): {
  readonly deps: TrelicaAtlasRefreshDeps;
  readonly events: Event[];
} {
  const events: Event[] = [];
  return {
    deps: {
      error: ({ msg }) => {
        events.push({ kind: "error", msg });
      },
      sync: async (argv) => {
        events.push({ argv, kind: "sync" });
        return syncCode;
      },
      walk: async (argv) => {
        events.push({ argv, kind: "walk" });
        return walkCode;
      },
    },
    events,
  };
}

const ARGV = ["node-alpha", "bin-bravo", "atlas", "trelica", "refresh", "--json", "--home", "/home-charlie"];

describe("runTrelicaAtlasRefresh", () => {
  it("runs the sync then the walk, rewriting the verb and forwarding the tail unchanged", async () => {
    const { deps, events } = recordingDeps({ syncCode: EXIT_OK, walkCode: EXIT_OK });
    expect(await runTrelicaAtlasRefresh({ argv: ARGV, deps })).toBe(EXIT_OK);
    expect(events).toEqual([
      { argv: ["node", "slopweaver", "atlas", "trelica", "sync", "--json", "--home", "/home-charlie"], kind: "sync" },
      { argv: ["node", "slopweaver", "atlas", "trelica", "walk", "--json", "--home", "/home-charlie"], kind: "walk" },
    ]);
  });

  it("forwards an empty tail when the verb was given no flags", async () => {
    const { deps, events } = recordingDeps({ syncCode: EXIT_OK, walkCode: EXIT_OK });
    await runTrelicaAtlasRefresh({ argv: ["node", "slopweaver", "atlas", "trelica", "refresh"], deps });
    expect(events).toEqual([
      { argv: ["node", "slopweaver", "atlas", "trelica", "sync"], kind: "sync" },
      { argv: ["node", "slopweaver", "atlas", "trelica", "walk"], kind: "walk" },
    ]);
  });

  it("returns a failed sync's own code and never attempts the walk", async () => {
    const { deps, events } = recordingDeps({ syncCode: EXIT_USAGE, walkCode: EXIT_OK });
    expect(await runTrelicaAtlasRefresh({ argv: ARGV, deps })).toBe(EXIT_USAGE);
    expect(events.map((event) => event.kind)).toEqual(["sync", "error"]);
    expect(events[1]).toEqual({ kind: "error", msg: "the API half failed, so the browser walk was not attempted" });
  });

  it("answers EXIT_ERROR when the walk fails after a good sync, saying the atlas is half current", async () => {
    const { deps, events } = recordingDeps({ syncCode: EXIT_OK, walkCode: 7 });
    expect(await runTrelicaAtlasRefresh({ argv: ARGV, deps })).toBe(EXIT_ERROR);
    expect(events.map((event) => event.kind)).toEqual(["sync", "walk", "error"]);
    expect(events[2]).toEqual({
      kind: "error",
      msg: "the API surfaces were published and the browser walk failed — the atlas is half current",
    });
  });
});
