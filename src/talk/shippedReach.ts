/**
 * The voice's reach over what actually ships: the registered catalog, the shipped read list and tools, and the
 * sources the corpus holds — and the tool inventory and reach lines both Talk prompts (`./sessionConfig.ts`) carry
 * from it. Kept apart from `./voiceReach.ts` so that module stays pure over its inputs, and apart from
 * `./talkToolSchemas.ts` because that one is reached from `relayDraft.ts` by the supervisor and the board, which
 * have no reason to load the manifest barrel.
 */
import { discoverCommands } from "../cli/discoverCommands.js";
import { NOUN_GROUPS } from "../cli/nounGroups.js";
import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { MODEL_READS } from "./modelReads.js";
import { TALK_TOOLS, type TalkTool } from "./talkToolSchemas.js";
import { type NounReach, reachPromptBlock, reachVoiceSentence, voiceReach } from "./voiceReach.js";

/**
 * Derive the voice's reach from the shipped catalog, read list and tools.
 *
 * @returns one entry per registered noun
 */
export function shippedVoiceReach(): readonly NounReach[] {
  return voiceReach({
    catalog: discoverCommands({ groups: NOUN_GROUPS }),
    corpusSources: BRONZE_SOURCES,
    reads: MODEL_READS,
    tools: TALK_TOOLS,
  });
}

/**
 * One line per tool, derived from {@link TALK_TOOLS} — the list both prompts carry.
 *
 * MEASURED on the owner's Talk transcript: asked "what tools do you even have access to", the voice
 * said "I can see your screen, fetch the session record and relay your steers to the supervisor. Nothing else."
 * Nine tools were declared, but only on `delegation.responses.tools`, which the Live model answering the owner never
 * sees, and the voice prompt named just the screen, the supervisor and the relay. So it answered from its own
 * prompt without delegating. Derived rather than written out, so it cannot fall behind the schemas.
 *
 * @param tools the tools to list
 * @returns one `- name: summary` line per tool, in order
 */
function talkToolInventory({ tools }: { tools: readonly TalkTool[] }): string {
  return tools.map((tool) => `- ${tool.name}: ${tool.summary}`).join("\n");
}

/**
 * {@link talkToolInventory} over the shipped tools, then the hosted web search the Codex thread keeps, which has no
 * schema row to derive from. The owner turned this on explicitly; what it
 * widens is stated in `docs/security/voice-boundary.md` § The console-voice boundary.
 */
export const TALK_TOOL_INVENTORY = [
  talkToolInventory({ tools: TALK_TOOLS }),
  "- web_search: search the public web for a quick fact about the outside world",
].join("\n");

/**
 * What the voice reaches of slopweaver's verbs, derived from the catalog, the read list and the tools
 * (`./voiceReach.ts`) — the noun-by-noun block the delegated model carries, and the voice's own two sentences.
 * A measured call is why: asked for a whole Slack DM, the model guessed `slack history`, which does
 * not exist, then `slack read-thread`, which it may not run, and the owner had to coach it through its own tools.
 */
const SHIPPED_REACH = shippedVoiceReach();

/** The noun-by-noun reach block the delegated model carries. */
export const REACH_BLOCK = reachPromptBlock({ reach: SHIPPED_REACH });

/** The voice's own two sentences on what it reaches. */
export const REACH_SENTENCE = reachVoiceSentence({ reach: SHIPPED_REACH });
