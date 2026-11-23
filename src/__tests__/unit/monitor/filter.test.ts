import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { buildFilterScript, buildFilterShim } from "../../../monitor/filter.js";
import { hookBackupPath, hookCommandPaths, installFilter, readFilterStatus } from "../../../monitor/filterInstall.js";

/** The supervisor chair's workspace id, as `sessions/supervisor-pin.json` records it. */
const CHAIR = "6BA98076-2D8A-4094-BD79-3CDAFB820EC6";
const OTHER = "22C9AC55-1CEF-4BD2-A0AF-118435F755F8";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "monfilter-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** The one path the emitted script is told about. */
function paths(): { readonly decisionsPath: string } {
  return { decisionsPath: join(root, "decisions.jsonl") };
}

/**
 * Write the emitted filter to disk, executable.
 *
 * @returns the script's path
 */
function armedFilter(): string {
  const script = join(root, "filter.sh");
  writeFileSync(script, unwrap(buildFilterScript({ paths: paths() })), "utf8");
  chmodSync(script, 0o700);
  return script;
}

/**
 * Run the emitted filter over one policy payload, exactly as cmux does.
 *
 * @param script the filter's path
 * @param workspaceId which workspace the notification names, or `undefined` to omit the field
 * @returns the script's stdout, which cmux uses as the updated policy
 */
function judge({ script, workspaceId }: { script: string; workspaceId: string | undefined }): string {
  const notification = workspaceId === undefined ? { title: "Claude Code" } : { title: "Claude Code", workspaceId };
  const payload = JSON.stringify({
    context: { appFocused: false },
    effects: {
      command: true,
      desktop: true,
      markUnread: true,
      paneFlash: true,
      record: true,
      reorderWorkspace: true,
      sound: true,
    },
    notification,
    version: 1,
  });
  return execFileSync(script, [], { encoding: "utf8", input: payload });
}

describe("buildFilterScript", () => {
  it("refuses a path it cannot quote into a shell word rather than escaping one", () => {
    const failure = unwrapErr(buildFilterScript({ paths: { decisionsPath: '/tmp/"evil".jsonl' } }));
    expect(failure.code).toBe("SCRIPT_UNSAFE");
    expect(failure.message).toContain("refusing to emit a script");
  });

  it("carries the decision log's path into the script it emits, and reads no pin", () => {
    const script = unwrap(buildFilterScript({ paths: paths() }));
    expect(script).toContain(`LOG="${paths().decisionsPath}"`);
    expect(script.includes("PIN=")).toBe(false);
  });
});

describe("the emitted filter, run as cmux runs it", () => {
  it("takes the banner and the sound off the supervisor chair too — the floating note is the one surface", () => {
    const script = armedFilter();
    const out = JSON.parse(judge({ script, workspaceId: CHAIR })) as { effects: { desktop: boolean; sound: boolean } };
    expect(out.effects.desktop).toBe(false);
    expect(out.effects.sound).toBe(false);
  });

  it("takes the desktop banner and the sound off every other workspace", () => {
    const script = armedFilter();
    const out = JSON.parse(judge({ script, workspaceId: OTHER })) as {
      effects: { desktop: boolean; sound: boolean };
    };
    expect(out.effects.desktop).toBe(false);
    expect(out.effects.sound).toBe(false);
  });

  it("leaves the record, the unread mark and the sidebar reorder exactly as cmux set them", () => {
    const script = armedFilter();
    const out = JSON.parse(judge({ script, workspaceId: OTHER })) as { effects: Record<string, boolean> };
    expect(out.effects).toEqual({
      command: true,
      desktop: false,
      markUnread: true,
      paneFlash: true,
      record: true,
      reorderWorkspace: true,
      sound: false,
    });
  });

  it("silences a payload carrying no workspace id at all, and logs it with an empty one", () => {
    const script = armedFilter();
    const out = JSON.parse(judge({ script, workspaceId: undefined })) as { effects: { desktop: boolean } };
    expect(out.effects.desktop).toBe(false);
    expect(JSON.parse(readFileSync(paths().decisionsPath, "utf8").trim()).workspaceId).toBe("");
  });

  it("fails OPEN on a payload it cannot parse, re-emitting it byte for byte", () => {
    const script = armedFilter();
    expect(execFileSync(script, [], { encoding: "utf8", input: "not json" })).toBe("not json");
  });

  it("records one decision line per notification, so the filter's own behaviour stays measurable", () => {
    const script = armedFilter();
    judge({ script, workspaceId: CHAIR });
    judge({ script, workspaceId: OTHER });
    const lines = readFileSync(paths().decisionsPath, "utf8").trim().split("\n");
    expect(lines.map((line) => JSON.parse(line) as { decision: string; workspaceId: string })).toEqual([
      expect.objectContaining({ decision: "suppressed", workspaceId: CHAIR }),
      expect.objectContaining({ decision: "suppressed", workspaceId: OTHER }),
    ]);
  });
});

