import { describe, expect, it } from "vitest";

import type { Result } from "../../../lib/result.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { OrgHealthError } from "../../../orgHealth/errors.js";
import { classifyIncidentIoRoot, type IncidentIoRoot, incidentBotsOf } from "../../../orgHealth/incidentIo.js";
import { parseIncidentIoThread } from "../../../orgHealth/incidentIoThread.js";
import type { ThreadIncident } from "../../../orgHealth/types.js";
import { announcement, update, WEEKLY_REPORT } from "./incidentIoFixtures.js";

/** The fixture channel's incident.io bot, as its own weekly report shows it. */
const INCIDENT_BOTS = incidentBotsOf({ messages: [WEEKLY_REPORT] });

/** The parsed root of an announcement fixture, which every thread test starts from. */
function rootOf({ raw }: { raw: Record<string, unknown> }): IncidentIoRoot {
  const classified = unwrap(classifyIncidentIoRoot({ incidentBots: INCIDENT_BOTS, raw }));
  if (classified.kind !== "incident") {
    throw new Error("fixture is not an incident announcement");
  }
  return classified.root;
}

/** Parse a one-page thread in the fixture channel. */
const readThread = ({
  messages,
  root,
}: {
  messages: readonly unknown[];
  root: IncidentIoRoot;
}): Result<ThreadIncident, OrgHealthError> => parseIncidentIoThread({ pages: [messages], root });

