/**
 * What every `talk` verb accepts, and what an omitted flag MEANS.
 *
 * The help-truth ratchet already proves these parsers accept exactly what their usage advertises. What it
 * cannot see is the value an absent flag resolves to, which is the half a caller actually depends on — so
 * every default here is asserted against the exported constant rather than against a number written twice.
 */
import { describe, expect, it } from "vitest";

import {
  type CodeMode,
  DEFAULT_CODE_BUDGET,
  DEFAULT_MAX_HITS,
  parseCodeArgs,
  parseOfferArgs,
  parsePackArgs,
  parseRowArgs,
  talkHomeOf,
} from "../../../cli/commands/talk/args.js";
import { DEFAULT_LOG_LIMIT, parseLogArgs } from "../../../cli/commands/talk/logArgs.js";
import { TalkOfferArgsErrors } from "../../../cli/commands/talk/offerArgsErrors.js";
import { parseRelayArgs } from "../../../cli/commands/talk/relayArgs.js";
import { slopweaverHome } from "../../../config.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { DEFAULT_TALK_PLAN_VOICE } from "../../../talk/planVoices.js";

/** Every mode `talk code` has. A member added without a decision here fails to compile rather than passing. */
const EVERY_MODE: readonly CodeMode[] = ["find", "read", "list"];

const TURN = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

describe("parsePackArgs", () => {
  it("reads nothing and writes nothing by default", () => {
    expect(unwrap(parsePackArgs({ rest: [] }))).toEqual({
      base: undefined,
      dir: undefined,
      home: undefined,
      ifOlderThanMinutes: undefined,
      json: false,
      write: false,
    });
  });

  it("takes every flag it names", () => {
    const args = unwrap(
      parsePackArgs({ rest: ["--write", "--json", "--base", "main", "--dir", "/d", "--home", "/h"] }),
    );
    expect(args).toEqual({
      base: "main",
      dir: "/d",
      home: "/h",
      ifOlderThanMinutes: undefined,
      json: true,
      write: true,
    });
  });

  it("takes --if-older-than in minutes beside --write, as the console's pack keeper passes it", () => {
    expect(unwrap(parsePackArgs({ rest: ["--write", "--if-older-than", "30"] })).ifOlderThanMinutes).toBe(30);
  });

  it("refuses --if-older-than without --write, with --json, at zero, or not a whole number", () => {
    expect(unwrapErr(parsePackArgs({ rest: ["--if-older-than", "30"] }))).toEqual([
      "--if-older-than decides whether --write rebuilds, so it needs --write",
    ]);
    expect(unwrapErr(parsePackArgs({ rest: ["--write", "--json", "--if-older-than", "30"] }))).toEqual([
      "--if-older-than may skip the build and so print no pack; drop --json",
    ]);
    expect(unwrapErr(parsePackArgs({ rest: ["--write", "--if-older-than", "0"] }))).toEqual([
      "--if-older-than must be at least 1 minute; leave it off to rebuild every time",
    ]);
    expect(unwrapErr(parsePackArgs({ rest: ["--write", "--if-older-than", "half"] }))).toEqual([
      "--if-older-than must be a non-negative whole number, got half",
    ]);
  });

  it("refuses a flag it does not know", () => {
    expect(unwrapErr(parsePackArgs({ rest: ["--since", "1d"] })).join(" ")).toContain("--since");
  });
});

