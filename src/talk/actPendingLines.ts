/**
 * The act-pending lines both Talk prompts carry (`./sessionConfig.ts`): an act the owner asks for outside the call is
 * pending once relayed, never "got it", and a Slack send that did not go is said when it is known.
 *
 * A measured call showed why: the owner approved a reply to a colleague, the voice said "Got it." and then "Yep, got
 * it. You approved the reply", and the as-me gates had held the reply as a draft; nothing was
 * sent. So `relay_steer` declares `outward`, and a Slack send's outcome is read by `slack_send_outcome` and, when it
 * was held or failed, said unasked once the page's watch finds it (`site/lib/slackSendWatch.ts`,
 * `docs/console/voice-says-what-became-of-a-send.md`). A send that went is never said unasked: it is not useful for
 * the voice to say it is sent when the owner is already focused on something else. Repro: `jq -r
 * 'select(.kind=="segment" and .final) | "\(.atIso) \(.who) \(.text)"' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 */

/** The voice's lines, after its rule that it never guesses what became of a steer. */
export const ACT_PENDING_VOICE_LINES: readonly string[] = [
  "A steer that asks for an act outside this call — send that, merge it, post it — is",
  "PENDING once relayed: never 'sent', 'done', 'approved' or 'handled', and never 'got it' alone as if it",
  "were done. Say what happens next instead: for a Slack send, 'On it — I'll tell you if it doesn't go.'",
  "And never add that nothing has been done on it yet: the owner knows a relay is only a hand-off.",
  "Told a send was held or failed, say so at once in one short sentence, with the",
  "reason or what stopped it. A send that went is never said unasked — never that it went unless you read so.",
  "A relay never keeps the owner waiting: nothing comes back from it to wait for, so a steer that asks for no act",
  "gets a word or two and you go straight on — never a pause or a lookup to confirm it went.",
];

/** The thinking model's lines, inside its relay bullet: which `outward` a relay declares, and how a send is read. */
export const ACT_PENDING_BACKEND_LINES: readonly string[] = [
  "  Pass outward on every relay: slack-send, with sends set to the thread's Slack link, when the owner's words send",
  "  or post something to Slack; other-outward for any other act outside the call; none otherwise. An act is",
  "  pending until its outcome is known: the answer says what to say. For a Slack send, the page tells the",
  "  voice unasked only when it is held or fails, never that it went; when the owner asks, read slack_send_outcome",
  "  with the url and since the relay answer handed back, and say exactly its state — never that it went",
  "  unless it says sent.",
];
