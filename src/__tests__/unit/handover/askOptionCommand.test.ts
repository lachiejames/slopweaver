import { describe, expect, it } from "vitest";
import type { AskAction } from "../../../handover/askAction.js";
import { askOptionCommandProblems } from "../../../handover/askOptionCommand.js";
import {
  type AskOption,
  askOptionsBlock,
  askOptionsFrom,
  askShapeProblems,
  parseAskOptions,
} from "../../../handover/askShape.js";
import { askShapeVerdict } from "../../../handover/askShapeGate.js";
import { nestedFields } from "../../../handover/docNested.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { rowEventIssues } from "../../../handover/rowEventSchema.js";

/** The option the owner was shown with no command, from the card that started this rule. */
const SIGN_IN: AskOption = {
  letter: "A",
  option: "sign plan-3 in again",
  tradeoff: "one browser sign-in by you, nothing else",
};

/** The command that takes it: the plan sign-in verb, on the owner-hands register. */
const SIGN_IN_COMMAND = "slopweaver claude signin --plan plan-3";

const STAKES = {
  blastRadius: "plan routing for every new seat on this machine",
  risk: "every new seat routes to the other plans",
  stillReal: "the last spawn printed the same refusal for plan-3",
};

describe("askOptionCommandProblems — which options need a command", () => {
  it("refuses the reported sign-in option carrying no command, naming its letter, words and repair", () => {
    const problems = askOptionCommandProblems({ option: SIGN_IN });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('option A is a step only the owner\'s hands take ("sign plan-3 in")');
    expect(problems[0]).toContain("add `:: <command>` to option A's line");
  });

  it.each([
    ["log in to the Vanta console", "log in"],
    ["re-login plan-2", "re-login"],
    ["sign it back in", "sign it back in"],
    ["authenticate the gcloud CLI", "authenticate"],
    ["run codex login for plan-3", "codex login"],
    ["set the Fathom key with secrets set fathom-api-key", "secrets set fathom-api-key"],
  ])("refuses %j with no command, quoting %j", (text, phrase) => {
    const problems = askOptionCommandProblems({ option: { letter: "B", option: text, tradeoff: "a cost" } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`("${phrase}`);
  });

  it.each([
    "leave plan-3 off",
    "auth is fine as is",
    "retire plan-3 from the configured plans",
    "sign off on the release",
    "sign up for the trial",
    "log the error in Datadog",
  ])("passes %j, which is no owner terminal step", (text) => {
    expect(askOptionCommandProblems({ option: { letter: "C", option: text, tradeoff: "a cost" } })).toEqual([]);
  });

  it("reads the option's sentence only, never its trade-off", () => {
    const option: AskOption = { letter: "B", option: "leave plan-3 off", tradeoff: "avoids another sign-in by you" };
    expect(askOptionCommandProblems({ option })).toEqual([]);
  });
});

describe("askOptionCommandProblems — a present command is the owner's line", () => {
  it("passes the sign-in option carrying its command", () => {
    expect(askOptionCommandProblems({ option: { ...SIGN_IN, command: SIGN_IN_COMMAND } })).toEqual([]);
  });

  it("passes a preparatory segment ahead of the owner's command", () => {
    const option = { ...SIGN_IN, command: "mkdir -p /tmp/acme && codex login" };
    expect(askOptionCommandProblems({ option })).toEqual([]);
  });

  it("refuses an empty command", () => {
    expect(askOptionCommandProblems({ option: { ...SIGN_IN, command: "  " } })).toEqual([
      "option A's command is empty — write the exact line the owner pastes, or drop the third `::`",
    ]);
  });

  it("refuses a command over two lines", () => {
    const problems = askOptionCommandProblems({ option: { ...SIGN_IN, command: "codex login\ncodex login" } });
    expect(problems).toEqual([
      "option A's command runs over more than one line — the copy block pastes one line into the owner's terminal",
    ]);
  });

  // The r2 counterexample: a vertical tab tokenises as whitespace but breaks the strict-YAML front matter.
  it("refuses a control character inside an otherwise one-line command", () => {
    const problems = askOptionCommandProblems({ option: { ...SIGN_IN, command: "codex login --account\u000bplan-3" } });
    expect(problems).toEqual([
      "option A's command carries a control character — write the line as the owner would type it",
    ]);
  });

  it("refuses a value that is no shell command", () => {
    const problems = askOptionCommandProblems({ option: { ...SIGN_IN, command: "plan-3" } });
    expect(problems).toEqual([
      'option A\'s command "plan-3" is not a shell command — it is what the owner pastes into a terminal',
    ]);
  });

  it("refuses a command the fleet runs whole, on an option that needed none too", () => {
    const option: AskOption = { command: "yarn login-helper", letter: "B", option: "leave plan-3 off", tradeoff: "x" };
    const problems = askOptionCommandProblems({ option });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("option B's command \"yarn login-helper\" runs nothing only the owner's hands can");
  });

  it("refuses a fleet-runnable segment riding beside the owner's command", () => {
    const problems = askOptionCommandProblems({ option: { ...SIGN_IN, command: "codex login && git push" } });
    expect(problems).toEqual([
      "option A's command carries \"git push\", which the fleet can run itself — leave only the owner's own segment",
    ]);
  });
});

describe("the command rule binds a write, never a read", () => {
  const shape = ({ options }: { options: readonly AskOption[] }) => ({
    lean: "A, the sign-in takes one minute",
    options,
    problem: "plan-3's stored login is refused",
    stakes: STAKES,
  });
  const LEAVE: AskOption = { letter: "B", option: "leave plan-3 off", tradeoff: "the other plans reach caps sooner" };
  const verdict = ({ options }: { options: readonly AskOption[] }) =>
    askShapeVerdict({
      blastRadius: STAKES.blastRadius,
      command: "slopweaver handover register",
      env: {},
      lean: "A, the sign-in takes one minute",
      options,
      parseProblems: [],
      problem: "plan-3's stored login is refused",
      required: true,
      risk: STAKES.risk,
      stillReal: STAKES.stillReal,
    });

  // The pre-push regression: inside askShapeProblems, every ask recorded before the rule read as a malformed row.
  it("leaves an ask recorded before the rule readable as a row", () => {
    expect(askShapeProblems({ shape: shape({ options: [SIGN_IN, LEAVE] }) })).toEqual([]);
  });

  it("refuses the reported card's shape at the verb", () => {
    const refused = verdict({ options: [SIGN_IN, LEAVE] });
    expect(refused.kind).toBe("refused");
    expect(JSON.stringify(refused)).toContain("option A is a step only the owner's hands take");
  });

  it("records it at the verb once option A carries its command", () => {
    expect(verdict({ options: [{ ...SIGN_IN, command: SIGN_IN_COMMAND }, LEAVE] }).kind).toBe("ok");
  });
});

describe("parseAskOptions — the optional third part", () => {
  it("reads `<option> :: <trade-off> :: <command>`", () => {
    const parsed = parseAskOptions({
      text: `sign plan-3 in again :: one browser sign-in by you :: ${SIGN_IN_COMMAND}\nleave plan-3 off :: caps sooner`,
    });
    expect(parsed.problems).toEqual([]);
    expect(parsed.options).toEqual([
      { command: SIGN_IN_COMMAND, letter: "A", option: "sign plan-3 in again", tradeoff: "one browser sign-in by you" },
      { letter: "B", option: "leave plan-3 off", tradeoff: "caps sooner" },
    ]);
  });

  it("keeps a `::` inside the command as the command's own", () => {
    const parsed = parseAskOptions({ text: "renew it :: a minute :: op read op://vault/item::field" });
    expect(parsed.options[0]!.command).toBe("op read op://vault/item::field");
  });

  it("omits the key on a two-part line, never writing an undefined command", () => {
    const parsed = parseAskOptions({ text: "leave plan-3 off :: caps sooner" });
    expect(Object.keys(parsed.options[0]!)).toEqual(["letter", "option", "tradeoff"]);
  });
});

describe("the command round-trips", () => {
  const WITH: readonly AskOption[] = [
    { command: SIGN_IN_COMMAND, letter: "A", option: "sign plan-3 in again", tradeoff: "one sign-in" },
    { letter: "B", option: "leave plan-3 off", tradeoff: "caps sooner" },
  ];

  it("through a decoded journal payload", () => {
    expect(askOptionsFrom({ value: WITH })).toEqual(WITH);
  });

  it("keeps a readable option whose command is not a string, dropping only the command", () => {
    const decoded = askOptionsFrom({ value: [{ command: 7, option: "leave plan-3 off", tradeoff: "caps sooner" }] });
    expect(decoded).toEqual([{ letter: "A", option: "leave plan-3 off", tradeoff: "caps sooner" }]);
  });

  it("through the front matter a registered ask writes and the doc reader parses", () => {
    const block = askOptionsBlock({ options: WITH });
    expect(block).toContain(`    command: "${SIGN_IN_COMMAND}"`);
    expect(nestedFields({ lines: block.split("\n") }).options).toEqual(WITH);
  });
});

describe("the journal's write schema refuses what the verb refuses", () => {
  const asked = ({ options }: { options: readonly AskOption[] }): RunEvent => ({
    atIso: "2026-11-23T21:00:00.000Z",
    kind: "question",
    lean: "A, the sign-in takes one minute",
    options,
    problem: "plan-3's stored login is refused",
    question: "Will you sign plan-3 back in?",
    stakes: STAKES,
  });
  const LEAVE: AskOption = { letter: "B", option: "leave plan-3 off", tradeoff: "caps sooner" };

  it("refuses a question line whose sign-in option carries no command", () => {
    expect(rowEventIssues({ event: asked({ options: [SIGN_IN, LEAVE] }) }).join("\n")).toContain(
      "the recorded shape breaks its own caps",
    );
  });

  it("accepts it with the command", () => {
    expect(rowEventIssues({ event: asked({ options: [{ ...SIGN_IN, command: SIGN_IN_COMMAND }, LEAVE] }) })).toEqual(
      [],
    );
  });

  it("refuses a blank command rather than dropping it", () => {
    expect(rowEventIssues({ event: asked({ options: [{ ...SIGN_IN, command: "" }, LEAVE] }) }).length).toBeGreaterThan(
      0,
    );
  });

  // The r1 counterexample: the decoder derives an action line's options from the action and ignores the stored
  // ones, so the schema judges the derived ones — innocuous stored options cannot carry a refused destination in.
  describe("over a line carrying an action", () => {
    const action = ({ label }: { label: string }): AskAction => ({
      actor: "me",
      body: "<@U01ARI> the switch-over is ready for review.",
      destinations: [{ channel: "C01SDLC", kind: "channel", label, tradeoff: "the whole channel sees it" }],
      mentions: [{ label: "Ari", userId: "U01ARI" }],
      version: 1,
    });
    const STORED: readonly AskOption[] = [
      { letter: "A", option: "Post it to #delivery", tradeoff: "the whole channel sees it" },
      { letter: "B", option: "Hold it", tradeoff: "nothing moves" },
    ];

    it("refuses a destination that derives an owner step, whatever options the line stored", () => {
      const event = { ...asked({ options: STORED }), action: action({ label: "codex login" }) };
      expect(rowEventIssues({ event }).join("\n")).toContain("the recorded shape breaks its own caps");
    });

    it("accepts an ordinary destination, its derived options judged", () => {
      const event = { ...asked({ options: STORED }), action: action({ label: "Post it to #delivery" }) };
      expect(rowEventIssues({ event })).toEqual([]);
    });
  });
});