describe("buildFilterShim", () => {
  it("execs the real filter and names nothing else", () => {
    expect(unwrap(buildFilterShim({ filterPath: "/home/hooks/f.sh" }))).toContain('exec "/home/hooks/f.sh" "$@"');
  });

  it("refuses an unquotable target", () => {
    expect(unwrapErr(buildFilterShim({ filterPath: "/tmp/$(rm -rf /).sh" })).code).toBe("SCRIPT_UNSAFE");
  });
});

describe("hookCommandPaths", () => {
  it("finds the hook command in a JSONC config full of the owner's own comments", () => {
    const config = [
      "{",
      "  // ── DISCOVERY ONLY · remove once the real filter is built ──",
      '  // "command": "/decoy/never-real.sh",',
      '  "notifications": {',
      '    "suppressOnlyFocusedSurface": true,',
      '    "hooks": [',
      "      {",
      '        "id": "payload-log",',
      '        "command": "/Users/x/.config/cmux/hooks/log-notification.sh",',
      '        "enabled": true',
      "      }",
      "    ]",
      "  }",
      "}",
    ].join("\n");
    expect(hookCommandPaths({ configText: config })).toEqual(["/Users/x/.config/cmux/hooks/log-notification.sh"]);
  });

  it("answers nothing for a config declaring no hooks at all", () => {
    expect(hookCommandPaths({ configText: '{ "notifications": { "sound": "default" } }' })).toEqual([]);
  });

  it("answers nothing for an empty hooks array", () => {
    expect(hookCommandPaths({ configText: '{ "notifications": { "hooks": [] } }' })).toEqual([]);
  });
});

describe("installFilter", () => {
  it("writes the filter, replaces the hook with a shim pointing at it, and backs up what was there", () => {
    const hookPath = join(root, "cmux-hooks", "log-notification.sh");
    mkdirSync(join(root, "cmux-hooks"), { recursive: true });
    writeFileSync(hookPath, "#!/bin/sh\n# the owner's own passthrough logger\ncat\n", "utf8");
    const filterPath = join(root, "state", "hooks", "cmux-notification-filter.sh");
    const receipt = unwrap(installFilter({ filterPath, hookPath, paths: paths() }));
    expect(receipt.backupPath).toBe(hookBackupPath({ hookPath }));
    expect(readFileSync(receipt.backupPath!, "utf8")).toContain("the owner's own passthrough logger");
    expect(readFileSync(hookPath, "utf8")).toContain(`exec "${filterPath}" "$@"`);
    expect(readFileSync(filterPath, "utf8")).toContain("cmux notification filter");
  });

  it("does not overwrite an existing backup, so a second install cannot lose the owner's original", () => {
    const hookPath = join(root, "hook.sh");
    writeFileSync(hookPath, "#!/bin/sh\n# the original\ncat\n", "utf8");
    const filterPath = join(root, "filter.sh");
    unwrap(installFilter({ filterPath, hookPath, paths: paths() }));
    unwrap(installFilter({ filterPath, hookPath, paths: paths() }));
    expect(readFileSync(hookBackupPath({ hookPath }), "utf8")).toContain("the original");
  });

  it("reports no backup when there was nothing at the hook path to replace", () => {
    const receipt = unwrap(
      installFilter({ filterPath: join(root, "f.sh"), hookPath: join(root, "absent.sh"), paths: paths() }),
    );
    expect(receipt.backupPath).toBeUndefined();
  });

  it("refuses before writing anything when a path cannot be quoted", () => {
    const failure = unwrapErr(
      installFilter({
        filterPath: join(root, "f.sh"),
        hookPath: join(root, "hook.sh"),
        paths: { decisionsPath: "/tmp/`whoami`.jsonl" },
      }),
    );
    expect(failure.code).toBe("SCRIPT_UNSAFE");
  });
});

describe("readFilterStatus", () => {
  it("reports not installed when the hook does not hand off to this filter", () => {
    const status = readFilterStatus({
      decisionsPath: paths().decisionsPath,
      filterPath: join(root, "f.sh"),
      hookPath: join(root, "absent.sh"),
    });
    expect(status.installed).toBe(false);
    expect(status.filterPresent).toBe(false);
    expect(status.decisions).toBeUndefined();
  });

  it("counts what the filter has actually judged, which is what makes it falsifiable", () => {
    const script = armedFilter();
    judge({ script, workspaceId: CHAIR });
    judge({ script, workspaceId: OTHER });
    judge({ script, workspaceId: OTHER });
    const status = readFilterStatus({
      decisionsPath: paths().decisionsPath,
      filterPath: script,
      hookPath: script,
    });
    expect(status.decisions).toEqual({ judged: 3, passed: 0 });
  });
});
