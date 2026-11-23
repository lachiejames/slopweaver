/*
 * The `talk relay` argv one parsed relay becomes: the reading or the reads, the check-in reach, and the owner's ruling on a
 * workstream candidate — the flag whose absence meant a spoken ruling never reached the candidate it was about.
 */
import { describe, expect, it } from "vitest";

import { talkRelayArgv } from "../../lib/talkRelayArgv";
import { type ParsedTalkRelay, RELAY_HEARD_MAX } from "../../lib/talkRelayRequestWire";

const TURN = "a0000017-0000-4000-8000-000000000019";

const RELAY: ParsedTalkRelay = {
  about: "",
  alsoAnswers: [],
  candidateRuling: undefined,
  covers: undefined,
  discussFirst: undefined,
  heard: "not a workstream",
  heardTail: undefined,
  offered: undefined,
  readsAfter: [],
  say: "c-105 is not a workstream",
  screen: { kind: "none", reason: "screen-not-shared" },
  triageRuling: undefined,
  turnId: TURN,
  wordsAlone: false,
  workspace: undefined,
};

const ORIGIN = ["--console-root", "/w/main", "--console-port", "3000", "--console-default-port", "3000"];

const TAIL = [...ORIGIN, "--priority", "p1", "--deliver-to-supervisor", "--json"];

