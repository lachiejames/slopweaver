/**
 * WHAT THE REPLY MAY SHARE — the standing rule on disclosure, printed into every brief and every resume.
 *
 * The owner's standing rulings, from the console calls journalled under `a-ruling-for-who-the-bot-answers`:
 * the bot shares only what the owner, compliance in mind, would share; a reply that would show a reader data
 * they cannot already reach is a privilege escalation and waits on the owner; ambiguous means no; a past
 * approval is never a grant; a partial answer the owner's decision would change waits whole; and a private
 * fact is answered around as if unknown.
 *
 * ## Why this is printed, and why it takes no input
 *
 * `standingAnswerScopeLines` (`./briefGuidance.ts`) carries both reasons and they bind here identically: a rule not named in
 * the brief is a rule not checked, and a standing rule that can be absent is not standing. So there is no
 * profile, directive or file that could switch this off.
 *
 * ## The boundary it shares with the answer-scope rule
 *
 * The two blocks print side by side because each is the other's limit. The answer-scope rule forbids refusing
 * on what an answer is ABOUT; this one governs who may SEE a fact. Read alone, this block becomes the tone
 * refusal that rule bans, and that rule read alone becomes a licence to leak — so the last lines here say
 * which question is whose.
 *
 * The reasoning and the worked cases: `skills/loop-bot/reference/what-the-reply-may-share.md`.
 */

/**
 * The standing disclosure block, printed by `turn brief` and `turn resume` beside the answer-scope block.
 *
 * @returns the block, always non-empty
 */
export function replyDisclosureLines(): readonly string[] {
  return [
    "WHAT THE REPLY MAY SHARE — standing owner rulings, and it never loads conditionally:",
    "  Share only what the owner, compliance in mind, would share. Would they look at it and say \"this person isn't",
    '  supposed to see that"? Then the reply does not carry it. Already visible to every reader is not a question.',
    "  Check WHO WILL SEE the reply, not only who asked: every reader in the channel, and whether each can already",
    "  reach the access-controlled place the fact came from; one reader's access clears that reader only. A reader",
    "  who cannot, or whose access you cannot establish, is a privilege escalation: wait on the owner, visibly, and end",
    "  the dispatch —",
    '  `slopweaver turn block --brief <file> --need risky-approval --what "<the narrow step, one line>"`.',
    "  Ambiguous whether the owner would be fine with it means no, and no means that wait, never a refusal or the act.",
    "  A past approval is never a grant: five blocks on one narrow step earn a general ruling PROPOSED to the owner,",
    "  never assumed. If the gated part would materially change the answer, the WHOLE answer waits; if it would",
    "  not, answer from what you may share. No answer beats a bad one.",
    "  A private fact is answered around AS IF UNKNOWN: someone resigning, something told the owner in confidence, the",
    '  reason they are away ("they\'re away", maybe "back in an hour or two"). No hint, no "there may be more I',
    '  can\'t share". The owner\'s own private DECISION ("the owner is handling pilot invites personally") is fine',
    "  to share. Never move a reply into a DM to dodge an audience; a fact the channel may not see waits on the",
    "  owner instead.",
    "  This governs who may SEE a fact. It never governs what an answer is ABOUT: refusing on tone stays banned",
    "  by the answer-scope rule above.",
  ];
}
