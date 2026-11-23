/*
 * A command only the owner's hands run goes in `literal` — the note's pasteboard and the queue card's copy block — never in
 * a hand step's prose (a command buried in prose was hard to find). The first case replays the shape of the step that
 * exposed it, with every value invented.
 */
import { describe, expect, it } from "vitest";

import { commandInProse, proseCommand } from "../../../hand/commandInProse.js";
import { HandStepErrors } from "../../../hand/errors.js";
import { buildHandStep, type HandStep, type HandStepDraft, MONITOR_WITNESS } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";

/** A log-search client step in the shape that exposed the defect, every field invented. */
const LOGSEARCH: HandStepDraft = {
  id: "logsearch-oauth-client-readonly",
  postedBy: "workspace:1",
  postedIso: "2026-10-02T06:55:34.641Z",
  row: "do-we-have-a-logsearch-atlas-and-what-visibility-would-one-give-the-vuln-work-1-1",
  unblocks:
    "The log-search atlas on your option A: a new client named slopweaver-logsearch, never the existing google or google-admin one; then secrets set google-logsearch-client-id and -secret",
  url: "https://console.cloud.google.com/apis/credentials?project=123456789012",
  what: "Create a new Desktop OAuth client for log search with the logs.readonly scope, then store its id and secret",
  where: "GCP project 123456789012: OAuth consent screen, Data access, then Credentials; your sign-in only",
  witness:
    "slopweaver secrets status lists no google-logsearch rows; relayed by the atlas seat on workspace:2, anchor transcript:00000000-0000-4000-8000-000000000001#00000000-0000-4000-8000-000000000002",
};

/** A step built by the real builder from the log-search draft with a case's changes. */
function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(buildHandStep({ draft: { ...LOGSEARCH, ...over } }));
}

describe("commandInProse", () => {
  it("refuses the log-search step, naming unblocks and the bare secrets set it hid", () => {
    expect(commandInProse({ step: step() })).toEqual(
      HandStepErrors.invalidField({
        field: "unblocks",
        why:
          "names a command only the owner's hands run (`secrets set google-logsearch-client-id and`) inside its prose, where " +
          "neither the note nor the queue card offers it to copy — pass the whole command as --literal, with --where " +
          "naming the terminal: the note puts it on the owner's pasteboard and the queue card draws it as a copy block. A " +
          "step with more than one command: post a --checklist, one command per line, each its own copy block the " +
          "owner runs one at a time (the commands that are the owner's: OWNER_HANDS_COMMANDS, " +
          "src/hand/runnableLiteral.ts)",
      }),
    );
  });

  it("passes the log-search step re-cut with its command as the literal", () => {
    const recut = step({
      literal:
        "slopweaver secrets set google-logsearch-client-id && slopweaver secrets set google-logsearch-client-secret",
      unblocks: "The log-search atlas on your option A: a new client named slopweaver-logsearch",
    });
    expect(commandInProse({ step: recut })).toBeUndefined();
  });

  it.each([
    ["what", { what: "Run claude login for plan three" }],
    ["where", { where: "a terminal: codex login into a new home" }],
    ["unblocks", { unblocks: "the resync, once gcloud --project x auth login is done" }],
  ])("refuses a command of the owner's in %s", (field, over) => {
    const refused = commandInProse({ step: step({ unblocks: "the log-search atlas", ...over }) });
    expect(refused!.code).toBe("INVALID_FIELD");
    expect(refused).toEqual(expect.objectContaining({ field }));
  });

  it("passes prose naming the command the literal itself runs", () => {
    const op = step({
      literal: "op signin --account atlas",
      unblocks: "the 1Password resync, stopped until the op session is live",
      what: "Sign the op CLI in to the atlas account",
      where: "a plain terminal of yours",
    });
    expect(commandInProse({ step: op })).toBeUndefined();
  });

  it("still refuses a different command of the owner's beside the literal's", () => {
    const both = step({
      literal: "op signin --account atlas",
      unblocks: "the resync; then gcloud auth login too",
      where: "a plain terminal of yours",
    });
    expect(commandInProse({ step: both })).toEqual(expect.objectContaining({ field: "unblocks" }));
  });

  it("reads neither witness nor details", () => {
    const quiet = step({
      details: ["recipe atlas-resync failed: not signed in, run op signin"],
      unblocks: "the log-search atlas",
      witness: "slopweaver secrets set nothing-here; slopweaver hand done x --did y",
    });
    expect(commandInProse({ step: quiet })).toBeUndefined();
  });

  it("keeps case, so English naming Claude is no command", () => {
    expect(commandInProse({ step: step({ unblocks: "Claude auth broke on plan two" }) })).toBeUndefined();
  });

  it.each([
    ["the op CLI as a word", "The op CLI signs the atlas account in"],
    ["sudo as a word", "A seat never runs sudo for the owner"],
    ["secrets set as English", "the secrets set up last week stay"],
    ["secrets set ending the sentence", "the store refuses an interactive secrets set"],
    ["a one-word code span naming sudo", "the `sudo` password prompt stays up"],
    ["a one-word code span naming op", "so the `op` CLI can read the vault"],
    ["a dash as a pause after op", "the op CLI - it signs itself in"],
  ])("passes %s, which is English", (_case, unblocks) => {
    expect(commandInProse({ step: step({ unblocks }) })).toBeUndefined();
  });

  it.each([
    ["op in a code span", "then run `op signin` first"],
    ["sudo in a code span", "then `sudo launchctl kickstart` it"],
    ["secrets set in a code span, whatever follows", "then `secrets set X` it"],
    ["op after an imperative run", "Run op signin in a terminal first"],
    ["sudo before a flag", "then sudo -k and kickstart it"],
    ["op with a flag two words on", "then op signin --account atlas first"],
    ["sudo with a flag three words on", "then sudo launchctl kickstart -k system/com.apple.mds"],
    ["secrets set before a name with shorthand glued on", "then secrets set google-logsearch-client-id/-secret"],
  ])("refuses %s", (_case, unblocks) => {
    expect(commandInProse({ step: step({ unblocks }) })).toEqual(expect.objectContaining({ field: "unblocks" }));
  });

  it("skips a monitor card's unblocks, a pull request's title, and still reads its what", () => {
    const card = { unblocks: "prs#1 — `slopweaver secrets set` refuses a name", witness: MONITOR_WITNESS };
    expect(commandInProse({ step: step(card) })).toBeUndefined();
    const declared = step({ ...card, what: "Run claude login for plan three" });
    expect(commandInProse({ step: declared })).toEqual(expect.objectContaining({ field: "what" }));
  });
});

describe("proseCommand", () => {
  it("answers none for empty text", () => {
    expect(proseCommand({ carried: new Set(), text: "" })).toBeUndefined();
  });

  it("names the row and the words that named it", () => {
    expect(proseCommand({ carried: new Set(), text: "then `sudo launchctl kickstart` it" })).toEqual({
      id: "sudo",
      phrase: "sudo launchctl kickstart it",
    });
  });
});
