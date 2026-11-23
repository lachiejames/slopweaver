/**
 * What a call on the owner's ChatGPT plan launches `codex app-server` with and tells it, asserted as data.
 *
 * The load-bearing values are the ones a live call measured (`src/talk/planSession.ts`'s
 * header): the ack filler off, the voice prompt in `prompt`, every configured MCP server stubbed as a whole
 * table, and `code_mode_host` left on. Each is pinned exactly, because a "tidier" launch that drops one fails
 * silently in a live call and nowhere else.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { COLLEAGUE_GREETING_VOICE_LINES } from "../../../talk/colleagueGreetingLines.js";
import {
  mcpServerNamesOf,
  PICTURE_NAMESPACE,
  planAppServerArgv,
  planDynamicTools,
  planOfferComposition,
  TALK_PLAN_BACKEND_MODEL,
} from "../../../talk/planSession.js";
import { isPlanVoice, TALK_PLAN_VOICE_NAMES } from "../../../talk/planVoices.js";
import {
  TALK_BACKEND_INSTRUCTIONS,
  TALK_REASONING_EFFORT,
  TALK_VOICE_INSTRUCTIONS,
} from "../../../talk/sessionConfig.js";
import { TALK_TYPED_INSTRUCTIONS, type TalkSurface } from "../../../talk/talkSurface.js";
import { TALK_TOOLS, type TalkTool } from "../../../talk/talkToolSchemas.js";

const EXECUTABLE = "/vendored/codex";
const UNSET = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"];
const CODEX_HOME = "/stores/codex-one";
const PLAN_ALIAS = "codex-one";

/** A composition with a pack, an opener and two MCP servers. */
function composed({ surface = "voice" }: { surface?: TalkSurface } = {}): ReturnType<typeof planOfferComposition> {
  return planOfferComposition({
    codexHome: CODEX_HOME,
    context: "PACK",
    executable: EXECUTABLE,
    mcpServers: ["trajectory", "node_repl"],
    opener: "OPENER",
    planAlias: PLAN_ALIAS,
    surface,
    unsetEnv: UNSET,
    voice: "sol",
  });
}

describe("planOfferComposition, typed", () => {
  it("hands the delegated model the opener and then the typed block, last, since no voice reads either", () => {
    const typed = composed({ surface: "typed" });
    expect(typed.surface).toBe("typed");
    expect(typed.thread.developerInstructions).toBe(
      `${TALK_BACKEND_INSTRUCTIONS}\n\nPACK\n\nOPENER\n\n${TALK_TYPED_INSTRUCTIONS}`,
    );
  });

  it("keeps the model, tools, writers and launch a voice call has, so typing reaches what speaking does", () => {
    const typed = composed({ surface: "typed" });
    const voice = composed();
    expect(typed.thread.model).toBe(voice.thread.model);
    expect(typed.thread.dynamicTools).toEqual(voice.thread.dynamicTools);
    expect(typed.writers).toEqual(voice.writers);
    expect(typed.appServer).toEqual(voice.appServer);
    expect(voice.surface).toBe("voice");
  });

  it("tells a typed thread a pasted link is the one to read, and that nothing is spoken", () => {
    expect(TALK_TYPED_INSTRUCTIONS).toContain("THIS CONVERSATION IS TYPED, NOT SPOKEN.");
    expect(TALK_TYPED_INSTRUCTIONS).toContain("A link they pasted is the one to read");
  });
});

