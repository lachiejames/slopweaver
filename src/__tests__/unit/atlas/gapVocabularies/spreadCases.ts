/*
 * The spread-vocabulary family's whole case table, one row per platform: the aether-through-gemini-ai-studio
 * half first, then inngest through trelica, in the order the coverage case asserts.
 */
import { INNGEST_GAP_CONDITIONS, openInngestGap, reconcileInngestGaps } from "../../../../atlas/inngest/gaps.js";
import { KNOCK_GAP_CONDITIONS, openKnockGap, reconcileKnockGaps } from "../../../../atlas/knock/gaps.js";
import { NOTION_GAP_CONDITIONS, openNotionGap, reconcileNotionGaps } from "../../../../atlas/notion/gaps.js";
import {
  ONEPASSWORD_GAP_CONDITIONS,
  openOnepasswordGap,
  reconcileOnepasswordGaps,
} from "../../../../atlas/onepassword/gaps.js";
import {
  openPrismaGap,
  PRISMA_DATA_PLATFORM_GAP_CONDITIONS,
  reconcilePrismaGaps,
} from "../../../../atlas/prismaDataPlatform/gaps.js";
import { openTrelicaGap, reconcileTrelicaGaps, TRELICA_GAP_CONDITIONS } from "../../../../atlas/trelica/gaps.js";
import { AT, FIELDS, openThenResolve, REASON, SCOPE, type SpreadCase, SURFACES } from "./harness.js";
import { SPREAD_CASES_A_TO_G } from "./spreadCasesAToG.js";

export const SPREAD_CASES: readonly SpreadCase[] = [
  ...SPREAD_CASES_A_TO_G,
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: INNGEST_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openInngestGap({
        at,
        condition: INNGEST_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: INNGEST_GAP_CONDITIONS[0],
        gap: openInngestGap({
          at: AT,
          condition: INNGEST_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileInngestGaps,
      }),
    platform: "inngest",
    vocabulary: INNGEST_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: KNOCK_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openKnockGap({
        at,
        condition: KNOCK_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: KNOCK_GAP_CONDITIONS[0],
        gap: openKnockGap({
          at: AT,
          condition: KNOCK_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileKnockGaps,
      }),
    platform: "knock",
    vocabulary: KNOCK_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: NOTION_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openNotionGap({
        at,
        condition: NOTION_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: NOTION_GAP_CONDITIONS[0],
        gap: openNotionGap({
          at: AT,
          condition: NOTION_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileNotionGaps,
      }),
    platform: "notion",
    vocabulary: NOTION_GAP_CONDITIONS,
  },
  {
    carried: { channel: "browser" },
    condition: ONEPASSWORD_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openOnepasswordGap({
        at,
        channel: "browser",
        condition: ONEPASSWORD_GAP_CONDITIONS[0],
        kind: null,
        reason: REASON,
        scope: SCOPE,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: ONEPASSWORD_GAP_CONDITIONS[0],
        gap: openOnepasswordGap({
          at: AT,
          channel: null,
          condition: ONEPASSWORD_GAP_CONDITIONS[0],
          kind: null,
          reason: REASON,
          scope: SCOPE,
        }),
        reconcile: reconcileOnepasswordGaps,
      }),
    platform: "onepassword",
    vocabulary: ONEPASSWORD_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: PRISMA_DATA_PLATFORM_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openPrismaGap({
        at,
        condition: PRISMA_DATA_PLATFORM_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: PRISMA_DATA_PLATFORM_GAP_CONDITIONS[0],
        gap: openPrismaGap({
          at: AT,
          condition: PRISMA_DATA_PLATFORM_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcilePrismaGaps,
      }),
    platform: "prisma-data-platform",
    vocabulary: PRISMA_DATA_PLATFORM_GAP_CONDITIONS,
  },
  {
    carried: { fields: FIELDS, surfaces: SURFACES },
    condition: TRELICA_GAP_CONDITIONS[0],
    open: ({ at }) =>
      openTrelicaGap({
        at,
        condition: TRELICA_GAP_CONDITIONS[0],
        fields: FIELDS,
        kind: null,
        reason: REASON,
        scope: SCOPE,
        surfaces: SURFACES,
      }),
    openThenRecheck: () =>
      openThenResolve({
        condition: TRELICA_GAP_CONDITIONS[0],
        gap: openTrelicaGap({
          at: AT,
          condition: TRELICA_GAP_CONDITIONS[0],
          fields: FIELDS,
          kind: null,
          reason: REASON,
          scope: SCOPE,
          surfaces: SURFACES,
        }),
        reconcile: reconcileTrelicaGaps,
      }),
    platform: "trelica",
    vocabulary: TRELICA_GAP_CONDITIONS,
  },
];
