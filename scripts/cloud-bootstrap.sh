#!/usr/bin/env bash
# One-time hosted Supabase bootstrap (run after the personal org invoices are settled).
# Requires: supabase CLI login, pnpm, psql. Creates the project, links, pushes
# migrations, applies the synthetic seed (NOT local-users.sql), and invites the admin.
set -euo pipefail
ORG_ID="${ORG_ID:-knqarurgnmzdtrpbieph}"      # personal org
REGION="${REGION:-ap-southeast-1}"
NAME="${NAME:-tile-concept}"
ADMIN_EMAIL="${ADMIN_EMAIL:-m.nadeemramli@gmail.com}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)}"

echo ">> creating project $NAME in org $ORG_ID ($REGION)"
OUT=$(pnpm exec supabase projects create "$NAME" --org-id "$ORG_ID" --region "$REGION" --db-password "$DB_PASSWORD" -o json)
REF=$(echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.id||j.ref||j.project_ref)})')
echo ">> project ref: $REF"
echo ">> DB password (store in your password manager, shown once): $DB_PASSWORD"

echo ">> waiting for project to become healthy"
until pnpm exec supabase projects list -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.id===process.argv[1]||x.ref===process.argv[1]);process.exit(p&&p.status==="ACTIVE_HEALTHY"?0:1)})' "$REF"; do sleep 10; done

echo ">> linking"
pnpm exec supabase link --project-ref "$REF" -p "$DB_PASSWORD"
echo ">> pushing migrations"
pnpm exec supabase db push -p "$DB_PASSWORD"
echo ">> seeding synthetic data"
psql "postgresql://postgres:${DB_PASSWORD}@db.${REF}.supabase.co:5432/postgres" -v ON_ERROR_STOP=1 -f supabase/seed.sql
echo ">> regenerating types from linked project"
pnpm db:types:linked

echo ">> keys"
pnpm exec supabase projects api-keys --project-ref "$REF"
echo
echo
echo "IMPORTANT: in the Supabase dashboard set Settings -> API -> Exposed schemas to 'api'"
echo "(remove 'public'); the app queries the api schema only."
echo
echo "Next: set Vercel env vars (NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co, publishable + secret keys),"
echo "set Auth → URL configuration (site URL + redirect https://<vercel-domain>/auth/**), then:"
echo "  SUPABASE_URL=https://${REF}.supabase.co SUPABASE_SECRET_KEY=<secret> APP_URL=https://<vercel-domain> pnpm exec tsx scripts/invite-user.ts $ADMIN_EMAIL"