describe("parseOfferArgs", () => {
  it("speaks in sol by default and needs no SDP", () => {
    expect(unwrap(parseOfferArgs({ rest: [] }))).toEqual({
      home: undefined,
      json: false,
      mode: "fresh",
      typed: false,
      voice: DEFAULT_TALK_PLAN_VOICE,
    });
    expect(DEFAULT_TALK_PLAN_VOICE).toBe("sol");
  });

  it("takes a chatgpt.com voice", () => {
    expect(unwrap(parseOfferArgs({ rest: ["--voice", "juniper", "--json"] }))).toEqual({
      home: undefined,
      json: true,
      mode: "fresh",
      typed: false,
      voice: "juniper",
    });
  });

  it("marks a mint the console makes to re-open a dropped call, or to roll a long one over in a pause", () => {
    const modes = [["--reconnect", "--json"], ["--rollover"]].map((rest) => unwrap(parseOfferArgs({ rest })).mode);
    expect(modes).toEqual(["reconnect", "rollover"]);
  });

  it("refuses --reconnect and --rollover together, since the voice is told different things", () => {
    expect(unwrapErr(parseOfferArgs({ rest: ["--reconnect", "--rollover"] }))).toEqual(
      TalkOfferArgsErrors.modesContradict(),
    );
  });

  it("marks a mint for the messenger's typed box", () => {
    expect(unwrap(parseOfferArgs({ rest: ["--typed", "--json"] })).typed).toBe(true);
  });

  it("refuses --typed beside --reconnect or --rollover, since a typed conversation carries no call on", () => {
    const refusals = [
      ["--typed", "--reconnect"],
      ["--rollover", "--typed"],
    ].map((rest) => unwrapErr(parseOfferArgs({ rest })));
    expect(refusals).toEqual([
      TalkOfferArgsErrors.typedNotACall({ flag: "--reconnect" }),
      TalkOfferArgsErrors.typedNotACall({ flag: "--rollover" }),
    ]);
    expect(refusals[0]!.code).toBe("TYPED_NOT_A_CALL");
  });

  it("refuses a voice the plan does not have, naming the plan's own", () => {
    expect(unwrapErr(parseOfferArgs({ rest: ["--voice", "cedar"] }))).toEqual(
      TalkOfferArgsErrors.voiceUnknown({
        known: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol"],
        voice: "cedar",
      }),
    );
    expect(unwrapErr(parseOfferArgs({ rest: ["--voice", "cedar"] })).message).toBe(
      "talk offer: --voice cedar is not a plan voice — one of juniper, maple, spruce, ember, vale, breeze, arbor, sol",
    );
  });

  // The ChatGPT plans cover everything; there is no platform.openai usage.
  it("refuses every flag of the retired platform.openai fallback rather than ignoring it", () => {
    const codes = [
      ["--funding", "api-key"],
      ["--sdp-file", "/tmp/o.sdp"],
      ["--plan-refused", "x"],
      ["--backend-model", "gpt-5"],
    ].map((rest) => unwrapErr(parseOfferArgs({ rest })).code);
    expect(codes).toEqual(["FLAGS_UNPARSED", "FLAGS_UNPARSED", "FLAGS_UNPARSED", "FLAGS_UNPARSED"]);
  });
});

