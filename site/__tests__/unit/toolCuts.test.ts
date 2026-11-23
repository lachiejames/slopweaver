import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import type { CutProbe } from "../../lib/cutProbe";
import { TALK_TOOLS } from "../../lib/talkToolsList";
import { TOOL_CUTS, toolCutsOf } from "../../lib/toolCuts";
import { VERB_CHILD_CUTS } from "../../lib/verbChildCuts";

/** Where the read tools' answers are shaped: the talk tree and its verbs, the Slack reads, and the page readings. */
const PRODUCER_ROOTS = ["src/talk", "src/cli/commands/talk", "src/live/slack", "site/lib", "site/components/live"];

/** Every field name a non-test TypeScript file under a root declares or writes as `name:`. */
function fieldsDeclaredUnder({ root }: { root: string }): readonly string[] {
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
  return files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/\b([A-Za-z_]\w*)\??:/g)].flatMap((match) => match.slice(1, 2)),
  );
}

/** The dotted path one probe reads from. */
function probePath({ probe }: { probe: CutProbe }): string {
  if ("set" in probe) {
    return probe.set;
  }
  if ("at" in probe) {
    return probe.at;
  }
  if ("anyOf" in probe) {
    return probe.anyOf;
  }
  return probe.each;
}

/** Every field name one probe reads. */
function probeFields({ probe }: { probe: CutProbe }): readonly string[] {
  const names = probePath({ probe }).split(/\[\]\.|\./);
  if ("field" in probe) {
    names.push(probe.field);
  }
  if ("says" in probe && probe.says !== undefined) {
    names.push(probe.says);
  }
  return names;
}

/** One tool's parsed answer, as `toolCutsOf` takes it. */
type Answer = Parameters<typeof toolCutsOf>[0]["answer"];

/** The files that write recall's `notSearched` reasons: the answer, and the verb that says a source was not asked for. */
const RECALL_PRODUCERS = ["src/talk/recall.ts", "src/cli/commands/talk/recallRun.ts"];

