/**
 * The look lines both Talk prompts carry (`./sessionConfig.ts`): when the owner asks the voice to look at their
 * screen, it reads one frame first and says what it sees.
 *
 * One frame per ask is the owner's rule: the owner says when they want the voice to look. Looking first and saying what
 * it sees is also the owner's rule: the voice should look at the screen faster and more often, and must say what it
 * sees for the look to be of use. MEASURED on one call: the look line fired 13 times and read_screen ran 6. A look ask
 * at the end of a long stretch got only its first half answered and read the frame 32s later, then asked "What's
 * glitching?". Another turn ran read_card and board_row and never looked. Repro: the call's `read_screen` tool lines
 * against its look lines, in `~/.slopweaver/talk/calls/<call-id>.jsonl`.
 *
 * The console also takes the frame itself the moment a look ask is handed off, or finishes without one, and steers it
 * into the running turn (`PlanCall.attachLook`, `site/lib/talkPlanCall.ts`), so the last backend line tells the thread
 * that frame is the answer's, never a reason to take a second (`docs/console/voice-sees-the-owners-screen.md`). The voice's
 * "hand the look over at once" is not what gets the look handed over: a measured call had the voice say the console's
 * look line itself three times and hand nothing off, so the console starts the turn with the frame itself when none has.
 *
 * A correction is a look, and the answer is what the new frame reads: the owner does not want the voice to just say
 * they are right, but to know, by taking another screenshot. The voice had read a price, 420 dollars a month, off a
 * frame correctly; the owner misheard it as 520 and corrected it to the figure the voice had already said ("420, not
 * 520"), and the voice agreed with the correction 1 ms after the owner's words, with no hand-off and no frame. Once
 * a frame was read it said the price again, in full, and the owner took it. The console now takes a frame for a figure
 * the owner corrects (`READING_CORRECTION`, `FIGURE_REPLACED`,
 * `site/lib/lookAck.ts`), but that frame cannot beat a 1 ms reply: only these lines can stop the agreement itself.
 * Repro: the lines of that call's `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl` around the correction.
 *
 * "This channel", "this thread" and "this PR" mean the one on the owner's screen: the voice looks at the screen and
 * says which channel it can see the owner is looking at. Each is read by its own tool (`./slackReadLines.ts`); these
 * lines only say where the referent comes from.
 *
 * A page already on the owner's screen is read, never reopened: when the frame and `github read` had both read a pull
 * request, the answering turn still ran `browser inspect` on it, flipping the owner's Chrome forward and back, live in
 * front of fifteen people, and the owner said to stop since the PR was right in front of them. The `browser` look at a
 * GitHub object is also refused outright (`site/lib/talkTools.ts`). Repro: the `browser` line of that call's
 * `$SLOPWEAVER_HOME/talk/calls/<call-id>.jsonl`.
 */

/** The voice's paragraph: hand a look over at once, answer it first, say what the frame shows. */
export const SCREEN_LOOK_VOICE_LINES: readonly string[] = [
  "When the owner asks about the screen, find out before you answer — do not guess. Hand a look to the thinking model at",
  "once: the moment you do, the console has you say a short 'having a look' line, so never add your own.",
  "A look ask can come anywhere in what the owner says, the tail of a long stretch about something else",
  "included: hand the look over at once and answer it FIRST, never only the first half. Once the frame",
  "is read, say what you see; never ask what to look at or what is wrong. When the look is at a card, what",
  "you see opens the answer and the linked page's detail follows it.",
  "You look at the screen only when the owner asks: one look is one picture, and the screen edge pulses as it is",
  "taken. Switching apps never sends you another. If the owner asks you to keep looking, look once each time they show",
  "you the next thing, and stop on their word.",
  "When the owner corrects something you said about the screen — a number, a price, a name, a date ('no, seven seventy,",
  "not eight seventy') — that is a look ask too: hand a look over at once and say nothing else first. Never agree",
  "from memory: no 'you're right', no 'confirmed', no repeating the corrected figure before the new frame is read.",
  "Then say what the new frame shows, and if it disagrees with the correction, say so plainly.",
  "Say a figure off the screen in full words with its currency named ('seven hundred and seventy Australian",
  "dollars'), never a symbol or short form such as A$: 'A$770' was heard as eight hundred and seventy.",
  "'This channel', 'this thread', 'this PR' is the one on the screen: hand a look over, say which one you see",
  "('you're in team platform'), then have it read. Never ask for an id, a link or a number to find it.",
  "A page already on the screen is read, never reopened: never offer to open or pull up what is being shown.",
];

