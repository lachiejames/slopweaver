/**
 * A hand step's card carries its own record and nothing else: about 95% of a composed card's text was generic
 * boilerplate the owner skips over, and it added no value.
 * The fixtures are steps shaped as `hand list --json` prints them, so "nothing composed" is asserted over realistic
 * records rather than a convenient one.
 */
import { describe, expect, it } from "vitest";

import {
  type HandDecisionRecord,
  type HandRecord,
  handCard,
  stepCardForm,
  stepCardTemplateText,
  stepDestination,
} from "../../lib/handCard";
import { pasteFieldsCoverLiteral, stepCardTexts } from "../../lib/handCardTexts";

/** `hand:op-account-add-atlas-for-1password-resync`, as `hand list --json` prints it. */
const OP_ACCOUNT: HandRecord = {
  cites: [],
  id: "op-account-add-atlas-for-1password-resync",
  checklist: undefined,
  ifIgnored: undefined,
  literal: "op account add --shorthand atlas",
  opened: undefined,
  unaddressed: undefined,
  unblocks:
    "resync-atlas-onepassword: op signin --account atlas fails with found no accounts for filter atlas, so no account is configured in op yet (row 1password-atlas-resync-cannot-succeed-unattended-for-its)",
  url: undefined,
  what: "Add the team 1Password account to the op CLI under the shorthand atlas, then sign in when it prompts",
  where: "a terminal on this Mac; op asks for the sign-in address and your email",
  witness: "op signin --account atlas succeeds",
};

/** `hand:github-sso-for-screenshots`, as `hand list --json` prints it. */
const GITHUB_SSO: HandRecord = {
  cites: ["https://github.com/acme/app/actions/runs/12"],
  id: "github-sso-for-screenshots",
  checklist: undefined,
  ifIgnored: undefined,
  literal: undefined,
  opened: undefined,
  unaddressed: undefined,
  unblocks: "the three console screenshots on the acme app pull request",
  url: "https://github.com/orgs/acme/sso",
  what: "Complete acme's GitHub single sign-on in your Chrome so the PR screenshots can upload",
  where: "your own Chrome, signed in to github.com",
  witness: "slopweaver github attach status --org acme",
};

/** `hand:trajectory-tasks-on-read-page`: a local page for its address, and no place. */
const TRAJECTORY: HandRecord = {
  cites: [],
  id: "trajectory-tasks-on-read-page",
  checklist: undefined,
  ifIgnored: undefined,
  literal: undefined,
  opened: undefined,
  unaddressed: undefined,
  unblocks: "board row datadog-hmi-for-trajectory-task-replay, which waits on your pick",
  url: "file:///Users/someone/.slopweaver/pages/agent-observability-setup/index.html",
  what: "Read the page on what 4,745 classified tasks say about your month (Tasks is on, cost 0.004% of a Max week)",
  where: undefined,
  witness: 'slopweaver hand done trajectory-tasks-on-read-page --did "read it"',
};

/** A shaped ask a decision step opens, with its three stakes lines. */
const DECISION: HandDecisionRecord = {
  blastRadius: "the value-customer e2e persona; no production code",
  lean: "go with whatever you decide on 16400",
  options: [
    { letter: "A", option: "take 16400 forward, then rebase 16406", tradeoff: "two rebases" },
    { letter: "B", option: "rebase 16406 alone", tradeoff: "loses the side-by-side video" },
  ],
  problem: "16406 can't land while its base 16400 is a draft",
  risk: "a wrong seed breaks the local e2e specs",
  slug: "acme-booking-draft-16406",
  stillReal: "16406 is a draft, CONFLICTING",
  stillRealIso: "2026-09-25T10:23:40.890Z",
  summary: "The booking seed draft 16406 sits on 16400.",
};

