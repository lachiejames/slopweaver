/*
 * A step the owner's hands take is the script they run through, one tickable line at a time: every command its own copy block,
 * every secret stored on its own line naming where its value sits (the owner's ask, on the SecOps note that
 * put two `secrets set` lines in one block).
 */
import { describe, expect, it } from "vitest";

import {
  CHECKLIST_MAX,
  checkedChecklist,
  checklistCommands,
  checklistRefusal,
  ownerCommandCount,
} from "../../../hand/checklist.js";
import { postingRefusal } from "../../../hand/posting.js";
import { parseHandLine } from "../../../hand/row.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { codexLoginCommand } from "../../../plans/login.js";

/** The SecOps step, as the owner should have been handed it: five lines, the two secrets each on their own. */
const SECOPS_CHECKLIST = [
  {
    action: "Open the Credentials page for the SecOps project",
    url: "https://console.cloud.google.com/apis/credentials",
  },
  { action: "Click Create credentials, then OAuth client ID" },
  { action: "Pick Desktop app, name it slopweaver-secops, and click Create" },
  {
    action: "Paste the Client ID when the terminal asks for it",
    command: "slopweaver secrets set google-secops-client-id",
    find: ["Additional information", "Client ID"],
  },
  {
    action: "Paste the Client secret when the terminal asks for it",
    command: "slopweaver secrets set google-secops-client-secret",
    find: ["Client secrets", "Client secret"],
  },
];

