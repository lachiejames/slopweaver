/** The cmux client's call shapes and reply parsing, against a hand-written recording fake socket. */
import { describe, expect, it } from "vitest";

import { cmuxClientOver, parseWindowIds, parseWorkspaceList } from "../../../cmux/client.js";
import { CmuxErrors } from "../../../cmux/errors.js";
import { parseProcessTrees, parseWorkspaceTop } from "../../../cmux/processTree.js";
import { parseScreenText } from "../../../cmux/screenText.js";
import type { CmuxSocket } from "../../../cmux/socket.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

/** One recorded call. */
interface RecordedCall {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * A fake socket that records every call and answers from a per-method script.
 *
 * Not a mock: a plain object literal implementing the same seam production uses, so the ORDER and the exact
 * parameters a spawn issues are assertable without a running cmux.
 */
function fakeSocket({ replies }: { replies: Readonly<Record<string, unknown>> }): {
  calls: RecordedCall[];
  socket: CmuxSocket;
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    socket: {
      call: ({ method, params = {} }) => {
        calls.push({ method, params });
        return Promise.resolve(
          method in replies
            ? ok(replies[method])
            : err(CmuxErrors.callFailed({ cmuxCode: "method_not_found", message: "Unknown method", method })),
        );
      },
      close: () => undefined,
    },
  };
}

describe("parseWorkspaceList", () => {
  it("tags every row with the window the reply answered for", () => {
    const rows = parseWorkspaceList({
      value: {
        window_id: "W1",
        workspaces: [
          {
            current_directory: "/a",
            description: "id: a",
            id: "U1",
            latest_submitted_at: "2026-08-22T14:00:00.000Z",
            latest_submitted_message: "read the doc",
            pinned: true,
            ref: "workspace:1",
            selected: true,
            title: "a",
          },
        ],
      },
    });

    expect(rows).toEqual([
      {
        currentDirectory: "/a",
        description: "id: a",
        latestConversationMessage: undefined,
        latestSubmittedAtIso: "2026-08-22T14:00:00.000Z",
        latestSubmittedMessage: "read the doc",
        pinned: true,
        selected: true,
        title: "a",
        windowId: "W1",
        workspaceId: "U1",
        workspaceRef: "workspace:1",
      },
    ]);
  });

  it("reads pinned/selected as false when cmux omits them, never undefined", () => {
    const rows = parseWorkspaceList({
      value: {
        window_id: "W1",
        workspaces: [{ current_directory: "/a", id: "U1", ref: "workspace:1" }],
      },
    });

    expect(rows[0]!.pinned).toBe(false);
    expect(rows[0]!.selected).toBe(false);
  });

  it("drops one malformed row and keeps the rest", () => {
    const rows = parseWorkspaceList({
      value: {
        window_id: "W1",
        workspaces: [{ ref: "workspace:1" }, { current_directory: "/b", id: "U2", ref: "workspace:2" }],
      },
    });

    expect(rows.length).toBe(1);
    expect(rows[0]!.workspaceId).toBe("U2");
  });

  it("returns nothing at all when the reply names no window, rather than inventing one", () => {
    expect(
      parseWorkspaceList({ value: { workspaces: [{ current_directory: "/a", id: "U1", ref: "workspace:1" }] } }),
    ).toEqual([]);
  });
});

describe("parseWindowIds", () => {
  it("reads every window id", () => {
    expect(parseWindowIds({ value: { windows: [{ id: "W1" }, { id: "W2" }, { ref: "window:3" }] } })).toEqual([
      "W1",
      "W2",
    ]);
  });

  it("is empty for a reply with no windows array", () => {
    expect(parseWindowIds({ value: {} })).toEqual([]);
  });
});