describe("handCard on a step to take", () => {
  it("draws the step's own fields in the order the owner acts on them, the literal as the copy block", () => {
    const { card, form } = handCard({ step: GITHUB_SSO });
    expect(card.question).toBe("Complete acme's GitHub single sign-on in your Chrome so the PR screenshots can upload");
    expect(card.subject).toBe("github-sso-for-screenshots");
    expect(card.rows).toEqual([
      { label: "go to", value: "https://github.com/orgs/acme/sso" },
      { label: "unblocks", value: "the three console screenshots on the acme app pull request" },
      { behind: true, label: "where", value: "your own Chrome, signed in to github.com" },
      { behind: true, label: "done when", value: "slopweaver github attach status --org acme" },
      { behind: true, label: "cites", value: "https://github.com/acme/app/actions/runs/12" },
    ]);
    expect(card.copy).toBe(undefined);
    expect(card.decision).toBe(undefined);
    expect(form).toEqual({ kind: "drawn" });
  });

  it("draws no row for a field the record left off, and no posted-by row for any poster", () => {
    const { card } = handCard({ step: OP_ACCOUNT });
    expect(card.rows).toEqual([
      { label: "unblocks", value: OP_ACCOUNT.unblocks },
      { label: "where", value: OP_ACCOUNT.where },
      { behind: true, label: "done when", value: OP_ACCOUNT.witness },
    ]);
    expect(card.copy).toBe("op account add --shorthand atlas");
  });

  it("draws what happens if the owner does nothing in the unblocks line's place, and the unblocks line behind the fold", () => {
    const ifIgnored = "the Clerk resync stays paused and its row never clears";
    const { card, form } = handCard({ step: { ...GITHUB_SSO, ifIgnored } });
    expect(form).toEqual({ kind: "drawn" });
    expect(card.rows).toEqual([
      { label: "go to", value: "https://github.com/orgs/acme/sso" },
      { label: "if you do nothing", value: ifIgnored },
      { behind: true, label: "where", value: "your own Chrome, signed in to github.com" },
      { behind: true, label: "unblocks", value: "the three console screenshots on the acme app pull request" },
      { behind: true, label: "done when", value: "slopweaver github attach status --org acme" },
      { behind: true, label: "cites", value: "https://github.com/acme/app/actions/runs/12" },
    ]);
  });

  it("keeps the where row above the fold on a step that has the owner paste something, chip or not", () => {
    const { card } = handCard({ step: { ...GITHUB_SSO, literal: "slopweaver secrets set x" } });
    expect(card.rows.find((row) => row.label === "where")).toEqual({
      label: "where",
      value: "your own Chrome, signed in to github.com",
    });
  });

  it("treats a blank do-nothing line as none, drawing the unblocks line in its place", () => {
    const { card } = handCard({ step: { ...GITHUB_SSO, ifIgnored: "  " } });
    expect(card.rows.map((row) => row.label)).toEqual(["go to", "unblocks", "where", "done when", "cites"]);
  });

  it("names a local page the step opens as a page, and draws its address as the step wrote it", () => {
    const { card } = handCard({ step: TRAJECTORY });
    expect(card.pages).toEqual([{ slug: "agent-observability-setup", url: TRAJECTORY.url }]);
    expect(card.rows.find((row) => row.label === "go to")!.value).toBe(TRAJECTORY.url);
  });

  it("draws why a card naming its row has not left, straight after what it unblocks", () => {
    const rowProblem = "no doc carries the board row agent-observability-setup, live or archived";
    const { card, form } = handCard({ step: { ...TRAJECTORY, rowProblem } });
    expect(card.rows.slice(1, 3)).toEqual([
      { label: "unblocks", value: TRAJECTORY.unblocks },
      { label: "still here because", value: rowProblem },
    ]);
    expect(form).toEqual({ kind: "drawn" });
  });

  it("draws nothing any two different steps share — no sentence is the card's own", () => {
    const texts = [OP_ACCOUNT, GITHUB_SSO, TRAJECTORY].map((step) => stepCardTexts({ card: handCard({ step }).card }));
    const shared = texts.flatMap((mine, index) =>
      mine.filter((text) => texts.some((theirs, other) => other !== index && theirs.includes(text))),
    );
    expect(texts.every((mine) => mine.length > 0)).toBe(true);
    expect(shared).toEqual([]);
  });
});

