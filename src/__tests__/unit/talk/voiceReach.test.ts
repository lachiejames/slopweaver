/**
 * What the console voice says it can and cannot do, held to what it actually can.
 *
 * Asked for a whole Slack DM, a delegated model once guessed `slack history` (no such verb) and `slack read-thread`
 * (off its read list), and told the owner it could not. The inventory is derived from the catalog, the read list
 * and the tools, so the property worth holding is that NOTHING the voice can run drops
 * out of what it says it can do, and nothing it says it can run is a verb that does not exist. Both are asserted
 * over the SHIPPED inputs, opening on a non-empty length because `filter(bad).toEqual([])` is true of an empty one.
 */
import { describe, expect, it } from "vitest";

import { parseCapabilitiesArgs } from "../../../cli/commands/talk/capabilitiesArgs.js";
import { runTalkCapabilities } from "../../../cli/commands/talk/capabilitiesRun.js";
import { TALK_CAPABILITIES_USAGE } from "../../../cli/commands/talk/knowUsage.js";
import { TalkPositionalArgsErrors } from "../../../cli/commands/talk/positionalArgsErrors.js";
import { discoverCommands } from "../../../cli/discoverCommands.js";
import { EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { NOUN_GROUPS } from "../../../cli/nounGroups.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { MODEL_READS, type ModelRead } from "../../../talk/modelReads.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { shippedVoiceReach } from "../../../talk/shippedReach.js";
import { TALK_TOOLS, type TalkTool } from "../../../talk/talkToolSchemas.js";
import { VERB_OUTPUT_MAX_BYTES } from "../../../talk/verbOutput.js";
import {
  type CatalogVerb,
  type NounReach,
  nounReachDocument,
  reachPromptBlock,
  reachVoiceSentence,
  refusalLines,
  renderNounReach,
  voiceReach,
} from "../../../talk/voiceReach.js";

const CATALOG = discoverCommands({ groups: NOUN_GROUPS });
const SHIPPED = shippedVoiceReach();
const CATALOG_NAMES = new Set(CATALOG.map((entry) => `${entry.noun} ${entry.verb}`));

/** The backend prompt's reach block — after its heading, since the tool list above it has `- browser:` lines too. */
const BLOCK_LINES = TALK_BACKEND_INSTRUCTIONS.split("What slopweaver can do for you, by noun")[1]!.split("\n");

/** The block's line for one noun, which the test asserts exists before reading it. */
const blockLineFor = ({ noun }: { noun: string }): string =>
  BLOCK_LINES.find((line) => line.startsWith(`- ${noun}: `))!;

/** A fixture catalog: one noun with a read, a subverb read, a stand-in, a writer, a home writer and an untraced read. */
const FIXTURE_CATALOG: readonly CatalogVerb[] = [
  { meta: { effect: "external-read", summary: "read one thing" }, noun: "chat", verb: "read" },
  { meta: { effect: "external-read", summary: "the standing of one thing" }, noun: "chat", verb: "pr" },
  { meta: { effect: "local-state", summary: "read a whole thread and save its files" }, noun: "chat", verb: "thread" },
  { meta: { effect: "external-write", summary: "post a message" }, noun: "chat", verb: "post" },
  { meta: { effect: "local-state", summary: "park a draft" }, noun: "chat", verb: "draft" },
  { meta: { effect: "none", summary: "print the voice brief" }, noun: "chat", verb: "rules" },
  { meta: { effect: "none", summary: "list corpus rows" }, noun: "store", verb: "query" },
  { meta: { effect: "none", summary: "a word" }, noun: "talk", verb: "glossary" },
];

const FIXTURE_READS: readonly ModelRead[] = [
  { for: "one chat thing", noun: "chat", verb: "read" },
  { for: "a thing's standing", noun: "chat", subverbs: ["standing"], verb: "pr" },
  { for: "the corpus", noun: "store", readsCorpus: true, verb: "query" },
];

const FIXTURE_TOOLS: readonly TalkTool[] = [
  {
    description: "a word",
    kind: "read",
    name: "glossary",
    parameters: {},
    runs: { noun: "talk", verb: "glossary" },
    summary: "a word",
  },
  {
    description: "one thread live",
    kind: "read",
    name: "thread_after",
    parameters: {},
    standsInFor: { noun: "chat", part: "one thread, no files", verb: "thread" },
    summary: "one thread live",
  },
];

const FIXTURE = voiceReach({
  catalog: FIXTURE_CATALOG,
  corpusSources: ["chat"],
  reads: FIXTURE_READS,
  tools: FIXTURE_TOOLS,
});

describe("voiceReach over a fixture", () => {
  it("states each verb from the read list, the tools and the catalog effect", () => {
    const chat = FIXTURE.find((noun) => noun.noun === "chat")!;
    expect(chat.verbs.map((verb) => [verb.verb, verb.state, verb.named])).toEqual([
      ["read", "can", "read"],
      ["pr", "partly", "pr standing"],
      ["thread", "partly", "thread in part (thread_after)"],
      ["post", "cannot", ""],
      ["draft", "cannot", ""],
      ["rules", "cannot", ""],
    ]);
  });

  it("words a cannot by effect, and calls an off-list read untraced rather than dangerous", () => {
    const chat = FIXTURE.find((noun) => noun.noun === "chat")!;
    const how = Object.fromEntries(chat.verbs.map((verb) => [verb.verb, verb.how]));
    expect(how["post"]).toBe("it acts on a provider, and only a seat runs it: relay the ask to the supervisor");
    expect(how["draft"]).toBe(
      "it may change state under the owner's slopweaver home, so only a seat runs it: relay the ask to the supervisor",
    );
    expect(how["rules"]).toBe(
      "it is not traced onto your read list, so only a seat runs it: relay the ask to the supervisor",
    );
  });

  it("offers the corpus under a source noun only", () => {
    expect(FIXTURE.map((noun) => [noun.noun, noun.corpus])).toEqual([
      ["chat", ["store query"]],
      ["store", []],
      ["talk", []],
    ]);
  });

  it("names a tool-run verb as one the voice can do", () => {
    const talk = FIXTURE.find((noun) => noun.noun === "talk")!;
    expect(talk.verbs.map((verb) => [verb.verb, verb.state, verb.how])).toEqual([
      ["glossary", "can", "the glossary tool"],
    ]);
  });

  it("renders the prompt block without the console's own plumbing noun", () => {
    expect(reachPromptBlock({ reach: FIXTURE }).split("\n")).toEqual([
      "- chat: read, pr standing, thread in part (thread_after)",
      "- store: query",
      "The corpus (store query, hours behind) holds the history of chat. The other 3 of the 8 verbs only a seat " +
        "runs. Run talk capabilities <noun> for a noun's verbs and why before saying you cannot; never guess a verb name.",
    ]);
  });

  it("names a source the voice reaches only through the corpus once, on the corpus line, and gives it no noun line", () => {
    const sourceOnly: NounReach = { corpus: ["store query"], noun: "diary", verbs: [] };
    expect(reachPromptBlock({ reach: [...FIXTURE, sourceOnly] }).split("\n")).toEqual([
      "- chat: read, pr standing, thread in part (thread_after)",
      "- store: query",
      "The corpus (store query, hours behind) holds the history of chat, diary. The other 3 of the 8 verbs only a " +
        "seat runs. Run talk capabilities <noun> for a noun's verbs and why before saying you cannot; never guess a " +
        "verb name.",
    ]);
  });

  it("leaves the corpus sentence out when no noun is a source", () => {
    const noSources = FIXTURE.map((noun) => ({ ...noun, corpus: [] }));
    expect(reachPromptBlock({ reach: noSources }).split("\n").at(-1)).toBe(
      "The other 3 of the 8 verbs only a seat runs. Run talk capabilities <noun> for a noun's verbs and why before " +
        "saying you cannot; never guess a verb name.",
    );
  });

  it("renders the voice's sentence naming the nouns it reads", () => {
    expect(reachVoiceSentence({ reach: FIXTURE })).toContain("Through the thinking model you also read chat, store.");
  });

  it("renders one noun's reached verbs with their route, then the rest grouped under the reason a seat runs them", () => {
    const chat = FIXTURE.find((noun) => noun.noun === "chat")!;
    const lines = renderNounReach({ noun: chat });
    expect(lines[0]).toBe("chat: you reach 3 of its 6 verbs");
    expect(lines.slice(4)).toEqual([
      "  and its ingested history, hours behind, by store query (source chat)",
      "  only a seat — it acts on a provider, and only a seat runs it: relay the ask to the supervisor:",
      "    post: post a message",
      "  only a seat — it may change state under the owner's slopweaver home, so only a seat runs it: relay the ask to the supervisor:",
      "    draft: park a draft",
      "  only a seat — it is not traced onto your read list, so only a seat runs it: relay the ask to the supervisor:",
      "    rules: print the voice brief",
    ]);
  });
});

describe("nounReachDocument", () => {
  it("clips a seat-only verb's summary to 140 characters", () => {
    const long = voiceReach({
      catalog: [{ meta: { effect: "external-write", summary: "x".repeat(300) }, noun: "chat", verb: "post" }],
      corpusSources: [],
      reads: [],
      tools: [],
    });
    const document = nounReachDocument({ noun: long[0]! });
    expect(document.seatOnly[0]!.verbs[0]!.length).toBe("post: ".length + 140);
    expect(document.seatOnly[0]!.verbs[0]!.endsWith("…")).toBe(true);
  });

  // The console cuts a `verb` answer at VERB_OUTPUT_MAX_BYTES; the atlas noun's ungrouped answer measured 22,754 bytes.
  it("keeps every shipped noun's answer under the console's verb-output cap", () => {
    expect(SHIPPED.length).toBeGreaterThan(0);
    const over = SHIPPED.filter(
      (noun) => Buffer.byteLength(JSON.stringify(nounReachDocument({ noun })), "utf8") >= VERB_OUTPUT_MAX_BYTES,
    );
    expect(over.map((noun) => noun.noun)).toEqual([]);
  });
});

describe("refusalLines", () => {
  it("says a guessed verb does not exist, names the real ones, and ends on what the voice can use", () => {
    expect(refusalLines({ noun: "chat", reach: FIXTURE, verb: "history" })).toEqual([
      "chat history does not exist.",
      "chat has: read, pr, thread, post, draft, rules.",
      "What you can use instead: chat read; chat pr standing; chat thread in part (thread_after); its ingested " +
        "history, hours behind, by store query (source chat).",
    ]);
  });

  it("gives an off-list verb its summary, its derived reason and the route", () => {
    expect(refusalLines({ noun: "chat", reach: FIXTURE, verb: "post" }).slice(0, 2)).toEqual([
      "chat post: post a message",
      "You cannot run it: it acts on a provider, and only a seat runs it: relay the ask to the supervisor.",
    ]);
  });

  it("says a partly-reached verb is reachable in part, and a tool-run one by its tool", () => {
    expect(refusalLines({ noun: "chat", reach: FIXTURE, verb: "thread" })[1]).toBe(
      "Only in part: the thread_after tool does part: one thread, no files; for the rest only a seat runs it: relay " +
        "the ask to the supervisor.",
    );
    expect(refusalLines({ noun: "talk", reach: FIXTURE, verb: "glossary" })[1]).toBe(
      "Not through the verb tool: use the glossary tool.",
    );
  });

  it("names every tool that does part of one verb, each with its part, so a channel read is never called a seat's", () => {
    const twoTools = voiceReach({
      catalog: [{ meta: { effect: "external-read", summary: "read a thread" }, noun: "chat", verb: "thread" }],
      corpusSources: [],
      reads: [],
      tools: [
        ...FIXTURE_TOOLS,
        {
          description: "one channel live",
          kind: "read",
          name: "channel_read",
          parameters: {},
          standsInFor: { noun: "chat", part: "a channel's newest messages", verb: "thread" },
          summary: "one channel live",
        },
      ],
    });
    expect(twoTools[0]!.verbs.map((verb) => verb.named)).toEqual(["thread in part (thread_after, channel_read)"]);
    expect(refusalLines({ noun: "chat", reach: twoTools, verb: "thread" })[1]).toBe(
      "Only in part: thread_after: one thread, no files; channel_read: a channel's newest messages; for the rest of " +
        "thread only a seat runs it: relay the ask to the supervisor.",
    );
  });

  // A bare "for the rest" beside a channel read routed the channel's older history to the supervisor.
  it("answers the shipped slack read-thread with both Slack reads, older history to the corpus, inside 240 characters", () => {
    const why = refusalLines({ noun: "slack", reach: SHIPPED, verb: "read-thread" })[1]!;
    expect(why).toBe(
      "Only in part: slack_channel: a channel's newest 50 by name, older in the corpus; slack_open: one thread " +
        "whole from a link, attachments named not fetched; for the rest of read-thread only a seat runs it: relay " +
        "the ask to the supervisor.",
    );
    expect(why.length).toBeLessThanOrEqual(240);
  });

  it("says a noun that does not exist is not one, listing the nouns the voice reads", () => {
    expect(refusalLines({ noun: "teams", reach: FIXTURE, verb: "read" })).toEqual([
      "teams is not a slopweaver noun.",
      "Nouns you can read: chat, store.",
    ]);
  });

  it("fits the console's failure budget on the shipped inventory: four lines of at most 240 characters", () => {
    const lines = refusalLines({ noun: "slack", reach: SHIPPED, verb: "history" });
    expect(lines.length).toBe(3);
    expect(lines.filter((line) => line.length > 240)).toEqual([]);
  });
});

describe("the shipped inventory", () => {
  it("counts every MODEL_READS row as one the voice can do, wholly or by its subverbs", () => {
    expect(MODEL_READS.length).toBeGreaterThan(0);
    const reachable = new Set(
      SHIPPED.flatMap((noun) => noun.verbs.filter((verb) => verb.state !== "cannot").map((v) => `${v.noun} ${v.verb}`)),
    );
    expect(MODEL_READS.map((read) => `${read.noun} ${read.verb}`).filter((name) => !reachable.has(name))).toEqual([]);
  });

  it("names no read and no tool verb that the catalog does not register", () => {
    expect(MODEL_READS.length).toBeGreaterThan(0);
    expect(MODEL_READS.map((read) => `${read.noun} ${read.verb}`).filter((name) => !CATALOG_NAMES.has(name))).toEqual(
      [],
    );
    const toolVerbs = TALK_TOOLS.flatMap((tool) => [tool.runs, tool.standsInFor]).filter((ref) => ref !== undefined);
    expect(toolVerbs.length).toBeGreaterThan(0);
    expect(toolVerbs.map((ref) => `${ref.noun} ${ref.verb}`).filter((name) => !CATALOG_NAMES.has(name))).toEqual([]);
  });

  it("maps every tool the page does not answer itself to the catalog verb it runs", () => {
    const pageAnswered = new Set([
      "action_items",
      "read_card",
      "open_card",
      "draft_edit_start",
      "draft_edit",
      "draft_restore",
      "triage_next",
      "triage_end",
      "triage_clock",
      "read_page",
      "read_screen",
      "focus_screen",
      "offer_copy",
      "set_stage_setting",
      "focus_set",
      "focus_end",
      "focus_quiet",
      "meeting_skip",
    ]);
    expect(TALK_TOOLS.filter((tool) => tool.runs === undefined).map((tool) => tool.name)).toEqual([...pageAnswered]);
  });

  it("reaches the catalogued talk list verb through running_list, the voice's read of the owner's running list", () => {
    expect(TALK_TOOLS.find((tool) => tool.name === "running_list")!.runs).toEqual({ noun: "talk", verb: "list" });
    expect(CATALOG_NAMES.has("talk list")).toBe(true);
    const talk = SHIPPED.find((noun) => noun.noun === "talk")!;
    expect(talk.verbs.find((verb) => verb.verb === "list")!.state).toBe("can");
  });

  it("places every catalog verb exactly once", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    expect(SHIPPED.flatMap((noun) => noun.verbs).length).toBe(CATALOG.length);
  });

  it("says slack read-thread is reached only in part, and the rest of slack is a seat's", () => {
    const slack = SHIPPED.find((noun) => noun.noun === "slack")!;
    expect(slack.verbs.find((verb) => verb.verb === "read-thread")!.state).toBe("partly");
    expect(slack.verbs.find((verb) => verb.verb === "post")!.state).toBe("cannot");
    expect(slack.corpus).toEqual(["store query", "store open", "store peek"]);
  });
});

