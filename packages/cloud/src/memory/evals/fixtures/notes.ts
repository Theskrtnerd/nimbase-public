// Curated company-KB fixture for the retrieval eval: a fictional B2B SaaS,
// "Cadence" (subscription revenue analytics). Shaped like a real Nimbase
// workspace — decisions, specs, meeting notes, engineering runbooks, a couple of
// markdown datasets, and a RESTRICTED board subtree (restricted/board/*) used by the
// scope-leak test. Content is keyword-distinct so relevance judgments in
// queries.ts are unambiguous. `content` is the note BODY only — the seed adds
// the title into frontmatter through the same write path production uses.

export interface FixtureNote {
  path: string;
  title: string;
  kind: "note" | "dataset";
  // Marks the node (and thus its restricted/board subtree) restricted after seed,
  // for fidelity with a real permission anchor. Access in the eval is enforced
  // by the ProviderAccessContext path scopes (SQL-side), same as production.
  restricted?: boolean;
  content: string;
}

export const FIXTURE_NOTES: FixtureNote[] = [
  // ---- company ----
  {
    path: "company/mission.md",
    title: "Cadence mission and vision",
    kind: "note",
    content:
      "Cadence helps subscription businesses understand and grow recurring revenue. " +
      "Our mission is to make MRR, churn, and expansion legible to every operator. " +
      "The long-term vision is an autonomous revenue copilot that flags risk before renewal.",
  },
  {
    path: "company/values.md",
    title: "Company values",
    kind: "note",
    content:
      "Our five values: customer obsession, default to transparency, bias for action, " +
      "written-first communication, and durable trust. We write decisions down and " +
      "share context widely so people can act autonomously.",
  },
  {
    path: "company/org-structure.md",
    title: "Org structure and teams",
    kind: "note",
    content:
      "Cadence has four departments: Engineering, Product, Go-To-Market, and Operations. " +
      "Engineering splits into Platform, Ingestion, and Frontend squads. The GTM org " +
      "covers Sales, Marketing, and Customer Success.",
  },

  // ---- engineering ----
  {
    path: "eng/architecture-overview.md",
    title: "Platform architecture overview",
    kind: "note",
    content:
      "The Cadence platform is a Next.js frontend, a Node API tier, and a Postgres " +
      "primary database with a pgvector store for semantic search. Event ingestion " +
      "runs through a Kafka pipeline into a columnar warehouse for analytics rollups.",
  },
  {
    path: "eng/billing-stripe-integration.md",
    title: "Stripe billing integration",
    kind: "note",
    content:
      "We bill through Stripe. Subscriptions map to Stripe prices; usage overages are " +
      "reported as metered usage records. Failed charges are retried with exponential " +
      "backoff over five days (dunning) before the account is marked past due.",
  },
  {
    path: "eng/dunning-and-retries.md",
    title: "Dunning and payment retry policy",
    kind: "note",
    content:
      "When a renewal charge fails, the dunning worker retries on days 1, 3, 5, and 7. " +
      "Each retry sends a templated email. After the final failed attempt the " +
      "subscription is suspended and the account owner is notified.",
  },
  {
    path: "eng/oncall-runbook.md",
    title: "On-call runbook",
    kind: "note",
    content:
      "The on-call engineer owns PagerDuty alerts around the clock for one week. " +
      "For a database CPU alert, first check slow queries in the Postgres dashboard, " +
      "then fail over to the read replica if the primary is saturated. Escalate to the " +
      "platform lead after fifteen minutes.",
  },
  {
    path: "eng/incident-response.md",
    title: "Incident response process",
    kind: "note",
    content:
      "Declare an incident in the #incidents channel with a severity from SEV1 to SEV3. " +
      "Assign an incident commander who coordinates responders and writes the timeline. " +
      "Every SEV1 and SEV2 requires a blameless postmortem within three business days.",
  },
  {
    path: "eng/security-and-compliance.md",
    title: "Security and SOC 2 compliance",
    kind: "note",
    content:
      "Cadence is SOC 2 Type II certified. All data is encrypted at rest with AES-256 " +
      "and in transit with TLS 1.3. Access to production requires SSO plus hardware MFA. " +
      "We run quarterly access reviews and an annual third-party penetration test.",
  },
  {
    path: "eng/data-retention-policy.md",
    title: "Data retention and deletion",
    kind: "note",
    content:
      "Customer event data is retained for 24 months, then aggregated and the raw rows " +
      "deleted. On account cancellation we purge personal data within 30 days per our " +
      "DPA. Backups roll off after 35 days.",
  },
  {
    path: "eng/api-rate-limits.md",
    title: "Public API rate limits",
    kind: "note",
    content:
      "The public REST API allows 600 requests per minute per token by default. Bursts " +
      "up to 100 requests per second are permitted. Exceeding the limit returns HTTP 429 " +
      "with a Retry-After header. Enterprise plans can request a higher ceiling.",
  },
  {
    path: "eng/embeddings-and-search.md",
    title: "Semantic search and embeddings",
    kind: "note",
    content:
      "Search fuses a pgvector cosine-similarity leg with a Postgres full-text leg using " +
      "reciprocal rank fusion. Documents are chunked on headings and embedded with a " +
      "1536-dimension model. The HNSW index keeps nearest-neighbour lookups fast.",
  },
  {
    path: "eng/deployment-pipeline.md",
    title: "CI/CD and deployment pipeline",
    kind: "note",
    content:
      "Every pull request runs typecheck, lint, and the test suite in CI. Merges to main " +
      "deploy automatically to staging; production promotion is a manual approval. We use " +
      "trunk-based development with short-lived feature branches.",
  },

  // ---- product ----
  {
    path: "product/roadmap-h2.md",
    title: "H2 product roadmap",
    kind: "note",
    content:
      "H2 themes are the revenue copilot beta, self-serve onboarding, and a redesigned " +
      "cohort-retention report. The copilot ships behind a flag in Q3 and goes GA in Q4. " +
      "Self-serve onboarding targets a five-minute time-to-first-insight.",
  },
  {
    path: "product/spec-churn-alerts.md",
    title: "Spec: churn risk alerts",
    kind: "note",
    content:
      "Churn risk alerts score each account weekly on usage decline, support tickets, and " +
      "failed payments. Accounts above the risk threshold surface to the CSM with a " +
      "recommended play. The score model is retrained monthly on closed-won and churned cohorts.",
  },
  {
    path: "product/spec-cohort-retention.md",
    title: "Spec: cohort retention report",
    kind: "note",
    content:
      "The cohort retention report groups customers by signup month and plots logo and " +
      "revenue retention over 12 months. Users can pivot by plan tier and acquisition " +
      "channel. Net revenue retention is the headline metric.",
  },
  {
    path: "product/analytics-metrics-glossary.md",
    title: "Metrics glossary",
    kind: "note",
    content:
      "MRR is monthly recurring revenue. NRR (net revenue retention) includes expansion " +
      "and contraction. Logo churn counts lost accounts; revenue churn counts lost dollars. " +
      "ARPA is average revenue per account. CAC payback is months to recover acquisition cost.",
  },

  // ---- go-to-market ----
  {
    path: "sales/pricing-and-packaging.md",
    title: "Pricing and packaging",
    kind: "note",
    content:
      "Cadence has three plans: Starter at 99 dollars per month, Growth at 499, and " +
      "Enterprise with custom pricing. Plans are priced on tracked recurring revenue " +
      "volume. Annual contracts get two months free.",
  },
  {
    path: "sales/sales-playbook.md",
    title: "Sales playbook and discovery",
    kind: "note",
    content:
      "In discovery, qualify on the prospect's current MRR, their churn pain, and who owns " +
      "the renewal number. Lead with the churn-alerts demo for at-risk-revenue buyers. " +
      "The economic buyer is usually the VP of Finance or the Head of RevOps.",
  },
  {
    path: "sales/onboarding-checklist.md",
    title: "Customer onboarding checklist",
    kind: "note",
    content:
      "New customer onboarding: send the welcome email, schedule a kickoff call within " +
      "48 hours, connect their Stripe and warehouse data sources, and confirm the first " +
      "MRR dashboard renders correctly. Assign a dedicated CSM for Growth and Enterprise.",
  },
  {
    path: "sales/competitor-landscape.md",
    title: "Competitive landscape",
    kind: "note",
    content:
      "Our main competitors are ChartMogul, Baremetrics, and in-house BI stacks. We win on " +
      "the churn copilot and native warehouse sync. We lose deals where the buyer only " +
      "needs a simple MRR chart and picks the cheapest tool.",
  },
  {
    path: "marketing/brand-voice.md",
    title: "Brand voice and tone",
    kind: "note",
    content:
      "Cadence's voice is precise, calm, and operator-to-operator. We avoid hype and vague " +
      "adjectives. Prefer concrete numbers and customer outcomes. Never promise a metric we " +
      "cannot measure.",
  },

  // ---- people / ops ----
  {
    path: "people/employee-handbook.md",
    title: "Employee handbook",
    kind: "note",
    content:
      "Cadence is remote-first across North America and Europe. Core collaboration hours " +
      "are 9am to noon Pacific. We default to asynchronous, written communication and keep " +
      "meetings small and agenda-driven.",
  },
  {
    path: "people/pto-policy.md",
    title: "PTO and leave policy",
    kind: "note",
    content:
      "We offer unlimited paid time off with a four-week minimum expectation per year. " +
      "Parental leave is 16 weeks fully paid. Request PTO in the HR tool at least two weeks " +
      "ahead for anything longer than three days.",
  },
  {
    path: "people/benefits-overview.md",
    title: "Benefits overview",
    kind: "note",
    content:
      "Benefits include full medical, dental, and vision coverage, a 401k with a four " +
      "percent match, a home-office stipend, and an annual learning budget of 1500 dollars. " +
      "Equity is granted as ISOs with a four-year vest and a one-year cliff.",
  },
  {
    path: "people/expense-policy.md",
    title: "Expense and reimbursement policy",
    kind: "note",
    content:
      "Submit expenses in Ramp within 30 days. Software under 50 dollars per month needs no " +
      "approval; anything larger needs your manager's sign-off. Travel is booked economy and " +
      "reimbursed at receipt.",
  },

  // ---- decisions (ADRs) ----
  {
    path: "decisions/adr-001-postgres-over-mongo.md",
    title: "ADR-001: Postgres over MongoDB",
    kind: "note",
    content:
      "We chose Postgres as the primary datastore over MongoDB. Relational integrity, mature " +
      "tooling, and pgvector for embeddings outweighed MongoDB's flexible schema. Accepted.",
  },
  {
    path: "decisions/adr-002-kafka-ingestion.md",
    title: "ADR-002: Kafka for event ingestion",
    kind: "note",
    content:
      "We adopted Kafka for the event ingestion pipeline over a direct database write path. " +
      "Kafka gives us durable buffering, replay, and backpressure during traffic spikes. " +
      "The tradeoff is added operational complexity. Accepted.",
  },
  {
    path: "decisions/adr-003-rrf-hybrid-search.md",
    title: "ADR-003: Reciprocal rank fusion for search",
    kind: "note",
    content:
      "We fuse vector and keyword retrieval with reciprocal rank fusion rather than a " +
      "weighted score blend. RRF is robust to score-scale differences between the two legs " +
      "and needs no per-query tuning. Accepted.",
  },
  {
    path: "decisions/adr-004-remote-first.md",
    title: "ADR-004: Remote-first operating model",
    kind: "note",
    content:
      "Cadence will operate remote-first rather than open a headquarters. This widens the " +
      "hiring pool and lowers fixed cost, at the cost of deliberate investment in written " +
      "culture and periodic in-person offsites. Accepted.",
  },

  // ---- meetings ----
  {
    path: "meetings/2026-06-15-eng-weekly.md",
    title: "Engineering weekly 2026-06-15",
    kind: "note",
    content:
      "Discussed the pgvector migration rollout and the dunning worker flakiness. Action: " +
      "add retry jitter to the dunning worker; owner is Priya. The HNSW index backfill " +
      "completes this week. No blockers on the copilot beta.",
  },
  {
    path: "meetings/2026-06-22-gtm-sync.md",
    title: "GTM sync 2026-06-22",
    kind: "note",
    content:
      "Pipeline review: three Enterprise deals in late stage, all citing churn alerts as the " +
      "wedge. Marketing to publish the NRR benchmark report. Action: refresh the competitor " +
      "battlecard against Baremetrics.",
  },
  {
    path: "meetings/2026-06-29-product-review.md",
    title: "Product review 2026-06-29",
    kind: "note",
    content:
      "Reviewed the cohort retention report designs. Decision: net revenue retention is the " +
      "headline metric on the report. Self-serve onboarding moves to Q4. The copilot beta " +
      "opens to ten design partners next week.",
  },

  // ---- datasets (OKF markdown concepts, type: Dataset via kind) ----
  {
    path: "data/pricing-plans.md",
    title: "Pricing plans dataset",
    kind: "dataset",
    content:
      "Cadence subscription plans with monthly price and included tracked revenue volume.\n\n" +
      "| Plan | Monthly USD | Tracked revenue cap USD |\n" +
      "|---|---|---|\n" +
      "| Starter | 99 | 500000 |\n" +
      "| Growth | 499 | 5000000 |\n" +
      "| Enterprise | custom | custom |\n",
  },
  {
    path: "data/support-sla-tiers.md",
    title: "Support SLA tiers dataset",
    kind: "dataset",
    content:
      "Customer support response-time SLA by plan tier, in business hours.\n\n" +
      "| Plan | First response (h) | Channels |\n" +
      "|---|---|---|\n" +
      "| Starter | 24 | email |\n" +
      "| Growth | 8 | email and chat |\n" +
      "| Enterprise | 2 | email, chat, and phone |\n",
  },

  // ---- RESTRICTED: board-only subtree (scope-leak test target) ----
  {
    path: "restricted/board/q2-financials.md",
    title: "Board: Q2 financial summary",
    kind: "note",
    restricted: true,
    content:
      "Confidential board material. Q2 ended at 4.2 million dollars ARR, up 38 percent " +
      "year over year. Gross margin was 82 percent. Net revenue retention was 118 percent. " +
      "Cash runway is 26 months at the current burn.",
  },
  {
    path: "restricted/board/fundraise-plan.md",
    title: "Board: Series B fundraise plan",
    kind: "note",
    restricted: true,
    content:
      "Confidential. We plan to raise a 30 million dollar Series B in Q4 at a target " +
      "valuation of 300 million. Lead candidates are three growth funds. Use of proceeds is " +
      "GTM expansion and the copilot R&D team.",
  },
  {
    path: "restricted/board/exec-comp.md",
    title: "Board: executive compensation",
    kind: "note",
    restricted: true,
    content:
      "Confidential board compensation review. Proposed executive salary bands and the " +
      "annual equity refresh grants for the leadership team, pending compensation committee " +
      "approval at the next board meeting.",
  },
];