describe("the place a step sends the owner, drawn first as its call to action", () => {
  /** `hand:mon-signin-dashboard-clerk-com`, as `hand list --json` prints it once the owner opens its card. */
  const CLERK: HandRecord = {
    checklist: undefined,
    cites: [],
    id: "mon-signin-dashboard-clerk-com",
    ifIgnored: undefined,
    literal: undefined,
    opened: "https://dashboard.clerk.com",
    unaddressed: undefined,
    unblocks:
      "resync-atlas-clerk stopped at dashboard.clerk.com's sign-in page — each row stays paused on its failure finding until an attempt gets past it",
    url: "http://localhost:3000/queue?open=hand%3Amon-signin-dashboard-clerk-com&context=work",
    what: "Sign in to dashboard.clerk.com in the work Chrome window that just opened on its sign-in page",
    where: "Your work Chrome profile, on that platform's sign-in page — sign in there, then press Done",
    witness: "slopweaver monitor check --fire",
  };

  it("draws the Clerk card's page as its first row, and no link back to the card the owner is on", () => {
    const { card, form } = handCard({ step: CLERK });
    expect(stepDestination({ step: CLERK })).toBe("https://dashboard.clerk.com");
    expect(card.rows.map((row) => row.label)).toEqual(["go to", "unblocks", "where", "done when"]);
    expect(card.rows[0]).toEqual({ label: "go to", value: "https://dashboard.clerk.com" });
    expect(form).toEqual({ kind: "drawn" });
  });

  it("goes to the one cited page when the card's own link is all it carries — a sign-in whose page would not open", () => {
    const cited = { ...CLERK, cites: ["https://dashboard.clerk.com"], opened: undefined };
    const { card } = handCard({ step: cited });
    expect(card.rows.map((row) => row.label)).toEqual(["go to", "unblocks", "where", "done when"]);
    expect(card.rows[0]).toEqual({ label: "go to", value: "https://dashboard.clerk.com" });
  });

  it("keeps the card's own link, and draws no place, on a step that sends the owner nowhere else", () => {
    const own = { ...CLERK, opened: undefined };
    const { card } = handCard({ step: own });
    expect(stepDestination({ step: own })).toBe(undefined);
    expect(card.rows.slice(0, 2)).toEqual([
      { label: "unblocks", value: CLERK.unblocks },
      { label: "open", value: CLERK.url },
    ]);
  });

  it("goes to the page the fleet opened and still draws a link to another queue item beside it", () => {
    const ask = "http://localhost:3000/queue?open=ask%3Aclerk-resync&context=work";
    const { card } = handCard({ step: { ...CLERK, url: ask } });
    expect(card.rows.filter((row) => row.label === "go to" || row.label === "open")).toEqual([
      { label: "go to", value: "https://dashboard.clerk.com" },
      { label: "open", value: ask },
    ]);
  });

  it("goes to no cite when the step cites more than one", () => {
    const two = { ...CLERK, cites: ["https://clerk.com/a", "https://clerk.com/b"], opened: undefined };
    expect(stepDestination({ step: two })).toBe(undefined);
  });
});

describe("handCard on a decision step", () => {
  it("draws the ask's own summary, problem, recorded options, lean and stakes, and no leave-it option", () => {
    const { card, form } = handCard({ decision: DECISION, step: OP_ACCOUNT });
    expect(card.subject).toBe("acme-booking-draft-16406");
    expect(card.decision).toEqual({
      lean: "go with whatever you decide on 16400",
      options: [
        { letter: "A", sentence: "take 16400 forward, then rebase 16406", tradeoff: "two rebases" },
        { letter: "B", sentence: "rebase 16406 alone", tradeoff: "loses the side-by-side video" },
      ],
      problem: "16406 can't land while its base 16400 is a draft",
      stakes: {
        blastRadius: "the value-customer e2e persona; no production code",
        checkedIso: "2026-09-25T10:23:40.890Z",
        kind: "stated",
        risk: "a wrong seed breaks the local e2e specs",
        stillReal: "16406 is a draft, CONFLICTING",
      },
      summary: "The booking seed draft 16406 sits on 16400.",
    });
    expect(card.copy).toBe("op account add --shorthand atlas");
    expect(form).toEqual({ kind: "drawn" });
  });

  it("draws no stakes at all when the ask recorded fewer than all three lines", () => {
    const { card } = handCard({ decision: { ...DECISION, stillReal: undefined }, step: OP_ACCOUNT });
    expect(card.decision!.stakes).toBe(undefined);
  });
});

