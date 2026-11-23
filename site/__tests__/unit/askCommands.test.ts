/*
 * The mds ask card drew its `sudo` line as paragraph text (commands the owner needs
 * to run belong in copy blocks). The question below is a recorded one of that shape, off a run
 * `spotlight-s-mds-stops-hogging-memory`.
 */
import { describe, expect, it } from "vitest";

import { askCommands, liftedAsk } from "../../lib/askCommands";
import { askCard } from "../../lib/queueCardAsk";

const SUDO =
  "sudo /bin/sh -c '/bin/cp /Users/ada.owner/.slopweaver/machine/com.slopweaver.mds-guard.plist " +
  "/Library/LaunchDaemons/com.slopweaver.mds-guard.plist && /usr/sbin/chown root:wheel " +
  "/Library/LaunchDaemons/com.slopweaver.mds-guard.plist && /bin/chmod 644 " +
  "/Library/LaunchDaemons/com.slopweaver.mds-guard.plist && /bin/launchctl bootstrap system " +
  "/Library/LaunchDaemons/com.slopweaver.mds-guard.plist'";

const LEAD =
  "Will you paste one sudo line, once, to install a guard that keeps mds off across every future macOS upgrade?";

const TAIL =
  "What the upgrade reverted: your earlier sudo line disabled mds in launchd and removed the old watchdog. macOS " +
  "27.0.1 rewrote launchd's override file on install and dropped the mds entry, so " +
  "nothing was left. What holds now: indexing stays off on every volume, and the worktrees stay unindexed. Neither " +
  "stops mds's memory. Stop running killall/mdutil: mdutil -E makes mds rebuild its index, so it only adds work. I " +
  "check the three probes on this row myself, so you need not tell me it ran. Docs PR: " +
  "https://github.com/lachiejames/slopweaver/pull/1722";

const QUESTION = `${LEAD}\n\n${SUDO}\n\n${TAIL}`;

describe("askCommands", () => {
  it("lifts the mds sudo line out of the prose, whole", () => {
    const lifted = askCommands({ text: QUESTION });
    expect(lifted.commands).toEqual([SUDO]);
    expect(lifted.prose).toBe(`${LEAD}\n\n${TAIL}`);
  });

  it("never lifts the lead, nor a sentence that opens on a program word", () => {
    const lead = askCommands({ text: "sudo reboot\n\nThen tell me." });
    expect(lead.commands).toEqual([]);
    const sentence = askCommands({ text: "Will you run it?\n\nsudo is what the guard needs, once." });
    expect(sentence.commands).toEqual([]);
  });

  it("lifts each line of a command paragraph as its own command", () => {
    const lifted = askCommands({
      text: "Will you store both?\n\nslopweaver secrets set google-secops-client-id\nslopweaver secrets set google-secops-client-secret",
    });
    expect(lifted.commands).toEqual([
      "slopweaver secrets set google-secops-client-id",
      "slopweaver secrets set google-secops-client-secret",
    ]);
    expect(lifted.prose).toBe("Will you store both?");
  });

  it("leaves a paragraph mixing a command with prose where it was", () => {
    const text = "Will you run it?\n\nsudo reboot\nIt takes a minute.";
    expect(askCommands({ text })).toEqual({ commands: [], prose: text });
  });
});

describe("the mds ask card", () => {
  it("draws the sudo line as its own paste and never in its what", () => {
    const card = askCard({
      row: {
        ...liftedAsk({ question: QUESTION }),
        blastRadius: undefined,
        exampleGap: undefined,
        examples: [],
        lean: undefined,
        offered: undefined,
        options: [],
        priority: "p1",
        problem: undefined,
        reason: "waiting on the owner",
        risk: undefined,
        artifactPage: undefined,
        slug: "spotlight-s-mds-stops-hogging-memory",
        stillReal: undefined,
        stillRealIso: undefined,
        summary: undefined,
        threadUrl: undefined,
      },
    });
    expect(card.commands).toEqual([SUDO]);
    expect(card.question).toBe(LEAD);
    expect(card.what!.whole.includes("sudo /bin/sh")).toBe(false);
    expect(card.what!.whole.startsWith("What the upgrade reverted")).toBe(true);
  });
});
