import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { classifyIncidentIoRoot, type IncidentIoRoot, incidentBotsOf } from "../../../orgHealth/incidentIo.js";
import { announcement, update, WEEKLY_REPORT } from "./incidentIoFixtures.js";

/** The fixture channel's incident.io bot, as its own weekly report shows it. */
const INCIDENT_BOTS = incidentBotsOf({ messages: [WEEKLY_REPORT] });

/** Classify one message in a channel whose incident.io bot is the fixtures'. */
const classify = ({ raw }: { raw: unknown }): ReturnType<typeof classifyIncidentIoRoot> =>
  classifyIncidentIoRoot({ incidentBots: INCIDENT_BOTS, raw });

/** The parsed root of an announcement fixture. */
function rootOf({ raw }: { raw: Record<string, unknown> }): IncidentIoRoot {
  const classified = unwrap(classify({ raw }));
  if (classified.kind !== "incident") {
    throw new Error("fixture is not an incident announcement");
  }
  return classified.root;
}

describe("classifyIncidentIoRoot", () => {
  it("reads an announcement's ref, severity, status, lead, channel and homepage", () => {
    const root = rootOf({ raw: announcement({ status: "Fixing" }) });
    expect(root.ref).toBe("INC-98");
    expect(root.severity).toBe("Critical");
    expect(root.status).toBe("Fixing");
    expect(root.phase).toBe("identified");
    expect(root.title).toBe("Payment checkout regression");
    expect(root.lead).toBe("Riley Lead");
    expect(root.channelId).toBe("C0SYNINCCHAN1");
    expect(root.homepageUrl).toBe("https://app.incident.io/example-org/incidents/98");
  });

  it("reads its thread's newest reply as the channel read carries it, and none for a thread nobody replied in", () => {
    const replied = rootOf({ raw: announcement({ latestReply: "1790586000.000100" }) });
    const quiet = rootOf({ raw: announcement() });
    expect([replied.latestReplyTs, quiet.latestReplyTs]).toEqual(["1790586000.000100", undefined]);
  });

  it("answers other for the bot's weekly report, which carries the same incident metadata but no status or homepage", () => {
    expect(WEEKLY_REPORT["metadata"]).toEqual({ event_type: "incident_message" });
    expect(unwrap(classify({ raw: WEEKLY_REPORT })).kind).toBe("other");
  });

  it("still reads an announcement whose metadata drifted, by its incident homepage button", () => {
    expect(rootOf({ raw: announcement({ metadata: false }) }).ref).toBe("INC-98");
  });

  it("refuses an announcement whose metadata and homepage button both drifted, by its title and details", () => {
    const raw = announcement({ metadata: false });
    const blocks = (raw["blocks"] as readonly Record<string, unknown>[]).filter((block) => block["type"] !== "actions");
    const error = unwrapErr(classify({ raw: { ...raw, blocks } }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("0 incident homepage buttons, not one");
  });

  it("refuses incident.io's announcement whose title and button both drifted, by its details alone", () => {
    const raw = announcement();
    const blocks = (raw["blocks"] as readonly Record<string, unknown>[]).filter((block) => block["type"] !== "actions");
    const drifted = { ...raw, blocks, text: "Critical: Payment checkout regression" };
    const error = unwrapErr(classify({ raw: drifted }));
    expect(error.message).toContain("its text is not `[<Severity>] <title>`");
  });

  it("answers other for another bot's message linking an incident homepage", () => {
    const raw = {
      blocks: [
        { elements: [{ type: "button", url: "https://app.incident.io/example-org/incidents/98" }], type: "actions" },
      ],
      bot_id: "B0OTHERBOT",
      text: "Deployment complete, see incident",
      ts: "1790126245.320409",
    };
    expect(unwrap(classify({ raw })).kind).toBe("other");
  });

  it("answers other for another bot's incident link even when nothing shows which bot is incident.io's", () => {
    const raw = {
      blocks: [
        { elements: [{ type: "button", url: "https://app.incident.io/example-org/incidents/98" }], type: "actions" },
      ],
      bot_id: "B0OTHERBOT",
      text: "Deployment complete, see incident",
      ts: "1790126245.320409",
    };
    expect(unwrap(classifyIncidentIoRoot({ incidentBots: new Set(), raw })).kind).toBe("other");
  });

  it("refuses a signed message when nothing in the channel shows which bot is incident.io's", () => {
    const raw = announcement({ metadata: false });
    const error = unwrapErr(classifyIncidentIoRoot({ incidentBots: new Set(), raw }));
    expect(error.message).toContain("no message in the channel shows which bot is incident.io's");
  });

  it("knows incident.io's bot by its metadata, or by a titled message with a homepage button, never a reply", () => {
    const reply = { ...WEEKLY_REPORT, bot_id: "B0REPLYBOT", thread_ts: "1790126245.320400" };
    const titledWithButton = { ...announcement({ metadata: false }), bot_id: "B0TITLEDBOT" };
    expect([...incidentBotsOf({ messages: [WEEKLY_REPORT, reply, titledWithButton] })]).toEqual([
      WEEKLY_REPORT["bot_id"],
      "B0TITLEDBOT",
    ]);
  });

  it("answers other for a bracketed bot message carrying no incident metadata, details or homepage button", () => {
    const raw = { bot_id: "B0OTHERBOT", text: "[Triggered] Disk usage high on db-1", ts: "1790126245.320409" };
    expect(unwrap(classify({ raw })).kind).toBe("other");
  });

  it("answers other for an update broadcast to the channel, even one carrying the homepage button", () => {
    const reply = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const broadcast = { ...reply, blocks: announcement()["blocks"], subtype: "thread_broadcast" };
    expect(unwrap(classify({ raw: broadcast })).kind).toBe("other");
  });

  it("answers other for a broadcast Slack marks as one, even carrying the announcement's own signature", () => {
    const broadcast = { ...announcement(), subtype: "thread_broadcast", thread_ts: "1790126245.320400" };
    expect(unwrap(classify({ raw: broadcast })).kind).toBe("other");
  });

  it("refuses a root whose thread_ts drifted, since it still carries the announcement's own signature", () => {
    const error = unwrapErr(classify({ raw: { ...announcement(), thread_ts: "1790126245.320410" } }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("it reads as a reply in another thread");
  });

  it("refuses a status no phase is mapped for, naming the status", () => {
    const error = unwrapErr(classify({ raw: announcement({ status: "Paused" }) }));
    expect(error.code).toBe("UNKNOWN_STATUS");
    expect(error.message).toContain('"Paused"');
  });

  it("refuses an announcement naming a status with no homepage button, rather than guessing its number", () => {
    const raw = announcement();
    const blocks = (raw["blocks"] as readonly Record<string, unknown>[]).filter((block) => block["type"] !== "actions");
    const error = unwrapErr(classify({ raw: { ...raw, blocks } }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("0 incident homepage buttons, not one");
  });

  it("refuses an announcement linking a homepage with no status, rather than passing it over", () => {
    const raw = announcement();
    const blocks = (raw["blocks"] as readonly Record<string, unknown>[]).filter((block) => block["type"] !== "section");
    const error = unwrapErr(classify({ raw: { ...raw, blocks } }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("no single Severity and Status");
  });

  it("refuses a signed announcement whose ts drifted, rather than passing it over", () => {
    const { ts: _dropped, ...raw } = announcement();
    const error = unwrapErr(classify({ raw: { ...raw, ts: 1790126245.320409 } }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("it carries no ts");
  });

  it("refuses an announcement whose Status field was renamed and whose homepage button is gone, never reading it as no incident", () => {
    const raw = announcement();
    const blocks = (raw["blocks"] as readonly Record<string, unknown>[])
      .filter((block) => block["type"] !== "actions")
      .map((block) => {
        if (block["type"] !== "section") {
          return block;
        }
        const text = block["text"] as { text: string };
        return { ...block, text: { ...text, text: text.text.replace("*Status*", "*State*") } };
      });
    const error = unwrapErr(classify({ raw: { ...raw, blocks } }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("no single Severity and Status");
  });
});
