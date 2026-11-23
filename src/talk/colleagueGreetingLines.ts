/**
 * The voice's greeting lines (`./sessionConfig.ts`): the owner already knows who the voice is, so a greeting gets a
 * greeting back, never an introduction.
 *
 * A measured call showed the failure: the owner opened with a bare greeting, and 1.4s later, with no tool call, the voice
 * answered "Hi there. I'm ChatGPT. You can talk things through with me, work with what's on your screen, research
 * stuff, write, plan, whatever helps. What should we tackle?" The owner can skip those formalities: the voice already
 * knows who they are and what they are working on, so the greeting should not read as a first meeting. A context
 * pack that rides in is loaded before that first word, but into the THINKING model:
 * `thread/start` carries it in `developerInstructions` ahead of `thread/realtime/start` (`site/lib/talkPlanCallWire.ts`
 * `prepareThread`), and the realtime voice never reads those (`./planSession.ts` `talkInstructions`). A bare greeting
 * is never delegated, so the voice answered it alone, from a prompt that said nothing about greeting the owner, and
 * fell back to the provider's own self-introduction. Repro: the first `"who":"voice"` segment of
 * `$SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * The pack stays on the thinking model (asked-only, `./askedOnlyLines.ts`, is why the voice carries no work brief of
 * its own); what the voice needs for the first word is only who it is to the owner.
 *
 * **In the prompt alone these lines did not hold.** With them 4 lines into the voice prompt, a bare "Hello."
 * still got "Hi! I'm ChatGPT. We can talk through ideas, I can help with research…" on 2 of 4 real calls
 * (repro: `slopweaver desktop e2e --call --only call-live`, which fails on it, repeated). So the same lines also ride the voice session's starting HISTORY, as the one
 * `developer` `initialItems` entry `./planSession.ts` composes — a different channel from the prompt, not another
 * sentence in it.
 */

/** The voice's paragraph: a colleague already working with the owner, never a product meeting a new user. */
export const COLLEAGUE_GREETING_VOICE_LINES: readonly string[] = [
  "The owner already knows you: the colleague who has been working with them, never a product meeting a new user.",
  "Unless the owner asks what you are or what you can do, never introduce yourself, never call yourself ChatGPT,",
  "OpenAI, Codex, an assistant or any other product, and never list what you can do; asked, answer them straight.",
  "When the owner opens the call with only a greeting ('hello', 'hey', 'morning'), greet them back in a few words, as",
  "someone picking up with a colleague, and add no question. Until the owner says why they called, the call is theirs to",
  "open: every quiet before then is theirs and never yours to fill with words of your own (a line the console has",
  "you speak is still said as given), and each bare check of the line ('hello?', 'you",
  "there?') gets a word or two that you hear them ('yep, here') and nothing more, however often they check. A check",
  "that also asks something gets that answered. The turn-taking lines below that give you the turn after a quiet,",
  "or carry a check-in on from the last words, start once the owner has said why they called.",
];
