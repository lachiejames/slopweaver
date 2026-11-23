/**
 * The card-fidelity lines both Talk prompts carry (`./sessionConfig.ts`): what a card, row or page says is said in its
 * own terms and attributed, each claim keeps its own qualifiers, anything past what was read is marked as inference,
 * and a challenge is answered by re-reading the card rather than by conceding a flaw it does not contain.
 *
 * The owner's top priority is a voice that can be trusted to read what is on the page and speak faithfully about it;
 * anything less is a big problem. Two loci show up on a call file, and a third turns up proving the fix on a test call:
 *
 * - The voice's paraphrase. The thinking model wrote that uploading needs "a service key", and in an option's
 *   trade-off that the option "exposes the powerful key"; the voice said uploading "needs a powerful service key",
 *   opened on "Right now", and so moved an option's qualifier into the problem statement. The voice paraphrases what
 *   `appendSpeech` hands it (`site/lib/talkPlanWords.ts`) and there is no verbatim channel, so the only lever on the
 *   voice is its prompt: keep each claim's structure.
 * - The thinking model under challenge. Asked how a local page could need a powerful key, it answered from its own
 *   reasoning ("I haven't established that such broad permissions are necessary. That's a fair challenge to the
 *   proposed design") when the card proposes no permission design at all, and the voice amplified it to "I think
 *   that's a gap in the current proposal". It cited the card's own wording only minutes later. So a challenge re-reads
 *   the card, answers with its words first, then names what it does not say and what nobody has checked.
 *
 * - The voice answering a challenge itself. The re-read above binds the thinking model, which runs the card tools, so
 *   it holds only when the challenge reaches it. On a test call a typed line doubting
 *   that the card's problem was real started no delegated turn: the voice answered from what it had already said, and
 *   `slopweaver talk call-tools --call <call-id>` shows no tool line after it.
 *   That answer happened to hold the card's line, but nothing had read the card again. So the voice delegates a
 *   challenge, rather than answering it, even to hold its ground.
 *
 * - The thinking model answering a page from memory. Reading a briefing aloud with the voice, the owner asked about it
 *   for most of an hour; the model had read it whole once near the start and answered every later question from that
 *   thread memory, once telling the owner something waited for "the next cut" that the page's third section already
 *   covered. The owner felt misled. So a claim about what a page covers or leaves out is made off a `read_page` in the
 *   same turn, which reads a published page fresh (`site/lib/publishedPageVoice.ts`). Repro: `slopweaver talk
 *   call-thread --call <call-id>` shows the answering turn calling no read.
 *
 * The owner's standing requirement is the last voice line about what was not checked, and the last
 * backend line: name what was not read, not seen and not checked rather than answer confidently. `slopweaver talk fidelity` reads the call files for the first locus.
 */

/**
 * The voice's paragraph, after its candour lines: say a handed claim with the same structure it was handed. One rule
 * for every kind of loss, never a list of words: banning
 * phrases solves the wrong problem, and a narrow rule for one failure can weaken the guard on the others.
 */
export const CARD_FIDELITY_VOICE_LINES: readonly string[] = [
  "When you say what the thinking model handed you about anything it read, keep every claim as it was handed:",
  "the same subject, and its qualifiers, its 'not', its 'if' and its time stay on that claim, and no word moves",
  "to another claim. Add no claim the answer did not make: no sharpening word, judgement, question or promise, and",
  "never drop who said it ('the card says') or what it has not read or checked: that is part of it.",
  "When the owner doubts or challenges something you said from a card ('I don't think that's real', 'is that what it",
  "says?'), never answer it yourself, not even to hold your ground: delegate it, so the thinking model reads the",
  "card again and answers from its words. What you already said about it is not the card.",
];

/** The thinking model's bullets, after its candour bullets: how an answer explains, and defends, what it read. */
export const CARD_FIDELITY_BACKEND_LINES: readonly string[] = [
  "- Explaining anything you read (card, row, page, thread, file, code, supervisor chat, the screen):",
  "  say what it says, attributed ('the card says …'), quoting its words where they carry the claim (a number,",
  "  name, 'not', qualifier, option, decision, what someone said). Never quote words it does not hold.",
  "  Each claim keeps its subject, qualifiers, 'if', 'not' and time; an option's trade-off is never the",
  "  problem. Past what you read is yours: say so and what it rests on. Read only part? Say so.",
  "- The owner challenges a claim you made from a card: read it again, by whichever tool the card rule picks, and",
  "  answer with its words first, then what it does not say, then what you have not checked. Never agree to a",
  "  flaw it does not contain or critique a proposal it does not make; when it is silent, say so.",
  "- Saying what a page the owner reads covers, lacks or leaves to a later cut needs a read_page this turn, never",
  "  an earlier read. Differing from what they say is on screen, it changed since their tab loaded.",
  "- Name what you have not read, opened or checked whenever it bears on the answer, rather than answer as if",
  "  you had: 'I have read the card, not the code it names'.",
];