describe("TOOL_CUTS", () => {
  it("has exactly one entry per read tool the model can call, so a new read tool is a decision", () => {
    const reads = TALK_TOOLS.filter((tool) => tool.does === "read").map((tool) => tool.name);
    expect(reads.length).toBeGreaterThan(0);
    expect(Object.keys(TOOL_CUTS).toSorted()).toEqual(reads.toSorted());
  });

  it("says, for every read tool, what it previews and where the whole is, or why it carries no cut", () => {
    expect(Object.entries(TOOL_CUTS).filter(([, entry]) => entry.previews.trim() === "")).toEqual([]);
  });

  // Probe paths were strings nothing checked against a producer.
  it("probes only fields a read tool's source declares, so a renamed field fails here instead of reading whole", () => {
    const declared = new Set(PRODUCER_ROOTS.flatMap((root) => fieldsDeclaredUnder({ root })));
    const named = Object.values(TOOL_CUTS).flatMap((entry) => entry.probes.flatMap((probe) => probeFields({ probe })));
    expect(named.length).toBeGreaterThan(0);
    expect([...new Set(named)].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("probes a verb's stdout only at fields the source declares, and only for verbs the allowlist holds", () => {
    const declared = new Set(fieldsDeclaredUnder({ root: "src" }));
    const named = Object.values(VERB_CHILD_CUTS).flatMap((probes) => probes.flatMap((probe) => probeFields({ probe })));
    expect(named.length).toBeGreaterThan(0);
    expect([...new Set(named.flatMap((name) => name.split(".")))].filter((name) => !declared.has(name))).toEqual([]);
    const allowlist = readFileSync("src/talk/modelReads.ts", "utf8");
    const absent = Object.keys(VERB_CHILD_CUTS).filter((words) => {
      const [noun, verb] = words.split(" ");
      return !allowlist.includes(`noun: "${noun}"`) || !allowlist.includes(`verb: "${verb}"`);
    });
    expect(absent).toEqual([]);
  });

  // A standing phrase the producer no longer writes would read every real loss as standing, or none as one.
  it("excuses only recall reasons its producers actually write", () => {
    const written = RECALL_PRODUCERS.map((file) => readFileSync(file, "utf8")).join("\n");
    const phrases = Object.entries(TOOL_CUTS)
      .filter(([name]) => name === "recall")
      .flatMap(([, entry]) => entry.probes.flatMap((probe) => ("unless" in probe ? probe.unless : [])));
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases.filter((phrase) => !written.includes(phrase))).toEqual([]);
  });
});

describe("toolCutsOf", () => {
  it("reads slack_unread's status, never its per-row unread counts", () => {
    const rows = { dms: { more: 0, rows: [{ unread: 3 }] }, residue: ["scope"] };
    expect(toolCutsOf({ answer: { ...rows, status: "complete" }, tool: "slack_unread" })).toEqual([]);
    expect(
      toolCutsOf({ answer: { ...rows, activity: { more: 4 }, status: "incomplete" }, tool: "slack_unread" }),
    ).toEqual(["status: incomplete", "activity.more: 4"]);
  });

  it("names a Slack read's loss said only in its warnings, past the standing bot-token caveat", () => {
    const answer = {
      omitted: 0,
      warnings: [
        "read with the BOT token: a private conversation the bot is not in cannot be read",
        "2 message(s) in the channel could not be read and are left out",
      ],
    };
    expect(toolCutsOf({ answer, tool: "slack_channel" })).toEqual([
      "warnings: 2 message(s) in the channel could not be read and are left out",
    ]);
    expect(toolCutsOf({ answer: { read: answer }, tool: "slack_open" })).toEqual([
      "read.warnings: 2 message(s) in the channel could not be read and are left out",
    ]);
  });

  it("counts origin passages cut by its own mark while the answer says truncated false, and unresolved anchors", () => {
    const answer: Answer = {
      anchorWords: [{ words: ["whole"] }, { why: "no transcript for session s1" }],
      quotes: ["short", `${"x".repeat(1500)} …`],
      truncated: false,
      whereFrom: [],
    };
    expect(toolCutsOf({ answer, tool: "origin" })).toEqual(["anchorWords[]: 1 why", 'quotes[]: 1 cut, ending "…"']);
  });

  it("names a verb that was stopped, even when what it printed fit", () => {
    const answer = { exitCode: null, stderr: { truncated: true }, stdout: { truncated: false }, timedOut: true };
    expect(toolCutsOf({ answer, tool: "verb" })).toEqual([
      "timedOut: true",
      "exitCode: null",
      "stderr.truncated: true",
    ]);
  });

  describe("a verb's own JSON", () => {
    const cuts = ({ child, command, over }: { child: object; command: string; over?: Answer }) =>
      toolCutsOf({
        answer: {
          command,
          exitCode: 0,
          format: "json",
          stderr: { truncated: false },
          stdout: { text: JSON.stringify(child), truncated: false },
          timedOut: false,
          ...over,
        },
        tool: "verb",
      });

    it("names a traced verb's loss, as coming from its stdout", () => {
      expect(cuts({ child: { truncated: true }, command: "datadog logs --query x --json" })).toEqual([
        "stdout truncated: true",
      ]);
      expect(cuts({ child: { data: { more: true } }, command: "gmail list --json" })).toEqual([
        "stdout data.more: true",
      ]);
      expect(cuts({ child: { data: { more: true } }, command: "drive list --json" })).toEqual([
        "stdout data.more: true",
      ]);
      expect(cuts({ child: { data: { complete: false } }, command: "calendar list --json" })).toEqual([
        "stdout data.complete: false",
      ]);
      expect(
        cuts({ child: { jobs: [{ log: { linesTruncated: 4 } }, { log: {} }] }, command: "github run-log 1 --json" }),
      ).toEqual(["stdout jobs[]: 1 log.linesTruncated"]);
    });

    it("reads a traced verb with nothing set as whole", () => {
      expect(cuts({ child: { truncated: false }, command: "datadog logs --json" })).toEqual([]);
      expect(cuts({ child: { data: { complete: true } }, command: "calendar list --json" })).toEqual([]);
      expect(cuts({ child: { data: { more: false } }, command: "drive list --json" })).toEqual([]);
    });

    it("reads a verb with no entry as whole, whatever its fields are called", () => {
      const child = { omitted: 3, refused: "x", truncated: true, unread: 9 };
      expect(cuts({ child, command: "secrets status --json" })).toEqual([]);
    });

    it("needs the whole words of the verb, so a longer verb name is not its neighbour", () => {
      expect(cuts({ child: { truncated: true }, command: "datadog logs-extra --json" })).toEqual([]);
    });

    it("parses only a whole JSON stdout", () => {
      const cutOff = { stdout: { text: '{"truncated":true}', truncated: true } };
      expect(cuts({ child: {}, command: "datadog logs --json", over: cutOff })).toEqual([]);
      expect(cuts({ child: { truncated: true }, command: "datadog logs", over: { format: "text" } })).toEqual([]);
    });

    it("keeps the verb's own markers ahead of its child's", () => {
      expect(cuts({ child: { truncated: true }, command: "datadog logs --json", over: { timedOut: true } })).toEqual([
        "timedOut: true",
        "stdout truncated: true",
      ]);
    });
  });

  it("counts a card's briefings that could not be opened, for every tool that answers a card", () => {
    const answer: Answer = { briefings: [{ read: true }, { read: false, why: "gone" }] };
    const named = ["read_card", "open_card", "triage_next"].map((tool) => toolCutsOf({ answer, tool }));
    expect(named).toEqual([
      ["briefings[]: 1 read false"],
      ["briefings[]: 1 read false"],
      ["briefings[]: 1 read false"],
    ]);
  });

  it("names a Queue count the screen could not read, and steers dropped to fit by the section they came from", () => {
    expect(
      toolCutsOf({ answer: { complete: true, shown: { Everything: 4, Queue: "unread" } }, tool: "action_items" }),
    ).toEqual(["shown: unread for Queue"]);
    const steers = { calls: [{ linesCut: 0 }, { linesCut: 12 }], notShown: { calls: 2, steers: 0 }, unread: [] };
    expect(toolCutsOf({ answer: steers, tool: "recent_steers" })).toEqual(["notShown: calls 2", "calls[]: 1 linesCut"]);
  });

  it("counts an origin's mentioned rows' quotes cut by its own mark, as it counts its own", () => {
    const answer = {
      mentioned: [{ quotes: [`${"x".repeat(1500)} …`], slug: "source-row" }],
      quotes: [],
      truncated: false,
    };
    expect(toolCutsOf({ answer, tool: "origin" })).toEqual(['mentioned[].quotes[]: 1 cut, ending "…"']);
  });

  it("names a recall source it could not search, never one left out on purpose or the standing line", () => {
    const standing = {
      source: "supervisor-chat",
      why: "what the owner TYPED into the supervisor chat is not in this search; supervisor_history reads its last day",
    };
    const recall = (notSearched: readonly { source: string; why: string }[]) =>
      toolCutsOf({ answer: { notSearched: [...notSearched, standing] }, tool: "recall" });
    expect(recall([])).toEqual([]);
    expect(recall([{ source: "steers", why: "not asked for: --source calls" }])).toEqual([]);
    expect(recall([{ source: "knowledge", why: "the knowledge store did not answer" }])).toEqual([
      "notSearched: the knowledge store did not answer",
    ]);
  });

  it("names code_find's aliased names it skipped, and leaves binaries as the scope of a text search", () => {
    const answer = {
      aliasSkipped: 2,
      binarySkipped: 40,
      excerptBudgetExhausted: false,
      hitLimitReached: false,
      hits: [],
    };
    expect(toolCutsOf({ answer, tool: "code_find" })).toEqual(["aliasSkipped: 2"]);
  });

  it("names each cut the read tools' producers now print, and nothing for the same field unset", () => {
    expect(toolCutsOf({ answer: { contextClipped: 3, contextOmitted: 2 }, tool: "recall_open" })).toEqual([
      "contextOmitted: 2",
    ]);
    expect(toolCutsOf({ answer: { contextClipped: 3, contextOmitted: 0 }, tool: "recall_open" })).toEqual([]);
    expect(toolCutsOf({ answer: { undecodableNames: 1, unreadableSkipped: 4 }, tool: "code_find" })).toEqual([
      "unreadableSkipped: 4",
      "undecodableNames: 1",
    ]);
    expect(toolCutsOf({ answer: { unreadableSkipped: 0 }, tool: "code_find" })).toEqual([]);
    expect(toolCutsOf({ answer: { undecodableNames: 1 }, tool: "code_list" })).toEqual(["undecodableNames: 1"]);
    expect(toolCutsOf({ answer: { mentionedOmitted: 2, truncated: false }, tool: "origin" })).toEqual([
      "mentionedOmitted: 2",
    ]);
    expect(toolCutsOf({ answer: { outlineCut: true, truncated: false }, tool: "browser" })).toEqual([
      "outlineCut: true",
    ]);
    expect(toolCutsOf({ answer: { outlineCut: false, truncated: false }, tool: "browser" })).toEqual([]);
    expect(toolCutsOf({ answer: { complete: true, withheld: 2 }, tool: "action_items" })).toEqual(["withheld: 2"]);
    expect(
      toolCutsOf({ answer: { outlineCut: true, redactions: [{ count: 1, label: "token" }] }, tool: "file_read" }),
    ).toEqual(["redactions: 1 item(s)", "outlineCut: true"]);
    expect(toolCutsOf({ answer: { redactions: [] }, tool: "file_read" })).toEqual([]);
    expect(
      toolCutsOf({ answer: { activity: { appTagsNotListed: 2, more: 0 }, status: "complete" }, tool: "slack_unread" }),
    ).toEqual(["activity.appTagsNotListed: 2"]);
  });

  it("counts the owner's own clipped turn on recent_steers, never the chair's clipped report", () => {
    const answer: Answer = {
      typed: [
        { cut: true, reply: { text: "x" }, text: "a long turn …" },
        { reply: { cut: true, text: "a long report …" }, text: "a short turn" },
      ],
    };
    expect(toolCutsOf({ answer, tool: "recent_steers" })).toEqual(["typed[]: 1 cut"]);
  });

  it("names an Automations card whose firing history went unread, at the card it sits on", () => {
    const answer: Answer = {
      shows: { automations: [{ name: "a" }, { historyUnread: "the slot ledger was not read", name: "b" }] },
    };
    expect(toolCutsOf({ answer, tool: "read_page" })).toEqual(["shows.automations[]: 1 historyUnread"]);
  });

  it("names Queue cards the page holds back for failing their checks", () => {
    const answer = { shows: { drawnMore: false, unread: [], withheld: 3 } };
    expect(toolCutsOf({ answer, tool: "read_page" })).toEqual(["shows.withheld: 3"]);
  });

  it("names an answer the page refused whole, whatever the tool", () => {
    const answer = {
      refused: "glossary answered 30000 bytes, over this page's 24576-byte tool cap, so none of it was sent",
    };
    expect(toolCutsOf({ answer, tool: "glossary" })).toEqual([
      "refused: glossary answered 30000 bytes, over this page's 24576-byte tool cap, so none of it was sent",
    ]);
  });

  it("reads a whole answer, and any tool that is not a read, as carrying no cut", () => {
    expect(toolCutsOf({ answer: { hasMore: false, omitted: 0 }, tool: "knowledge" })).toEqual([]);
    expect(toolCutsOf({ answer: { truncated: true }, tool: "offer_copy" })).toEqual([]);
  });
});
