/**
 * The stage schemas a `browser shot` capture record carries — the raw capture, the readiness observation the shutter
 * fired on, the crop, the annotations and the prominence measurement — plus the digest and artifact spellings every
 * capture receipt shares. Split out of `./captureRecord.ts`, which composes them into the version-1 record and the
 * `browser shot` arm of the version-2 receipt.
 *
 * Every export is `@internal`: parsed only as part of a capture record.
 */
import { z } from "zod";

import { pixelRectSchema } from "./frameText.js";

/** @internal — a `sha256:` digest, as every capture document spells one. */
export const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** @internal — one artifact's identity: its digest and pixel size. */
export const artifactSchema = z
  .object({ digest: digestSchema, heightPx: z.number().int().positive(), widthPx: z.number().int().positive() })
  .strict();

const cssRectSchema = z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() }).strict();

const visibilitySchema = z.enum(["visible", "clipped", "occluded"]);

const contextSchema = z
  .object({ rect: cssRectSchema, text: z.string(), visibility: visibilitySchema })
  .strict()
  .nullable();

const observationSchema = z
  .object({
    chart: z
      .object({
        canvasCount: z.number().int().min(0),
        inkError: z.string().nullable(),
        inkSamples: z.number().int().min(0),
        rect: cssRectSchema.nullable(),
        sampledPixels: z.number().int().min(0),
        visibility: visibilitySchema.nullable(),
      })
      .strict(),
    document: z.object({ height: z.number(), width: z.number() }).strict(),
    networkQuietMs: z.number(),
    observedAtMs: z.number(),
    progressIndicators: z.number().int().min(0),
    query: contextSchema,
    scroll: z.object({ x: z.number(), y: z.number() }).strict(),
    smallestFontPx: z.number().positive().nullable(),
    summary: z
      .object({
        groups: z.number().int().min(0),
        logs: z.number().int().min(0),
        rect: cssRectSchema,
        text: z.string(),
        visibility: visibilitySchema,
      })
      .strict()
      .nullable(),
    targetMatches: z.number().int().min(0),
    targetRect: cssRectSchema.nullable(),
    timeRange: contextSchema,
    viewport: z.object({ height: z.number(), width: z.number() }).strict(),
  })
  .strict();

/** @internal — a highlight box or the caption band drawn into a capture. */
export const annotationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("highlight"), rect: pixelRectSchema, strokePx: z.number().int().positive() }).strict(),
  z
    .object({
      bandHeightPx: z.number().int().positive(),
      kind: z.literal("caption"),
      lines: z.array(z.string()).readonly(),
    })
    .strict(),
]);

/** @internal — the prominence measurement on the final bytes. */
export const legibilitySchema = z
  .object({
    featurePx: z.number().positive().nullable(),
    issues: z.array(z.string()).readonly(),
    policyVersion: z.number().int().positive(),
    profile: z.string().min(1),
    projectedPx: z.number().nullable(),
  })
  .strict();

/** @internal — the crop stage: the rectangle cut and the cropped identity. */
export const cropStageSchema = z
  .object({
    artifact: artifactSchema,
    panelInkRowFraction: z.number().min(0).max(1),
    rect: pixelRectSchema,
    regions: z.array(z.object({ name: z.string().min(1), rect: cssRectSchema }).strict()).readonly(),
    scale: z.number().positive(),
  })
  .strict();

/** @internal — the raw capture's identity and geometry. */
export const rawStageSchema = z
  .object({
    artifact: artifactSchema,
    geometry: z
      .object({
        devicePixelRatio: z.number(),
        documentHeight: z.number(),
        documentWidth: z.number(),
        viewportHeight: z.number(),
        viewportWidth: z.number(),
      })
      .strict(),
    path: z.string().min(1),
  })
  .strict();

/** @internal — the readiness observation the shutter fired on. */
export const readinessStageSchema = z
  .object({
    after: observationSchema,
    elapsedMs: z.number(),
    observation: observationSchema,
    polls: z.number().int().positive(),
  })
  .strict();

/** @internal — which evidence adapter and target the capture framed. */
export const targetSchema = z
  .object({
    adapterId: z.union([z.literal("datadog-logs-v1"), z.literal("datadog-apm-traces-v1")]),
    targetId: z.literal("timeseries"),
  })
  .strict();
