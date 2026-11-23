/**
 * `admit/liveWrite.ts` — does a shell line run a migration or write to a live system? Each WRITE row is a
 * command the bot turn must not run on a colleague's ask; each READ row is the investigation
 * that stays open, because reading and reporting is the lane the owner asked for.
 */
import { describe, expect, it } from "vitest";

import { classifyLiveWrite } from "../../../admit/liveWrite.js";

/** The finding without its located segment, which each row would otherwise restate. */
const findingOf = ({ command }: { command: string }): Record<string, string> => {
  const { segment: _segment, ...rest } = classifyLiveWrite({ command }) as Record<string, string>;
  return rest;
};

describe("classifyLiveWrite — migrations", () => {
  it.each([
    ["yarn prisma migrate deploy", "prisma", "migrate deploy"],
    ["npx prisma db push --accept-data-loss", "prisma", "db push"],
    ["alembic -c alembic.ini upgrade head", "alembic", "upgrade"],
    ["bundle exec rails db:migrate RAILS_ENV=production", "rails", "db:migrate"],
    ["rake db:rollback", "rake", "db:rollback"],
    ["python3 manage.py migrate --noinput", "python3", "manage.py migrate"],
    ["knex migrate:latest --env production", "knex", "migrate:latest"],
    ["npx sequelize-cli db:migrate:undo", "sequelize-cli", "db:migrate:undo"],
    ["drizzle-kit push", "drizzle-kit", "push"],
    ["supabase db push --linked", "supabase", "db push"],
    ["wrangler d1 migrations apply prod-db --remote", "wrangler", "migrations apply"],
    ["flyway -url=jdbc:postgresql://db/app migrate", "flyway", "migrate"],
    ['goose -dir migrations postgres "$DATABASE_URL" up', "goose", "up"],
    ["typeorm-ts-node-commonjs migration:run -d src/data-source.ts", "typeorm-ts-node-commonjs", "migration:run"],
  ])("%s is a migration (%s %s)", (command, tool, operation) => {
    expect(findingOf({ command })).toStrictEqual({ kind: "migration", operation, tool });
  });

  it.each([
    ["yarn migrate", "yarn", "script migrate"],
    ["pnpm run db:migrate:prod", "pnpm", "script db:migrate:prod"],
    ["make migrate-prod", "make", "script migrate-prod"],
  ])("%s runs a script named after a migration", (command, tool, operation) => {
    expect(findingOf({ command })).toStrictEqual({ kind: "migration", operation, tool });
  });

  it.each([
    "yarn prisma migrate status",
    "npx prisma migrate diff --from-schema-datamodel a --to-schema-datamodel b",
    "alembic history",
    "alembic current",
    "rails db:migrate:status",
    "yarn migrate:status",
    "yarn migration:generate add-users",
    "make migrate-check",
    "drizzle-kit generate",
    "python manage.py showmigrations",
    "python manage.py makemigrations --check",
  ])("%s only reads or authors a migration, so it stays open", (command) => {
    expect(classifyLiveWrite({ command })).toStrictEqual({ kind: "allowed" });
  });
});