describe("parseScreenText", () => {
  it("prefers the plain text field", () => {
    expect(unwrap(parseScreenText({ value: { text: "hello" } }))).toBe("hello");
  });

  it("decodes the base64 field when cmux sends that instead", () => {
    expect(unwrap(parseScreenText({ value: { base64: Buffer.from("hi", "utf8").toString("base64") } }))).toBe("hi");
  });

  it("fails when the reply carries neither", () => {
    const parsed = parseScreenText({ value: { surface_ref: "surface:1" } });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("MALFORMED_REPLY");
  });
});

describe("parseWorkspaceTop", () => {
  /** One workspace whose single surface carries the given fields — the cmux 0.65.2 shape adds the tty pid list. */
  const surfaceWith = ({ fields }: { fields: Record<string, unknown> }): unknown => ({
    windows: [{ workspaces: [{ id: "U1", panes: [{ surfaces: [fields] }] }] }],
  });

  // MEASURED on cmux 0.65.2, a reopened tab at its prompt: `processes` empty and the tab's own `login` and
  // shell listed as unattributed. Read as `processes` alone, this tab is nothing running.
  it("reads the tty pids cmux 0.65.2 lists beside an empty attributed tree", () => {
    const value = surfaceWith({
      fields: { foreground_pgids: [], pids: [], processes: [], unattributed_tty_process_pids: [60561, 60562] },
    });

    expect(unwrap(parseWorkspaceTop({ value, workspaceId: "U1" }))).toEqual({
      surfaces: 1,
      trees: [],
      ttys: [],
      unattributedTtyPids: [60561, 60562],
    });
  });

  // The trees and tty pids are read across every surface while a typed line
  // reaches the selected one, so the judge needs the count to refuse a split tab.
  it("counts the surfaces across the workspace's panes, so a split tab is never judged on another surface's shell", () => {
    const value: unknown = {
      windows: [
        {
          workspaces: [
            {
              id: "U1",
              panes: [
                { surfaces: [{ processes: [] }, { processes: [{ children: [], name: "zsh", pid: 10 }] }] },
                { surfaces: [{ processes: [] }] },
              ],
            },
          ],
        },
      ],
    };

    expect(unwrap(parseWorkspaceTop({ value, workspaceId: "U1" }))).toEqual({
      surfaces: 3,
      trees: [{ children: [], name: "zsh", pid: 10 }],
      ttys: [],
      unattributedTtyPids: [],
    });
  });

  it("reads an older cmux's surface, with no tty pid field, as no unattributed pids rather than malformed", () => {
    const value = surfaceWith({ fields: { processes: [{ children: [], name: "zsh", pid: 1 }] } });

    expect(unwrap(parseWorkspaceTop({ value, workspaceId: "U1" }))).toEqual({
      surfaces: 1,
      trees: [{ children: [], name: "zsh", pid: 1 }],
      ttys: [],
      unattributedTtyPids: [],
    });
  });

  it("refuses a tty pid field that is not a list of integers rather than reading the tab as empty", () => {
    const notList = surfaceWith({ fields: { processes: [], unattributed_tty_process_pids: 60561 } });
    const notInts = surfaceWith({ fields: { processes: [], unattributed_tty_process_pids: ["60561"] } });

    expect([notList, notInts].map((value) => unwrapErr(parseWorkspaceTop({ value, workspaceId: "U1" })).code)).toEqual([
      "MALFORMED_REPLY",
      "MALFORMED_REPLY",
    ]);
  });

  // MEASURED: each surface names its own pty, the tie that still holds when
  // cmux attributes no process to the tab.
  it("reads each surface's tty in surface order, and a surface sending none as no tty", () => {
    const value: unknown = {
      windows: [
        {
          workspaces: [
            {
              id: "U1",
              panes: [
                { surfaces: [{ processes: [], tty: "ttys001" }, { processes: [] }, { processes: [], tty: "ttys007" }] },
              ],
            },
          ],
        },
      ],
    };

    expect(unwrap(parseWorkspaceTop({ value, workspaceId: "U1" }))).toEqual({
      surfaces: 3,
      trees: [],
      ttys: ["ttys001", "ttys007"],
      unattributedTtyPids: [],
    });
  });

  it("refuses a tty that is not a string rather than reading the tab as having none", () => {
    const value = surfaceWith({ fields: { processes: [], tty: 1 } });

    expect(unwrapErr(parseWorkspaceTop({ value, workspaceId: "U1" })).message).toBe(
      "cmux system.top replied with an unusable shape: a pane, surface, process, child, tty pid list or tty in the tab would not decode",
    );
  });

  it("reads a reply whose sample says its enumeration was complete, or says nothing of it", () => {
    const fields = { processes: [], tty: "ttys001" };
    const complete = { ...(surfaceWith({ fields }) as object), sample: { enumeration_complete: true } };
    const silent = { ...(surfaceWith({ fields }) as object), sample: {} };

    expect([complete, silent].map((value) => unwrap(parseWorkspaceTop({ value, workspaceId: "U1" })).ttys)).toEqual([
      ["ttys001"],
      ["ttys001"],
    ]);
  });

  it("refuses a reply whose sample says its enumeration was incomplete, so an empty tab in it is never read as one", () => {
    const value = {
      ...(surfaceWith({ fields: { processes: [] } }) as object),
      sample: { enumeration_complete: false },
    };

    expect(unwrapErr(parseWorkspaceTop({ value, workspaceId: "U1" })).message).toBe(
      "cmux system.top replied with an unusable shape: cmux says its process enumeration was incomplete, so an empty tab in it may be a running one",
    );
  });

  it("reads a pid an incomplete or undecodable enumeration does report, exactly as a complete one", () => {
    const base = surfaceWith({
      fields: { processes: [{ children: [], name: "claude", pid: 4242 }], tty: "ttys004" },
    }) as object;
    const values = [
      { ...base, sample: { enumeration_complete: false } },
      { ...base, sample: { enumeration_complete: "true" } },
    ];

    expect(
      values.map((value) => unwrap(parseWorkspaceTop({ value, workspaceId: "U1" })).trees.map((tree) => tree.pid)),
    ).toEqual([[4242], [4242]]);
  });

  it("refuses a sample that is not a record, or an enumeration flag that is not a boolean", () => {
    const base = surfaceWith({ fields: { processes: [] } }) as object;
    const values = [
      { ...base, sample: "complete" },
      { ...base, sample: { enumeration_complete: "true" } },
    ];

    expect(values.map((value) => unwrapErr(parseWorkspaceTop({ value, workspaceId: "U1" })).message)).toEqual([
      "cmux system.top replied with an unusable shape: the reply's sample.enumeration_complete would not decode",
      "cmux system.top replied with an unusable shape: the reply's sample.enumeration_complete would not decode",
    ]);
  });
});

