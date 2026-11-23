/**
 * A complete, already-valid `--form`, printed by `sop draft --form-example`.
 *
 * It exists because a strict schema is only usable if you can see a filled one. The proposal and GitHub PR
 * forms ship the same escape hatch for the same reason: the alternative is a session guessing at field names
 * and being refused six times, which reads as the tool being broken rather than as the form being strict.
 *
 * Every field is present, including the optional ones, and the content is deliberately about a made-up
 * subject at a made-up company — an example quoting a real procedure would be copied verbatim into a real
 * SOP, which is exactly the way an invented process gets published as a real one.
 */
import type { SopForm } from "../../../outbound/sop/types.js";

/** A filled form that passes both the schema and the lint gate. */
export const SOP_FORM_EXAMPLE: SopForm = {
  beforeYouStart: [
    "Admin on the ticketing tool, or someone on the rota who has it",
    "The requester's work email address, and their manager's approval in writing",
  ],
  emoji: "📋",
  escalation: {
    to: "the platform on-call rota in the support channel",
    when: "The request needs an access level this SOP does not list, or the approval cannot be found.",
  },
  exceptions: [
    {
      situation: "The requester is a contractor rather than an employee",
      whatToDo: "Grant read-only for the trial period and re-check at the end of it.",
    },
    {
      situation: "The tool reports the seat limit is reached",
      whatToDo: "Reclaim a seat from the dormant-account list before buying another.",
    },
  ],
  lastUpdated: "2026-09-01",
  owner: {
    contact: "the support channel",
    person: "Seth Example",
    role: "Platform Operations",
  },
  purpose:
    "Give one written answer to who may be granted a seat on the ticketing tool, so the same request is not " +
    "decided three different ways by three different people.",
  related: [
    { text: "The access-review policy", url: "https://example.test/policy/access-review" },
    { text: "SOP: removing a leaver's access", url: "https://example.test/sop/leaver-access" },
  ],
  reviewCadence: "every six months, or whenever the tool changes its seat types",
  scope: {
    covers: ["Employees and contractors asking for a seat", "Upgrading an existing read-only seat"],
    doesNotCover: [
      "Removing access, which the leaver SOP covers",
      "Anyone outside the organisation, including agency staff",
    ],
  },
  source: { text: "the request thread", url: "https://example.test/threads/1" },
  steps: [
    {
      action: "Check the approval is in writing",
      detail: "A verbal yes in a call is not one. Ask for it in the thread and wait.",
      who: "whoever is on the support rota",
    },
    {
      action: "Create the seat at the lowest level that does the job",
      detail: "Read-only unless the request names a task that needs more.",
      who: "a tool admin",
    },
    {
      action: "Reply in the thread with what was granted",
      who: "whoever is on the support rota",
    },
  ],
  title: "SOP: Granting a seat on the ticketing tool",
  whenThisApplies: "Somebody has asked for access to the ticketing tool, or for more access than they already have.",
};