describe("what both prompts say the voice can do", () => {
  // The test the row asked for: a verb the voice can run that is absent from what it says it can do fails here.
  it("names every verb the voice can run, under its noun, in the backend's reach block", () => {
    const reached = SHIPPED.filter((noun) => noun.noun !== "talk").flatMap((noun) =>
      noun.verbs.filter((verb) => verb.state !== "cannot"),
    );
    expect(reached.length).toBeGreaterThan(0);
    const missing = reached.filter((verb) => {
      const line = BLOCK_LINES.find((one) => one.startsWith(`- ${verb.noun}: `));
      return line === undefined || !line.includes(verb.named);
    });
    expect(missing.map((verb) => `${verb.noun} ${verb.verb}`)).toEqual([]);
  });

  it("names every noun the voice reads in the voice's own prompt", () => {
    const nouns = SHIPPED.filter(
      (noun) => noun.noun !== "talk" && (noun.corpus.length > 0 || noun.verbs.some((verb) => verb.state !== "cannot")),
    ).map((noun) => noun.noun);
    expect(nouns.length).toBeGreaterThan(0);
    const sentence = TALK_VOICE_INSTRUCTIONS.split("\n").find((line) => line.startsWith("Through the thinking model"))!;
    expect(nouns.filter((noun) => !sentence.includes(noun))).toEqual([]);
  });

  it("carries the slack block line and exactly one Slack corpus query, the 'Older than that window' one", () => {
    expect(blockLineFor({ noun: "slack" })).toBe(
      "- slack: read-thread in part (slack_channel, slack_open), unread (slack_unread), when",
    );
    expect(reachPromptBlock({ reach: SHIPPED }).split("\n").at(-1)).toContain(
      "The corpus (store query, hours behind) holds the history of ",
    );
    expect(reachPromptBlock({ reach: SHIPPED }).split("\n").at(-1)).toContain(", slack.");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Older than that window: store query --source slack --channel <the id slack_channel returned>, the corpus,",
    );
    expect(TALK_BACKEND_INSTRUCTIONS.match(/store query --source slack --channel <[^>]*>/gu)).toEqual([
      "store query --source slack --channel <the id slack_channel returned>",
    ]);
  });

  // Asked what the Codex plans had left, the voice was once refused `codex quota` and said it could not see the
  // meter. Both prompts offer the one that is.
  it("offers the Codex plan meter, and says it reads codex", () => {
    expect(blockLineFor({ noun: "codex" })).toBe("- codex: route");
    const sentence = TALK_VOICE_INSTRUCTIONS.split("\n").find((line) => line.startsWith("Through the thinking model"))!;
    expect(sentence).toContain("codex");
  });

  it("tells the backend to check talk capabilities before saying it cannot, and never to guess a verb", () => {
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("Before\n  saying you cannot do something, run talk capabilities");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("never guess a verb name");
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("reach for it before\n  saying you cannot see something");
    expect(MODEL_READS.map((read) => `${read.noun} ${read.verb}`)).toContain("talk capabilities");
  });

  // MEASURED, the block over the shipped inputs: 36 lines, 1,347 bytes. Repro:
  // `npx tsx -e 'import("./src/talk/shippedReach.ts").then((m) => console.log(m.REACH_BLOCK.split("\n").length,
  // Buffer.byteLength(m.REACH_BLOCK)))'`
  // The line cap is 120 for the noun lines; the closing corpus line is exempt because it names every source. The
  // whole-block 2 KB budget beside it is the one the prompt's size rides on.
  it("keeps the reach block short: one line per noun, each under 120 characters, the whole under 2 KB", () => {
    const block = reachPromptBlock({ reach: SHIPPED });
    const lines = block.split("\n");
    expect(lines.length).toBeLessThan(40);
    expect(lines.slice(0, -1).filter((line) => line.length > 120)).toEqual([]);
    expect(Buffer.byteLength(block, "utf8")).toBeLessThan(2048);
  });

  it("keeps the voice's own sentence to two sentences under 600 bytes", () => {
    const sentence = reachVoiceSentence({ reach: SHIPPED });
    expect(Buffer.byteLength(sentence, "utf8")).toBeLessThan(600);
  });
});

