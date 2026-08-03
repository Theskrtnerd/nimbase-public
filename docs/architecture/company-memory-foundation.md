# Company memory foundation

This is the simplified Nimbase architecture after removing projected memory
slices. It deliberately establishes only two foundations now: one canonical
company knowledge base, and one stable profile for each employee. Provider ACL
mirroring is now attached to source evidence; policy-preserving compilation and
the long-term governance model remain the next phase.

## Current product shape

```mermaid
flowchart LR
  subgraph Capture["Universal capture"]
    Text["Text and Markdown"]
    URL["URLs and websites"]
    Media["Files, images, audio, video"]
    Sync["Out-of-process connectors"]
  end

  Normalize["Original + normalized raw.md"]
  Policy["Provider ACL snapshot"]
  Kind{"Provider-managed?"}
  Compile["One canonical compile"]
  Held["Held provider evidence"]
  KB["Centralized OKF knowledge base"]

  subgraph Serve["Deployment surfaces"]
    Search["CLI and API search"]
    MCP["MCP endpoint"]
    Docs["Docs site"]
    Agent["Agent"]
    Slack["Slack interface"]
    Widget["Widget interface"]
    Artifact["Artifact"]
  end

  Capture --> Normalize
  Sync --> Policy
  Normalize --> Kind
  Kind -- "No" --> Compile --> KB
  Kind -- "Yes" --> Held
  Policy --> Held
  KB --> Search
  KB --> MCP
  KB --> Docs
  KB --> Agent
  Agent --> Slack
  Agent --> Widget
  KB --> Artifact
```

The invariants are intentionally small:

- A captured source is stored once and compiled once.
- OKF markdown in versioned object storage is authoritative; Postgres is the
  derived index.
- Deployments read from the KB root by default.
- `folderId` is an optional deployment anchor, not a memory ownership model.
- Existing folder access checks remain fail-closed until governance is
  redesigned.
- Connector evidence carries an immutable provider ACL. Every provider source
  is held out of compilation for now; restricted evidence additionally requires
  its source-derived identity grants at retrieval.
- This boundary applies to raw provider evidence and new compilation. Memory
  compiled before provider policies existed is not permission-proven; the eval
  phase must trace and audit those derivations before restricted compiled memory
  is enabled.

## Company identity spine

```mermaid
flowchart LR
  Clerk["Nimbase / Clerk account"]
  Slack["Slack subject"]
  Google["Google subject"]
  GitHub["GitHub subject"]
  Email["Exact verified company email"]
  Resolver["Identity resolver"]
  Profile["UserProfile"]
  Member["WorkspaceMember"]

  Clerk --> Resolver
  Slack --> Resolver
  Google --> Resolver
  GitHub --> Resolver
  Email --> Resolver
  Resolver --> Profile
  Member --> Profile
```

Resolution order is stable provider subject, then exact verified email, then a
new profile. The resolver never uses a person's name, title, or fuzzy matching
as identity evidence. `ExternalIdentity` records provider bindings and
`UserProfileEmail` records verified aliases. Every workspace membership points
to exactly one `UserProfile`.

## Deployment scope

```mermaid
flowchart TD
  Deployment["Agent, MCP, or docs deployment"]
  Choice{"folderId configured?"}
  Root["Read centralized KB root"]
  Folder["Read anchored folder subtree"]
  Retrieval["Shared scoped retrieval"]

  Deployment --> Choice
  Choice -- "No" --> Root --> Retrieval
  Choice -- "Yes" --> Folder --> Retrieval
```

Folder scope is optional at the wire contract, CLI, service, and schema layers.
An omitted `--folder` is represented as `folderId = null` and `folderPath = ""`.
This seam is retained because it can later carry provider ACL and policy
decisions without reintroducing duplicate memory.

## Deliberately deferred

- Group and organization identity synchronization.
- Permission-preserving compilation of restricted evidence and its security
  evals.
- Retrieval evidence traces, thread/project bursting, recency, and reranking.
- Learning, forgetting, retention, and their evaluation framework.

Those capabilities should attach to the canonical source, identity, and
deployment seams above rather than adding another parallel memory model.

## Vision after the security eval foundation

```mermaid
flowchart LR
  Provider["Provider content + ACL"]
  Capture["Universal capture"]
  Evidence["Immutable source evidence"]
  Identity["UserProfile identity graph"]
  Facts["Policy-carrying facts or spans"]
  Compiler["Same-domain compiler"]
  Memory["Centralized company memory"]
  Query["Authorized query"]
  Filter["Policy filter before ranking"]
  Burst["Thread, folder, repo bursting"]
  Rank["Rerank + recency"]
  Trace["Evidence trace + citations"]
  Evals["Security, retrieval, learning, forgetting evals"]

  Provider --> Capture --> Evidence --> Facts --> Compiler --> Memory
  Provider --> Identity
  Identity --> Filter
  Query --> Filter
  Evidence --> Filter
  Memory --> Filter --> Burst --> Rank --> Trace
  Evals -. gates .-> Facts
  Evals -. gates .-> Compiler
  Evals -. gates .-> Filter
  Evals -. gates .-> Trace
```

The eval system is a release gate, not an observability afterthought. Restricted
compilation does not ship until fixtures prove non-interference across access
domains, revoked access disappears from retrieval, and every answer can trace
back to evidence the caller can independently read.