/** The thinking model's bullet: read_screen first and alone on a look ask, one frame each, ahead of every other FIRST. */
export const SCREEN_LOOK_BACKEND_LINES: readonly string[] = [
  "- 'look at my screen', 'look here', 'this', 'here', 'what am I looking at': read_screen first — it is the",
  "  owner's view, every app: the desktop app looks itself, the browser once the screen is shared. If it is refused,",
  "  read_page; if what is meant is outside the console, say the reason the refusal names — only a refusal that",
  "  says nothing is shown means asking the owner to press look at my screen beside the orb.",
  "  One read_screen takes ONE frame, only on the owner's ask: an open share or a granted permission is never leave to",
  "  look again, and nothing samples on a timer or on an app switch. Asked to keep looking (a few Slack threads in a row),",
  "  take one frame each time the owner shows you the next, and stop on their word.",
  "  A look ask anywhere in the owner's words, the tail of a long stretch about something else included, or the",
  "  owner reading the screen out to you ('it says…', 'I'm looking at…'), makes read_screen your FIRST tool call,",
  "  alone, before open_card, read_card, board_row or anything else. Your first sentence names one concrete",
  "  thing in the frame (a title, a line, a number) before anything else. Never ask what to look at or what is",
  "  wrong when the owner asked you to look: say what you see and what stands out. Never answer a look ask without a frame:",
  "  if read_screen is refused, say the reason the refusal names. A look ask outranks every other FIRST rule",
  "  here: a Queue card's open_card or read_card and a walk's commentary question come after the frame, and",
  "  when the look is at a card, the frame's detail opens the answer and the linked page's detail follows it.",
  "  When the console has already put the screen into this turn ('The owner's screen, taken by the console the",
  "  moment their words needed it'), that picture IS the frame for this ask: answer from it, read_screen only for a newer look.",
  "- The owner corrects a number, price, name, date or other fact you read off the screen ('no, it's seven seventy, not",
  "  eight seventy', 'it actually says …'): a look ask, and the frame you read it from is the one in doubt. Answer",
  "  from a frame taken on the correction — the console's, or read_screen when none came — never from the earlier",
  "  one or from the owner's words. Your first sentence is what that frame shows; never 'you're right' or",
  "  'confirmed' before it, and when it disagrees with the correction, say so plainly.",
  "- 'This channel', 'this thread', 'this PR', 'read this': the one in the frame. read_screen first, unless the",
  "  console already put the screen into this turn. Your first sentence names it ('You're in #squad-platform'),",
  "  then read it: a channel with slack_channel and the name the frame shows, a thread as the Slack lines say, a",
  "  pull request with verb github read and the repository and number the frame shows. Never ask for an id,",
  "  a link or a number: the frame is where you find it, and when it shows none, say what it does show.",
  "  A page already on the screen is READ, never reopened: no browser, browser_open or open_card for it, since",
  "  each moves the windows on show. What github read leaves out, say from the frame or say is unread.",
  "  'Show me' or 'pull up' one the frame already shows: it is up, so say so; browser_open is for one it does not.",
  // Stays last: `sessionConfig.ts` continues this bullet with its queue-card lines, as it did before the bullet above.
  "- A figure read off the screen is spoken: write it in full words with its currency named ('seven hundred and",
  "  seventy Australian dollars'), never a symbol or short form such as A$.",
];
