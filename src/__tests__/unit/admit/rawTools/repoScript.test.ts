/*
 * `classifyRawCommand` on a repo-local script that wraps gh: given a reader, the script is judged by its text and
 * pointed at the checks verb; without one, by name alone; and a known tool given by full path is never opened.
 */
import { describe, expect, it } from "vitest";

import { classifyRawCommand, RAW_ESCAPE } from "../../../../admit/rawTools.js";
import { isBlocked } from "./harness.js";

describe("classifyRawCommand — a repo-local script that wraps gh", () => {
  /** A fake reader: the one script it knows shells `gh` inside a loop; everything else is unreadable. */
  const readScript = ({ path }: { path: string }): string | undefined =>
    path.endsWith("watch.sh") ? 'while :; do snap=$(gh api graphql -f query="$Q"); sleep 20; done' : undefined;

  it("blocks the script by its text — direct, dotted, behind a shell, behind nohup, and inside a -c wrapper", () => {
    for (const command of [
      "scripts/ship/watch.sh --pr 1",
      "./scripts/ship/watch.sh --pr 1 --exit-on ci",
      "bash scripts/ship/watch.sh --pr 1",
      "nohup bash scripts/ship/watch.sh 1 > out.log 2>&1 &",
      'cd "$(git rev-parse --show-toplevel)" && scripts/ship/watch.sh --pr 1',
      "bash -c 'trap \"\" USR1 USR2; exec scripts/ship/watch.sh --pr 1'",
    ]) {
      const verdict = classifyRawCommand({ allowRaw: false, command, readScript });
      expect(verdict.blocked).toBe(true);
    }
  });

  it("names the script and the reach, and points at the checks verb", () => {
    const verdict = classifyRawCommand({ allowRaw: false, command: "scripts/ship/watch.sh --pr 1", readScript });
    if (!verdict.blocked) {
      throw new Error("expected blocked");
    }
    expect(verdict.tool).toBe("gh");
    expect(verdict.reason).toBe(
      "`scripts/ship/watch.sh` — the script shells `gh` internally, reaching GitHub outside the door",
    );
    expect(verdict.message).toContain("slopweaver github checks --number <n> --wait");
    expect(verdict.message).toContain(RAW_ESCAPE);
  });

  it("is judged by name alone without a reader — the pure default, and the shape that let it through", () => {
    expect(isBlocked({ command: "scripts/ship/watch.sh --pr 1" })).toBe(false);
  });

  it("passes a script the reader cannot open, and a script that reaches nothing", () => {
    expect(classifyRawCommand({ allowRaw: false, command: "scripts/other.sh", readScript }).blocked).toBe(false);
    const quiet = ({ path }: { path: string }): string | undefined =>
      path === "./quiet.sh" ? "jq -r .x < f\nsleep 1" : undefined;
    expect(classifyRawCommand({ allowRaw: false, command: "./quiet.sh", readScript: quiet }).blocked).toBe(false);
  });

  it("honours the escape, process-wide and inline on the segment", () => {
    expect(classifyRawCommand({ allowRaw: true, command: "scripts/ship/watch.sh", readScript })).toEqual({
      blocked: false,
      tool: "gh",
    });
    expect(
      classifyRawCommand({ allowRaw: false, command: "SLOPWEAVER_ALLOW_RAW=1 scripts/ship/watch.sh", readScript })
        .blocked,
    ).toBe(false);
  });

  it("does not open a known tool given by full path", () => {
    const everything = (): string => "gh pr close 1";
    expect(
      classifyRawCommand({ allowRaw: false, command: "/usr/bin/gh pr checks 1", readScript: everything }).blocked,
    ).toBe(false);
  });
});