describe("planOfferComposition", () => {
  // Forwarded by the app-server, answers were once spoken over the owner's unfinished clauses.
  it("turns the ack filler off and keeps Codex's answers for the console to hand the voice once the owner is quiet", () => {
    expect(composed().realtime).toEqual({
      clientManagedHandoffs: true,
      codexResponsesAsItems: false,
      delegationAckFiller: false,
      includeStartupContext: false,
      initialItems: [{ role: "developer", text: COLLEAGUE_GREETING_VOICE_LINES.join("\n") }],
      outputModality: "audio",
      prompt: `${TALK_VOICE_INSTRUCTIONS}\n\nOPENER`,
      version: "v3",
      voice: "sol",
    });
  });

  it("starts an ephemeral, read-only, never-approving thread on the named model with the pack", () => {
    const { thread } = composed();
    expect(thread.approvalPolicy).toBe("never");
    expect(thread.ephemeral).toBe(true);
    expect(thread.sandbox).toBe("read-only");
    expect(thread.model).toBe(TALK_PLAN_BACKEND_MODEL);
    expect(thread.developerInstructions).toBe(`${TALK_BACKEND_INSTRUCTIONS}\n\nPACK`);
  });

  it("projects every talk tool as a dynamic tool, and no other", () => {
    expect(TALK_TOOLS.length).toBeGreaterThan(0);
    expect(composed().thread.dynamicTools).toEqual(planDynamicTools({ tools: TALK_TOOLS }));
    const declared = composed().thread.dynamicTools.flatMap((entry) =>
      entry.type === "namespace" ? entry.tools.map((tool) => tool.name) : [entry.name],
    );
    expect(declared.toSorted()).toEqual(TALK_TOOLS.map((tool) => tool.name).toSorted());
  });

  it("offers read_screen and file_read in the direct picture namespace, so a frame reaches the model as a picture", () => {
    const namespaces = composed().thread.dynamicTools.filter((entry) => entry.type === "namespace");
    expect(namespaces.map((entry) => entry.name)).toEqual([PICTURE_NAMESPACE]);
    expect(
      namespaces.flatMap((entry) => (entry.type === "namespace" ? entry.tools : [])).map((tool) => tool.name),
    ).toEqual(["file_read", "read_screen"]);
  });

  it("names the tools and writers the verb declares, so the page's drift check holds", () => {
    const composition = composed();
    expect(composition.tools).toEqual(TALK_TOOLS.map((tool) => tool.name));
    expect(composition.writers).toEqual(["draft_edit", "draft_restore", "relay_steer"]);
  });

  it("leaves both prompts bare when nothing rides in", () => {
    const bare = planOfferComposition({
      codexHome: CODEX_HOME,
      context: undefined,
      executable: EXECUTABLE,
      mcpServers: [],
      opener: undefined,
      planAlias: PLAN_ALIAS,
      surface: "voice",
      unsetEnv: UNSET,
      voice: "juniper",
    });
    expect(bare.realtime.prompt).toBe(TALK_VOICE_INSTRUCTIONS);
    expect(bare.thread.developerInstructions).toBe(TALK_BACKEND_INSTRUCTIONS);
    expect(bare.realtime.voice).toBe("juniper");
  });

  // The voice answers a bare greeting alone, and never reads the pack.
  it("puts the greeting lines on the voice with or without an opener, and the pack on the thread alone", () => {
    const greeting = COLLEAGUE_GREETING_VOICE_LINES.join("\n");
    const bare = planOfferComposition({
      codexHome: CODEX_HOME,
      context: "PACK",
      executable: EXECUTABLE,
      mcpServers: [],
      opener: undefined,
      planAlias: PLAN_ALIAS,
      surface: "voice",
      unsetEnv: UNSET,
      voice: "sol",
    });
    expect(COLLEAGUE_GREETING_VOICE_LINES.length).toBeGreaterThan(0);
    expect([composed().realtime.prompt.includes(greeting), bare.realtime.prompt.includes(greeting)]).toEqual([
      true,
      true,
    ]);
    expect([composed().realtime.prompt.includes("PACK"), bare.realtime.prompt.includes("PACK")]).toEqual([
      false,
      false,
    ]);
    expect([composed().thread.developerInstructions.includes(greeting), bare.thread.developerInstructions]).toEqual([
      false,
      `${TALK_BACKEND_INSTRUCTIONS}\n\nPACK`,
    ]);
  });

  // Desktop e2e run 2026-11-04T125249Z: with the lines in the prompt alone, a bare "Hello." got "Hi! I'm ChatGPT…".
  it("seeds the voice's history with the greeting lines as ONE developer item, with or without an opener", () => {
    const bare = planOfferComposition({
      codexHome: CODEX_HOME,
      context: undefined,
      executable: EXECUTABLE,
      mcpServers: [],
      opener: undefined,
      planAlias: PLAN_ALIAS,
      surface: "voice",
      unsetEnv: UNSET,
      voice: "sol",
    });
    const expected = [{ role: "developer", text: COLLEAGUE_GREETING_VOICE_LINES.join("\n") }];
    expect([composed().realtime.initialItems, bare.realtime.initialItems]).toEqual([expected, expected]);
  });

  it("carries the launch the console runs, the credentials it strips, and the routed plan's home", () => {
    expect(composed().appServer).toEqual({
      argv: planAppServerArgv({ mcpServers: ["trajectory", "node_repl"] }),
      codexHome: CODEX_HOME,
      executable: EXECUTABLE,
      planAlias: PLAN_ALIAS,
      unsetEnv: UNSET,
    });
    expect(composed().model).toBe("realtime-v3");
  });
});

