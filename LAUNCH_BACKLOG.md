# Launch Backlog — cookbook-backend + frontend

Working backlog from the pre-MVP infra/cost and compliance review (2026-07-25).
Unlike `ISSUES.md` (resolved code-review findings), this file tracks **open**
items to do before/around the first production release. Check items off and
move resolved ones to `ISSUES.md`-style notes if useful, or just delete the
line once done.

---

## 1. Infra decision (not yet made)

- [ ] Pick a deployment scenario and commit to it:
  - **A — Bootstrap (free):** Oracle Cloud Always Free ARM VM, `sa-saopaulo-1` region.
    Everything (Postgres, Meilisearch, backend, Next.js) in one docker-compose,
    same pattern as `docker/docker-compose.yml`. ~R$0–5/mo (domain only).
    Risk: free-tier capacity availability is inconsistent, no SLA, ARM (arm64)
    images required.
  - **B — Cheap & real (recommended):** Brazil-region VPS (e.g. Hostinger KVM 2,
    São Paulo DC), same all-in-one docker-compose. ~R$45–100/mo. Budget for the
    renewal price, not the promo price (renewals commonly run 140–232% higher).
  - **C — Lean production:** Frontend on Vercel Pro ($20/mo, required for
    commercial use — Hobby plan is non-commercial only), backend+DB+search on a
    small VPS. ~R$130–165/mo.
- [ ] Whichever is picked: the backend runs on a real VM, **never a home PC**
      (dynamic IPs, ISP ToS, no uptime guarantee, exposes home network).
- [ ] **Postgres and Meilisearch are separate decisions, not one.** The
      scenarios above describe an all-in-one docker-compose; the database is an
      independent axis on top of that, because the two components have opposite
      risk profiles:
  - **Meilisearch → self-host, in the container.** It is a read index only
    (CLAUDE.md: "Postgres is the source of truth"), fully rebuildable with
    `npm run meili:reindex`. It needs no backup story at all, which is exactly
    why paying for Meili Cloud would be the wrong money.
  - **Postgres → managed (recommended): Neon Launch, `aws-sa-east-1`.** It is the
    *only* component in the stack whose loss is unrecoverable — R2 and Clerk are
    external, the app is in git, Meili rebuilds. Self-hosting it on the app VM
    puts it in the same failure domain as everything else. Managed buys the
    backups + PITR that section 2 otherwise makes a recurring discipline.
    **Cost: US$5–20/mo depending on how much the DB stays awake** (see §1a for
    the derivation — an earlier draft of this file said "≈US$5/mo", which was the
    optimistic end and is corrected here). At ~R$5.4/USD that is R$27–110, i.e.
    potentially doubling the VPS line — a real budget item, not noise.
  - Self-hosting Postgres stays defensible while pre-launch (no real user data),
    if the bill matters more than the ops burden, or if keeping all data on one
    controlled box simplifies the LGPD processor list in section 3. If so, the
    tested restore below is the whole bet — do not let it slip.
  - Full provider comparison and the reasoning behind picking Neon: **§1a below.**
- [ ] **If managed Postgres is picked, three concrete follow-ups:**
  - `prisma/schema.prisma` needs `directUrl` alongside `url` — runtime uses the
    pooled connection string, `prisma migrate deploy` needs the direct one. The
    `command:` in `docker/docker-compose.yml` runs `migrate deploy` on boot, so
    it needs the direct URL in its env too.
  - **Do not launch on Neon Free.** Its history retention is **6 hours**, which
    does not deliver the durability that justified going managed in the first
    place. Free is right for pre-launch/staging; move to **Launch** (7-day PITR)
    when real users arrive.
  - Tune the **autosuspend delay** rather than leaving the 5-min default
    unexamined — it trades compute bill against a cold start on the first
    request after idle, which at low traffic is the morning's first visitor.
    Separately, expect low single-digit ms per query cross-provider within São
    Paulo, which multiplies by round trips (`listRecipes` → `attachSavedState`
    is ~3 sequential queries).
- [ ] Migrating later is cheap and this is **not a one-way door**: Prisma means
      `DATABASE_URL` is the only seam, so switching is one env var plus a
      dump/restore.
- [ ] Decide the Cloudflare R2 bucket exposure model: public-read bucket behind
      a custom (sub)domain vs. proxied through the backend. Pick one
      deliberately (needed either way for recipe images to be viewable).

## 1a. Managed Postgres — provider research (2026-08-29)

Research behind the "Postgres → managed, Neon" line above. Prices are as
surveyed on 2026-08-29 and move; re-check before committing.

### Step 1 — the São Paulo requirement eliminates most of the market

