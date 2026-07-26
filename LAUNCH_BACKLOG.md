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
- [ ] Whichever is picked: self-host Postgres + Meilisearch **on the same VM as
      the backend** (never a home PC — dynamic IPs, ISP ToS, no uptime
      guarantee, exposes home network).
- [ ] Decide the Cloudflare R2 bucket exposure model: public-read bucket behind
      a custom (sub)domain vs. proxied through the backend. Pick one
      deliberately (needed either way for recipe images to be viewable).

## 2. Must-do before real users (independent of which scenario is picked)

- [ ] **Backups** — automate `pg_dump` → R2 (or use VPS provider's snapshot
      feature) on a cron; **test a restore at least once**.
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
- [ ] Managed Postgres w/ point-in-time recovery (e.g. Neon) — self-hosted +
      tested backups is enough at MVP scale.
- [ ] Meilisearch Cloud — self-hosting is fine until query volume/ops burden
      says otherwise.
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