describe("the template-text refusal", () => {
  it("finds nothing to refuse on a card built from its own records", () => {
    const built = [
      { decision: undefined, step: OP_ACCOUNT },
      { decision: undefined, step: GITHUB_SSO },
      { decision: DECISION, step: TRAJECTORY },
    ].map(({ step, decision }) => stepCardTemplateText({ card: handCard({ decision, step }).card, decision, step }));
    expect(built).toEqual([[], [], []]);
  });

  it("names a composed row and refuses the card, quoting it", () => {
    const { card } = handCard({ step: GITHUB_SSO });
    const composed = "A session recorded this as a step only your hands can take.";
    const contaminated = { ...card, rows: [...card.rows, { label: "where" as const, value: composed }] };
    expect(stepCardTemplateText({ card: contaminated, step: GITHUB_SSO })).toEqual([composed]);
    expect(stepCardForm({ card: contaminated, step: GITHUB_SSO })).toEqual({
      kind: "refused",
      why: `This card would draw text its step did not record ("${composed}"), so it is refused rather than drawn.`,
    });
  });

  it("draws the step's sentence as its heading verbatim, and refuses one turned into a question it never asked", () => {
    const step = { ...OP_ACCOUNT, what: "Sign in" };
    const { card, form } = handCard({ step });
    expect(card.question).toBe("Sign in");
    expect(form).toEqual({ kind: "drawn" });
    expect(stepCardTemplateText({ card: { ...card, question: "Sign in?" }, step })).toEqual(["Sign in?"]);
  });

  it("draws a step whose sentence carries surrounding whitespace, since the fold trims only layout", () => {
    const { card, form } = handCard({ step: { ...OP_ACCOUNT, what: " Sign in " } });
    expect(card.what.whole).toBe("Sign in");
    expect(form).toEqual({ kind: "drawn" });
  });

  it("checks a decision against the ask's record, not against the card's own copy of it", () => {
    const { card } = handCard({ decision: DECISION, step: OP_ACCOUNT });
    const invented = "Leave it: the note stays on your screen and the decision stays open.";
    const contaminated = {
      ...card,
      decision: {
        ...card.decision!,
        options: [...card.decision!.options, { letter: "C", sentence: invented, tradeoff: "none" }],
      },
    };
    expect(stepCardTemplateText({ card: contaminated, decision: DECISION, step: OP_ACCOUNT })).toEqual([
      invented,
      "none",
    ]);
  });
});

describe("a step whose secrets have paste fields", () => {
  /** The SecOps client step's shape: a provider console to open, and two secrets to store, one command each. */
  const SECOPS: HandRecord = {
    checklist: undefined,
    cites: [],
    id: "secops-oauth-client",
    ifIgnored: undefined,
    literal:
      'slopweaver secrets set google-secops-client-id\n"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" secrets set google-secops-client-secret',
    opened: undefined,
    secrets: ["google-secops-client-id", "google-secops-client-secret"],
    unaddressed: undefined,
    unblocks: "the SecOps atlas",
    url: "https://console.cloud.google.com/apis/credentials",
    what: "Create a Desktop OAuth client for SecOps, then paste its id and secret into the fields",
    where: "the fields on this card",
    witness: "slopweaver secrets status shows both stored",
  };

  it("draws no copy block when the fields cover every line the literal runs", () => {
    expect(handCard({ step: SECOPS }).card.copy).toBeUndefined();
    expect(pasteFieldsCoverLiteral({ literal: SECOPS.literal!, secrets: SECOPS.secrets! })).toBe(true);
  });

  it("keeps the copy block whole when the literal runs anything besides a covered secrets set", () => {
    const literal = `${SECOPS.literal!}; slopweaver atlas google-secops connect`;
    expect(handCard({ step: { ...SECOPS, literal } }).card.copy).toBe(literal);
  });

  it("keeps it when a line stores a secret the card has no field for", () => {
    const secrets = ["google-secops-client-id"];
    expect(handCard({ step: { ...SECOPS, secrets } }).card.copy).toBe(SECOPS.literal);
  });

  it("keeps it on a step that names no secrets, as every row before the field does", () => {
    const { secrets: _dropped, ...bare } = SECOPS;
    expect(handCard({ step: bare }).card.copy).toBe(SECOPS.literal);
  });

  it.each(['"$(other)/bin/slopweaver"', "`other`/bin/slopweaver", '"${X:-$(other)}/bin/slopweaver"'])(
    "keeps it when the binary's path runs a command of its own: %s",
    (binary) => {
      expect(
        pasteFieldsCoverLiteral({ literal: `${binary} secrets set linear-token`, secrets: ["linear-token"] }),
      ).toBe(false);
    },
  );

  it("drops a checklist line's copy block when its field covers it, keeping its sentence and where its value sits", () => {
    const line = {
      action: "Paste the Client ID into its field on this card",
      command: "slopweaver secrets set google-secops-client-id",
      find: ["Additional information", "Client ID"],
      url: undefined,
    };
    const other = { action: "Sign in to Codex", command: "codex login", find: undefined, url: undefined };
    const card = handCard({ step: { ...SECOPS, checklist: [line, other], literal: undefined } }).card;
    expect(card.checklist).toEqual([{ ...line, command: undefined }, other]);
    const unfielded = handCard({ step: { ...SECOPS, checklist: [line], literal: undefined, secrets: [] } }).card;
    expect(unfielded.checklist).toEqual([line]);
  });

  it("treats a flag after the name as more than the field does", () => {
    expect(
      pasteFieldsCoverLiteral({ literal: "slopweaver secrets set linear-token --home /x", secrets: ["linear-token"] }),
    ).toBe(false);
  });
});
