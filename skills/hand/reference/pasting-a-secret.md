# Pasting a secret into the console

Onboarding has the owner paste secrets into the UI instead of working out which commands to run. The console has two
inputs, the one conversation field and this secret field, and the secret field shows a receipt naming the key, never
the value.

## How a step gets the field

Post the step with the provider page as `--url` and the store commands as `--literal`, one name per line:

```bash
slopweaver hand post --id secops-oauth-client --row <slug> --blocks \
  --what "Create the SecOps Desktop OAuth client, then paste its client ID and secret into the fields" \
  --url "https://console.cloud.google.com/apis/credentials?project=<id>" \
  --literal $'slopweaver secrets set google-secops-client-id\nslopweaver secrets set google-secops-client-secret' \
  --where "the fields on this card" --unblocks "<what waits>" \
  --witness "slopweaver secrets status shows google-secops-client-id and google-secops-client-secret stored"
```

`hand list --json` publishes each settable name the step stores as `secrets` (`src/hand/secretName.ts`,
`pasteableSecrets`, re-read against the registry at list time). The queue card draws one password field per name,
and when every line of the literal is a covered `secrets set` it draws **no copy block** — the field replaces the
command (`site/lib/handCardTexts.ts`, `pasteFieldsCoverLiteral`). A literal doing anything else as well keeps its copy
block whole. The floating note has no field, so it still carries the literal: the terminal is the fallback, never
the path.

## What the field does, and what it never does

The value goes from the field to `POST /api/secret` (`site/app/api/secret/route.ts`), behind the same
same-origin, loopback, JSON guard every console write takes, and from there to `slopweaver secrets set <name>
--stdin --json` **on the child's stdin** — never its argv, which `ps` shows every process on the machine. The verb's
own allowlist decides whether the name may be written; the route checks only that the name is shaped like one, so no
flag or path reaches the argv (`site/lib/secretPaste.ts`). The response carries the name and the path, never the
value; the field clears itself on every outcome, stored or refused.

The receipt reads `set <name>` from the press, and after a reload `<name> is stored · written <when>` from a live
read of `secrets status --json`, which prints no value. A store not yet read says so, never "not set".

**The voice cannot reach it.** `site/lib/talkToolsList.ts` has no tool for it, so a model that reads third-party text
holds no path to a credential write.

## Residue, stated

- **Any process already running as the owner can call the route**, with the same headers the page sends — the residue
  every console write carries (`site/lib/consolePress.ts`). It is a local write door, not an authenticated one.
- **A password manager may still offer to save the value.** The field asks the common ones not to
  (`data-1p-ignore`, `data-lpignore`, `data-bwignore`, `autoComplete="off"`), and that is all a page can do.