describe("parseCodeArgs", () => {
  it("accepts each of the three modes and no fourth", () => {
    expect(
      EVERY_MODE.map((mode) => unwrap(parseCodeArgs({ rest: [mode, "--text", "x", "--path", "a"] })).mode),
    ).toEqual(EVERY_MODE);
    expect(unwrapErr(parseCodeArgs({ rest: ["grep", "--text", "x"] }))).toEqual([
      "talk code needs a mode — find, read or list — got grep",
    ]);
  });

  it("names the absence rather than a mode nobody typed", () => {
    expect(unwrapErr(parseCodeArgs({ rest: [] }))).toEqual(["talk code needs a mode — find, read or list — got none"]);
  });

  it("defaults the two budgets and the resume offset", () => {
    const args = unwrap(parseCodeArgs({ rest: ["find", "--text", "needle"] }));
    expect(args.budget).toBe(DEFAULT_CODE_BUDGET);
    expect(args.maxHits).toBe(DEFAULT_MAX_HITS);
    expect(args.from).toBe(0);
    expect(args.cwd).toBe(undefined);
  });

  it("refuses a budget that is not a non-negative whole number", () => {
    expect(unwrapErr(parseCodeArgs({ rest: ["find", "--text", "x", "--budget", "-1"] }))).toEqual([
      "--budget must be a non-negative whole number, got -1",
    ]);
  });

  it("reads a literal starting with hyphens from --text-hex, the spelling the console voice sends", () => {
    expect(unwrap(parseCodeArgs({ rest: ["find", "--text-hex", "2d2d6a736f6e"] })).text).toBe("--json");
  });

  it("refuses --text-hex beside --text, or bytes that are not hex or not UTF-8", () => {
    expect(unwrapErr(parseCodeArgs({ rest: ["find", "--text", "x", "--text-hex", "78"] }))).toEqual([
      "talk code find takes --text or --text-hex, not both",
    ]);
    expect(unwrapErr(parseCodeArgs({ rest: ["find", "--text-hex", "2D"] }))).toEqual([
      "--text-hex is not lowercase hex bytes",
    ]);
    expect(unwrapErr(parseCodeArgs({ rest: ["find", "--text-hex", "ff"] }))).toEqual([
      "--text-hex does not decode as UTF-8",
    ]);
  });

  it("collects every problem in one pass rather than stopping at the first", () => {
    expect(unwrapErr(parseCodeArgs({ rest: ["read", "--from", "later", "--max-hits", "lots"] }))).toEqual([
      "talk code read needs --path <repo-relative>",
      "--from must be a non-negative whole number, got later",
      "--max-hits must be a non-negative whole number, got lots",
    ]);
  });
});

