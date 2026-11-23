/**
 * The two printers every lifecycle gate shares, over an injected line sink: one marked, indented line per
 * probe verdict, and a parked run's checkpoint block — a blank separator, then each checkpoint line indented —
 * or nothing at all when the run never parked.
 */
import { describe, expect, it } from "vitest";

import {
  askedQuestion,
  declaredRepo,
  printParkedResume,
  printProbes,
} from "../../../../../cli/commands/handover/runContextTypes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { type RunEvent, runStateOf } from "../../../../../handover/ledger.js";
import { parkedResumeLines } from "../../../../../handover/parked.js";
import type { ProbeResult } from "../../../../../handover/probe.js";
import type { Logger } from "../../../../../lib/logger.js";

const SLUG = "card-provenance";
const WRITER = "89e81284-ee20-4e94-8896-6c17a2d10a50";

const STARTED: RunEvent = { atIso: "2026-10-04T01:00:00.000Z", branch: SLUG, docHash: "h", kind: "started" };
/** The writer's own launch, so the park below is by the run's writer and the seat reads as not reopened. */
const LAUNCHED: RunEvent = {
  atIso: "2026-10-04T01:00:01.000Z",
  kind: "launched",
  pid: 4242,
  sessionId: WRITER,
  worktree: "/wt/card-provenance",
};
const ASKED: RunEvent = { atIso: "2026-10-04T02:00:00.000Z", kind: "question", question: "Which label?" };
const PARKED: RunEvent = {
  atIso: "2026-10-04T03:00:00.000Z",
  branch: SLUG,
  kind: "parked",
  question: "Which label?",
  screenTail: "❯ ",
  sessionId: WRITER,
  workspaceRef: "workspace:238",
  worktree: "/wt/card-provenance",
};

/**
 * A sink that keeps every line written to it, in order.
 *
 * @returns the sink and the lines it has received so far
 */
function recordingSink(): { readonly out: Logger["out"]; readonly lines: string[] } {
  const lines: string[] = [];
  const out: Logger["out"] = ({ line }) => {
    lines.push(line);
  };
  return { lines, out };
}

describe("printProbes", () => {
  it("writes one indented line per probe, marked by its outcome and carrying its note", () => {
    const sink = recordingSink();
    const results: readonly ProbeResult[] = [
      { note: "present in src/a.ts", outcome: "pass", probe: { file: "src/a.ts", kind: "present", symbol: "a" } },
      { note: "still in src/b.ts", outcome: "fail", probe: { file: "src/b.ts", kind: "absent", symbol: "b" } },
      { note: "commands are not run here", outcome: "not-evaluated", probe: { command: "yarn x", kind: "command" } },
    ];

    printProbes({ out: sink.out, results });

    expect(sink.lines).toEqual(["  ✔ present in src/a.ts", "  ✘ still in src/b.ts", "  – commands are not run here"]);
  });

  it("writes nothing for an empty probe list", () => {
    const sink = recordingSink();

    printProbes({ out: sink.out, results: [] });

    expect(sink.lines).toEqual([]);
  });
});

describe("declaredRepo", () => {
  /** A doc parsed from front matter, with whatever extra lines the case needs. */
  const docWith = ({ extra }: { extra: string }) =>
    parseHandoverDoc({ path: "/board/a-doc.md", text: `---\nslug: a-doc\nstatus: ready\n${extra}---\n# body\n` });

  it("names the repository the doc declares", () => {
    expect(declaredRepo({ doc: docWith({ extra: "repo: /repos/slopweaver\n" }) })).toBe("/repos/slopweaver");
  });

  it("says none was declared for a doc with no `repo:`", () => {
    expect(declaredRepo({ doc: docWith({ extra: "" }) })).toBe("(none declared)");
  });
});

describe("askedQuestion", () => {
  it("quotes the question the run is waiting on", () => {
    expect(askedQuestion({ run: runStateOf({ events: [STARTED, ASKED] }) })).toBe("Which label?");
  });

  it("says the question was recorded but cannot be read when the run carries no text for it", () => {
    const run = { ...runStateOf({ events: [STARTED, ASKED] }), openQuestion: undefined };
    expect(askedQuestion({ run })).toBe("(recorded, but unreadable)");
  });
});

describe("printParkedResume", () => {
  it("writes nothing for a run that never parked", () => {
    const sink = recordingSink();

    printParkedResume({ events: [STARTED, ASKED], out: sink.out, slug: SLUG });

    expect(sink.lines).toEqual([]);
  });

  it("writes a blank separator and then every checkpoint line indented two spaces", () => {
    const sink = recordingSink();

    printParkedResume({ events: [STARTED, LAUNCHED, ASKED, PARKED], out: sink.out, slug: SLUG });

    expect(sink.lines[0]).toBe("");
    expect(sink.lines[1]).toBe(
      "  PARKED 2026-10-04T03:00:00.000Z — workspace:238 was closed at rest; the seat is NOT open",
    );
    expect(sink.lines[2]).toBe("    worktree: /wt/card-provenance (rebuilt from the branch if it is gone)");
    expect(sink.lines).toEqual([
      "",
      ...parkedResumeLines({ events: [STARTED, LAUNCHED, ASKED, PARKED], slug: SLUG }).map((line) => `  ${line}`),
    ]);
  });
});
