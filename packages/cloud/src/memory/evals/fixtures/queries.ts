// The eval query set: natural-language queries paired with the node PATHS a good
// retriever should surface (relevance judgments). Paths are resolved to seeded
// node ids at eval time. Most queries have 1-2 relevant notes; wording overlaps
// the target vocabulary so the judgments hold for both the lexical stub embedder
// and (better) the real embed model.
//
// `context` selects the caller's access scope:
//   "admin"    — sees the whole workspace (default).
//   "no-board" — a reader scoped to everything EXCEPT restricted/board (the
//                restricted subtree). Used for the scope-leak cases: `forbidden`
//                paths must NEVER appear for such a caller.

export interface FixtureQuery {
  id: string;
  text: string;
  relevant: string[];
  context?: "admin" | "no-board";
  // Paths that MUST NOT appear in the results for this query/context (access
  // enforcement). Scored pass/fail independently of recall/MRR.
  forbidden?: string[];
}

export const FIXTURE_QUERIES: FixtureQuery[] = [
  // ---- engineering ----
  {
    id: "q-stripe-retry",
    text: "how are failed subscription payments retried",
    relevant: [
      "eng/dunning-and-retries.md",
      "eng/billing-stripe-integration.md",
    ],
  },
  {
    id: "q-dunning-schedule",
    text: "dunning retry schedule days after a failed renewal charge",
    relevant: ["eng/dunning-and-retries.md"],
  },
  {
    id: "q-oncall-db-alert",
    text: "what to do for a database CPU alert while on call",
    relevant: ["eng/oncall-runbook.md"],
  },
  {
    id: "q-incident-sev",
    text: "incident severity levels and postmortem process",
    relevant: ["eng/incident-response.md"],
  },
  {
    id: "q-soc2",
    text: "are we SOC 2 compliant and how is data encrypted",
    relevant: ["eng/security-and-compliance.md"],
  },
  {
    id: "q-retention",
    text: "how long is customer event data retained before deletion",
    relevant: ["eng/data-retention-policy.md"],
  },
  {
    id: "q-rate-limit",
    text: "public API rate limit requests per minute and 429 response",
    relevant: ["eng/api-rate-limits.md"],
  },
  {
    id: "q-search-arch",
    text: "how does semantic search with embeddings and rank fusion work",
    relevant: [
      "eng/embeddings-and-search.md",
      "decisions/adr-003-rrf-hybrid-search.md",
    ],
  },
  {
    id: "q-architecture",
    text: "overall platform architecture frontend api database pipeline",
    relevant: ["eng/architecture-overview.md"],
  },
  {
    id: "q-deploy",
    text: "how does deployment to production and staging work in CI",
    relevant: ["eng/deployment-pipeline.md"],
  },

  // ---- product ----
  {
    id: "q-roadmap",
    text: "what is on the H2 product roadmap and copilot timeline",
    relevant: ["product/roadmap-h2.md"],
  },
  {
    id: "q-churn-alerts",
    text: "how are churn risk alerts scored for accounts",
    relevant: ["product/spec-churn-alerts.md"],
  },
  {
    id: "q-cohort",
    text: "cohort retention report grouping by signup month",
    relevant: ["product/spec-cohort-retention.md"],
  },
  {
    id: "q-nrr-definition",
    text: "what does net revenue retention NRR mean",
    relevant: ["product/analytics-metrics-glossary.md"],
  },
  {
    id: "q-mrr-definition",
    text: "definition of MRR and ARPA metrics",
    relevant: ["product/analytics-metrics-glossary.md"],
  },

  // ---- go-to-market ----
  {
    id: "q-pricing",
    text: "what are the pricing plans and how much do they cost",
    relevant: ["sales/pricing-and-packaging.md", "data/pricing-plans.md"],
  },
  {
    id: "q-sales-discovery",
    text: "sales discovery questions and who is the economic buyer",
    relevant: ["sales/sales-playbook.md"],
  },
  {
    id: "q-onboarding",
    text: "customer onboarding checklist welcome email and kickoff call",
    relevant: ["sales/onboarding-checklist.md"],
  },
  {
    id: "q-competitors",
    text: "who are our competitors and where do we win or lose",
    relevant: ["sales/competitor-landscape.md"],
  },
  {
    id: "q-brand-voice",
    text: "brand voice and tone guidelines for writing",
    relevant: ["marketing/brand-voice.md"],
  },

  // ---- people / ops ----
  {
    id: "q-pto",
    text: "paid time off policy and parental leave weeks",
    relevant: ["people/pto-policy.md"],
  },
  {
    id: "q-benefits",
    text: "what benefits do we get 401k match and equity vesting",
    relevant: ["people/benefits-overview.md"],
  },
  {
    id: "q-expense",
    text: "how do I submit an expense reimbursement for software",
    relevant: ["people/expense-policy.md"],
  },
  {
    id: "q-handbook-remote",
    text: "remote work core collaboration hours and async communication",
    relevant: ["people/employee-handbook.md"],
  },

  // ---- decisions ----
  {
    id: "q-adr-postgres",
    text: "why did we choose Postgres over MongoDB",
    relevant: ["decisions/adr-001-postgres-over-mongo.md"],
  },
  {
    id: "q-adr-kafka",
    text: "decision to use Kafka for event ingestion and its tradeoffs",
    relevant: ["decisions/adr-002-kafka-ingestion.md"],
  },
  {
    id: "q-adr-rrf",
    text: "why reciprocal rank fusion instead of a weighted score blend",
    relevant: ["decisions/adr-003-rrf-hybrid-search.md"],
  },
  {
    id: "q-adr-remote",
    text: "decision record for operating remote-first without a headquarters",
    relevant: ["decisions/adr-004-remote-first.md"],
  },

  // ---- meetings ----
  {
    id: "q-eng-weekly",
    text: "engineering weekly notes about dunning worker jitter and HNSW backfill",
    relevant: ["meetings/2026-06-15-eng-weekly.md"],
  },
  {
    id: "q-gtm-pipeline",
    text: "GTM pipeline review enterprise deals citing churn alerts",
    relevant: ["meetings/2026-06-22-gtm-sync.md"],
  },
  {
    id: "q-product-review",
    text: "product review decision on headline retention metric and copilot design partners",
    relevant: ["meetings/2026-06-29-product-review.md"],
  },

  // ---- datasets ----
  {
    id: "q-sla",
    text: "support SLA first response time by plan tier",
    relevant: ["data/support-sla-tiers.md"],
  },
  {
    id: "q-plan-caps",
    text: "tracked revenue volume cap included in each pricing plan",
    relevant: ["data/pricing-plans.md"],
  },

  // ---- company ----
  {
    id: "q-mission",
    text: "what is the Cadence mission around recurring revenue",
    relevant: ["company/mission.md"],
  },
  {
    id: "q-values",
    text: "company values transparency and written-first communication",
    relevant: ["company/values.md"],
  },
  {
    id: "q-org",
    text: "how are engineering and go-to-market teams organized",
    relevant: ["company/org-structure.md"],
  },

  // ---- SCOPE cases: the restricted board subtree ----
  // Admin can retrieve the board financials (proves the query works)...
  {
    id: "q-board-financials-admin",
    text: "board Q2 ARR growth gross margin and cash runway",
    relevant: ["restricted/board/q2-financials.md"],
    context: "admin",
  },
  // ...but a non-board reader running the SAME kind of query must get NOTHING
  // from the restricted subtree (SQL-side scope enforcement in the provider).
  {
    id: "q-board-financials-leak",
    text: "board Q2 ARR growth gross margin and cash runway",
    relevant: [],
    context: "no-board",
    forbidden: [
      "restricted/board/q2-financials.md",
      "restricted/board/fundraise-plan.md",
      "restricted/board/exec-comp.md",
    ],
  },
  {
    id: "q-board-fundraise-admin",
    text: "series B fundraise plan target valuation and use of proceeds",
    relevant: ["restricted/board/fundraise-plan.md"],
    context: "admin",
  },
  {
    id: "q-board-fundraise-leak",
    text: "series B fundraise plan target valuation and use of proceeds",
    relevant: [],
    context: "no-board",
    forbidden: [
      "restricted/board/fundraise-plan.md",
      "restricted/board/q2-financials.md",
      "restricted/board/exec-comp.md",
    ],
  },
  {
    id: "q-board-comp-leak",
    text: "executive compensation salary bands and equity refresh grants",
    relevant: [],
    context: "no-board",
    forbidden: ["restricted/board/exec-comp.md"],
  },
];
