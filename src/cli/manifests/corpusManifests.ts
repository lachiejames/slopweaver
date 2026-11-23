/**
 * The local world model's nouns of the noun barrel: ingest and derivation (`refresh`, `seed`, `derive`, `distil`,
 * `identity`, `compact`, `slice`, `subset`), the store and what reads it (`store`, `audit`, `profile`, `org`,
 * `memory`, `reflect`), and the document verbs over its output (`pdf`, `policy`, `spend`).
 *
 * `./index.ts` spreads this array into `MANIFEST_MODULES`. A new noun of this family appends ONE row here; a
 * family file nearing the 300-code-line cap splits again rather than growing past it.
 */

import type { NounManifestModule } from "../manifest.js";
import { auditManifest } from "./audit.js";
import { compactManifest } from "./compact.js";
import { deriveManifest } from "./derive.js";
import { distilManifest } from "./distil.js";
import { identityManifest } from "./identity.js";
import { memoryManifest } from "./memory.js";
import { orgManifest } from "./org.js";
import { pdfManifest } from "./pdf.js";
import { policyManifest } from "./policy.js";
import { profileManifest } from "./profile.js";
import { reflectManifest } from "./reflect.js";
import { refreshManifest } from "./refresh.js";
import { seedManifest } from "./seed.js";
import { sliceManifest } from "./slice.js";
import { spendManifest } from "./spend.js";
import { storeManifest } from "./store.js";
import { subsetManifest } from "./subset.js";

/** The local world model's nouns, each one `{ noun, summary, verbs }` row. */
export const CORPUS_MANIFEST_MODULES: readonly NounManifestModule[] = [
  {
    noun: "refresh",
    summary: "Ingest recent GitHub activity into the local bronze corpus",
    verbs: refreshManifest,
  },
  {
    noun: "seed",
    summary: "Seed the local corpus with a synthetic, identifier-free demo dataset (offline fast loop)",
    verbs: seedManifest,
  },
  {
    noun: "derive",
    summary: "Derive deterministic silver (directory + graph + opportunities) from the corpus",
    verbs: deriveManifest,
  },
  {
    noun: "distil",
    summary: "Distil the corpus into gold (LLM map-reduce; caches per batch)",
    verbs: distilManifest,
  },
  {
    noun: "identity",
    summary: "Resolve the same human across GitHub/Slack/Linear/Notion into one canonical person",
    verbs: identityManifest,
  },
  {
    noun: "org",
    summary: "The organisation this install works for, written once in the store and read through one refusing read",
    verbs: orgManifest,
  },
  {
    noun: "compact",
    summary: "Compact bronze: merge each source's overlapping window files into one deduped canonical file",
    verbs: compactManifest,
  },
  {
    noun: "policy",
    summary:
      "Render a Vanta policy or evidence markdown file to a verified PDF, and draw a change as an HTML review page",
    verbs: policyManifest,
  },
  {
    noun: "audit",
    summary:
      "Read-only quality + cost snapshot of the local world model, and the zero-references proof over main as a zip (no network, no tokens)",
    verbs: auditManifest,
  },
  {
    noun: "pdf",
    summary: "Read a PDF a provider's door already put on disk — its text and its page count, never OCR",
    verbs: pdfManifest,
  },
  {
    noun: "spend",
    summary:
      "The company AI card's spend from a page the owner pasted — monthly headroom, declines, and each registered merchant's charges",
    verbs: spendManifest,
  },
  {
    noun: "slice",
    summary: "Pin a subset of a source and prove nothing was lost between the disk and a model prompt",
    verbs: sliceManifest,
  },
  {
    noun: "subset",
    summary:
      "Slice the last N days of the real corpus into a home of its own, so the whole pipeline re-runs in minutes",
    verbs: subsetManifest,
  },
  {
    noun: "memory",
    summary: "Check a Claude Code auto-memory corpus for routing, schema, link and placement defects",
    verbs: memoryManifest,
  },
  {
    noun: "profile",
    summary:
      "What the world model knows about its owner and about the people they work with — the global owner row, the per-person judgement column on the identity register, the measured length register, and the always-loaded context a session start injects",
    verbs: profileManifest,
  },
  {
    noun: "store",
    summary:
      "The typed query layer over the local Supabase store — list, filter, facets, retrieve-detail, and a bounded bronze ingest",
    verbs: storeManifest,
  },
  {
    noun: "reflect",
    summary: "The self-improvement loop's readers over how this system behaved — which tool calls actually failed",
    verbs: reflectManifest,
  },
];