describe("parseRelayArgs", () => {
  it("defaults the priority to p2 and carries the turn and words through", () => {
    const args = unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "look at staging"] }));
    expect(args.priority).toBe("p2");
    expect(args.turn).toBe(TURN);
    expect(args.say).toBe("look at staging");
  });

  it("refuses --dir or --home beside --deliver-to-supervisor, which must point at the real board", () => {
    const problem =
      "--deliver-to-supervisor types into the owner's real supervisor chat, so it takes no --dir or --home: the row it " +
      "points at must be on the real board and the once-per-turn record in the real home";
    expect(
      unwrapErr(
        parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--deliver-to-supervisor", "--home", "/tmp/h"] }),
      ),
    ).toEqual([problem]);
    expect(
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--deliver-to-supervisor", "--dir", "/tmp/d"] })),
    ).toEqual([problem]);
  });

  it("refuses a priority outside p1..p3", () => {
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--priority", "urgent"] }))).toEqual([
      "--priority must be p1, p2 or p3, got urgent",
    ]);
  });

  it("takes --covers beside an act: check-in, and leaves it undefined when absent", () => {
    const ruled = unwrap(
      parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--about", "act:ev-2", "--covers", "rule"] }),
    );
    expect([ruled.about, ruled.covers]).toEqual(["act:ev-2", "rule"]);
    expect(unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--about", "act:ev-2"] })).covers).toBe(
      undefined,
    );
  });

  it("refuses --covers off a check-in, and a reach that is not rule or this", () => {
    expect(
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--about", "ask:a", "--covers", "this"] })),
    ).toEqual(["--covers records the owner's word on a check-in, so it needs --about act:<actionId>"]);
    expect(
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--about", "act:a", "--covers", "all"] })),
    ).toEqual(["--covers must be rule or this, got all"]);
  });

  it("takes --candidate with --reaction as the owner's ruling on a candidate, and leaves it undefined when absent", () => {
    const ruled = unwrap(
      parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--candidate", "c-105", "--reaction", "no"] }),
    );
    expect(ruled.candidateVerdict).toEqual({ candidate: "c-105", reaction: "no" });
    expect(unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x"] })).candidateVerdict).toBe(undefined);
  });

  // The discuss-first question: the page puts it, the verb carries it.
  it("takes the discuss-first question the voice put, and the owner's answer past one, and none when absent", () => {
    const base = ["--turn", TURN, "--say", "raise a fix"];
    const thread = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";
    const put = unwrap(
      parseRelayArgs({
        rest: [...base, "--discuss-first", "put", "--team-fix", "acme/acme-admin", "--fix-thread", thread],
      }),
    );
    const override = unwrap(
      parseRelayArgs({
        rest: [...base, "--discuss-first", "override", "--team-fix", "acme/acme-admin", "--discuss-first-turn", TURN],
      }),
    );
    expect([put.discussFirst, override.discussFirst, unwrap(parseRelayArgs({ rest: base })).discussFirst]).toEqual([
      { repository: "acme/acme-admin", status: "put", thread },
      { priorTurnId: TURN, repository: "acme/acme-admin", status: "override", thread: undefined },
      undefined,
    ]);
  });

  // Whose repository it is needs the organisation, so `talk relay`'s edge refuses Slopweaver's own (`teamFixRefusal`).
  it("refuses a stray discuss-first flag, a clone address, a composed thread and a misplaced turn", () => {
    const base = ["--turn", TURN, "--say", "raise a fix"];
    const refused = (...extra: string[]) => unwrapErr(parseRelayArgs({ rest: [...base, ...extra] }));
    const notTeam =
      "--discuss-first needs --team-fix <owner/repo>: a team repository, lower-case, never Slopweaver's own";
    expect([
      refused("--team-fix", "acme/acme-admin"),
      refused("--discuss-first", "put", "--team-fix", "acme/acme-admin.git"),
      refused("--discuss-first", "put", "--team-fix", "Acme/acme-admin"),
      refused("--discuss-first", "put", "--team-fix", "acme/acme-admin", "--fix-thread", "https://example.com/t"),
      refused("--discuss-first", "put", "--team-fix", "acme/acme-admin", "--discuss-first-turn", TURN),
      refused("--discuss-first", "override", "--team-fix", "acme/acme-admin"),
      refused("--discuss-first", "held", "--team-fix", "acme/acme-admin"),
    ]).toEqual([
      ["--team-fix, --fix-thread and --discuss-first-turn go only with --discuss-first put|override"],
      [notTeam],
      [notTeam],
      ["--fix-thread must be a Slack message link of at most 200 characters"],
      ["--discuss-first-turn goes only with --discuss-first override"],
      ["--discuss-first override needs --discuss-first-turn <uuid>: the relay that put the question"],
      ["--discuss-first must be put or override, got held"],
    ]);
  });

  it("refuses half a candidate ruling, a word that is not the owner's, a malformed id, and one beside --covers", () => {
    const base = ["--turn", TURN, "--say", "x"];
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--candidate", "c-105"] }))).toEqual([
      "--candidate and --reaction go together: the candidate read to the owner, and the owner's word on it",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--candidate", "c-105", "--reaction", "maybe"] }))).toEqual([
      "--reaction must be one of yes, no, sort-of, not-sure, lets-talk, done, abandoned, got maybe",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--candidate", "C 105", "--reaction", "no"] }))).toEqual([
      "--candidate is a candidate id such as c-105, got C 105",
    ]);
    const long = `c-${"a".repeat(79)}`;
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--candidate", long, "--reaction", "no"] }))).toEqual([
      `--candidate is a candidate id such as c-105, got ${long}`,
    ]);
    const both = [...base, "--about", "act:ev-2", "--covers", "rule", "--candidate", "c-105", "--reaction", "no"];
    expect(unwrapErr(parseRelayArgs({ rest: both }))).toEqual([
      "talk relay carries one ruling per turn: --candidate with --reaction, or --covers, never both",
    ]);
  });

  // A triage pass's verdict and label travel as words the verb checks.
  it("takes --triage with an optional --label as the owner's ruling on the card --about names, and none when absent", () => {
    const base = ["--turn", TURN, "--say", "x", "--about", "act:ev-9"];
    expect(
      unwrap(parseRelayArgs({ rest: [...base, "--triage", "send-it", "--label", "action-now"] })).triageRuling,
    ).toEqual({ label: "action-now", verdict: "send-it" });
    expect(unwrap(parseRelayArgs({ rest: [...base, "--triage", "rewrite"] })).triageRuling).toEqual({
      label: undefined,
      verdict: "rewrite",
    });
    expect(unwrap(parseRelayArgs({ rest: base })).triageRuling).toBe(undefined);
  });

  it("refuses a label alone, a word not in the vocabulary, a ruling with no card, and one beside another ruling", () => {
    const base = ["--turn", TURN, "--say", "x"];
    const about = [...base, "--about", "act:ev-9"];
    expect(unwrapErr(parseRelayArgs({ rest: [...about, "--label", "action-now"] }))).toEqual([
      "--label rides only beside --triage: the owner's label on the card they ruled",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...about, "--triage", "bin-it", "--label", "someday"] }))).toEqual([
      "--triage must be one of send-it, needs-more-info, park-working-session, park-slow-triage, rewrite, drop, got bin-it",
      "--label must be one of waiting-on-them, waiting-on-me, come-back-to-it, action-now, got someday",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--triage", "send-it"] }))).toEqual([
      "--triage is the owner's ruling on the card they have open, so it needs --about <kind>:<id>",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...about, "--covers", "rule", "--triage", "send-it"] }))).toEqual([
      "talk relay carries one ruling per turn: --triage, --candidate or --covers, never two",
    ]);
  });

  // An empty inline value is a flag given with nothing in it, never no flag at all, so `--label=` alone is refused.
  it("refuses an empty --triage= or --label= rather than reading it as absent", () => {
    const about = ["--turn", TURN, "--say", "x", "--about", "act:ev-9"];
    expect(unwrapErr(parseRelayArgs({ rest: [...about, "--label="] }))).toEqual([
      "--label rides only beside --triage: the owner's label on the card they ruled",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...about, "--triage="] }))).toEqual([
      "--triage must be one of send-it, needs-more-info, park-working-session, park-slow-triage, rewrite, drop, got nothing",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...about, "--triage", "send-it", "--label="] }))).toEqual([
      "--label must be one of waiting-on-them, waiting-on-me, come-back-to-it, action-now, got nothing",
    ]);
  });

  it("takes the page's stated workspace with its reason, and none when it stated none", () => {
    const base = ["--turn", TURN, "--say", "x"];
    const stated = unwrap(
      parseRelayArgs({ rest: [...base, "--workspace", "team", "--workspace-because", "they said it on the console"] }),
    );
    expect(stated.workspace).toEqual({ because: "they said it on the console", workspace: "team" });
    expect(unwrap(parseRelayArgs({ rest: base })).workspace).toBe(undefined);
  });

  it("refuses a workspace with no reason, a reason with no workspace, and a workspace that is not one", () => {
    const base = ["--turn", TURN, "--say", "x"];
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--workspace", "team"] }))).toEqual([
      "--workspace needs --workspace-because <why>: the row carries the reason it is this workspace's",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--workspace-because", "why"] }))).toEqual([
      "--workspace-because needs --workspace team|self — it is the reason for one",
    ]);
    expect(unwrapErr(parseRelayArgs({ rest: [...base, "--workspace", "work", "--workspace-because", "why"] }))).toEqual(
      ['--workspace must be one of team|self, got "work"'],
    );
  });

  it("says the turn is the route's to mint, not the caller's to choose", () => {
    expect(unwrapErr(parseRelayArgs({ rest: ["--say", "x"] }))).toEqual([
      "talk relay needs --turn <uuid>, which the console page minted for this relay — never a value you chose",
    ]);
  });

  it("takes --words-alone as the third reading shape, and refuses it beside either other", () => {
    const args = unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--heard", "fix it", "--words-alone"] }));
    expect([args.wordsAlone, args.say, args.readAfter]).toEqual([true, "", []]);
    const both =
      "talk relay takes one of --say, --read-after, --words-alone or --typed: after a read or a refusal the voice's " +
      "reading is dropped and only their words go, and a typed steer has no reading at all";
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--words-alone", "--say", "x"] }))).toEqual([both]);
    expect(
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--words-alone", "--read-after", "web_search"] })),
    ).toEqual([both]);
  });

  it("takes --offered-file beside a spoken relay, and refuses it beside the owner's words alone or a typed steer", () => {
    expect(
      unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--offered-file", "/tmp/r/offer.json"] }))
        .offeredFile,
    ).toBe("/tmp/r/offer.json");
    expect(
      unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--read-after", "web_search", "--offered-file", "/o.json"] }))
        .offeredFile,
    ).toBe("/o.json");
    expect(unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x"] })).offeredFile).toBe(undefined);
    const spokenOnly =
      "talk relay --offered-file rides a spoken relay only: --words-alone and --typed carry their words and nothing the voice wrote";
    expect([
      unwrapErr(
        parseRelayArgs({ rest: ["--turn", TURN, "--heard", "x", "--words-alone", "--offered-file", "/o.json"] }),
      ),
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--heard", "x", "--typed", "--offered-file", "/o.json"] })),
    ]).toEqual([[spokenOnly], [spokenOnly]]);
  });

  it("names the four content shapes when none is given", () => {
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN] }))).toEqual([
      "talk relay needs --say <words>, --read-after <tool,...> when the voice read something after they spoke, " +
        "--words-alone when a first relay of the turn was refused, or --typed when they typed the steer on the console",
    ]);
  });

  it("takes --typed as the fourth content shape, and refuses it beside any other", () => {
    const args = unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--heard", "fix the queue", "--typed"] }));
    expect([args.typed, args.wordsAlone, args.say, args.readAfter, args.heard]).toEqual([
      true,
      false,
      "",
      [],
      "fix the queue",
    ]);
    const both =
      "talk relay takes one of --say, --read-after, --words-alone or --typed: after a read or a refusal the voice's " +
      "reading is dropped and only their words go, and a typed steer has no reading at all";
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--typed", "--say", "x"] }))).toEqual([both]);
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--typed", "--words-alone"] }))).toEqual([both]);
    expect(unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--typed", "--read-after", "web_search"] }))).toEqual([
      both,
    ]);
  });

  it("refuses every screen reason on a typed steer, which takes no look at the owner's screen", () => {
    const refusal =
      "talk relay --typed takes no --screen-failed, --screen-not-taken or --screen-recording-off: a typed steer takes no look at their screen, and a missing image is one they did not attach";
    const typed = ({ flag }: { flag: string }) =>
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--heard", "x", "--typed", flag] }));
    expect(typed({ flag: "--screen-failed" })).toEqual([refusal]);
    expect(typed({ flag: "--screen-not-taken" })).toEqual([refusal]);
    expect(typed({ flag: "--screen-recording-off" })).toEqual([refusal]);
  });

  /** A spoken relay with these flags after its turn and reading. */
  const spoken = (...extra: string[]) => parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", ...extra] });
  const twoReasons =
    "talk relay takes one of --screen <webp-file>, --screen-failed, --screen-not-taken or --screen-recording-off, never two";

  it("takes --screen-recording-off alone, and refuses it beside another screen reason", () => {
    expect(unwrap(spoken("--screen-recording-off")).screenRecordingOff).toBe(true);
    expect(unwrap(spoken("--screen-recording-off")).screenFailed).toBe(false);
    expect(unwrap(spoken()).screenRecordingOff).toBe(false);
    expect(unwrapErr(spoken("--screen-recording-off", "--screen-failed"))).toEqual([twoReasons]);
  });

  it("takes --screen-not-taken alone, and refuses it beside --screen or --screen-failed", () => {
    expect(unwrap(spoken("--screen-not-taken")).screenNotTaken).toBe(true);
    expect(unwrap(spoken()).screenNotTaken).toBe(false);
    expect(unwrapErr(spoken("--screen-not-taken", "--screen-failed"))).toEqual([twoReasons]);
    expect(unwrapErr(spoken("--screen-not-taken", "--screen", "/a.webp"))).toEqual([twoReasons]);
  });

  it("reads a spoken relay as not typed", () => {
    expect(unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x"] })).typed).toBe(false);
  });

  it("names both missing halves at once", () => {
    expect(unwrapErr(parseRelayArgs({ rest: [] })).length).toBe(2);
  });
});