describe("planDynamicTools", () => {
  const tool = ({ name, picture }: { name: string; picture: boolean }): TalkTool => ({
    description: `${name} does it`,
    kind: "read",
    name,
    parameters: { type: "object" },
    summary: name,
    ...(picture ? { answersWithPicture: true as const } : {}),
  });

  it("keeps order, gathering every picture tool where the first one stood", () => {
    const declared = planDynamicTools({
      tools: [
        tool({ name: "a", picture: false }),
        tool({ name: "shot", picture: true }),
        tool({ name: "b", picture: false }),
        tool({ name: "file", picture: true }),
      ],
    });
    expect(declared.map((entry) => `${entry.type}:${entry.name}`)).toEqual([
      "function:a",
      `namespace:${PICTURE_NAMESPACE}`,
      "function:b",
    ]);
    expect(declared[1]).toEqual({
      description: "Tools whose answer is a picture you look at: the owner's screen, and an image file.",
      name: PICTURE_NAMESPACE,
      tools: [
        { description: "shot does it", inputSchema: { type: "object" }, name: "shot", type: "function" },
        { description: "file does it", inputSchema: { type: "object" }, name: "file", type: "function" },
      ],
      type: "namespace",
    });
  });

  it("declares no namespace when no tool answers with a picture", () => {
    expect(planDynamicTools({ tools: [tool({ name: "a", picture: false })] })).toEqual([
      { description: "a does it", inputSchema: { type: "object" }, name: "a", type: "function" },
    ]);
  });

  it("declares nothing for no tools", () => {
    expect(planDynamicTools({ tools: [] })).toEqual([]);
  });
});

describe("planAppServerArgv", () => {
  it("is the measured launch, exactly", () => {
    expect(planAppServerArgv({ mcpServers: ["trajectory"] })).toEqual([
      "app-server",
      "--strict-config",
      ...[
        "shell_tool",
        "unified_exec",
        "apps",
        "plugins",
        "remote_plugin",
        "hooks",
        "memories",
        "multi_agent",
        "multi_agent_v2",
        "browser_use",
        "computer_use",
        "image_generation",
        "goals",
        "view_image",
        "in_app_browser",
        "skill_search",
        "tool_suggest",
        "sleep_tool",
      ].flatMap((feature) => ["--disable", feature]),
      "-c",
      "project_doc_max_bytes=0",
      "-c",
      "skills.bundled.enabled=false",
      "-c",
      `model="${TALK_PLAN_BACKEND_MODEL}"`,
      "-c",
      `model_reasoning_effort="${TALK_REASONING_EFFORT}"`,
      "-c",
      'features.code_mode.direct_only_tool_namespaces=["see"]',
      "-c",
      'web_search="live"',
      "-c",
      "plugins.browser@openai-bundled.enabled=false",
      "-c",
      "plugins.computer-use@openai-bundled.enabled=false",
      "-c",
      "plugins.unified-computer-use@openai-bundled.enabled=false",
      "-c",
      "mcp_servers.node_repl.command=/usr/bin/false",
      "-c",
      "mcp_servers.node_repl.enabled=false",
      "-c",
      'mcp_servers.trajectory={command="true",enabled=false}',
    ]);
  });

  it("never disables code mode, which dynamic tools need, and only narrows what it nests", () => {
    const argv = planAppServerArgv({ mcpServers: [] });
    const disabled = argv.filter((_, index) => argv[index - 1] === "--disable");
    expect(disabled.filter((feature) => feature.startsWith("code_mode"))).toEqual([]);
    expect(argv.filter((value) => value.includes("code_mode"))).toEqual([
      `features.code_mode.direct_only_tool_namespaces=["${PICTURE_NAMESPACE}"]`,
    ]);
  });
});

describe("mcpServerNamesOf", () => {
  it("names every configured server", () => {
    const json = JSON.stringify([
      { enabled: true, name: "trajectory" },
      { enabled: false, name: "computer-use" },
    ]);
    expect(unwrap(mcpServerNamesOf({ json }))).toEqual(["trajectory", "computer-use"]);
  });

  it("reads an empty config as no servers", () => {
    expect(unwrap(mcpServerNamesOf({ json: "[]" }))).toEqual([]);
  });

  it("refuses the whole list when one name could break out of the key path", () => {
    expect(unwrapErr(mcpServerNamesOf({ json: JSON.stringify([{ name: "a.b" }]) })).message).toBe(
      'codex mcp list --json named a server this mint cannot stub: "a.b"',
    );
  });

  it("refuses output that is not a list", () => {
    expect(unwrapErr(mcpServerNamesOf({ json: "{}" })).message).toBe(
      "codex mcp list --json printed something other than a list of servers",
    );
    expect(unwrapErr(mcpServerNamesOf({ json: "nope" })).message).toContain("is not JSON");
  });
});

describe("the plan voices", () => {
  it("are the eight /voice offers, and no platform.openai voice", () => {
    expect(TALK_PLAN_VOICE_NAMES).toEqual(["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol"]);
    expect(isPlanVoice("sol")).toBe(true);
    expect(isPlanVoice("cedar")).toBe(false);
    expect(isPlanVoice("cove")).toBe(false);
  });
});
