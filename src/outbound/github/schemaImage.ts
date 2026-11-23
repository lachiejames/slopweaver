/**
 * The pull-request form's link and picture schemas: an https URL, and an image with an optional display width.
 * Split out of `./schema.ts`, which builds every cell and section on them.
 */
import { z } from "zod";
import { strictForm } from "../strictForm.js";
import { LINE_BREAK, lineText } from "./schemaText.js";
import type { ImageRun } from "./types.js";

/** An https URL on one line. Refused otherwise: a link on a public pull request should not be plaintext http. */
export const HTTPS = z
  .url()
  .refine((u) => u.startsWith("https://"), "must be an https URL")
  .refine((u) => !LINE_BREAK.test(u), "a url renders inside one line, so a line break in it would break the line");

/** The bounds of an image display width, in pixels — see {@link displayWidthSchema}. */
const DISPLAY_WIDTH = { max: 2048, min: 64 } as const;

/**
 * An image display width: a whole number of pixels from 64 to 2048. These bounds are this form's own default,
 * not an owner ruling: 64 refuses an accidental zero or thumbnail, and 2048 still admits a full-resolution
 * high-density screenshot (a measured paste was 1512 wide) without admitting a meaningless size.
 */
const displayWidthSchema = z
  .number()
  .int("an image width is a whole number of pixels")
  .min(DISPLAY_WIDTH.min, `an image width is at least ${String(DISPLAY_WIDTH.min)} pixels`)
  .max(DISPLAY_WIDTH.max, `an image width is at most ${String(DISPLAY_WIDTH.max)} pixels`);

/** An image, wherever one may sit: an evidence run, a Proof item's picture, a (refused) note block. */
export const imageSchema = strictForm({
  alt: lineText({ what: "image alt text" }),
  kind: z.literal("image"),
  url: HTTPS,
  width: displayWidthSchema.optional(),
}) satisfies z.ZodType<ImageRun>;