describe("parseRelayArgs — the owner's words and the record", () => {
  it("leaves heard and about empty when the caller attached neither", () => {
    const args = unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x"] }));
    expect(args.heard).toBe("");
    expect(args.about).toBe("");
  });

  it("carries heard and about through verbatim, for the draft to normalise and check", () => {
    const args = unwrap(
      parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--heard", "go with B", "--about", "ask:a-row"] }),
    );
    expect(args.heard).toBe("go with B");
    expect(args.about).toBe("ask:a-row");
    expect(args.heardStdin).toBe(false);
  });

  it("marks the owner's words as arriving on stdin with --heard-stdin, the way the console's route sends them", () => {
    const args = unwrap(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--heard-stdin"] }));
    expect([args.heardStdin, args.heard]).toEqual([true, ""]);
  });

  it("refuses the owner's words both on stdin and as --heard", () => {
    expect(
      unwrapErr(parseRelayArgs({ rest: ["--turn", TURN, "--say", "x", "--heard-stdin", "--heard", "y"] })),
    ).toEqual(["talk relay takes the owner's words as --heard <words> or on stdin with --heard-stdin, never both"]);
  });
});

describe("parseRowArgs", () => {
  it("takes the slug", () => {
    expect(unwrap(parseRowArgs({ rest: ["--slug", "a-row", "--json"] })).slug).toBe("a-row");
  });

  it("refuses a read with no slug", () => {
    expect(unwrapErr(parseRowArgs({ rest: [] }))).toEqual(["talk row needs --slug <board-slug>"]);
  });
});

describe("parseLogArgs", () => {
  it("defaults the limit", () => {
    expect(unwrap(parseLogArgs({ rest: [] })).limit).toBe(DEFAULT_LOG_LIMIT);
  });

  it("takes a limit of zero, which is a real answer rather than an absent flag", () => {
    expect(unwrap(parseLogArgs({ rest: ["--limit", "0"] })).limit).toBe(0);
  });

  it("reads one turn by its id", () => {
    const parsed = unwrap(parseLogArgs({ rest: ["--turn", "951b9e45-6fc9-45fd-8e25-d04ded7164c9", "--json"] }));
    expect(parsed.turn).toBe("951b9e45-6fc9-45fd-8e25-d04ded7164c9");
    expect(parsed.json).toBe(true);
  });

  it("refuses a turn that is not a relay turn's UUID", () => {
    expect(unwrapErr(parseLogArgs({ rest: ["--turn", "../escape"] }))).toEqual(["--turn wants a relay turn's UUID"]);
  });

  it("refuses --turn beside --limit, since one turn is not a page of receipts", () => {
    expect(
      unwrapErr(parseLogArgs({ rest: ["--turn", "951b9e45-6fc9-45fd-8e25-d04ded7164c9", "--limit", "3"] })),
    ).toEqual(["--turn reads one turn, so it takes no --limit or --about-prefix"]);
  });
});

describe("talkHomeOf", () => {
  it("takes the flag's directory when one was given", () => {
    expect(talkHomeOf({ home: "/tmp/a-home" })).toBe("/tmp/a-home");
  });

  it("falls back to this machine's Slopweaver home, out loud rather than through a `??`", () => {
    expect(talkHomeOf({ home: undefined })).toBe(slopweaverHome());
  });
});