describe("talkRelayArgv", () => {
  it("never carries the owner's words in argv, at the route's bound or below: they go on stdin, named by --heard-stdin", () => {
    const atBound = talkRelayArgv({
      relay: { ...RELAY, heard: "w".repeat(RELAY_HEARD_MAX) },
      screenPath: undefined,
      offeredPath: undefined,
      originArgv: ORIGIN,
    });
    expect(atBound).toEqual(
      talkRelayArgv({ relay: RELAY, screenPath: undefined, offeredPath: undefined, originArgv: ORIGIN }),
    );
    expect(atBound.slice(4, 5)).toEqual(["--heard-stdin"]);
    expect(atBound).not.toContain("--heard");
  });

  it("says whether the owner was still speaking right after --heard-stdin, and says nothing when the page did not", () => {
    const argv = ({ heardTail }: { heardTail: "cut" | "whole" | undefined }): string[] =>
      talkRelayArgv({
        relay: { ...RELAY, heardTail },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      });
    expect([argv({ heardTail: "cut" }).slice(4, 7), argv({ heardTail: "whole" }).slice(4, 7)]).toEqual([
      ["--heard-stdin", "--heard-tail", "cut"],
      ["--heard-stdin", "--heard-tail", "whole"],
    ]);
    expect(argv({ heardTail: undefined })).not.toContain("--heard-tail");
  });

  it("hands the verb the candidate and the owner's word beside the reading", () => {
    expect(
      talkRelayArgv({
        relay: { ...RELAY, candidateRuling: { candidate: "c-105", reaction: "no" } },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).toEqual([
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard-stdin",
      "--say",
      "c-105 is not a workstream",
      "--candidate",
      "c-105",
      "--reaction",
      "no",
      ...TAIL,
    ]);
  });

  it("names each other card the owner's words answer after the open one, in the order the page named them", () => {
    expect(
      talkRelayArgv({
        relay: { ...RELAY, about: "ask:open-one", alsoAnswers: ["draft:abc-1", "ask:split-files"] },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).toEqual([
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard-stdin",
      "--say",
      "c-105 is not a workstream",
      "--about",
      "ask:open-one",
      "--also-answers",
      "draft:abc-1",
      "--also-answers",
      "ask:split-files",
      ...TAIL,
    ]);
  });

  it("hands the verb the owner's triage verdict on the card the pass has open, and its label only when they gave one", () => {
    const argvOf = (triageRuling: ParsedTalkRelay["triageRuling"]) =>
      talkRelayArgv({
        offeredPath: undefined,
        originArgv: ORIGIN,
        relay: { ...RELAY, about: "act:ev-9", triageRuling },
        screenPath: undefined,
      });
    const head = [
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard-stdin",
      "--say",
      "c-105 is not a workstream",
      "--about",
      "act:ev-9",
    ];
    expect([
      argvOf({ label: "waiting-on-me", verdict: "needs-more-info" }),
      argvOf({ label: undefined, verdict: "rewrite" }),
      argvOf({ feedback: "no-receipts", label: undefined, verdict: "needs-more-info" }),
    ]).toEqual([
      [...head, "--triage", "needs-more-info", "--label", "waiting-on-me", ...TAIL],
      [...head, "--triage", "rewrite", ...TAIL],
      [...head, "--triage", "needs-more-info", "--feedback", "no-receipts", ...TAIL],
    ]);
  });

  it("names no candidate for a relay that rules on none, and carries the reach, reads and picture as before", () => {
    expect(
      talkRelayArgv({
        relay: { ...RELAY, about: "act:ev-2", covers: "rule", readsAfter: ["context_pack"], say: undefined },
        screenPath: "/tmp/shot.webp",
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).toEqual([
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard-stdin",
      "--read-after",
      "context_pack",
      "--about",
      "act:ev-2",
      "--covers",
      "rule",
      "--screen",
      "/tmp/shot.webp",
      ...TAIL,
    ]);
  });

  it("sends the owner's words alone, and marks a capture that failed", () => {
    expect(
      talkRelayArgv({
        relay: { ...RELAY, say: undefined, screen: { kind: "none", reason: "capture-failed" }, wordsAlone: true },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).toEqual(["talk", "relay", "--turn", TURN, "--heard-stdin", "--words-alone", "--screen-failed", ...TAIL]);
  });

  it("hands the verb the workspace the page stated, with its reason, so the row is never a finding by default", () => {
    const because = "the owner said it on the self console, over no card";
    expect(
      talkRelayArgv({
        relay: { ...RELAY, workspace: { because, workspace: "self" } },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).toEqual([
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard-stdin",
      "--say",
      "c-105 is not a workstream",
      "--workspace",
      "self",
      "--workspace-because",
      because,
      ...TAIL,
    ]);
  });

  it("hands the verb the discuss-first question it put, and on the owner's answer the relay that put it", () => {
    const thread = "https://acme.slack.com/archives/C0SYN123ABCD/p1760000000123456";
    const argvOf = (discussFirst: ParsedTalkRelay["discussFirst"]) =>
      talkRelayArgv({
        offeredPath: undefined,
        originArgv: ORIGIN,
        relay: { ...RELAY, discussFirst },
        screenPath: undefined,
      });
    const head = ["talk", "relay", "--turn", TURN, "--heard-stdin", "--say", "c-105 is not a workstream"];
    expect([
      argvOf({ repository: "acme/acme-admin", status: "put", thread }),
      argvOf({ priorTurnId: TURN, repository: "acme/acme-admin", status: "override" }),
    ]).toEqual([
      [...head, "--discuss-first", "put", "--team-fix", "acme/acme-admin", "--fix-thread", thread, ...TAIL],
      [...head, "--discuss-first", "override", "--team-fix", "acme/acme-admin", "--discuss-first-turn", TURN, ...TAIL],
    ]);
  });

  it("names the copy-tray offer's staged file after the workspace and before the picture, never its text", () => {
    const relay: ParsedTalkRelay = {
      ...RELAY,
      offered: { id: "offer-3", made: "3", text: "Merged, thanks all" },
    };
    const argv = talkRelayArgv({
      offeredPath: "/tmp/r/offer.json",
      originArgv: ORIGIN,
      relay,
      screenPath: "/tmp/r/s.webp",
    });
    expect(argv).toEqual([
      "talk",
      "relay",
      "--turn",
      TURN,
      "--heard-stdin",
      "--say",
      "c-105 is not a workstream",
      "--offered-file",
      "/tmp/r/offer.json",
      "--screen",
      "/tmp/r/s.webp",
      ...TAIL,
    ]);
    expect(argv).not.toContain("Merged, thanks all");
  });

  it("marks a shared screen that had no frame taken this turn", () => {
    expect(
      talkRelayArgv({
        relay: { ...RELAY, screen: { kind: "none", reason: "not-taken-this-turn" } },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).toContain("--screen-not-taken");
    expect(
      talkRelayArgv({
        relay: { ...RELAY, screen: { kind: "none", reason: "screen-not-shared" } },
        screenPath: undefined,
        offeredPath: undefined,
        originArgv: ORIGIN,
      }),
    ).not.toContain("--screen-not-taken");
  });

  it("marks a native look Screen Recording refused as that, never as a failed share", () => {
    const argv = talkRelayArgv({
      relay: { ...RELAY, screen: { kind: "none", reason: "screen-recording-off" } },
      screenPath: undefined,
      offeredPath: undefined,
      originArgv: ORIGIN,
    });
    expect(argv).toContain("--screen-recording-off");
    expect(argv).not.toContain("--screen-failed");
  });
});