The app VM is Brazil-region in every scenario, and the read paths issue several
sequential queries per request, so a US-region database is not viable.

| Provider | São Paulo? | Verdict |
|---|---|---|
| Neon | ✅ `aws-sa-east-1` (GA Feb 2025) | Shortlist |
| Supabase | ✅ `sa-east-1` | Shortlist |
| Magalu Cloud | ✅ Brazil regions, BRL billing | Shortlist |
| AWS RDS | ✅ `sa-east-1` | Baseline |
| Vultr | ✅ São Paulo | Weak value (~3× instance price) |
| Aiven | ❌ free tier is NA/EU/APAC only | Out |
| DigitalOcean | ❌ no Brazil DC | Out |
| Prisma Postgres | ❌ only us/eu/ap regions | Out (despite being a Prisma shop) |
| Railway | ❌ own metal, no SP region | Out |

### Step 2 — compare on durability, since that is the only reason to pay

| Option | Cost/mo | Durability actually delivered |
|---|---|---|
| Neon Free | $0 | **6-hour** history retention, 1 manual snapshot, 0.5 GB |
| **Neon Launch** | **~$5–20** | **7-day PITR**, +$0.20/GB-mo history. No monthly minimum |
| Supabase Free | $0 | **No automatic backups**; self-dump via CLI. Pauses after ~1wk idle |
| Supabase Pro | $25 | Daily backups, 7-day retention. **PITR is a +$100/mo add-on** |
| Magalu BV1-4-10 | R$94 | Automated snapshots. 1 vCPU / 4 GB |
| AWS RDS t4g.micro | ~$20+ | Automated backups. 12-mo free tier, then full price |
| Self-host + `pg_dump`→R2 | R$0 | Daily granularity, we own the restore |

**The decisive finding:** Supabase Pro at $25/mo buys *daily backups* — the same
granularity as a `pg_dump` cron we can write for free. Real PITR there costs more
than the entire infra budget. Its value is the auth/storage/realtime bundle, and
we already have Clerk + R2, so it would be $25 for the one piece available
cheaper elsewhere. Among managed options **only Neon makes PITR affordable at
this scale**, which is what narrows the recommendation from "managed" to "Neon".

### Step 3 — the cost derivation

Neon Launch is $0.106/CU-hour at a 0.25 CU floor, with scale-to-zero after 5 min
idle, plus $0.35/GB-month storage and no monthly minimum. A public site wakes the
DB on each visitor, so:

- sporadic traffic, ~12h/day awake → ~$10/mo
- effectively always warm → 730h × 0.25 CU × $0.106 ≈ **$19/mo** + storage

Hence the $5–20/mo range, not the flat $5 an earlier draft claimed.

**Magalu** is worth remembering but not now: R$94/mo minimum exceeds the whole VPS
budget. Its pitch is BRL billing and a domestic processor — no LGPD Art. 33
international-transfer note for the database (see section 3). Revisit if the
compliance surface becomes a priority.

### Sources

