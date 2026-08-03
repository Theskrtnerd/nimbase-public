import "server-only";

import type { ConnectorAdapter } from "./types";
import { remoteConnector } from "./remote-connector";

// Community Edition runs connectors out of process through the public wire
// protocol. A hosted distribution may replace this composition root with a
// catalog that also resolves its own first-party adapters.
export function connectorAdapterFor(_provider: string): ConnectorAdapter {
  return remoteConnector;
}
