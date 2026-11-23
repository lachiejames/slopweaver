/**
 * The per-provider sections of `profile.json` — Datadog, GitHub and Linear — each one install's own setup for a
 * provider it reaches. Split out of `./profile.ts`, which composes them into the whole schema; every message here keeps the
 * `profile.json <field>` shape that file's messages share.
 */
import { isAbsolute } from "node:path";

import { z } from "zod";

/** A metrics producer's name: what a `metrics-push` row and `datadog produce --producer` say. */
const PRODUCER_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** An environment variable name a producer's secret is handed to it under. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A secrets-store file name: lowercase words joined by hyphens, as every `$SLOPWEAVER_HOME/secrets/<name>` is. */
const SECRET_FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * One metrics producer this install declares: a command it runs, blocking and bounded, in a checkout of its
 * choosing, which prints one `{ "series": [...] }` document as its last stdout line (`datadog/metricsProducer.ts`).
 *
 * The command and the checkout are install state and an EXECUTABLE TRUST ROOT, so they live here and nowhere a
 * row or a flag can name them. `secrets` maps an environment variable name to a `$SLOPWEAVER_HOME/secrets/<name>`
 * file, and those are the only credentials the child receives (`datadog/metricsProducerRun.ts`'s environment).
 */
const metricsProducerSchema = z.object({
  checkout: z
    .string({ error: "profile.json datadog.metricsProducers.<name>.checkout must be a string" })
    .refine((value) => isAbsolute(value), {
      error: "profile.json datadog.metricsProducers.<name>.checkout must be an absolute path",
    }),
  command: z
    .array(z.string().min(1, "profile.json datadog.metricsProducers.<name>.command entries must be non-empty"), {
      error: "profile.json datadog.metricsProducers.<name>.command must be an array of strings",
    })
    .min(1, "profile.json datadog.metricsProducers.<name>.command must name at least the executable"),
  secrets: z
    .record(
      z.string(),
      z
        .string()
        .regex(SECRET_FILE_NAME, "profile.json datadog.metricsProducers.<name>.secrets values must be secret names"),
      { error: "profile.json datadog.metricsProducers.<name>.secrets must be an object" },
    )
    .refine((secrets) => Object.keys(secrets).every((key) => ENV_NAME.test(key)), {
      error: "profile.json datadog.metricsProducers.<name>.secrets keys must be environment variable names",
    })
    .default({}),
});

/** One declared metrics producer, parsed. */
export type MetricsProducerConfig = z.infer<typeof metricsProducerSchema>;

/**
 * This install's Datadog setup — per-install CONFIG, deliberately not a secret, so it sits here rather than in
 * `secrets/`. `site` is a raw string: `resolveSite` (`datadog/config.ts`) refuses an unknown one by name, where
 * validating it here would let one typo make the whole profile unreadable; absent until set, and refused rather
 * than defaulted, because a wrong site answers with silence. `metricsProducers` names the commands
 * `datadog produce` may run, keyed by producer name; empty by default, so nothing is runnable until declared.
 * `iacManagedTags` are the monitor tags that mark infrastructure-as-code ownership (`datadog/monitorWrite.ts`);
 * empty by default, which leaves that guard inert.
 */
export const datadogSchema = z.object({
  iacManagedTags: z
    .array(z.string().min(1, "profile.json datadog.iacManagedTags entries must be non-empty strings"), {
      error: "profile.json datadog.iacManagedTags must be an array of strings",
    })
    .default([]),
  metricsProducers: z
    .record(z.string(), metricsProducerSchema, { error: "profile.json datadog.metricsProducers must be an object" })
    .refine((producers) => Object.keys(producers).every((key) => PRODUCER_NAME.test(key)), {
      error: "profile.json datadog.metricsProducers keys must be lowercase producer names",
    })
    .default({}),
  site: z.string({ error: "profile.json datadog.site must be a string" }).optional(),
});

/** The title shapes an install may give one of its repositories: `ticketed` is `kind(TICKET): outcome`. */
export const REPOSITORY_TITLE_SHAPES = ["ticketed"] as const;

/** One of {@link REPOSITORY_TITLE_SHAPES}. */
export type RepositoryTitleShape = (typeof REPOSITORY_TITLE_SHAPES)[number];

/** A lowercase `owner/repo`, the one spelling a title-shape key is compared in. */
const LOWERCASE_SLUG = /^[a-z0-9-]+\/[a-z0-9._-]+$/;

/**
 * This install's GitHub conventions. `titleShapes` maps a lowercase `owner/repo` to the title shape its pull
 * requests take (`outbound/github/titleShape.ts`); empty by default, and a repository it does not name is not
 * judged, bar this build's own, whose shape the code owns. The key check is a refine rather than a key schema
 * because a record's own `error` replaces a key schema's message, which would report a bad key as a non-object.
 */
export const githubSchema = z.object({
  titleShapes: z
    .record(
      z.string(),
      z.enum(REPOSITORY_TITLE_SHAPES, { error: 'profile.json github.titleShapes values must be "ticketed"' }),
      { error: "profile.json github.titleShapes must be an object" },
    )
    .refine((shapes) => Object.keys(shapes).every((key) => LOWERCASE_SLUG.test(key)), {
      error: "profile.json github.titleShapes keys must be lowercase owner/repo",
    })
    .default({}),
});

/**
 * A team key exactly as the forbidden-team-key scan reads one (`hygiene/identifierPatternSpans.ts`, `[A-Z]+` before
 * the hyphen): uppercase letters alone. Linear also allows a digit after the first letter, but the scan never sees
 * such a key, so stating one would claim a forgiveness the door has no refusal for.
 */
const LINEAR_TEAM_KEY = /^[A-Z]+$/;

/**
 * This install's Linear conventions, STATED rather than read from Linear. `teamKeys` are the organisation's own team
 * keys, the ones a `ticketed` repository's titles carry (`kind(ABC-840): outcome`); the PR write door forgives them
 * on the installation's own repositories (`outbound/github/installationIdentifiersRead.ts`). Stated here so an
 * install that reaches Linear through no Slopweaver token and ingests none still names them; empty by default.
 */
export const linearSchema = z.object({
  teamKeys: z
    .array(
      z
        .string({ error: "profile.json linear.teamKeys entries must be strings" })
        .regex(LINEAR_TEAM_KEY, "profile.json linear.teamKeys entries must be uppercase letters alone"),
      { error: "profile.json linear.teamKeys must be an array" },
    )
    .refine((keys) => new Set(keys).size === keys.length, {
      error: "profile.json linear.teamKeys must not contain duplicates",
    })
    .default([]),
});
