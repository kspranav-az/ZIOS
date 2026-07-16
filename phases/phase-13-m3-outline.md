# Phase 13 — M3 Outline: Ecosystem

**Status:** ⬜ Deferred — re-plan after M2 · **PRD refs:** §2.2 (M3), Blueprint §1.5, §21, §22.3

> Outline only — the flywheel milestone. Value depends entirely on trust and data earned in M1/M2; nothing here is started early.

## Shape of M3

- **Skills passport:** verifiable, scoped, candidate-owned interview credential with expiry and re-verification; verification API for job boards — candidate-initiated sharing only
- **Marketplace:** vetted human coaches/mocks on our rubric + recording (20–30% take rate)
- **Benchmarks:** cross-tenant, k-anonymized, differential-privacy-flavored aggregates only — never row-level data
- **ATS depth:** Zoho/Keka/Darwinbox/Greenhouse-class two-way integrations
- **Enterprise tier:** SSO/SCIM, multi-org, dedicated tenancy/cells, white-label
- **Flywheel:** passports begin substituting first-round screens — the ecosystem thesis (Blueprint §1.5) closes

## Hard rules carried forward

- Consent wall is the keystone: passport is the *only* cross-product data path; benchmarks are aggregate-only (Blueprint §16.4)
- No selling candidate data, no selling enterprise outcome data, no ads (Blueprint §21.4)
- Bias-audit artifacts ship before passport scale (regulators will look here first)

## Pre-conditions to start

- [ ] M2 shipped; Ascend readiness data exists at meaningful scale
- [ ] Legal review of passport consent + verification API in launch jurisdictions
- [ ] Detailed M3 phase files replace this outline

## Verification / Validation (outline-level)

- [ ] Consent-wall audit by external security/privacy reviewer before passport beta
- [ ] Benchmark store passes k-anonymity review; no query path returns row-level data
- [ ] Enterprise tenancy model (RLS → cell-per-tenant) load- and isolation-tested