describe("talk capabilities", () => {
  const argvFor = ({ rest }: { rest: readonly string[] }): readonly string[] => [
    "node",
    "slopweaver",
    "talk",
    "capabilities",
    ...rest,
  ];

  it("parses an optional noun and verb, and refuses a third word", () => {
    expect(unwrap(parseCapabilitiesArgs({ rest: ["slack", "post", "--json"] }))).toEqual({
      json: true,
      noun: "slack",
      verb: "post",
    });
    expect(unwrap(parseCapabilitiesArgs({ rest: [] }))).toEqual({ json: false, noun: undefined, verb: undefined });
    expect(unwrapErr(parseCapabilitiesArgs({ rest: ["a", "b", "c"] }))).toEqual(
      TalkPositionalArgsErrors.tooManyCapabilityWords({ got: 3 }),
    );
    expect(TalkPositionalArgsErrors.tooManyCapabilityWords({ got: 3 }).message).toBe(
      "talk capabilities takes at most a noun and a verb, got 3 words",
    );
  });

  it("answers every shape and refuses a bad flag before reading anything", () => {
    expect(TALK_CAPABILITIES_USAGE).toBe("usage: slopweaver talk capabilities [<noun> [<verb>]] [--json]");
    expect(runTalkCapabilities(argvFor({ rest: ["--help"] }))).toBe(EXIT_OK);
    expect(runTalkCapabilities(argvFor({ rest: ["--json"] }))).toBe(EXIT_OK);
    expect(runTalkCapabilities(argvFor({ rest: ["slack", "--json"] }))).toBe(EXIT_OK);
    expect(runTalkCapabilities(argvFor({ rest: ["slack", "history"] }))).toBe(EXIT_OK);
    expect(runTalkCapabilities(argvFor({ rest: ["--nope"] }))).toBe(EXIT_USAGE);
  });
});
