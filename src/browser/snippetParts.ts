/**
 * The two fragments every relay snippet opens and closes with: go there, and photograph it.
 *
 * Both were written out identically in `vantaPolicyEditorSnippet.ts` and `vantaPolicyVersionSnippet.ts`,
 * which is how the `duplicate-windows` gate found them. They are here rather than in either file because a
 * second copy of "navigate, and report a navigation failure as `failure`" is a second place for the
 * reporting contract to drift: every consumer of these snippets branches on that exact field name.
 *
 * Each takes its values and bakes them in as JSON literals, so a caller supplies data and never source.
 */

/**
 * Navigate to one address, report a failure the caller can recognise, and let the page settle.
 *
 * A navigation that throws returns `{ failure }` and nothing else, which is the shape every transport in
 * this directory already checks for first.
 *
 * @param url the address to open
 * @param settleMs how long to wait after load before anything is read
 * @returns the snippet fragment, ready to be interpolated into a snippet body
 * @internal
 */
export function gotoFragment({ url, settleMs }: { url: string; settleMs: number }): string {
  return `  try {
    await page.goto(${JSON.stringify(url)}, { timeout: 45000, waitUntil: "load" });
  } catch (error) {
    return JSON.stringify({ failure: String(error) });
  }
  await page.waitForTimeout(${JSON.stringify(settleMs)});`;
}

/**
 * Photograph the page, recording whether the picture landed rather than failing the run if it did not.
 *
 * A screenshot is evidence, never the operation, so a page that will not photograph still reports what it
 * did. The two variables it declares are read by every snippet that uses it.
 *
 * @param screenshotPath where the PNG is written
 * @returns the snippet fragment, declaring `screenshotWritten` and `screenshotError`
 * @internal
 */
export function photographFragment({ screenshotPath }: { screenshotPath: string }): string {
  return `  let screenshotWritten = false;
  let screenshotError = null;
  try {
    await page.bringToFront();
    await page.screenshot({ fullPage: true, path: ${JSON.stringify(screenshotPath)}, timeout: 8000 });
    screenshotWritten = true;
  } catch (error) {
    screenshotError = String(error);
  }`;
}
