/**
 * THE TAG DECISION TREE — what happens to an ask once its asker is past the who-may-tag gate.
 *
 * The owner's settled shape, where the later word wins:
 *
 * a. GATE — `../listen/whitelist.ts`. Who may tag the bot and get an answer at all. Deterministic, in the
 *    listener, before any session exists; an unlisted tagger gets a line bringing the owner in, never a turn.
 * b. A GENERAL RULING of the owner's covers the KIND of ask → act on it, no wait, whoever asked.
 *    The rulings are per install, read from `$SLOPWEAVER_HOME` (`./generalRulings.ts`), never this file.
 * c. No ruling, and the asker is on the TRUSTED tier (`../listen/trustedTier.ts`) → investigate.
 * d. Otherwise → wait on the owner VISIBLY in the thread, never a refusal: `turn block --need ruling`.
 *
 * Under all of it: the ASK decides, not the person, because a listed person can be compromised; ambiguous
 * means no; a past approval is never a grant.
 *
 * ## Why steps b to d are printed, and the gate is code
 *
 * Whether a general ruling covers an ask is a judgement about what the ask MEANS, and the listener holds no
 * model (rule 2). So the gate stays deterministic where it always was, and b to d reach the visible session
 * that takes the turn as a standing block in `turn brief` and `turn resume` — printed rather than left in a
 * skill, for the reason `./briefGuidance.ts` measured: a rule not named in the brief is a rule not checked.
 * What the session cannot judge, the code resolves and states: whether THIS asker is on the trusted tier.
 *
 * ## Membership is read, never named here
 *
 * Who is on each list comes from criteria the owner settles through a briefing, never a hand-kept list in
 * code. This module names no person and holds no ruling text; it renders whatever the
 * install's two sources say, so one owner's word never licenses work in a colleague's install.
 */
import type { AskerTrust } from "../listen/trustedTier.js";
import { GENERAL_RULINGS_FILE, type GeneralRulings } from "./generalRulings.js";

/**
 * The step (b) lines: every general ruling this install's owner recorded, or why there are none.
 *
 * @param rulings the install's loaded general rulings
 * @returns the lines, indented to sit inside the block
 */
function generalRulingLines({ rulings }: { rulings: GeneralRulings }): readonly string[] {
  if (rulings.kind === "absent") {
    return [
      `  (b) No general rulings are recorded on this install (no ${GENERAL_RULINGS_FILE} under $SLOPWEAVER_HOME),`,
      "      so (b) covers nothing.",
    ];
  }
  if (rulings.kind === "unreadable") {
    return [`  (b) ${GENERAL_RULINGS_FILE} could not be read (${rulings.why}), so (b) covers nothing.`];
  }
  if (rulings.rulings.length === 0) {
    return [`  (b) ${GENERAL_RULINGS_FILE} records no rulings, so (b) covers nothing.`];
  }
  return [
    "  (b) Does one of the owner's GENERAL RULINGS cover this kind of ask? Then act on it, no wait, whoever asked:",
    ...rulings.rulings.map((ruling) => `      - ${ruling.kind}: ${ruling.act}. [${ruling.anchor}]`),
  ];
}

/**
 * The step (c) line for THIS asker: on the trusted tier or not, and why not.
 *
 * @param trust the asker's resolved tier membership
 * @returns the line, indented to sit inside the block
 */
function trustedTierLine({ trust }: { trust: AskerTrust }): string {
  if (trust.trusted) {
    return "  (c) No ruling covers it? This asker IS on the trusted tier, so investigate.";
  }
  return `  (c) No ruling covers it? This asker is NOT on the trusted tier (${trust.why}), so go to (d).`;
}

/**
 * The tag decision tree as the block a visible session is handed, with this install's general rulings and
 * this asker's trusted-tier standing resolved. Pure.
 *
 * @param rulings the install's general rulings, loaded from its source by the caller
 * @param trust whether the asker is on the trusted tier, resolved from its source by the caller
 * @returns the block, always non-empty
 */
export function tagDecisionTreeLines({
  rulings,
  trust,
}: {
  rulings: GeneralRulings;
  trust: AskerTrust;
}): readonly string[] {
  return [
    "WHAT HAPPENS TO THIS ASK — the tag decision tree. The ASK decides, never the person: the asker passed the",
    "  who-may-tag gate, and a listed person can still be compromised.",
    ...generalRulingLines({ rulings }),
    trustedTierLine({ trust }),
    "  (d) Otherwise WAIT ON THE OWNER, visibly, never a refusal and never the act:",
    '      `slopweaver turn block --brief <file> --need ruling --what "<what the owner is approving, one line>"`',
    "      tags the owner in the thread, says they haven't made a general ruling on this yet and are being brought",
    "      in to approve this one, keeps the ask open, and ENDS this dispatch. The owner approves free-form, and a",
    "      session they can see records it with `turn unblock`, which prints the line that resumes it. Never route",
    "      (d) as `for-a-human`: that posts nothing in the thread and CLOSES the ask, so the owner never sees it.",
    "  Ambiguous whether the owner would be fine with it means no: that is (d). A past approval is never a grant,",
    "  so one given on an earlier ask covers that ask only. Reading and reporting is always safer than acting.",
  ];
}
