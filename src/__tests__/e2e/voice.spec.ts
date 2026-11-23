/**
 * The voice window places a call, goes live, draws what the voice says and hangs up, over a fake call backend
 * (`./fixtures/fakeVoiceBackend.ts`) and Chromium's fake microphone. The page, its WebRTC negotiation and its event
 * folding are the shipped ones; nothing past the page is.
 */
import { FAKE_ASSISTANT_TURN_ID, installFakeVoiceBackend } from "./fixtures/fakeVoiceBackend.js";
import { expect, LIVE_READ_TIMEOUT_MS, test } from "./fixtures/test.js";

/** A line no seeded page carries, so finding it proves this call drew it. */
const LINE = "The loopback voice is live.";

test("the voice window connects, shows speech, and hangs up", async ({ context, page }) => {
  const fake = await installFakeVoiceBackend({ context, page });
  try {
    await page.goto("/voice");
    const talk = page.getByRole("button", { exact: true, name: "talk" });
    await expect(talk).toBeEnabled({ timeout: LIVE_READ_TIMEOUT_MS });
    await expect(page.getByText("no call up")).toBeVisible();
    // Hanging up returns to this same idle UI, so what marks it as before the call is that no offer was made yet.
    expect(fake.observations().offers).toEqual([]);

    await talk.click();
    const hangUp = page.getByRole("button", { exact: true, name: "hang up" });
    await expect(page.getByText("minting the session")).toBeVisible();
    await expect(hangUp).toBeVisible();
    await expect.poll(() => fake.observations().offers).toEqual([{ instance: "e2e", mode: "fresh" }]);

    fake.releaseOffer();
    const mute = page.getByRole("button", { exact: true, name: "mute" });
    await expect(mute).toBeVisible({ timeout: LIVE_READ_TIMEOUT_MS });
    await expect(talk).toHaveCount(0);

    await fake.sendAssistantTranscript({ text: LINE });
    // A live row is keyed by the page's own call and the turn (`shownSegmentOf`, `site/lib/voiceTranscript.ts`), so the
    // turn is matched as the key's tail.
    const row = page
      .getByRole("list", { name: "what was said" })
      .locator(`[data-row^="live:"][data-row$=":${FAKE_ASSISTANT_TURN_ID}"]`);
    await expect(row).toContainText(LINE);
    await expect(row).toHaveAttribute("data-who", "voice");
    await expect(row).toHaveAttribute("data-final", "true");

    await hangUp.click();
    await expect(page.getByText("no call up")).toBeVisible();
    await expect(talk).toBeEnabled();
    await expect(mute).toHaveCount(0);
    await expect.poll(() => fake.observations().stopRequests).toBe(1);
    // The voice's line reached the transcript sink as the page wrote it, not only some request.
    await expect
      .poll(() => fake.observations().transcriptLines.some((line) => JSON.stringify(line).includes(LINE)))
      .toBe(true);
    expect(fake.observations().unexpected).toEqual([]);
  } finally {
    await fake.dispose();
  }
});