- [Neon regions](https://neon.com/docs/introduction/regions) · [Neon pricing](https://neon.com/pricing) · [Neon cost breakdown](https://selfhost.dev/blog/neon-pricing-cost-of-serverless-postgres/)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups) · [Supabase regions](https://supabase.com/docs/guides/platform/regions)
- [Magalu DBaaS pricing](https://magalu.cloud/precos/dbaas/) · [Aiven PG free tier](https://aiven.io/docs/products/postgresql/concepts/pg-free-tier) · [Prisma Postgres regions](https://www.prisma.io/docs/management-api/endpoints/regions/get-regions)

## 2. Must-do before real users (independent of which scenario is picked)

- [ ] **Backups** — scope depends on the Postgres decision in section 1:
  - *Managed Postgres:* mostly handled (daily backups + PITR come with the
    plan). Still **test a restore at least once** so the runbook is known, and
    confirm the retention window on the tier actually chosen.
  - *Self-hosted Postgres:* automate `pg_dump` → R2 (or the VPS provider's
    snapshot feature) on a cron, **test a restore at least once**, and verify
    the dump lands offsite — a backup on the same VM does not survive the
    failure it exists for.
  - Either way, Meilisearch needs no backup: rebuild with `npm run meili:reindex`.
- [ ] **Secrets hygiene** — confirm prod `CLERK_SECRET_KEY`, R2 keys, DB
      password, and `MEILISEARCH_API_KEY` are not dev/default values (no
      `masterkey`), and `NODE_ENV=production` is actually set (disables the
      `x-dev-user-sub` bypass).
- [ ] **TLS + CORS lockdown** — Let's Encrypt via Caddy/Nginx, or Cloudflare
      proxy in front of the VM. Set `ALLOWED_ORIGINS` to the real prod
      frontend domain(s) only — do not ship with `ALLOWED_ORIGINS=*` (see
      `ISSUES.md` ISSUE-16, still open).
- [ ] **`trust proxy` value** — verify it matches actual prod topology (e.g.
      Cloudflare + own Nginx = 2 hops, not the current `1`), or rate limiting
      keys off the wrong IP.
- [ ] **Error monitoring** — wire up Sentry free tier (5k events/mo, 1 user)
      before launch, not after the first incident.
- [ ] **Log persistence** — pino currently logs to stdout only; add file +
      logrotate on the VM, or a free log-drain tier (Better Stack/Axiom),
      so logs survive a container restart.
- [ ] **Uptime monitoring** — free UptimeRobot/Better Uptime check against
      `GET /health`.
- [ ] **Use `prisma migrate deploy`** (not `migrate dev`) for the production
      rollout.
- [ ] **Finish `.env.example`** — already flagged as pending in CLAUDE.md's
      Milestone 6 checklist.

## 3. LGPD — legal/compliance basics

- [ ] Write **Política de Privacidade** and **Termos de Uso** pages (frontend),
      based on ANPD's own published guidance (see sources below), covering:
  - What personal data is collected (email, displayName, username, bio,
    avatar, recipe/review photos, Clerk auth ID, request logs).
  - Purpose + legal basis per category (profile data → execução de contrato;
    security logs → legítimo interesse; any future marketing → consentimento).
  - Retention period, and note the existing cascade-delete-on-`user.deleted`
    webhook behavior (already compliant with the deletion right — mention it).
  - Third parties/processors: Clerk, Cloudflare R2, hosting provider — plus a
    short international-transfer note (LGPD Art. 33), since these are foreign
    companies.
  - Data subject rights (Art. 18) and a real contact channel to exercise them.
  - Contact for privacy questions (self-designated *encarregado* is fine at
    this scale — no formal DPO hire required).
  - A line stating the service isn't directed at minors (e.g. 18+), to avoid
    the heavier Art. 14 obligations around children's data.
- [ ] Add a **required checkbox at signup** ("Li e concordo com os Termos de
      Uso e a Política de Privacidade") — blocks submit until checked. This is
      a **one-time gate at account creation**, not a re-auth screen on every
      login.
- [ ] Add a migration + field on `User` to record acceptance:
      `privacyPolicyAcceptedAt` (or similar) + policy version, set during
      `POST /users/me`.
- [ ] Add persistent footer links to both documents on every page.
- [ ] Only re-prompt users when the policy **materially** changes (non-blocking
      banner, not a forced re-accept flow) — track a policy version to know
      who accepted which version.
- [ ] **Cookie banner: not needed yet.** Clerk's session/auth cookies are
      "strictly necessary" and don't require consent. Only add a banner if/when
      non-essential cookies are introduced (Google Analytics, ads/retargeting,
      embedded social widgets).

## 4. Fine to defer past first release

- [ ] Integration test suite (unit coverage is already solid — 200+ tests
      passing; see CLAUDE.md Milestone 6, still pending).
- [ ] ~~Managed Postgres w/ point-in-time recovery (e.g. Neon)~~ — **moved up to
      section 1.** Reassessed: this is not a scale question but a
      data-durability one, and Postgres is the one component nothing else can
      regenerate. Deferring it means owning backups and a tested restore from
      day one instead.
- [ ] Meilisearch Cloud — self-hosting is fine until query volume/ops burden
      says otherwise. Unlike Postgres, this genuinely *is* deferrable: the index
      is rebuildable from Postgres, so the downside of self-hosting is a
      reindex, not data loss.
- [ ] Vercel Pro / edge CDN for the frontend — only worth it once traffic or
      SEO needs justify the cost.
- [ ] Autoscaling, load balancers, multi-instance deploys.
- [ ] CI/CD pipeline (GitHub Actions is free at this scale) — worth adding
      early, but not launch-blocking.

---

## Sources (LGPD guidance)

- [ANPD — Aviso de Privacidade](https://www.gov.br/anpd/pt-br/acesso-a-informacao/aviso-de-privacidade)
- [ANPD guia sobre cookies — Machado Meyer](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/anpd-divulga-novo-guia-com-orientacoes-sobre-cookies)
- [ANPD Guia Orientativo das Hipóteses Legais de Tratamento — Rolim Goulart Cardoso](https://www.rolim.com/conteudo/privacidade-e-protecao-de-dados-anpd-divulga-guia-orientativo-das-hipoteses-legais-de-tratamento-legitimo-interesse/)
- [LGPD Artigo 9 — LGPD Brasil](https://lgpd-brasil.info/capitulo_02/artigo_09)