/** A step built by the real builder from the SecOps shape, with whatever a case overrides. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        checklist: SECOPS_CHECKLIST,
        id: "secops-desktop-oauth-client",
        postedBy: "workspace:1",
        postedIso: "2026-10-02T12:00:00.000Z",
        unblocks: "The SecOps atlas reading detections, on your option A",
        what: "Make a Desktop sign-in client for SecOps and store its two values, so SecOps can be read",
        witness: "slopweaver hand done secops-desktop-oauth-client --did stored",
        ...over,
      },
    }),
  );
}

describe("checkedChecklist", () => {
  it("keeps every line as written, trimmed, and drops an absent or empty list", () => {
    const lines = unwrap(checkedChecklist({ value: [{ action: "  Click Create  ", find: [" Client ID "] }] }));
    expect(lines).toEqual([{ action: "Click Create", find: ["Client ID"] }]);
    expect(unwrap(checkedChecklist({ value: undefined }))).toBe(undefined);
    expect(unwrap(checkedChecklist({ value: [] }))).toBe(undefined);
  });

  it("refuses a list that is not one, and names what one is", () => {
    const refused = checkedChecklist({ value: "not json" });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().message).toContain('checklist is a JSON list of lines, each {"action"');
  });

  it("refuses past the cap rather than cutting the script", () => {
    const long = Array.from({ length: CHECKLIST_MAX + 1 }, (_, index) => ({ action: `Click button ${String(index)}` }));
    expect(checkedChecklist({ value: long })._unsafeUnwrapErr().message).toBe(
      `checklist carries 13 lines and the cap is ${String(CHECKLIST_MAX)} — a script the owner runs in their head, never a manual`,
    );
  });

  it("refuses two sentences on one line, a key no line has, a multi-line command and a breadcrumb carrying its own separator", () => {
    expect(checkedChecklist({ value: [{ action: "Click Create. Then copy it." }] })._unsafeUnwrapErr().message).toBe(
      "checklist line 1 is more than one sentence — one instruction per line, so the owner ticks one thing",
    );
    expect(checkedChecklist({ value: [{ action: "Run it", cmd: "op signin" }] })._unsafeUnwrapErr().message).toBe(
      "checklist line 1 carries `cmd`, which no line has — action, command, find, url",
    );
    expect(
      checkedChecklist({ value: [{ action: "Run it", command: "op signin\nop read x" }] })._unsafeUnwrapErr().message,
    ).toBe("checklist line 1 carries a command over more than one line — give each its own line");
    expect(
      checkedChecklist({
        value: [{ action: "Copy it", find: ["Additional information > Client ID"] }],
      })._unsafeUnwrapErr().message,
    ).toContain("checklist line 1 carries a `find` label");
  });

  it("round-trips through the register byte for byte", () => {
    const built = step();
    const line = JSON.stringify({ kind: "posted", step: built });
    const read = unwrap(parseHandLine({ line, lineNumber: 1 }));
    expect(JSON.stringify(read)).toBe(line);
  });
});

describe("the posting rule", () => {
  it("posts the SecOps step as a checklist, its two secrets each a copy block of their own", () => {
    const built = step();
    expect(postingRefusal({ step: built })).toBe(undefined);
    expect(checklistCommands({ checklist: built.checklist })).toEqual([
      "slopweaver secrets set google-secops-client-id",
      "slopweaver secrets set google-secops-client-secret",
    ]);
  });

  it("posts a literal of only secrets-set lines, which the card draws as paste fields, and refuses one mixing in another", () => {
    const secrets =
      "slopweaver secrets set google-secops-client-id\nslopweaver secrets set google-secops-client-secret";
    const pasted = step({ checklist: undefined, literal: secrets, where: "the fields on this card" });
    expect(checklistRefusal({ step: pasted })).toBe(undefined);
    const mixed = step({ checklist: undefined, literal: `${secrets}\nop signin`, where: "a plain terminal of yours" });
    expect(checklistRefusal({ step: mixed })!.message).toBe(
      "literal holds 3 command lines — post a --checklist instead, one command per line, so each is its own copy block the owner runs one at a time",
    );
    const flagged = step({
      checklist: undefined,
      literal: "slopweaver secrets set linear-token --home /x\nslopweaver secrets set notion-token",
      where: "the fields on this card",
    });
    expect(checklistRefusal({ step: flagged })!.message).toContain("literal holds 2 command lines");
  });

  it("refuses two of the owner's commands joined on one line", () => {
    const built = step({ checklist: undefined, literal: "op signin && op read op://x/y", where: "a terminal" });
    expect(checklistRefusal({ step: built })!.message).toBe(
      "literal holds more than one of the owner's commands — post a --checklist instead, one command per line, so each is its own copy block the owner runs one at a time",
    );
  });

  it("still posts a codex sign-in, one command of the owner's behind a mkdir, as a literal or a line", () => {
    const command = codexLoginCommand({ codexHome: "/tmp/codex-two" });
    expect(ownerCommandCount({ command })).toBe(1);
    expect(checklistRefusal({ step: step({ checklist: undefined, literal: command, where: "a terminal" }) })).toBe(
      undefined,
    );
    expect(checklistRefusal({ step: step({ checklist: [{ action: "Sign in to Codex", command }] }) })).toBe(undefined);
  });

  it("refuses a secret stored on a line that does not say where its value sits", () => {
    const built = step({
      checklist: [
        { action: "Paste the Client ID when it asks", command: "slopweaver secrets set google-secops-client-id" },
      ],
    });
    expect(checklistRefusal({ step: built })!.message).toContain(
      'checklist line 1 stores a secret and does not say where its value sits — add "find"',
    );
  });

  it("refuses a literal beside a checklist", () => {
    const built = step({ literal: "op signin", where: "a terminal" });
    expect(checklistRefusal({ step: built })!.message).toBe(
      "literal is beside a --checklist — every command lives on its own checklist line, so drop the --literal",
    );
  });

  it("refuses a command the fleet could run itself on a line", () => {
    const built = step({ checklist: [{ action: "Run the tests", command: "yarn vitest run" }] });
    expect(checklistRefusal({ step: built })!.message).toContain(
      "checklist line 1 carries a command the fleet can run itself (`yarn vitest run`)",
    );
  });

  it("refuses a line whose sentence names a command of the owner's outside its copy block", () => {
    const built = step({
      checklist: [{ action: "Then run op signin --account atlas in a terminal", url: "https://example.com/a" }],
    });
    expect(postingRefusal({ step: built })!.message).toContain("checklist names a command only the owner's hands run");
  });

  it("counts a checklist with a command or a page as the step's address", () => {
    const what = "Turn on the SecOps export, so the detections page can read it";
    expect(
      postingRefusal({ step: step({ checklist: [{ action: "Click Create", url: "https://example.com/x" }], what }) }),
    ).toBe(undefined);
    expect(postingRefusal({ step: step({ checklist: [{ action: "Click Create" }], what }) })!.message).toContain(
      "url is missing, and so are --literal and --no-address",
    );
  });

  it("takes a checklist line's page as a sign-in's page, and refuses a sign-in whose lines open none", () => {
    expect(postingRefusal({ step: step() })).toBe(undefined);
    const pageless = step({ checklist: [{ action: "Click Create" }] });
    expect(postingRefusal({ step: pageless })!.message).toContain("url is missing and the step is a sign-in");
  });
});
