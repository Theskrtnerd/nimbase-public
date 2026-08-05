# ADR 0001: Provider-derived access policies

- Status: accepted
- Date: 2026-08-01

The mutable source re-fencing mechanism in this decision is superseded by
[ADR 0002](0002-provider-access-resource-mirroring.md). Immutable policies,
dynamic identity resolution, fail-closed SQL filtering, and held-source rules
remain accepted.

## Context

Nimbase captures company sources whose provider permissions differ. Compiling
restricted and workspace-visible evidence into one note can leak the restricted
source unless policy survives every derivation and retrieval path. That system
needs dedicated security evals and is intentionally deferred.

## Decision

Each provider source stores an immutable, canonical `ProviderAccessPolicy`
snapshot and normalized grants. Authorization resolves those grants dynamically
against `UserProfile`, verified email aliases, and external provider identities.
The filter runs in SQL before evidence is returned or code candidates are
ranked. Restricted grants have no admin or operator bypass.

When a crawl observes a new policy for an external item, Nimbase re-fences all
captured versions of that item to the newest observed policy before content
deduplication. This closes old raw-evidence versions after a provider ACL
tightens. Permission freshness still follows provider crawl/event freshness;
instant revocation and deletion reconciliation belong to the eval-gated phase.

All provider sources finish normalization in `held` state and do not create a
compile job. Even workspace-visible evidence is held because its provider can
tighten access later and the current compiler cannot safely retract a fact after
it has merged into a note. Unknown provider ACL shapes use an owner-only,
partial policy. Existing connector rows are migrated to the same conservative
owner-only policy until a recrawl supplies a current snapshot.

This phase governs raw provider evidence and all newly scheduled compilation.
It does not retroactively prove that previously compiled memory preserved its
source boundary. Existing compiled memory therefore remains outside the secure
provider-memory claim until a later audit can trace, evaluate, and either
recompile or quarantine every derivation.

## Consequences

- One centralized KB remains; no projected or per-reader KB is introduced.
- Authorized principals can inspect raw evidence, but provider evidence is not
  yet searchable as compiled memory.
- Provider policy changes re-fence source history and produce a new immutable
  evidence version.
- Secure restricted compilation, evidence traces, bursting, retention, and
  memory-learning behavior wait for the evaluation framework.
- Legacy compiled memory must be audited before restricted provider memory can
  be described as end-to-end secure.