describe("parseIncidentIoThread", () => {
  it("keys an incident with no update on its declaration, still investigating", () => {
    const raw = announcement();
    const incident = unwrap(readThread({ messages: [raw], root: rootOf({ raw }) }));
    expect(incident.phase).toBe("investigating");
    expect(incident.declaredIso).toBe("2026-09-23T01:17:25.000Z");
    expect(incident.phaseChangedIso).toBe("2026-09-23T01:17:25.000Z");
    expect(incident.phaseProvenance).toBe("declared");
    expect(incident.lastUpdate).toBe(undefined);
  });

  it("leaves an edited root with no update to be dated by sighting, since it may have moved with nothing said", () => {
    const raw = announcement({ editedTs: "1790200000.000000", status: "Fixing" });
    const incident = unwrap(readThread({ messages: [raw], root: rootOf({ raw }) }));
    expect([incident.phase, incident.phaseChangedIso, incident.phaseProvenance]).toEqual([
      "identified",
      "2026-09-23T01:17:25.000Z",
      "inferred",
    ]);
  });

  it("leaves an edited root whose only updates state its phase unmoved to be dated by sighting", () => {
    const raw = announcement({ editedTs: "1790200000.000000", status: "Fixing" });
    const held = update({ to: "Fixing", ts: "1790138037.887319" });
    const incident = unwrap(readThread({ messages: [raw, held], root: rootOf({ raw }) }));
    expect([incident.phase, incident.phaseChangedIso, incident.phaseProvenance]).toEqual([
      "identified",
      "2026-09-23T01:17:25.000Z",
      "inferred",
    ]);
  });

  it("keys an unedited root whose only updates state its phase unmoved on its declaration", () => {
    const raw = announcement({ status: "Fixing" });
    const held = update({ to: "Fixing", ts: "1790138037.887319" });
    const incident = unwrap(readThread({ messages: [raw, held], root: rootOf({ raw }) }));
    expect([incident.phaseChangedIso, incident.phaseProvenance]).toEqual(["2026-09-23T01:17:25.000Z", "declared"]);
  });

  /** INC-98's live shape: two moves and an update in each phase, the root edited to the last status. */
  const movedTwice = [
    update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" }),
    update({ to: "Fixing", ts: "1790159388.250099", words: "Fix in staging." }),
    update({ from: "Fixing", to: "Monitoring", ts: "1790181814.617319", words: "Patched." }),
    update({ to: "Monitoring", ts: "1790207726.150759", words: "New users coming in fine." }),
  ];

  it("takes the root's edited status as current and the first update of its phase as when it entered it", () => {
    const raw = announcement({ editedTs: "1790181900.000000", status: "Monitoring" });
    const incident = unwrap(readThread({ messages: [raw, ...movedTwice], root: rootOf({ raw }) }));
    expect(incident.status).toBe("Monitoring");
    expect(incident.phase).toBe("monitoring");
    expect(incident.phaseChangedIso).toBe("2026-09-23T16:43:34.000Z");
    expect(incident.phaseProvenance).toBe("update");
    expect(incident.lastUpdate).toEqual({
      author: "Riley Lead",
      iso: "2026-09-23T23:55:26.000Z",
      status: "Monitoring",
      text: "New users coming in fine.",
    });
  });

  it("keeps the phase's instant when the root is edited again with no status change, so the same move is not told twice", () => {
    const first = announcement({ editedTs: "1790181900.000000", status: "Monitoring" });
    const retouched = announcement({ editedTs: "1790300000.000000", status: "Monitoring" });
    const before = unwrap(readThread({ messages: [first, ...movedTwice], root: rootOf({ raw: first }) }));
    const after = unwrap(readThread({ messages: [retouched, ...movedTwice], root: rootOf({ raw: retouched }) }));
    expect(after.phaseChangedIso).toBe(before.phaseChangedIso);
    expect(after.phaseChangedIso).toBe("2026-09-23T16:43:34.000Z");
  });

  it("infers the instant from the last update when the root reached a phase no update moved it to", () => {
    const raw = announcement({ editedTs: "1790200000.000000", status: "Monitoring" });
    const messages = [raw, ...movedTwice.slice(0, 2)];
    const incident = unwrap(readThread({ messages, root: rootOf({ raw }) }));
    expect(incident.phase).toBe("monitoring");
    expect(incident.phaseChangedIso).toBe("2026-09-23T10:29:48.000Z");
    expect(incident.phaseProvenance).toBe("inferred");
  });

  it("infers from the last update before the run when the run's opening update states the phase without moving it", () => {
    const raw = announcement({ editedTs: "1790140100.000000", status: "Fixing" });
    const messages = [
      raw,
      update({ to: "Investigating", ts: "1790130000.000001", words: "Looking." }),
      update({ to: "Fixing", ts: "1790140000.000001", words: "Fix underway." }),
    ];
    const incident = unwrap(readThread({ messages, root: rootOf({ raw }) }));
    expect(incident.phaseChangedIso).toBe("2026-09-23T02:20:00.000Z");
    expect(incident.phaseProvenance).toBe("inferred");
  });

  it("keeps an inferred instant when a first update in the same phase arrives, so a held phase is not re-keyed", () => {
    const raw = announcement({ editedTs: "1790200000.000000", status: "Monitoring" });
    const before = unwrap(readThread({ messages: [raw, movedTwice[0]!], root: rootOf({ raw }) }));
    const after = unwrap(readThread({ messages: [raw, movedTwice[0]!, movedTwice[3]!], root: rootOf({ raw }) }));
    expect(before.phaseChangedIso).toBe("2026-09-23T04:33:57.000Z");
    expect(after.phaseChangedIso).toBe("2026-09-23T04:33:57.000Z");
    expect(after.phaseProvenance).toBe("inferred");
  });

  it("reads Documenting then Closed as one resolved phase, entered at Documenting", () => {
    const raw = announcement({ editedTs: "1790819083.000000", status: "Closed" });
    const messages = [
      raw,
      update({ from: "Monitoring", to: "Documenting", ts: "1790213495.353149", words: "All stable." }),
      update({
        author: "<http://incident.io|incident.io> (auto-closure)",
        from: "Documenting",
        to: "Closed",
        ts: "1790819113.569619",
        words: "Incident was auto-closed after no activity",
      }),
    ];
    const incident = unwrap(readThread({ messages, root: rootOf({ raw }) }));
    expect(incident.phase).toBe("resolved");
    expect(incident.phaseChangedIso).toBe("2026-09-24T01:31:35.000Z");
    expect(incident.lastUpdate!.author).toBe("incident.io (auto-closure)");
  });

  it("keys a phase entered a second time on its second entry, so a Done on the first does not hold it", () => {
    const raw = announcement({ editedTs: "1790170100.000000", status: "Monitoring" });
    const messages = [
      raw,
      update({ from: "Fixing", to: "Monitoring", ts: "1790150000.000001" }),
      update({ from: "Monitoring", to: "Fixing", ts: "1790160000.000001" }),
      update({ from: "Fixing", to: "Monitoring", ts: "1790170000.000001" }),
    ];
    const incident = unwrap(readThread({ messages, root: rootOf({ raw }) }));
    expect(incident.phaseChangedIso).toBe("2026-09-23T13:26:40.000Z");
  });

  it("reads an update a reinstalled incident.io bot posted into an older announcement's thread, by its app", () => {
    const raw = { ...announcement({ editedTs: "1790138100.000000", status: "Fixing" }), app_id: "A0SYNINCIDENTIO" };
    const rotated = {
      ...update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" }),
      bot_id: "B0ROTATED",
      bot_profile: { app_id: "A0SYNINCIDENTIO" },
    };
    const incident = unwrap(readThread({ messages: [raw, rotated], root: rootOf({ raw }) }));
    expect([incident.phaseChangedIso, incident.phaseProvenance]).toEqual(["2026-09-23T04:33:57.000Z", "update"]);
  });

  it("ignores an update-shaped reply by another app's bot, whatever bot id it carries", () => {
    const raw = { ...announcement({ editedTs: "1790138100.000000", status: "Fixing" }), app_id: "A0SYNINCIDENTIO" };
    const revoked = {
      ...update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" }),
      app_id: "A0SYNSOMEONEELSE",
      bot_id: "B0ROTATED",
    };
    const incident = unwrap(readThread({ messages: [raw, revoked], root: rootOf({ raw }) }));
    expect([incident.lastUpdate, incident.phaseProvenance]).toEqual([undefined, "inferred"]);
  });

  it("refuses a thread whose copy of the root was edited after the channel read, rather than mix two states", () => {
    const raw = announcement({ status: "Investigating" });
    const editedSince = { ...announcement({ editedTs: "1790138100.000000", status: "Fixing" }) };
    const moved = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const error = unwrapErr(readThread({ messages: [editedSince, moved], root: rootOf({ raw }) }));
    expect([error.code, error.message]).toEqual([
      "ROOT_MOVED",
      "INC-98's announcement no longer matches between the channel read and its thread read (its status moved) — the next read sees one state",
    ]);
  });

  it("refuses a thread whose copy of the root moved status with no edit stamp, never trusting a missing one", () => {
    const raw = announcement({ status: "Investigating" });
    const unstamped = announcement({ status: "Fixing" });
    const error = unwrapErr(readThread({ messages: [unstamped], root: rootOf({ raw }) }));
    expect([error.code, error.message]).toEqual([
      "ROOT_MOVED",
      "INC-98's announcement no longer matches between the channel read and its thread read (its status moved) — the next read sees one state",
    ]);
  });

  it("refuses a copy downgraded and renamed with its status unchanged and no edit stamp", () => {
    const raw = announcement({ status: "Fixing" });
    const downgraded = announcement({ severity: "Minor", status: "Fixing", title: "Checkout latency recovered" });
    expect(unwrapErr(readThread({ messages: [downgraded], root: rootOf({ raw }) })).message).toContain(
      "(its severity, title moved)",
    );
  });

  it("accepts a cosmetic edit made between the reads, whichever copy carries the newer stamp", () => {
    const older = announcement({ editedTs: "1790138100.000000", status: "Fixing" });
    const newer = announcement({ editedTs: "1790139000.000000", status: "Fixing" });
    const phases = [
      unwrap(readThread({ messages: [newer], root: rootOf({ raw: older }) })).phase,
      unwrap(readThread({ messages: [older], root: rootOf({ raw: newer }) })).phase,
    ];
    expect(phases).toEqual(["identified", "identified"]);
  });

  it("refuses a thread read that did not return the announcement, never reading absence as agreement", () => {
    const raw = announcement();
    expect(unwrapErr(readThread({ messages: [], root: rootOf({ raw }) })).message).toContain(
      "(page 1 of the thread read did not return the announcement)",
    );
  });

  it("refuses a later page that omits the root it repeats, never letting the first page's copy vouch for it", () => {
    const raw = announcement({ status: "Investigating" });
    const moved = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const error = unwrapErr(parseIncidentIoThread({ pages: [[raw], [moved]], root: rootOf({ raw }) }));
    expect([error.code, error.message]).toEqual([
      "ROOT_MOVED",
      "INC-98's announcement no longer matches between the channel read and its thread read (page 2 of the thread read did not return the announcement) — the next read sees one state",
    ]);
  });

  it("refuses a newest update that left the root's phase after the root's last edit, the window before incident.io edits it", () => {
    const raw = announcement({ editedTs: "1790138100.000000", status: "Fixing" });
    const fixing = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const monitoring = update({ from: "Fixing", to: "Monitoring", ts: "1790139000.000100" });
    const error = unwrapErr(readThread({ messages: [raw, fixing, monitoring], root: rootOf({ raw }) }));
    expect([error.code, error.message]).toEqual([
      "ROOT_BEHIND",
      "INC-98's announcement disagrees with an update posted after its last edit, at 2026-09-23T04:50:00.000Z (status Fixing against Monitoring) — incident.io has not edited it yet, so the next read sees one state",
    ]);
  });

  it("refuses a newer update that renamed and downgraded the incident with its status unchanged", () => {
    const raw = announcement({ editedTs: "1790138100.000000", status: "Fixing" });
    const renamed = update({ severity: "Minor", title: "Renamed incident", to: "Fixing", ts: "1790139000.000100" });
    expect(unwrapErr(readThread({ messages: [raw, renamed], root: rootOf({ raw }) })).message).toContain(
      "(severity Critical against Minor, title Payment checkout regression against Renamed incident)",
    );
  });

  it("refuses a newer update to another status in the same phase, Documenting to Closed", () => {
    const raw = announcement({ editedTs: "1790138100.000000", status: "Documenting" });
    const closed = update({ from: "Documenting", to: "Closed", ts: "1790139000.000100" });
    expect(unwrapErr(readThread({ messages: [raw, closed], root: rootOf({ raw }) })).code).toBe("ROOT_BEHIND");
  });

  it("reads a root edited after its newest update into another phase, since it moved with nothing said", () => {
    const raw = announcement({ editedTs: "1790200000.000000", status: "Monitoring" });
    const fixing = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const incident = unwrap(readThread({ messages: [raw, fixing], root: rootOf({ raw }) }));
    expect([incident.phase, incident.phaseProvenance, incident.lastUpdate!.status]).toEqual([
      "monitoring",
      "inferred",
      "Fixing",
    ]);
  });

  it("refuses a root that moved away and back between the two reads, with the updates that say so", () => {
    const seen = announcement({ editedTs: "1790139000.000000", status: "Investigating" });
    const now = announcement({ editedTs: "1790139300.000000", status: "Investigating" });
    const away = update({ from: "Investigating", to: "Fixing", ts: "1790139100.000000" });
    const back = update({ from: "Fixing", to: "Investigating", ts: "1790139200.000000" });
    const refused = unwrapErr(readThread({ messages: [now, away, back], root: rootOf({ raw: seen }) }));
    expect([refused.code, refused.message]).toEqual([
      "ROOT_MOVED",
      "INC-98's announcement no longer matches between the channel read and its thread read (it was edited again, and 2 update(s) posted, after the copy the channel read saw) — the next read sees one state",
    ]);
  });

  it("refuses two updates going away and back after the root's last edit, though the newest agrees with it", () => {
    const raw = announcement({ editedTs: "1790139000.000000", status: "Investigating" });
    const away = update({ from: "Investigating", severity: "Minor", to: "Fixing", ts: "1790139100.000000" });
    const back = update({ from: "Fixing", to: "Investigating", ts: "1790139200.000000" });
    const refused = unwrapErr(readThread({ messages: [raw, back, away], root: rootOf({ raw }) }));
    expect([refused.code, refused.message]).toEqual([
      "ROOT_BEHIND",
      "INC-98's announcement disagrees with an update posted after its last edit, at 2026-09-23T04:51:40.000Z (status Investigating against Fixing, severity Critical against Minor) — incident.io has not edited it yet, so the next read sees one state",
    ]);
  });

  it("reads a root edited after an away-and-back pair, since it has caught up with both", () => {
    const raw = announcement({ editedTs: "1790139300.000000", status: "Investigating" });
    const away = update({ from: "Investigating", to: "Fixing", ts: "1790139100.000000" });
    const back = update({ from: "Fixing", to: "Investigating", ts: "1790139200.000000" });
    const incident = unwrap(readThread({ messages: [raw, away, back], root: rootOf({ raw }) }));
    expect([incident.phase, incident.lastUpdate!.status]).toEqual(["investigating", "Investigating"]);
  });

  it("reads a root restamped between the two reads with no update after the channel read's copy", () => {
    const seen = announcement({ editedTs: "1790139300.000000", status: "Fixing" });
    const now = announcement({ editedTs: "1790139400.000000", status: "Fixing" });
    const fixing = update({ from: "Investigating", to: "Fixing", ts: "1790139100.000000" });
    const incident = unwrap(readThread({ messages: [now, fixing], root: rootOf({ raw: seen }) }));
    expect([incident.phase, incident.phaseProvenance]).toEqual(["identified", "update"]);
  });

  it("orders an update and the root's edit in the same second by Slack's fraction", () => {
    const behind = announcement({ editedTs: "1790139000.100000", status: "Fixing" });
    const caughtUp = announcement({ editedTs: "1790139000.900000", status: "Fixing" });
    const later = update({ from: "Fixing", to: "Monitoring", ts: "1790139000.500000" });
    const refused = unwrapErr(readThread({ messages: [behind, later], root: rootOf({ raw: behind }) }));
    const read = unwrap(readThread({ messages: [caughtUp, later], root: rootOf({ raw: caughtUp }) }));
    expect([refused.code, read.phase, read.lastUpdate!.status]).toEqual(["ROOT_BEHIND", "identified", "Monitoring"]);
  });

  it("takes the newest of two same-second updates by Slack's fraction, whatever order the thread returned", () => {
    const raw = announcement({ editedTs: "1790139001.000000", status: "Monitoring" });
    const fixing = update({ from: "Investigating", to: "Fixing", ts: "1790139000.200000" });
    const monitoring = update({ from: "Fixing", to: "Monitoring", ts: "1790139000.700000" });
    const incident = unwrap(readThread({ messages: [raw, monitoring, fixing], root: rootOf({ raw }) }));
    expect([incident.lastUpdate!.status, incident.phaseProvenance]).toEqual(["Monitoring", "update"]);
  });

  it("passes a zero-item page between two that repeat the root, since it holds no reply to mis-pair", () => {
    const raw = announcement({ editedTs: "1790138100.000000", status: "Fixing" });
    const moved = update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" });
    const incident = unwrap(parseIncidentIoThread({ pages: [[raw], [], [raw, moved]], root: rootOf({ raw }) }));
    expect([incident.phase, incident.lastUpdate!.status]).toEqual(["identified", "Fixing"]);
  });

  it("reads only the announcing bot's updates when the root names no app", () => {
    const raw = announcement({ editedTs: "1790138100.000000", status: "Fixing" });
    const rotated = {
      ...update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" }),
      bot_id: "B0ROTATED",
      bot_profile: { app_id: "A0SYNINCIDENTIO" },
    };
    const incident = unwrap(readThread({ messages: [raw, rotated], root: rootOf({ raw }) }));
    expect([incident.lastUpdate, incident.phaseProvenance]).toEqual([undefined, "inferred"]);
  });

  it("ignores an update-shaped reply by a bot the channel does not show to be incident.io's", () => {
    const raw = announcement({ editedTs: "1790138100.000000", status: "Fixing" });
    const stranger = { ...update({ from: "Investigating", to: "Fixing", ts: "1790138037.887319" }), bot_id: "B0OTHER" };
    const incident = unwrap(readThread({ messages: [raw, stranger], root: rootOf({ raw }) }));
    expect([incident.lastUpdate, incident.phaseProvenance]).toEqual([undefined, "inferred"]);
  });

  it("ignores a reply by anyone but the announcing bot", () => {
    const raw = announcement();
    const chatter = { text: "looking now", ts: "1790130000.000001", user: "U0PERSON" };
    const incident = unwrap(readThread({ messages: [raw, chatter], root: rootOf({ raw }) }));
    expect(incident.lastUpdate).toBe(undefined);
  });

  it("refuses an update naming another incident", () => {
    const raw = announcement({ status: "Fixing" });
    const messages = [raw, update({ from: "Investigating", number: 97, to: "Fixing", ts: "1790138037.887319" })];
    const error = unwrapErr(readThread({ messages, root: rootOf({ raw }) }));
    expect(error.code).toBe("REF_MISMATCH");
    expect(error.message).toContain("INC-97");
  });

  it("refuses a bot reply that opens like an update and does not parse as one", () => {
    const raw = announcement();
    const broken = { bot_id: raw["bot_id"], text: "Riley updated INC-98 (x) and then", ts: "1790138037.887319" };
    const error = unwrapErr(readThread({ messages: [raw, broken], root: rootOf({ raw }) }));
    expect(error.code).toBe("ANNOUNCEMENT_MALFORMED");
    expect(error.message).toContain("1790138037.887319");
  });
});
