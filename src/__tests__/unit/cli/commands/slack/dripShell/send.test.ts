import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { dripConfigFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { unreachableDoorLedger } from "../../../../../doorLedgerFixture.js";
import { parseOwnJson } from "../../../../../parseOwnJson.js";
import { argv, freshHome, harness, removeFixtureDirs } from "./harness.js";

afterEach(removeFixtureDirs);

describe("runSlackWrite --as me — refusals happen BEFORE anything is sent", () => {
  it("rejects a missing user token with a usage exit and never calls the API", async () => {
    const h = harness({ userToken: null });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.painPoints).toEqual([]);
    expect(h.sends).toEqual([]);
  });

  it("exits 1 over a corrupt profile, a fact about the install, and sends nothing", async () => {
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    const h = harness();

    const code = await runSlackWrite({
      argv: argv({ home }),
      deps: { ...h.deps, dripConfig: ({ home: at }) => dripConfigFromProfile({ home: at }) },
      verb: "post",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.painPoints).toEqual([]);
    expect(h.sends).toEqual([]);
  });

  it("resolves the user token under the SAME --home the rest of the run uses", async () => {
    const home = freshHome();
    const h = harness();

    await runSlackWrite({ argv: argv({ home }), deps: h.deps, verb: "post" });

    expect(h.userHomes).toEqual([home]);
  });

  it("rejects a form that breaks the shape, sending nothing", async () => {
    const h = harness({
      stdin: JSON.stringify({ kind: "drip", messages: [{ runs: [{ text: "a\nb", type: "text" }] }] }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.painPoints).toEqual([]);
    expect(h.sends).toEqual([]);
  });

  it("refuses the whole drip when one mentioned person cannot be resolved", async () => {
    const h = harness({
      stdin: JSON.stringify({ kind: "drip", messages: [{ runs: [{ person: "ghost", type: "mention" }] }] }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_USAGE);
    expect(h.sends).toEqual([]);
  });

  it("refuses authored prose that matches an exact rule at the DOOR, before the API is called", async () => {
    // The refusal used to be a pre-door usage error. It is now a door finding carrying an override token,
    // so the exit code is the one every other door refusal in this lane returns — and the pain point still
    // lands, which is the half that teaches the next compose.
    const h = harness({
      exactVoiceRules: [{ kind: "literal", value: "§" }],
      stdin: JSON.stringify({
        kind: "drip",
        messages: [{ runs: [{ text: "Setup passed § one blocker remains.", type: "text" }] }],
      }),
    });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(h.painPoints).toEqual([[{ path: "messages[0].runs[0]", rule: { kind: "literal", value: "§" } }]]);
    expect(h.sends).toEqual([]);
  });
});

describe("runSlackWrite --as me — the dry run", () => {
  it("sends NOTHING and prints every message in order", async () => {
    const h = harness();

    const code = await runSlackWrite({
      argv: argv({ extra: ["--dry-run"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends).toEqual([]);
    expect(h.out).toContain("Shipped the compaction pass.");
    expect(h.out).toContain("Docs to follow tomorrow.");
  });

  it("leaves NO reservation behind, so previewing cannot poison the real send that follows", async () => {
    const home = freshHome();
    const preview = harness();
    await runSlackWrite({ argv: argv({ extra: ["--dry-run"], home }), deps: preview.deps, verb: "post" });

    const real = harness();
    const code = await runSlackWrite({ argv: argv({ home }), deps: real.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(real.sends.map((send) => send.payload.text)).toEqual([
      "Shipped the compaction pass.",
      "Docs to follow tomorrow.",
    ]);
  });

  it("emits exactly ONE json document on stdout under --json", async () => {
    const h = harness();

    await runSlackWrite({
      argv: argv({ extra: ["--dry-run", "--json"], home: freshHome() }),
      deps: h.deps,
      verb: "post",
    });

    expect(h.out.length).toBe(1);
    const report = parseOwnJson<{ lane: string; outcomes: unknown }>({ text: h.out[0]! });
    expect(report.lane).toBe("drip");
    expect(report.outcomes).toBe(null);
  });
});

describe("runSlackWrite --as me — the real send", () => {
  it("posts every message in order and exits clean", async () => {
    const h = harness();

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.map((send) => send.payload.text)).toEqual([
      "Shipped the compaction pass.",
      "Docs to follow tomorrow.",
    ]);
  });

  it("records the decision before the first send, so each message leaves its own row", async () => {
    const h = harness();

    await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(h.door.records().length).toBeGreaterThan(0);
  });

  it("sends nothing and exits with the error code when the door record cannot be written", async () => {
    const h = harness();

    const code = await runSlackWrite({
      argv: argv({ home: freshHome() }),
      deps: { ...h.deps, doorLedger: unreachableDoorLedger() },
      verb: "post",
    });

    expect(code).toBe(EXIT_ERROR);
    expect(h.sends).toEqual([]);
  });

  it("emits NO card chrome over the operator's name", async () => {
    const h = harness();

    await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(h.sends.map((send) => Object.keys(send.payload).toSorted())).toEqual([
      ["blocks", "form", "text", "unfurl_links", "unfurl_media"],
      ["blocks", "form", "text", "unfurl_links", "unfurl_media"],
    ]);
  });

  it("exits with a FAULT and names the gap when the drip is only half sent", async () => {
    const h = harness({ failOn: "Docs to follow tomorrow." });

    const code = await runSlackWrite({ argv: argv({ home: freshHome() }), deps: h.deps, verb: "post" });

    expect(code).toBe(EXIT_ERROR);
    expect(h.out.some((line) => line.includes("drip INCOMPLETE"))).toBe(true);
    expect(h.out.some((line) => line.includes("2. FAILED — slack said no"))).toBe(true);
  });

  it("re-sends a line Slack itself REFUSED on the next run, with no flag — its reservation did not outlive the refusal", async () => {
    const home = freshHome();
    const first = harness({ refuseOn: "Docs to follow tomorrow." });
    expect(await runSlackWrite({ argv: argv({ home }), deps: first.deps, verb: "post" })).toBe(EXIT_ERROR);

    const second = harness();
    const code = await runSlackWrite({ argv: argv({ home }), deps: second.deps, verb: "post" });

    expect(code).toBe(EXIT_OK);
    expect(second.sends.map((send) => send.payload.text)).toEqual(["Docs to follow tomorrow."]);
  });

  it("skips what already landed when a half-sent drip is re-run", async () => {
    const home = freshHome();
    const first = harness({ failOn: "Docs to follow tomorrow." });
    await runSlackWrite({ argv: argv({ home }), deps: first.deps, verb: "post" });

    const second = harness();
    const code = await runSlackWrite({
      argv: argv({ extra: ["--resend-unconfirmed"], home }),
      deps: second.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(second.sends.map((send) => send.payload.text)).toEqual(["Docs to follow tomorrow."]);
  });

  it("takes the plain-body escape hatch byte-for-byte, minus the heredoc's trailing newline", async () => {
    const h = harness({ stdin: "just this — exactly as typed\n" });

    const code = await runSlackWrite({
      argv: ["--as", "me", "--channel", "C1", "--body", "-", "--home", freshHome(), "--shape", "top-level"],
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.sends.length).toBe(1);
    expect(h.sends[0]!.payload).toEqual({
      form: "plain",
      text: "just this — exactly as typed",
      unfurl_links: true,
      unfurl_media: true,
    });
  });

  it("sends the original bytes unchanged under a live voice-rules grant", async () => {
    const home = freshHome();
    const h = harness({
      exactVoiceRules: [{ kind: "literal", value: "§" }],
      grants: { hatchIds: ["voice-rules"], home },
      stdin: "Setup passed § one blocker remains.\n",
    });

    const code = await runSlackWrite({
      argv: ["--as", "me", "--channel", "C1", "--body", "-", "--home", home, "--shape", "top-level"],
      deps: h.deps,
      verb: "post",
    });

    expect(code).toBe(EXIT_OK);
    expect(h.painPoints).toEqual([[{ path: "body", rule: { kind: "literal", value: "§" } }]]);
    expect(h.sends.map((send) => send.payload.text)).toEqual(["Setup passed § one blocker remains."]);
  });

  it("threads messages 2..N under message 1 with --shape thread", async () => {
    const h = harness();

    await runSlackWrite({
      argv: ["--as", "me", "--channel", "C1", "--form", "-", "--home", freshHome(), "--shape", "thread"],
      deps: h.deps,
      verb: "post",
    });

    expect(h.sends.map((send) => send.threadTs)).toEqual([undefined, "1700000001.000100"]);
  });

  it("puts every reply into the named thread for `slack reply --as me`", async () => {
    const h = harness();

    await runSlackWrite({
      argv: ["--as", "me", "--channel", "C1", "--form", "-", "--home", freshHome(), "--thread-ts", "1699.0001"],
      deps: h.deps,
      verb: "reply",
    });

    expect(h.sends.map((send) => send.threadTs)).toEqual(["1699.0001", "1699.0001"]);
  });

  it("reports outcomes inside the ONE json document after a real send", async () => {
    const h = harness();

    await runSlackWrite({ argv: argv({ extra: ["--json"], home: freshHome() }), deps: h.deps, verb: "post" });

    expect(h.out.length).toBe(1);
    const report = parseOwnJson<{ outcomes: readonly { state: string }[] }>({ text: h.out[0]! });
    expect(report.outcomes.map((outcome) => outcome.state)).toEqual(["sent", "sent"]);
  });
});
