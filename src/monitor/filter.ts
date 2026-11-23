/**
 * The cmux notification filter — no cmux banner reaches the owner's desktop; the floating note is the one surface.
 *
 * Floating macOS notes replace cmux notifications entirely, because a note links to something useful on click.
 * A step or question aimed at the owner arrives as a `hand post` note, which carries the one act and a link to the
 * row; a cmux banner carries neither. So every banner and every sound is taken off, the supervisor chair's
 * included. MEASURED on the owner's machine: cmux raised 10,035 desktop banners in 44 days, 61% of them
 * while cmux was not the focused app. Reproduce the count with
 * `wc -l ~/.config/cmux/notification-payloads.jsonl`.
 *
 * ## What the hook contract actually is
 *
 * cmux pipes one notification's policy JSON to a script on stdin and uses that script's STDOUT as the
 * updated policy. Seven effects are independently switchable — `record`, `markUnread`, `reorderWorkspace`,
 * `desktop`, `sound`, `command`, `paneFlash`. Proven honoured today with a control in the same pass: an arm
 * matching only the first of two notifications suppressed that one and left the second untouched.
 *
 * ## What it logs
 *
 * **`notification.workspaceId` is on the payload**, so each decision line names the workspace that spoke —
 * the record of which sessions would have interrupted the owner. **`context.cwd` is useless** — measured across all 10,035 payloads it is
 * `~/.config/cmux` on every one,
 * the hook's own working directory rather than the workspace's, so a filter keying on it would match nothing.
 *
 * ## It suppresses the BANNER, never the record
 *
 * Only `desktop` and `sound` are flipped. `record`, `markUnread`, `reorderWorkspace` and `paneFlash` are
 * left exactly as cmux set them, so the sidebar still bolds a row that spoke and the inbox still carries it —
 * what stops is the thing that interrupts the owner. A filter that suppressed the record too would be the mirror
 * failure of the flood: state the owner cannot find because nothing wrote it down.
 *
 * ## It fails OPEN, in two places, on purpose
 *
 * No `jq`, or an unparseable payload: each re-emits stdin byte-identically. cmux's own
 * documented behaviour on a hook error is to use default notification behaviour, so the worst case of this
 * whole lane is the noise the owner already has — never a banner that silently never arrives. That direction is the
 * one a filter deciding what the owner sees is allowed to fail in.
 *
 * Pure: paths in, script text out, or a typed refusal. Nothing here touches a disk — `./filterInstall.ts` does.
 */

import { err, ok, type Result } from "../lib/result.js";

import { type MonitorError, MonitorErrors } from "./errors.js";

/**
 * The characters a path may not carry to reach the emitted script.
 *
 * The script quotes each path into a double-quoted shell word, where exactly these four still have meaning:
 * a quote ends the word, `$` and a backtick substitute, and a backslash escapes. A newline is in the set
 * because it ends the statement outright. Rejecting rather than escaping is deliberate — an escaping routine
 * is a second parser to keep in step with `/bin/sh`, and no legitimate state home contains any of them.
 */
const SHELL_UNSAFE = /["$`\\\n\r]/;

/**
 * Check one path is quotable into the script, unchanged.
 *
 * @param path the absolute path about to be written into a shell word
 * @returns the path, or the refusal naming it
 */
function quotable({ path }: { path: string }): Result<string, MonitorError> {
  if (SHELL_UNSAFE.test(path)) {
    return err(MonitorErrors.scriptUnsafe({ value: path }));
  }
  return ok(path);
}

/** Everything the emitted filter needs to know about this install. */
export interface FilterPaths {
  /** Where each decision is appended, one compact line, so the filter's own behaviour stays measurable. */
  readonly decisionsPath: string;
}

/**
 * Compose the filter script.
 *
 * @param paths the decision log to append
 * @returns the whole script text, or the refusal when the path cannot be quoted into it
 */
export function buildFilterScript({ paths }: { paths: FilterPaths }): Result<string, MonitorError> {
  const decisions = quotable({ path: paths.decisionsPath });
  if (decisions.isErr()) {
    return err(decisions.error);
  }
  return ok(
    [
      "#!/bin/sh",
      "# cmux notification filter — emitted by `slopweaver monitor filter install`. Do not hand-edit:",
      "# the verb rewrites this file, so an edit here is lost the next time it runs.",
      "#",
      "# cmux pipes one notification's policy JSON on stdin and uses this script's stdout as the policy.",
      "# Every notification keeps its record, its unread mark and its sidebar reorder and loses the desktop",
      "# banner and the sound — the supervisor chair's too. The floating note (`slopweaver hand post`) is the",
      "# one surface that interrupts the owner.",
      "#",
      "# It fails OPEN: no jq or an unparseable payload re-emits stdin byte-identically, so the worst case",
      "# is the noise that was already there.",
      "#",
      "# Restore the previous hook with the `.bak` beside whatever cmux.json points at, then reload cmux.",
      "set -u",
      `LOG="${decisions.value}"`,
      "payload=$(cat)",
      "",
      "if ! command -v jq >/dev/null 2>&1; then",
      '  printf "%s" "$payload"',
      "  exit 0",
      "fi",
      "",
      `quiet=$(printf "%s" "$payload" | jq -c '.effects.desktop = false | .effects.sound = false' 2>/dev/null)`,
      'if [ -z "$quiet" ]; then',
      '  printf "%s" "$payload"',
      "  exit 0",
      "fi",
      "",
      `speaker=$(printf "%s" "$payload" | jq -r '.notification.workspaceId // empty' 2>/dev/null)`,
      'printf \'{"at":"%s","workspaceId":"%s","decision":"suppressed"}\\n\' \\',
      '  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$speaker" >> "$LOG" 2>/dev/null',
      'printf "%s" "$quiet"',
      "",
    ].join("\n"),
  );
}

/**
 * Compose the one-line shim that lives where cmux's config already points.
 *
 * **Why a shim rather than rewriting the owner's `cmux.json`.** That file is JSONC carrying about a hundred lines of
 * the owner's own commentary explaining every setting and how to revert it, and a JSON round trip destroys all of it.
 * So the verb owns two files with different lifetimes: the FILTER under the state home, rewritten freely
 * whenever the lane changes, and this shim at the path cmux already knows, written once and never again.
 * Nothing in the config moves, so nothing needs reloading beyond what cmux already does per notification.
 *
 * @param filterPath the real filter this hands off to
 * @returns the shim's text, or the refusal when the path cannot be quoted
 */
export function buildFilterShim({ filterPath }: { filterPath: string }): Result<string, MonitorError> {
  const target = quotable({ path: filterPath });
  if (target.isErr()) {
    return err(target.error);
  }
  return ok(
    [
      "#!/bin/sh",
      "# Slopweaver notification filter shim — emitted by `slopweaver monitor filter install`.",
      "# cmux.json points here; the real filter lives under the state home so the verb can rewrite it",
      "# without touching a config file full of the owner's own comments. Reinstall with the verb, never by hand.",
      `exec "${target.value}" "$@"`,
      "",
    ].join("\n"),
  );
}