describe("parseProcessTrees", () => {
  const reply = {
    windows: [
      {
        workspaces: [
          {
            id: "U1",
            panes: [{ surfaces: [{ processes: [{ children: [{ pid: 2, name: "claude" }], name: "zsh", pid: 1 }] }] }],
          },
          { id: "U2", panes: [{ surfaces: [{ processes: [{ name: "other", pid: 9 }] }] }] },
        ],
      },
    ],
  };

  it("reads the trees off the surfaces, not the workspace row", () => {
    expect(unwrap(parseProcessTrees({ value: reply, workspaceId: "U1" }))).toEqual([
      { children: [{ children: [], name: "claude", pid: 2 }], name: "zsh", pid: 1 },
    ]);
  });

  it("collects every workspace when none is named", () => {
    expect(unwrap(parseProcessTrees({ value: reply, workspaceId: undefined })).map((process) => process.pid)).toEqual([
      1, 9,
    ]);
  });

  /** One workspace whose single shell carries the given `children` field. */
  const shellWith = ({ children }: { children: unknown }): unknown => ({
    windows: [
      { workspaces: [{ id: "U1", panes: [{ surfaces: [{ processes: [{ children, name: "zsh", pid: 1 }] }] }] }] },
    ],
  });

  it("refuses a child it cannot decode rather than reading the shell as childless", () => {
    const read = parseProcessTrees({ value: shellWith({ children: [{ name: "claude" }] }), workspaceId: "U1" });
    expect(unwrapErr(read).code).toBe("MALFORMED_REPLY");
  });

  it("refuses a children field that is not a list", () => {
    const read = parseProcessTrees({ value: shellWith({ children: { pid: 2 } }), workspaceId: "U1" });
    expect(unwrapErr(read).message).toBe(
      "cmux system.top replied with an unusable shape: a pane, surface, process, child, tty pid list or tty in the tab would not decode",
    );
  });

  it("refuses a processes container that is not a list rather than reading its pane as empty", () => {
    const value = {
      windows: [
        {
          workspaces: [
            {
              id: "U1",
              panes: [
                { surfaces: [{ processes: [{ children: [], name: "zsh", pid: 1 }] }] },
                { surfaces: [{ processes: { children: [], name: "claude", pid: 2 } }] },
              ],
            },
          ],
        },
      ],
    };
    expect(unwrapErr(parseProcessTrees({ value, workspaceId: "U1" })).code).toBe("MALFORMED_REPLY");
  });

  it("refuses a surface with no processes field rather than reading it as running nothing", () => {
    const value = {
      windows: [
        {
          workspaces: [{ id: "U1", panes: [{ surfaces: [{ processes: [{ name: "zsh", pid: 1 }] }, {}] }] }],
        },
      ],
    };
    expect(unwrapErr(parseProcessTrees({ value, workspaceId: "U1" })).code).toBe("MALFORMED_REPLY");
  });

  it("reads a surface whose processes list is empty as running nothing, the shape cmux sends", () => {
    const value = { windows: [{ workspaces: [{ id: "U1", panes: [{ surfaces: [{ processes: [] }] }] }] }] };
    expect(unwrap(parseProcessTrees({ value, workspaceId: "U1" }))).toEqual([]);
  });

  it("does not refuse over a malformed process in a workspace it was not asked about", () => {
    const read = parseProcessTrees({ value: shellWith({ children: [{ name: "claude" }] }), workspaceId: "U2" });
    expect(unwrap(read)).toEqual([]);
  });
});

