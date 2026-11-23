/*
 * The first half of the spread-vocabulary family's case table, aether through gemini-ai-studio, in the order the
 * coverage case asserts. `spreadCases.ts` spreads it ahead of the rest.
 */
import { openAetherGap } from "../../../../atlas/aether/gaps.js";
import { AETHER_GAP_CONDITIONS, AETHER_SURFACES } from "../../../../atlas/aether/model.js";
import { AIRTABLE_GAP_CONDITIONS, openAirtableGap, reconcileAirtableGaps } from "../../../../atlas/airtable/gaps.js";
import { BRAZE_GAP_CONDITIONS, openBrazeGap, reconcileBrazeGaps } from "../../../../atlas/braze/gaps.js";
import { CLERK_GAP_CONDITIONS, openClerkGap, reconcileClerkGaps } from "../../../../atlas/clerk/gaps.js";
import { FIGMA_GAP_CONDITIONS, openFigmaGap, reconcileFigmaGaps } from "../../../../atlas/figma/gaps.js";
import {
  GEMINI_AI_STUDIO_GAP_CONDITIONS,
  openGeminiAiStudioGap,
  reconcileGeminiAiStudioGaps,
} from "../../../../atlas/geminiAiStudio/gaps.js";
import { reconcileGaps } from "../../../../atlas/kit/gaps.js";
import { AT, FIELDS, openThenResolve, REASON, SCOPE, type SpreadCase, SURFACES } from "./harness.js";

export const SPREAD_CASES_A_TO_G: readonly SpreadCase[] = [
  {
    carried: { fields: FIELDS, surfaces: AETHER_SURFACES },
    condition: AETHER_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openAetherGap({
        at,
        condition: AETHER_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: AETHER_SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: AETHER_GAP_CONDITIONS[0],
        gap: openAetherGap({
          at: AT,
          condition: AETHER_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: AETHER_SURFACES,
        }),
        reconcile: reconcileGaps,
      }),
    platform: "aether",
    vocabulary: AETHER_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: AIRTABLE_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openAirtableGap({
        at,
        condition: AIRTABLE_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: AIRTABLE_GAP_CONDITIONS[0],
        gap: openAirtableGap({
          at: AT,
          condition: AIRTABLE_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileAirtableGaps,
      }),
    platform: "airtable",
    vocabulary: AIRTABLE_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: BRAZE_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openBrazeGap({
        at,
        condition: BRAZE_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: BRAZE_GAP_CONDITIONS[0],
        gap: openBrazeGap({
          at: AT,
          condition: BRAZE_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileBrazeGaps,
      }),
    platform: "braze",
    vocabulary: BRAZE_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: CLERK_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openClerkGap({
        at,
        condition: CLERK_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: CLERK_GAP_CONDITIONS[0],
        gap: openClerkGap({
          at: AT,
          condition: CLERK_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileClerkGaps,
      }),
    platform: "clerk",
    vocabulary: CLERK_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: FIGMA_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openFigmaGap({
        at,
        condition: FIGMA_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: FIGMA_GAP_CONDITIONS[0],
        gap: openFigmaGap({
          at: AT,
          condition: FIGMA_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileFigmaGaps,
      }),
    platform: "figma",
    vocabulary: FIGMA_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: GEMINI_AI_STUDIO_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openGeminiAiStudioGap({
        at,
        condition: GEMINI_AI_STUDIO_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: GEMINI_AI_STUDIO_GAP_CONDITIONS[0],
        gap: openGeminiAiStudioGap({
          at: AT,
          condition: GEMINI_AI_STUDIO_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileGeminiAiStudioGaps,
      }),
    platform: "gemini-ai-studio",
    vocabulary: GEMINI_AI_STUDIO_GAP_CONDITIONS,
  },
];
