import type {
  ConnectorManifest,
  ConnectorPullRequest,
  ConnectorPullResponse,
  ConnectorScopesRequest,
  ConnectorScopesResponse,
} from "@nimbase/connector-sdk";

export interface ConnectorRequestContext {
  endpointUrl: string;
  secret: string | null;
}

export interface ConnectorAdapter {
  manifest(context: ConnectorRequestContext): Promise<ConnectorManifest>;
  pull(
    context: ConnectorRequestContext,
    request: ConnectorPullRequest,
  ): Promise<ConnectorPullResponse>;
  scopes(
    context: ConnectorRequestContext,
    request: ConnectorScopesRequest,
  ): Promise<ConnectorScopesResponse>;
}
