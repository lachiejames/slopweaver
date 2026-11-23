/*
 * The stage's activity line: what a tool call is doing and to what, how long it stays, and the thumbnail its answer
 * hands over.
 */
import { describe, expect, it } from "vitest";

import {
  type Consultation,
  consultationAnswered,
  consultationOf,
  consultationShows,
  pictureOf,
} from "../../lib/voiceStageActivity";
import type { HeardSegment } from "../../lib/voiceTranscript";

const HIM_1: HeardSegment = { final: true, id: "h1", text: "tell me about this one", who: "owner" };
const VOICE_1: HeardSegment = { final: false, id: "v1", text: "it's the", who: "voice" };
const HIM_2: HeardSegment = { final: false, id: "h2", text: "and the next", who: "owner" };

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** A start with nothing open, nothing shared and the owner's one stretch heard. */
const start = ({
  tool,
  rawArguments = "{}",
  pageShows,
  screen,
}: {
  tool: string;
  rawArguments?: string;
  pageShows?: unknown;
  screen?: string;
}): Consultation => consultationOf({ pageShows, rawArguments, screen, segments: [HIM_1, VOICE_1], token: "t1", tool });

describe("consultationOf", () => {
  it("names a file by its own name, never its whole path", () => {
    const line = start({ rawArguments: '{"path":"/Users/owner/notes/plan.md"}', tool: "file_read" });
    expect([line.doing, line.subject]).toEqual(["reading a file", "plan.md"]);
  });

  // A bare "ran a verb" says nothing among a thousand verbs, so the line names which one.
  it("names the verb a verb call runs, from its nested request", () => {
    const line = start({ rawArguments: '{"request":{"noun":"cmux","verb":"list","args":[]}}', tool: "verb" });
    expect([line.doing, line.subject]).toEqual(["running a read", "slopweaver cmux list"]);
  });

  it("names no subject for a verb call whose request names no verb", () => {
    const line = start({ rawArguments: '{"request":{"noun":"cmux"}}', tool: "verb" });
    expect([line.doing, line.subject]).toEqual(["running a read", undefined]);
  });

  it("names the stage switch the voice is flipping", () => {
    const line = start({ rawArguments: '{"setting":"previews","state":"off"}', tool: "set_stage_setting" });
    expect([line.doing, line.subject]).toEqual(["changing your call settings", "previews"]);
  });

  it("says the voice is noting a meeting off for the owner, naming no subject from a list of meetings", () => {
    const rawArguments = '{"meetings":[{"calendarId":"primary","eventId":"retro_1","title":"Fixture team retro"}]}';
    const line = start({ rawArguments, tool: "meeting_skip" });
    expect([line.doing, line.subject]).toEqual(["noting that meeting is off for you", undefined]);
  });

  it("names the open Queue card's title and the decision it needs while it reads the page or relays", () => {
    const pageShows = { open: { problem: "merge now or wait for review", subject: "the stage card" } };
    expect(start({ pageShows, tool: "read_page" })).toEqual({
      after: "h1",
      decision: "merge now or wait for review",
      doing: "reading the page",
      picture: undefined,
      subject: "the stage card",
      token: "t1",
      tool: "read_page",
    });
    expect(start({ pageShows, tool: "relay_steer" }).subject).toBe("the stage card");
  });

  it("falls back to the card's question when it states no problem", () => {
    const pageShows = { open: { question: "which look?", subject: "orb looks" } };
    expect(start({ pageShows, tool: "read_page" }).decision).toBe("which look?");
  });

  it("skips an empty problem for the question, and names no decision when both are empty", () => {
    const blankProblem = { open: { problem: "", question: "which option?", subject: "Card A" } };
    expect(start({ pageShows: blankProblem, tool: "read_page" }).decision).toBe("which option?");
    const blank = { open: { problem: "", question: "", subject: "Card A" } };
    expect(start({ pageShows: blank, tool: "read_page" }).decision).toBeUndefined();
  });

  it("treats a whitespace-only field as empty", () => {
    const spaces = { open: { problem: "   ", question: "which option?", subject: "Card A" } };
    expect(start({ pageShows: spaces, tool: "read_page" }).decision).toBe("which option?");
    const blankSubject = { open: { problem: "merge?", subject: "  " } };
    expect(start({ pageShows: blankSubject, tool: "read_page" })).toMatchObject({
      decision: "merge?",
      subject: undefined,
    });
  });

  it("names what the owner's share is of while it looks at their screen", () => {
    expect(start({ screen: "your entire screen", tool: "read_screen" })).toMatchObject({
      doing: "looking at your screen",
      subject: "your entire screen",
    });
  });

  it("names the desktop app's own whole-screen look the same way, with no share behind it", () => {
    expect(start({ screen: "the owner's whole screen", tool: "read_screen" })).toMatchObject({
      doing: "looking at your screen",
      subject: "the owner's whole screen",
    });
    expect(start({ tool: "read_screen" }).subject).toBeUndefined();
  });

  it("says a message is going on the running list without naming the message or its label", () => {
    const rawArguments = JSON.stringify({ label: "reply to Ari", text: "*on it*" });
    expect([
      start({ rawArguments, tool: "offer_copy" }).doing,
      start({ rawArguments, tool: "offer_copy" }).subject,
    ]).toEqual(["putting a message on your running list", undefined]);
  });

  it("names nothing for malformed arguments, a page with no open card, or an unknown tool", () => {
    expect(start({ rawArguments: "not json", tool: "file_read" }).subject).toBeUndefined();
    expect(start({ pageShows: { rows: [] }, tool: "read_page" }).subject).toBeUndefined();
    expect([start({ tool: "mystery" }).doing, start({ tool: "mystery" }).subject]).toEqual([
      "running mystery",
      undefined,
    ]);
  });

  it("never says 'checking', the word the owner tired of", () => {
    const tools = ["action_items", "knowledge", "read_page", "read_screen", "relay_steer", "verb", "code_find"];
    expect(tools.filter((tool) => start({ tool }).doing.includes("check"))).toEqual([]);
  });
});

describe("consultationShows", () => {
  const line = start({ tool: "read_screen" });

  it("shows through the voice's answer about it", () => {
    expect(consultationShows({ consultation: line, segments: [HIM_1, VOICE_1] })).toBe(true);
  });

  it("goes the moment the owner starts a new stretch of speech", () => {
    expect(consultationShows({ consultation: line, segments: [HIM_1, VOICE_1, HIM_2] })).toBe(false);
  });

  it("shows nothing before the first tool", () => {
    expect(consultationShows({ consultation: undefined, segments: [HIM_1] })).toBe(false);
  });
});

describe("consultationAnswered and pictureOf", () => {
  const line = start({ tool: "read_screen" });
  const image = [
    { type: "input_text", text: "frame" },
    { type: "input_image", image_url: PNG },
  ];

  it("carries the picture its own answer handed the model", () => {
    expect(consultationAnswered({ consultation: line, image, token: "t1" })?.picture).toBe(PNG);
  });

  it("leaves a newer line alone when an older call answers", () => {
    expect(consultationAnswered({ consultation: line, image, token: "t0" })).toBe(line);
  });

  it("leaves the line as it is for a text-only answer or one that is not a data image", () => {
    expect(consultationAnswered({ consultation: line, image: undefined, token: "t1" })).toBe(line);
    expect(pictureOf({ image: [{ type: "input_image", image_url: "https://example.com/x.png" }] })).toBeUndefined();
  });
});
