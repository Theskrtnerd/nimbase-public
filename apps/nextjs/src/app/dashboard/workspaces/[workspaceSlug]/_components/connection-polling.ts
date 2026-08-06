interface FirstSyncConnection {
  status: string;
  lastSuccessAt: Date | string | null;
}

export function firstSyncPollInterval(
  connections: readonly FirstSyncConnection[] | undefined,
): 2000 | false {
  return connections?.some(
    (connection) =>
      connection.status === "active" && connection.lastSuccessAt === null,
  )
    ? 2000
    : false;
}
