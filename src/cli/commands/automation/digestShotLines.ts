/**
 * What a seated `datadog-alert-digest` row prints about its pictures, and which attachments it refuses.
 *
 * Split out of `./rowRunners.ts` along a real seam: that file answers "what does this ONE row do", and this
 * one answers "what do the captures a seated session hands back have to do with the card" — the capture
 * commands to run, the count against the card's firing views, and the attachments that picture a view the
 * card does not cite. Both read the capture records under the state home and nothing else.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../../../lib/errorMessage.js";
import { digestShotTargetsFromDocument, shotCaption, unboundCaptures } from "../../../live/automation/digestShots.js";
import { stateHomePaths } from "../../../stateHome.js";
import { capturedUrlOf } from "../../../visualEvidence/captureRecord.js";

/**
 * What a seated session is told about this card's pictures: how many it attached against how many the card
 * wants, the exact capture command for each, and every firing item that cannot have one.
 *
 * The count line is printed whether or not it matches, because a capture list and an attachment list that
 * silently differ is how a card ships two pictures for four firing probes and nobody notices.
 *
 * @param form the card document the read leg emitted
 * @param home the state home, which is where a capture is written
 * @param media what the caller attached
 * @param recipeId the row, so a line reads on its own in a tick's output
 * @returns the lines to print under the row's own outcome
 */
export function shotDetailLines({
  form,
  home,
  media,
  recipeId,
}: {
  form: string;
  home: string;
  media: readonly string[];
  recipeId: string;
}): readonly string[] {
  const plan = digestShotTargetsFromDocument({ document: form });
  if (plan.isErr()) {
    return [`recipe ${recipeId} · shots · the card could not be re-read for its targets: ${plan.error.message}`];
  }
  const { targets, unshootable } = plan.value;
  const header = `recipe ${recipeId} · shots · ${String(media.length)} image(s) attached for ${String(targets.length)} firing view(s)`;
  const commands = targets.map((target, index) => {
    const out = join(stateHomePaths({ home }).datadogShotsDir, `${recipeId}-${String(index + 1)}.png`);
    const caption = shotCaption({ target });
    return (
      `recipe ${recipeId} · shot ${String(index + 1)} · ${caption} · ` +
      `slopweaver browser shot --url '${target.url}' --caption '${caption}' --out ${out} --json`
    );
  });
  const refused = unshootable.map((line) => `recipe ${recipeId} · no shot · ${line}`);
  return [header, ...commands, ...refused];
}

/**
 * Every attached capture that does not picture a view THIS card cites, read from the capture records its
 * own bytes hash to.
 *
 * Found by the r1 review pass over this change's own diff: admission proves an image was recorded and read
 * back and says nothing about what it SHOWS, so a graded capture of another row's view would have ridden on
 * this card with only the count line to notice it. A refusal here is the card's own predicate.
 *
 * @param form the card document the read leg emitted
 * @param home the state home holding the image and capture records
 * @param media what the caller attached
 * @returns one line per attachment that may not ride on this card; empty when every one belongs to it
 */
export function unboundMediaLines({
  form,
  home,
  media,
}: {
  form: string;
  home: string;
  media: readonly string[];
}): readonly string[] {
  const plan = digestShotTargetsFromDocument({ document: form });
  if (plan.isErr()) {
    return [`the card could not be re-read for its targets, so no attachment can be bound to it`];
  }
  const attached = media.map((path) => {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(path);
    } catch (error: unknown) {
      return { capturedUrl: null, path: `${path} (unreadable: ${errorMessage({ error })})` };
    }
    const captured = capturedUrlOf({ bytes, home });
    if (captured.isErr()) {
      return { capturedUrl: null, path: `${path} (${captured.error.message})` };
    }
    return { capturedUrl: captured.value, path };
  });
  return unboundCaptures({ attached, targets: plan.value.targets });
}
