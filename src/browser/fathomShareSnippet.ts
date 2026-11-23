/**
 * The snippet that reads one Fathom SHARE page's raw transcript in the owner's own Chrome.
 *
 * ## Why a browser at all
 *
 * The owner's Fathom API key lists only the calls the owner recorded. A call somebody else recorded and shared
 * with them — a weekly Auditco session is one — exists for the owner only at `https://fathom.video/share/<token>`, and
 * that page is not public: MEASURED, an anonymous GET redirects to
 * `/users/sign_in?share_token=<token>`. The owner's Chrome is signed in, so the relay is the one reader that works.
 *
 * ## It clicks nothing
 *
 * MEASURED on the share page of an Auditco session: the page's `page-call-detail`
 * element carries the whole transcript as a property, `transcriptCues`, loaded while the page boots and
 * before any tab is chosen — the page opens on its Summary tab and the cues are already there. So this arm
 * is a navigation and a property read, the same capability `page-visit` has, and nothing on the page is
 * pressed: not the Transcript tab, not `Copy Summary`, not an action item's checkbox.
 *
 * Reading the property rather than the rendered bubbles is also what makes the speakers RIGHT. The rendered
 * transcript interleaves Fathom's ACTION ITEM blocks, and the speech under one carries no speaker label at
 * all — an earlier hand-read of these pages attributed that speech to whoever spoke before it, and on the
 * measured call that was the wrong person. Every cue in the property names its own speaker and offset.
 *
 * ## Provider-written text never leaves the page
 *
 * A cue group can hold a `note` — Fathom's own action item, written by its model — as an entry with no
 * speech of its own. The snippet drops those IN THE PAGE and returns only how many it dropped, so the
 * provider's text never reaches this process at all (owner ruling: a
 * Fathom or Gemini summary is lossy by nature and is never stored). The summary itself is a different
 * property this snippet does not read.
 */
import { gotoFragment } from "./snippetParts.js";

/**
 * How long the page's own boot is given to deliver the transcript before the read gives up.
 *
 * The cues arrive through the page's bootstrap queue rather than in the first paint; MEASURED
 * they were present at the first read after a 4 s settle. The bound is what a slow load is allowed on top of
 * that, polled rather than slept.
 *
 * @internal
 */
export const FATHOM_CUES_WAIT_MS = 20_000;

/** The fixed page-side function that reads the call and its cues. Runs inside `page.evaluate`. */
const READ_CALL = `() => {
  const host = document.querySelector("page-call-detail");
  if (!host) { return { present: false }; }
  const groups = Array.isArray(host.transcriptCues) ? host.transcriptCues : null;
  if (groups === null || groups.length === 0) { return { present: true, ready: false }; }
  const call = host.call || {};
  const cues = [];
  let droppedNotes = 0;
  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      if (entry && entry.note) { droppedNotes += 1; continue; }
      if (!entry || typeof entry.text !== "string" || entry.text.trim() === "") { continue; }
      cues.push({
        email: typeof entry.speaker_email === "string" ? entry.speaker_email : null,
        speaker: typeof entry.speaker_name === "string" ? entry.speaker_name : "",
        startSeconds: typeof entry.start_time === "number" ? entry.start_time : null,
        text: entry.text,
      });
    }
  }
  const attendees = [];
  const listed = host.attendeeMetadata && Array.isArray(host.attendeeMetadata.attendees) ? host.attendeeMetadata.attendees : [];
  for (const one of listed) {
    if (one && typeof one.name === "string") { attendees.push({ email: typeof one.email === "string" ? one.email : null, name: one.name }); }
  }
  return {
    present: true,
    ready: true,
    call: {
      durationMinutes: typeof call.duration_minutes === "number" ? call.duration_minutes : null,
      hostEmail: call.host && typeof call.host.email === "string" ? call.host.email : null,
      id: typeof call.id === "number" ? call.id : null,
      recordingStartedAt: call.recording && typeof call.recording.started_at === "string" ? call.recording.started_at : null,
      scheduledStartAt: typeof call.started_at === "string" ? call.started_at : null,
      title: typeof call.title === "string" ? call.title : null,
    },
    attendees,
    cues,
    droppedNotes,
  };
}`;

/**
 * Open one share page and read its call and raw transcript cues, clicking nothing.
 *
 * @param url the share page — `https://fathom.video/share/<token>`, validated by the caller
 * @param settleMs how long the page is given to paint before the first read
 * @returns the snippet source
 */
export function fathomShareTranscriptSnippet({ url, settleMs }: { url: string; settleMs: number }): string {
  return `async (page) => {
${gotoFragment({ settleMs, url })}
  const deadline = Date.now() + ${String(FATHOM_CUES_WAIT_MS)};
  let read = await page.evaluate(${READ_CALL}).catch((error) => ({ readError: String(error) }));
  while (read.ready !== true && read.readError === undefined && Date.now() < deadline) {
    await page.waitForTimeout(1000);
    read = await page.evaluate(${READ_CALL}).catch((error) => ({ readError: String(error) }));
  }
  return JSON.stringify({ finalUrl: page.url(), read, title: await page.title().catch(() => "") });
}`;
}
