/**
 * The own-hand rule's criterion, one case each.
 *
 * The four phrases the owner's correction named are asserted by name, because they are the measurement
 * this rule exists for — a criterion that stopped catching one of them would be a rule that had quietly
 * stopped doing its job while every other test still passed.
 */
import { describe, expect, it } from "vitest";

import { ownHandAction, ownHandRefusal } from "../../../briefing/ownHandAction.js";

describe("ownHandAction", () => {
  it("names the owner as the actor across the four phrases the cards carried", () => {
    expect(ownHandAction({ imperative: false, text: "The pool clears, then you reset the counter." })).toBe(
      "you reset",
    );
    expect(ownHandAction({ imperative: false, text: "The rule lives in your own file." })).toBe("your own file");
    expect(ownHandAction({ imperative: false, text: "It sits in a file only you can write." })).toBe("you can write");
    expect(ownHandAction({ imperative: true, text: "Add it now and the session moves on." })).toBe("Add");
  });

  it("binds the owner to a verb across a modal and an infinitive marker", () => {
    expect(ownHandAction({ imperative: false, text: "You'll need to add the entry yourself." })).toBe(
      "You'll need to add",
    );
    expect(ownHandAction({ imperative: false, text: "You then manually restart the daemon." })).toBe(
      "You then manually restart",
    );
  });

  it("leaves a cell that names the session as the actor alone", () => {
    expect(
      ownHandAction({ imperative: true, text: "Tell the supervisor land and the session pushes it." }),
    ).toBeUndefined();
    expect(
      ownHandAction({
        imperative: false,
        text: "The session edited the settings file on your relayed word. Nothing is waiting on you.",
      }),
    ).toBeUndefined();
  });

  it("reads a past-tense report as a report rather than a step", () => {
    expect(ownHandAction({ imperative: false, text: "You approved it, and the session pushed the fix." })).toBe(
      undefined,
    );
  });

  it("keeps `your own` on work of the owner's that is not in their hands", () => {
    expect(ownHandAction({ imperative: false, text: "It sits on your own pull request." })).toBeUndefined();
    expect(ownHandAction({ imperative: false, text: "It sits on your own work-console branch." })).toBeUndefined();
  });

  it("reads an opening verb as an instruction only where the cell addresses the owner", () => {
    expect(ownHandAction({ imperative: true, text: "Reset the pool and the session re-runs it." })).toBe("Reset");
    expect(ownHandAction({ imperative: false, text: "Reset the pool and the session re-runs it." })).toBeUndefined();
  });

  it("states the shape a refused cell is reworded into", () => {
    expect(ownHandRefusal({ cell: "option A", phrase: "you reset" })).toBe(
      'option A puts an action in the owner\'s own hands with "you reset". The owner never edits a file, runs a command or ' +
        'clicks a console themselves, so name the session as the actor: "tell the supervisor <word> and the ' +
        'session does it".',
    );
  });
});
