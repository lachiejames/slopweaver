# The measurements — importing, reading and restoring them

The files a proof, a bake-off or a screenshot left under `bakeoff/`, `datadog-shots/`, `evidence/` and
`proof/` of the home, held in `measurement_blob` + `measurement_location` and, for a body a text column
cannot hold, the Supabase Storage bucket `measurements`. Why each shape is what it is:
[docs/store/fleet-state-and-measurements.md § "The measurements"](../../../docs/store/fleet-state-and-measurements.md#the-measurements).

## The Storage API comes off the running stack

Nothing to select: the gateway's URL and the Storage key are read off the running local stack with
`docker inspect` each time a body needs Storage, and stored nowhere. A stopped stack, a gateway published
beyond loopback, or a Storage container with no `SERVICE_KEY` setting each refuses with its own code and says
what to do.

## Import

```bash
slopweaver store import-fleet --only measurements --dry-run   # counts, opens no connection
slopweaver store import-fleet --only measurements             # objects first, then rows in one transaction
```

Append-only and re-runnable: a second pass over an unchanged home reports `0 written`. A file it cannot read
is named in the report and the verb exits non-zero.

## Read

```bash
slopweaver store measurement-list [--class proof] [--prefix proof/1263] [--json]
slopweaver store measurement-show --ref ~/.slopweaver/evidence/<file>.md          # text to stdout
slopweaver store measurement-show --ref evidence/<shot>.png --out /tmp/shot.png  # Storage body, byte-exact
slopweaver store measurement-show --ref <64-hex sha256>                          # a body by its hash
slopweaver store measurement-restore --into <dir> [--class c] [--prefix p] [--dry-run]
```

`list` exits 3 when nothing matches. `show` of a path with more than one stored body prints the newest and
says how many there are; "newest" is the latest import that saw the path change, never the latest mtime.
`restore` writes the newest body of each path with its recorded mtime, skips an identical file, and never
replaces one whose bytes differ — each write is an exclusive create inside `--into`, so a file that lands
mid-restore or a case-folded twin is left alone too — it names it and exits 1. Every one of them reads
the store only, so a store with nothing for a ref says so and names the import rather than falling back to
disk.

## The proof, reproducible

Against a throwaway database, so the live store is never migrated ahead of the merge:

```bash
docker exec supabase_db_slopweaver createdb -U postgres measurement_proof
export SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/measurement_proof
SLOPWEAVER_ALLOW_UNLANDED_MIGRATION=1 slopweaver store push
slopweaver store import-fleet --only measurements && slopweaver store import-fleet --only measurements
R=$(mktemp -d) && slopweaver store measurement-restore --into "$R"
for d in bakeoff datadog-shots evidence proof; do diff -rq -x .DS_Store ~/.slopweaver/$d "$R/$d"; done
```

The only lines that diff may print are `Only in` for a directory holding no file, which a store of files
has no row for — count them with `find bakeoff datadog-shots evidence proof -type d -empty | wc -l` in the
home.
