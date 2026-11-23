/**
 * The escape-hatch rows for the asks and steps a run puts in front of the owner — `handover ask`, `hand post` and
 * `turn settle-reaction`. How a run ENDS (`handover finish|settle|park`) is `./handoverEndingHatches.ts`.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position, directly after
 * `./handoverEndingHatches.ts`. Add a row for a new owner-action refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on an owner-facing ask or step, in register order. */
export const HANDOVER_OWNER_ACTION_HATCHES = [
  {
    caught:
      "the ask carries no problem, no options with their trade-offs and no lean, and a recorded ask the owner has " +
      "to parse is a defect",
    command: "slopweaver handover ask",
    exceptions: [
      "the session is mid-incident, has to park on the owner NOW, and genuinely has one course of action rather than a choice",
      "a row asking the owner to pick nothing DECLARES it — `--finding` or `--dispatch` — and needs no hatch",
    ],
    id: "unshaped-ask",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNSHAPED_ASK" },
    lane: "ambient",
    reader: "src/handover/askShapeGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the question does not line up with the card drawn from it — its lead asks nothing, it names a pull " +
      "request with no link, or a field names a picture file the card can only draw as a path, and a card the owner has " +
      "to decode by reading elsewhere is a defect",
    command: "slopweaver handover ask",
    exceptions: [
      "a `#NN` in the question is not a GitHub pull request or issue — a ticket, a tick or a count",
      "the run must park on the owner NOW and genuinely asks nothing, so the card is headed by that statement as written",
      "the `.png` the text names is the subject being discussed — a file to rename or delete — not a picture to show",
    ],
    id: "unaligned-card",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNALIGNED_CARD" },
    lane: "ambient",
    reader: "src/handover/cardAlignment.ts",
    standing: "proposed",
  },
  {
    caught:
      "the question is one the owner already ruled on in this run, word for word, and a re-ask in the same words is " +
      "a stale card the owner has told the fleet to stop putting in front of them — a re-ask that needs the owner " +
      "again says what changed since their ruling",
    command: "slopweaver handover ask",
    exceptions: [
      "the owner asked for the very same question to be put to them again unchanged, and that word is journalled on " +
        "the run",
      "the owner's ruling was journalled against this question by mistake, and the re-ask is how the record is put " +
        "right",
    ],
    id: "ruled-reask",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_RULED_REASK" },
    lane: "ambient",
    reader: "src/handover/ruledReaskGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the owner has said more since the words this row was registered from — ready `talk-*` rows registered " +
      "after them, which this seat has not named as read — and a question one of them already answers is the stale " +
      "card the owner keeps being shown (re-asked to take a set they had already taken, on another row)",
    command: "slopweaver handover ask",
    exceptions: [
      "the seat has read every listed row in full and none of them answers or changes the question",
      "a listed row is about other work entirely, read and set aside, and the question still needs the owner",
    ],
    id: "later-owner-words",
    key: { kind: "command", incantation: "slopweaver handover ask <slug> … --read-owner-words <slug,...>" },
    lane: "ambient",
    reader: "src/handover/laterOwnerWords.ts",
    standing: "proposed",
  },
  {
    caught:
      "the owner has spoken over this run's held-question card since the question was asked, and a seat about to put " +
      "that question in front of the owner again has not named those words as read — they may already answer it",
    command: "slopweaver hand post",
    exceptions: [
      "the seat has read every listed utterance in its call and none of them answers the question",
      "a listed utterance is a greeting or about other work, said while the card happened to be open",
    ],
    id: "held-question-owner-words",
    key: { kind: "command", incantation: "slopweaver hand post … --read-owner-words <call anchor,...>" },
    lane: "ambient",
    reader: "src/handover/ownerWordsBeforeReask.ts",
    standing: "proposed",
  },
  {
    caught:
      "the question asks the owner to sign into a Claude or Codex plan without the plan's email address, and a plan " +
      "number alone makes the owner guess which account it is",
    command: "slopweaver handover ask",
    exceptions: [
      "the text names a plan the fleet signs into itself, and asks the owner to sign into nothing",
      "the plan's cached email in the register is wrong, and the question names the right address instead",
    ],
    id: "plan-sign-in-without-email",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_PLAN_SIGN_IN_WITHOUT_EMAIL" },
    lane: "ambient",
    reader: "src/handover/planSignInGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the card asks the owner to sign in to Datadog or GitHub, walls the fleet presses through itself, " +
      "and no fresh `browser sign-in` look found a step that is genuinely the owner's",
    command: "slopweaver handover ask",
    exceptions: [
      "the text quotes a past sign-in card as history, and asks the owner to sign in to nothing",
      "the relay cannot reach the owner's Chrome at all, so no look can be taken, and the card says that is why",
    ],
    id: "fleet-sign-in-card",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_FLEET_SIGN_IN_CARD" },
    lane: "ambient",
    reader: "src/handover/fleetSignInGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the card names a parked Slack draft the drafts register does not hold — sent, dropped or never recorded — " +
      "and a card asking the owner to react to a draft it cannot show must never happen",
    command: "slopweaver handover ask",
    exceptions: [
      "the text cites a sent or dropped draft as history, and asks the owner to send nothing",
      "the draft was recorded on a different state home, and the card says where it is",
    ],
    id: "unheld-draft",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNHELD_DRAFT" },
    lane: "ambient",
    reader: "src/handover/namedDraftGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the step asks the owner to react to a message drafted as the owner and carries no draft the card can draw — " +
      "the owner then asks where the drafted replies are",
    command: "slopweaver hand post",
    exceptions: [
      "the step speaks of a draft as history — one already sent — and asks the owner to react to nothing",
      "the draft is a GitHub comment or another surface the card cannot draw, and the step links it directly",
    ],
    id: "undrawn-draft",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNDRAWN_DRAFT" },
    lane: "ambient",
    reader: "src/hand/draftAsOwner.ts",
    standing: "proposed",
  },
  {
    caught:
      "the card says a message was drafted as the owner and carries no draft the card can draw — two recorded asks pointed " +
      "at a DM thread and a page instead, where a Queue card about a draft shows it",
    command: "slopweaver handover ask",
    exceptions: [
      "the card cites a draft already sent as history, and asks the owner to send nothing",
      "the draft is a GitHub comment or another surface no card draws, and the card links it directly",
    ],
    id: "undrawn-ask-draft",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNDRAWN_ASK_DRAFT" },
    lane: "ambient",
    reader: "src/handover/undrawnAskDraftGate.ts",
    standing: "proposed",
  },
  {
    caught:
      "the calling session is not the pinned supervisor, and only the supervisor posts a floating note — a seat " +
      "posted a codex-capped note that the owner dismissed",
    command: "slopweaver hand post",
    exceptions: [
      "this session is the chair, pinned by hand or on Codex, and `slopweaver cmux pin` cannot record it",
      "the chair is mid-takeover and the pin record still names its predecessor",
    ],
    id: "seat-hand-post",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_SEAT_HAND_POST" },
    lane: "ambient",
    reader: "src/hand/seatPost.ts",
    standing: "proposed",
  },
  {
    caught:
      "the post opened its --url in the owner's Chrome first and the page answered an error, did not load, or drew nothing — " +
      "or the browser could not look at all — and a note is never put in front of the owner on a page nobody has seen show " +
      "the thing",
    command: "slopweaver hand post",
    exceptions: [
      "the browser route is down on this machine (no pin, no extension) and the page was checked another way this turn",
      "the step IS to fix the page — it is expected to be broken, and the sentence says so",
    ],
    id: "unseen-hand-url",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNSEEN_HAND_URL" },
    lane: "ambient",
    reader: "src/cli/commands/hand/postLook.ts",
    standing: "proposed",
  },
  {
    caught:
      "the ending asked for contradicts the one the ask was JUDGED to: `:ack:` says nothing is owed and " +
      "`:for-a-human:` says a person owes the answer, and a hand settle must never swap one for the other " +
      "(a person should answer never reads as nothing owed)",
    command: "slopweaver turn settle-reaction",
    exceptions: [
      "the recorded judgement was wrong and has been reviewed, and the reaction is being corrected to what is true",
    ],
    id: "judged-ending-swap",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_JUDGED_ENDING_SWAP" },
    lane: "ambient",
    reader: "src/cli/commands/turn/settleReaction.ts",
    standing: "proposed",
  },
  {
    caught:
      "the check-in names a board row whose pull request is not merged, so the thing it asks the owner to look at is not " +
      "live yet — a check-in once opened the old page while the pull request sat open",
    command: "slopweaver hand post --check-in --row",
    exceptions: [
      "the check-in asks the owner to look at the open pull request itself, not at what it ships",
      "what the owner checks is live from another merged change, and the row's own pull request only tidies after it",
    ],
    id: "unmerged-check-in",
    key: { kind: "env", variable: "SLOPWEAVER_ALLOW_UNMERGED_CHECK_IN" },
    lane: "ambient",
    reader: "src/cli/commands/hand/postLook.ts",
    standing: "proposed",
  },
] as const satisfies readonly EscapeHatch[];