describe("cmuxClientOver", () => {
  it("creates a workspace unfocused, with its description, and decodes its four addresses", async () => {
    const { calls, socket } = fakeSocket({
      replies: {
        "workspace.create": {
          surface_id: "22059B3F",
          surface_ref: "surface:63",
          workspace_id: "966460D9",
          workspace_ref: "workspace:60",
        },
      },
    });

    const created = await cmuxClientOver({ socket }).createWorkspace({
      cwd: "/repo/a-doc",
      description: "spawned session",
      name: "a-doc",
    });

    expect(unwrap(created)).toEqual({
      surfaceId: "22059B3F",
      surfaceRef: "surface:63",
      workspaceId: "966460D9",
      workspaceRef: "workspace:60",
    });
    expect(calls).toEqual([
      {
        method: "workspace.create",
        params: { cwd: "/repo/a-doc", description: "spawned session", focus: false, name: "a-doc" },
      },
    ]);
  });

  it("refuses a create reply missing its workspace id, and sends no description it was not given", async () => {
    const { calls, socket } = fakeSocket({
      replies: { "workspace.create": { surface_id: "s", surface_ref: "surface:1", workspace_ref: "workspace:1" } },
    });

    const created = await cmuxClientOver({ socket }).createWorkspace({ cwd: "/repo/a-doc", name: "a-doc" });

    expect(unwrapErr(created).code).toBe("MALFORMED_REPLY");
    expect(unwrapErr(created).message).toContain("workspace_id");
    expect(calls).toEqual([
      { method: "workspace.create", params: { cwd: "/repo/a-doc", focus: false, name: "a-doc" } },
    ]);
  });

  it("resolves an existing workspace's surface through pane.list, keyed by workspace id", async () => {
    const { calls, socket } = fakeSocket({
      replies: {
        "pane.list": {
          panes: [{ selected_surface_id: "S9", selected_surface_ref: "surface:9" }],
          workspace_id: "U9",
          workspace_ref: "workspace:9",
        },
      },
    });

    const resolved = await cmuxClientOver({ socket }).workspaceSurface({ workspaceId: "U9" });

    expect(unwrap(resolved)).toEqual({
      surfaceId: "S9",
      surfaceRef: "surface:9",
      workspaceId: "U9",
      workspaceRef: "workspace:9",
    });
    expect(calls).toEqual([{ method: "pane.list", params: { workspace_id: "U9" } }]);
  });

  it("addresses a send by workspace id and surface id, never by ref", async () => {
    const { calls, socket } = fakeSocket({ replies: { "surface.send_key": {}, "surface.send_text": {} } });

    const sent = await cmuxClientOver({ socket }).sendLine({
      target: { surfaceId: "S1", workspaceId: "U1" },
      text: "claude",
      wait: () => Promise.resolve(),
    });

    expect(sent.isOk()).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["surface.send_text", "surface.send_key"]);
    expect(calls[0]!.params).toEqual({ surface_id: "S1", text: "claude\n", workspace_id: "U1" });
    expect(calls[1]!.params).toEqual({ key: "enter", surface_id: "S1", workspace_id: "U1" });
  });

  it("does not send the Enter at all when the paste itself failed", async () => {
    const { calls, socket } = fakeSocket({ replies: {} });

    const sent = await cmuxClientOver({ socket }).sendLine({
      target: { workspaceId: "U1" },
      text: "claude",
      wait: () => Promise.resolve(),
    });

    expect(sent.isErr()).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["surface.send_text"]);
  });

  it("submits a composer with ONE enter and no send_text — the distinction sendLine cannot make", async () => {
    // This is the whole safety of `cmux/pickupWitnessWindow.ts`'s re-submit: it types nothing, so on a
    // composer already holding the pickup line it submits that line rather than appending a second copy of it.
    const { calls, socket } = fakeSocket({ replies: { "surface.send_key": {} } });

    const submitted = await cmuxClientOver({ socket }).submitComposer({
      target: { surfaceId: "S1", workspaceId: "U1" },
    });

    expect(submitted.isOk()).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["surface.send_key"]);
    expect(calls[0]!.params).toEqual({ key: "enter", surface_id: "S1", workspace_id: "U1" });
  });

  it("interrupts a turn with one escape, addressed by id", async () => {
    const { calls, socket } = fakeSocket({ replies: { "surface.send_key": {} } });

    const interrupted = await cmuxClientOver({ socket }).interruptTurn({
      target: { surfaceId: "S1", workspaceId: "U1" },
    });

    expect(interrupted.isOk()).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(["surface.send_key"]);
    expect(calls[0]!.params).toEqual({ key: "escape", surface_id: "S1", workspace_id: "U1" });
  });

  it("pins a workspace via workspace.action, keyed by id", async () => {
    const { calls, socket } = fakeSocket({ replies: { "workspace.action": { pinned: true } } });

    const pinned = await cmuxClientOver({ socket }).pinWorkspace({ workspaceId: "U1" });

    expect(pinned.isOk()).toBe(true);
    expect(calls).toEqual([{ method: "workspace.action", params: { action: "pin", workspace_id: "U1" } }]);
  });

  it("unpins a workspace via workspace.action, keyed by id", async () => {
    const { calls, socket } = fakeSocket({ replies: { "workspace.action": { pinned: false } } });

    const unpinned = await cmuxClientOver({ socket }).unpinWorkspace({ workspaceId: "U1" });

    expect(unpinned.isOk()).toBe(true);
    expect(calls).toEqual([{ method: "workspace.action", params: { action: "unpin", workspace_id: "U1" } }]);
  });

  it("asks for scrollback only when a caller wants it", async () => {
    const { calls, socket } = fakeSocket({ replies: { "surface.read_text": { text: "screen" } } });
    const client = cmuxClientOver({ socket });

    await client.readScreen({ target: { workspaceId: "U1" } });
    await client.readScreen({ scrollbackLines: 200, target: { workspaceId: "U1" } });

    expect(calls[0]!.params).toEqual({ workspace_id: "U1" });
    expect(calls[1]!.params).toEqual({ lines: 200, scrollback: true, workspace_id: "U1" });
  });

  it("fans workspace.list out across every window", async () => {
    const { calls, socket } = fakeSocket({
      replies: {
        "window.list": { windows: [{ id: "W1" }, { id: "W2" }] },
        "workspace.list": { window_id: "W1", workspaces: [{ current_directory: "/a", id: "U1", ref: "workspace:1" }] },
      },
    });

    const listed = await cmuxClientOver({ socket }).listWorkspaces();

    expect(listed.isOk()).toBe(true);
    expect(unwrap(listed).length).toBe(2);
    expect(calls.map((call) => call.method)).toEqual(["window.list", "workspace.list", "workspace.list"]);
    expect(calls[1]!.params).toEqual({ window_id: "W1" });
    expect(calls[2]!.params).toEqual({ window_id: "W2" });
  });

  it("resolves a ref to the live workspace it names", async () => {
    const { socket } = fakeSocket({
      replies: {
        "window.list": { windows: [{ id: "W1" }] },
        "workspace.list": { window_id: "W1", workspaces: [{ current_directory: "/a", id: "U1", ref: "workspace:7" }] },
      },
    });

    const resolved = await cmuxClientOver({ socket }).resolveWorkspace({ ref: "workspace:7" });

    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved).workspaceId).toBe("U1");
  });

  it("refuses a ref no live workspace answers to, rather than letting cmux pick the focused one", async () => {
    const { socket } = fakeSocket({
      replies: { "window.list": { windows: [] }, "workspace.list": { window_id: "W1", workspaces: [] } },
    });

    const resolved = await cmuxClientOver({ socket }).resolveWorkspace({ ref: "workspace:999" });

    expect(resolved.isErr()).toBe(true);
    expect(unwrapErr(resolved).message).toContain("workspace:999");
  });

  it("closes a workspace by id", async () => {
    const { calls, socket } = fakeSocket({ replies: { "workspace.close": {} } });

    const closed = await cmuxClientOver({ socket }).closeWorkspace({ workspaceId: "U1" });

    expect(closed.isOk()).toBe(true);
    expect(calls[0]).toEqual({ method: "workspace.close", params: { workspace_id: "U1" } });
  });

  it("sends force only when asked for it, and omits it rather than sending false", async () => {
    const { calls, socket } = fakeSocket({ replies: { "workspace.close": {} } });
    const client = cmuxClientOver({ socket });

    await client.closeWorkspace({ force: true, workspaceId: "U1" });
    await client.closeWorkspace({ force: false, workspaceId: "U2" });

    expect(calls).toEqual([
      { method: "workspace.close", params: { force: true, workspace_id: "U1" } },
      { method: "workspace.close", params: { workspace_id: "U2" } },
    ]);
  });

  it("asks system.top for processes explicitly", async () => {
    const { calls, socket } = fakeSocket({ replies: { "system.top": { windows: [] } } });

    await cmuxClientOver({ socket }).processTree({ workspaceId: "U1" });

    expect(calls[0]!.params).toEqual({ include_processes: true, workspace_id: "U1" });
  });
});
