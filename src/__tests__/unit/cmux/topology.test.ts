/**
 * `parseTopology` — one `system.top` reply read whole into every workspace ref and surface pid, or refused. Pure.
 */
import { describe, expect, it } from "vitest";

import { parseTopology } from "../../../cmux/topology.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One workspace row holding the given surface roots. */
function workspace({ ref, processes }: { ref: unknown; processes: readonly unknown[] }): Record<string, unknown> {
  return { id: `id-${String(ref)}`, panes: [{ surfaces: [{ processes }] }], ref };
}

const SHELL = { children: [{ children: [], name: "claude", pid: 12 }], name: "zsh", pid: 11 };

describe("parseTopology", () => {
  it("gathers every ref across every window, and every pid in every tree, children included", () => {
    const value = {
      windows: [
        { workspaces: [workspace({ processes: [SHELL], ref: "workspace:1" })] },
        { workspaces: [workspace({ processes: [], ref: "workspace:7" })] },
      ],
    };
    expect(unwrap(parseTopology({ value }))).toEqual({
      surfacePids: [11, 12],
      workspaceRefs: ["workspace:1", "workspace:7"],
    });
  });

  it("refuses a reply missing its windows list, or a window missing its workspaces list", () => {
    expect(unwrapErr(parseTopology({ value: {} })).message).toContain("no windows list");
    expect(unwrapErr(parseTopology({ value: { windows: [{}] } })).message).toContain("no workspaces list");
  });

  it("refuses a workspace row with no ref, and one whose process tree will not decode", () => {
    const noRef = parseTopology({ value: { windows: [{ workspaces: [workspace({ processes: [], ref: 5 })] }] } });
    const badTree = parseTopology({
      value: { windows: [{ workspaces: [workspace({ processes: [{ name: "zsh" }], ref: "workspace:2" })] }] },
    });
    expect(unwrapErr(noRef).message).toContain("no workspace:<n> ref");
    expect(unwrapErr(badTree).message).toContain("workspace:2 would not decode");
  });

  it("refuses a ref of any other shape, and a pid that is not a positive whole number", () => {
    const refusal = ({ ref, pid }: { ref: string; pid?: number }): string => {
      const processes = pid === undefined ? [] : [{ children: [], name: "zsh", pid }];
      const value = { windows: [{ workspaces: [workspace({ processes, ref })] }] };
      return unwrapErr(parseTopology({ value })).message;
    };
    expect(refusal({ ref: "bogus" })).toContain("no workspace:<n> ref");
    expect(refusal({ ref: "workspace:5 " })).toContain("no workspace:<n> ref");
    expect(refusal({ pid: -1, ref: "workspace:3" })).toContain("workspace:3 would not decode");
    expect(refusal({ pid: 1.5, ref: "workspace:3" })).toContain("workspace:3 would not decode");
    expect(refusal({ pid: 0, ref: "workspace:3" })).toContain("workspace:3 would not decode");
  });

  it("refuses a reply that lists no workspace at all", () => {
    const empty = unwrapErr(parseTopology({ value: { windows: [{ workspaces: [] }] } }));
    expect(empty.code).toBe("MALFORMED_REPLY");
    expect(empty.message).toContain("lists no workspace");
  });
});
