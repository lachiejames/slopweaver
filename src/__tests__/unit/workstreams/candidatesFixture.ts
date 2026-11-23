/**
 * A small, valid candidates document the unit tests build variants of: one candidate already on the register
 * (`merge-gate`, from `./fixture.ts`), two that are not, one citing a Slack channel the register does not name and
 * a transcript anchor and carrying the enrichment (definitions of done, what stalled, who to loop in), and one filed
 * under the `self` workspace with none, as an older mine wrote it.
 */

/** The candidate the register already holds as `merge-gate`. */
function heldCandidate(): Record<string, unknown> {
  return {
    evidence: [
      { anchor: null, date: "2026-08-05", href: "https://example.test/m/2", quote: "merge gate agreed" },
      { anchor: null, date: "2026-08-01", href: "https://example.test/m/1", quote: "nothing should merge red" },
    ],
    evidenceCount: 30,
    first: "2026-08-01",
    id: "c-001",
    inRegister: "merge-gate",
    last: "2026-09-10",
    n: 1,
    name: "Merge gate",
    outcome: "Nothing merges red",
    people: ["Ari"],
    theme: "ci-testing",
    workspace: "team",
  };
}

/** The two candidates the register does not hold: the enriched one, and one an older mine wrote. */
function newCandidates(): Record<string, unknown>[] {
  return [
    enrichedCandidate(),
    {
      evidence: [{ anchor: null, date: "2026-06-01", href: "https://example.test/m/4", quote: "WAF in monitor mode" }],
      evidenceCount: 5,
      first: "2026-06-01",
      id: "c-003",
      inRegister: null,
      last: "2026-06-20",
      n: 3,
      name: "Cloudflare WAF rollout",
      outcome: "The WAF blocks rather than watches",
      people: [],
      theme: "security-compliance",
      workspace: "self",
    },
  ];
}

/** The candidate carrying the enrichment: definitions of done, what stalled, who to loop in. */
function enrichedCandidate(): Record<string, unknown> {
  return {
    doneOptions: [
      {
        id: "written-within-a-week",
        lens: "result",
        text: "Every incident has a written postmortem within five working days",
        tradeoff: "easy to measure, but a rushed write-up counts as done",
      },
      {
        id: "owned-and-read",
        lens: "people",
        text: "Each postmortem has a named owner and the on-call lead has read it",
        tradeoff: "slower to reach, but someone answers for every one",
      },
    ],
    evidence: [
      {
        anchor: null,
        date: "2026-07-02",
        href: "https://example.slack.com/archives/C0SYNINCIDENTS/p1782000000000100",
        quote: "postmortems keep slipping",
      },
      { anchor: "owner-turn:owner-turn-12.txt", date: "2026-07-09", href: null, quote: "we never write them" },
    ],
    evidenceCount: 8,
    first: "2026-07-02",
    id: "c-002",
    inRegister: null,
    last: "2026-07-09",
    loopIn: [
      {
        name: "Ari",
        opener: "Postmortems keep slipping. Could we agree who owns writing each one?",
        slack: "U0SYNTESTAAA1",
        why: "leads on-call, so owns whether a postmortem gets written",
      },
    ],
    n: 2,
    name: "Postmortems that happen",
    outcome: "Every incident gets a written postmortem",
    people: [],
    stalled: { since: "2026-07-09", what: "no postmortem written since the July incident" },
    theme: "reliability-incidents",
    workspace: "team",
  };
}

/**
 * The candidates document.
 *
 * @returns a fresh document
 */
export function validCandidates(): Record<string, unknown> {
  return {
    candidates: [heldCandidate(), ...newCandidates()],
    channels: { C0SYNINCIDENTS: "#incidents" },
    minedFrom: "the owner's Slack messages and session transcripts",
    minedIso: "2026-10-02T13:00:00.000Z",
    schemaVersion: 1,
  };
}