describe("classifyLiveWrite — staging and production writes", () => {
  it.each([
    ["kubectl -n production rollout restart deploy/api", "kubectl", "rollout restart"],
    ["kubectl -n staging delete pod api-7d9", "kubectl", "delete pod"],
    ["kubectl exec -it api-7d9 -- sh", "kubectl", "exec api-7d9"],
    ["kubectl certificate approve csr-7d9", "kubectl", "certificate approve"],
    ["helm upgrade api ./chart -n prod", "helm", "upgrade api"],
    ["pulumi up --yes -s prod", "pulumi", "up"],
    ["bq rm -f -t project:dataset.table", "bq", "rm project:dataset.table"],
    ['psql "$PROD_URL" -c "COMMENT ON TABLE users IS \'production metadata change\'"', "psql", "a write statement"],
    ["terraform apply -auto-approve", "terraform", "apply"],
    ["tofu state rm aws_instance.api", "tofu", "state rm"],
    ["aws ecs update-service --cluster prod --service api --force-new-deployment", "aws", "ecs update-service"],
    ["aws --region ap-southeast-2 s3 rm s3://bucket/key", "aws", "s3 rm"],
    ["gcloud run deploy api --image gcr.io/p/api", "gcloud", "run deploy api"],
    ["gcloud sql instances restart prod-db", "gcloud", "sql instances restart"],
    // A resource NAMED like a read verb is not a read.
    ["az group create --name list --location australiaeast", "az", "group create"],
    ["gcloud compute instances create list --zone x", "gcloud", "compute instances create"],
    ["heroku config:set FLAG=1 -a api-prod", "heroku", "config:set"],
    ["fly secrets set KEY=v", "fly", "secrets set"],
    ["vercel --prod", "vercel", "--prod"],
    ["wrangler deploy", "wrangler", "deploy"],
    ['psql "$PROD_URL" -c "UPDATE users SET plan = \'pro\' WHERE id = 1"', "psql", "a write statement"],
    ['psql "$PROD_URL" -f fix.sql', "psql", "a SQL file"],
    ['psql "$PROD_URL" < fix.sql', "psql", "a SQL file"],
    ["mysql -h prod -e 'DELETE FROM jobs'", "mysql", "a write statement"],
    ["mongosh \"$URI\" --eval 'db.users.updateOne({a:1},{$set:{b:2}})'", "mongosh", "a write statement"],
  ])("%s writes (%s %s)", (command, tool, operation) => {
    expect(findingOf({ command })).toStrictEqual({ kind: "live-write", operation, tool });
  });

  it("reads a SQL write a heredoc feeds the client on stdin", () => {
    const command = "psql \"$PROD_URL\" <<'SQL'\nDELETE FROM sessions WHERE expired;\nSQL";

    expect(findingOf({ command })).toStrictEqual({
      kind: "live-write",
      operation: "a write statement on stdin",
      tool: "psql",
    });
  });

  it.each([
    "kubectl -n production get pods",
    "kubectl -n production logs deploy/api --tail 200",
    "kubectl describe pod api-7d9",
    "kubectl apply -f k8s/ --dry-run=client",
    "kubectl config use-context staging",
    "helm list -A",
    "helm repo update",
    "terraform plan",
    "terraform state list",
    "kubectl -n production rollout status deploy/api",
    "pulumi stack output -s prod",
    "bq query --nouse_legacy_sql 'SELECT 1'",
    'psql "$PROD_URL" -c "SELECT \'update\' AS operation"',
    "mysql -h prod -e \"SELECT 'can\\\\'t update' AS note\"",
    "aws ecs describe-services --cluster prod --services api",
    "aws s3 ls s3://bucket",
    "aws logs tail /ecs/api --since 1h",
    "aws --ca-bundle /etc/company-ca.pem --cli-read-timeout 30 ec2 describe-instances",
    "gcloud logging read 'severity>=ERROR' --limit 50",
    "gcloud config set project p",
    "psql \"$PROD_URL\" -c 'SELECT count(*) FROM jobs'",
    "psql \"$PROD_URL\" <<'SQL'\nSELECT 1;\nSQL",
    "wrangler d1 execute db --local --command 'DELETE FROM t'",
    "vercel --help",
  ])("%s only reads, so it stays open", (command) => {
    expect(classifyLiveWrite({ command })).toStrictEqual({ kind: "allowed" });
  });
});

describe("classifyLiveWrite — the walk", () => {
  it("names the segment that carries the write, past a read before it", () => {
    expect(classifyLiveWrite({ command: "kubectl get pods && kubectl delete pod api-7d9" })).toStrictEqual({
      kind: "live-write",
      operation: "delete pod",
      segment: "kubectl delete pod api-7d9",
      tool: "kubectl",
    });
  });

  it.each([
    ["bash -c 'yarn prisma migrate deploy'", "prisma"],
    ["sh <<'EOF'\nyarn prisma migrate deploy\nEOF", "prisma"],
    ["echo $(yarn prisma migrate deploy)", "prisma"],
    ["docker compose exec api yarn prisma migrate deploy", "prisma"],
    ["docker exec -e NODE_ENV=production api npx prisma migrate deploy", "prisma"],
    ["cross-env NODE_ENV=production prisma migrate deploy", "prisma"],
    ["dotenv -e .env.production -- prisma migrate deploy", "prisma"],
    ["env DATABASE_URL=x timeout 60 prisma migrate deploy", "prisma"],
    ["npx -c 'prisma migrate deploy'", "prisma"],
    ["yarn workspace @app/api prisma migrate deploy", "prisma"],
  ])("%s is seen through its wrapper", (command, tool) => {
    expect(findingOf({ command })).toStrictEqual({ kind: "migration", operation: "migrate deploy", tool });
  });

  it("leaves every slopweaver verb to its own door, migrate in its name or not", () => {
    expect(classifyLiveWrite({ command: "slopweaver store migrate --apply" })).toStrictEqual({ kind: "allowed" });
  });

  it("reads an empty line as allowed", () => {
    expect(classifyLiveWrite({ command: "" })).toStrictEqual({ kind: "allowed" });
  });
});
