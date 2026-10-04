# Deploying the pilot on Vercel

Two Vercel projects from the same GitHub repo (`MaknamCrest-Digital/FoodVendor`):

| Project | Root directory | What it is | Suggested URL |
|---|---|---|---|
| `maknam-api` | `services/api` | FastAPI (Vercel Function, auto-detected at `app/main.py`) | `https://maknam-api.vercel.app` |
| `maknam-pos` | `apps/pos` | Static PWA export (`out/`) | `https://maknam-pos.vercel.app` |

The schema migration and seed already ran against Supabase from a workstation;
Vercel does not run them. For future schema changes, run
`alembic upgrade head` locally with `MAKNAM_ENV_FILE=.env.pilot` **before**
deploying the API code that needs them.

Ready-to-paste environment files are generated locally (git-ignored, never
committed): `services/api/.env.vercel` and `apps/pos/.env.vercel`.

## 1. API project (`maknam-api`)

1. Vercel → **Add New… → Project** → import `MaknamCrest-Digital/FoodVendor`.
2. Project name `maknam-api`. **Root Directory: `services/api`**. Framework: FastAPI (auto).
3. **Environment Variables** → paste `services/api/.env.vercel` (Import .env):

   | Variable | Value |
   |---|---|
   | `ENVIRONMENT` | `pilot` |
   | `DATABASE_URL` | Supabase **transaction pooler**: `postgresql+psycopg://postgres.<ref>:<url-encoded-password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres` |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_JWT_AUDIENCE` | `authenticated` |
   | `CORS_ORIGINS` | `https://maknam-pos.vercel.app` (the exact frontend URL, no trailing slash) |

   Do **not** add `SUPABASE_SERVICE_ROLE_KEY` or `PILOT_*` passwords to Vercel.
4. Deploy, then open `https://maknam-api.vercel.app/health/db`. You should see
   `{"status":"ok","environment":"pilot","database":"connected"}`.

Why port 6543: Vercel functions are frozen between requests. The app sees `VERCEL=1`
and uses no client-side connection pool; Supabase's transaction pooler shares
connections safely, and prepared statements are disabled automatically.

## 2. Frontend project (`maknam-pos`)

1. **Add New… → Project** → same repo. Name `maknam-pos`. **Root Directory: `apps/pos`**.
   `apps/pos/vercel.json` sets the install/build commands, the `out` directory and the
   service-worker headers, so leave the framework settings as detected.
2. **Environment Variables** → paste `apps/pos/.env.vercel`:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://maknam-api.vercel.app/api/v1` |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable/anon key (never the service-role key) |

   The build fails on purpose if the API URL is localhost or not https, or if a
   secret key is put here.
3. Deploy and open `https://maknam-pos.vercel.app/login/`.

## 3. Connect the two

- If Vercel gave different domains than above, set the API's `CORS_ORIGINS` to the
  real frontend URL and the frontend's `NEXT_PUBLIC_API_URL` to the real API URL,
  then **Redeploy** both. Public variables are baked in at build time.
- Supabase dashboard → Authentication → **URL Configuration**: Site URL =
  `https://maknam-pos.vercel.app`; add `https://maknam-pos.vercel.app/**` to Redirect URLs.
- Optional: in each Vercel project → Settings → Git, enable skipping deployments
  when nothing changed in that root directory.

Preview deployments get their own URLs, which are not in `CORS_ORIGINS`. Test on
the production domains.

## 4. Verify

```powershell
curl https://maknam-api.vercel.app/health/db
cd services/api; $env:MAKNAM_ENV_FILE='.env.pilot'; .\.venv312\Scripts\python.exe scripts\verify_pilot.py
```

Then run the smoke test in [REMOTE_PILOT.md](REMOTE_PILOT.md): sign in as Cashier,
install, open shift, sell online, sell offline, reconnect, and confirm as Admin.

## Rollback

Vercel → project → Deployments → pick the previous deployment → **Promote**. Devices
keep their local sales and outbox through any API rollback and resync afterwards.
