"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon, UnplugIcon } from "lucide-react";

import type { RouterOutputs } from "@acme/api";
import { Button } from "@acme/ui/button";

import { formatDateTime } from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";
import { firstSyncPollInterval } from "./connection-polling";
import { StatusPill } from "./table-primitives";

type Connection = RouterOutputs["connections"]["list"][number];

function connectionStatus(status: string): {
  label: string;
  tone: "active" | "idle" | "warn";
} {
  if (status === "active") return { label: "Syncing", tone: "active" };
  if (status === "paused") return { label: "Paused", tone: "idle" };
  return { label: "Needs attention", tone: "warn" };
}

export function IntegrationsSettings({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const connections = useQuery(
    trpc.connections.list.queryOptions(
      { workspaceId },
      {
        refetchInterval: (query) => firstSyncPollInterval(query.state.data),
      },
    ),
  );
  const invalidate = async () => {
    await queryClient.invalidateQueries(
      trpc.connections.list.queryFilter({ workspaceId }),
    );
  };
  const setPaused = useMutation(
    trpc.connections.setPaused.mutationOptions({ onSuccess: invalidate }),
  );
  const syncNow = useMutation(
    trpc.connections.syncNow.mutationOptions({ onSuccess: invalidate }),
  );
  const remove = useMutation(
    trpc.connections.delete.mutationOptions({ onSuccess: invalidate }),
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[15px] font-semibold tracking-tight">
          Sync connectors
        </h2>
        <p className="text-muted-foreground max-w-xl text-[12px] leading-5">
          Community Edition runs out-of-process connectors through the open
          connector protocol. Register one with{" "}
          <code>nimbase sync add &lt;connectorUrl&gt;</code>.
        </p>
      </div>

      <div className="bg-card border-border overflow-hidden rounded-xl border">
        {connections.isLoading ? (
          <p className="text-muted-foreground p-4 text-sm">
            Loading connectors…
          </p>
        ) : null}
        {connections.isError ? (
          <p className="text-destructive p-4 text-sm">
            Connectors could not be loaded.
          </p>
        ) : null}
        {connections.data?.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <UnplugIcon className="text-muted-foreground size-5" />
            <p className="text-foreground text-sm font-medium">
              No connectors registered
            </p>
            <p className="text-muted-foreground max-w-md text-xs leading-5">
              Run the CLI command above with a connector implementing the
              versioned Nimbase connector protocol.
            </p>
          </div>
        ) : null}
        {connections.data?.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            pending={
              setPaused.isPending || syncNow.isPending || remove.isPending
            }
            onPause={(paused) =>
              setPaused.mutate({
                workspaceId,
                connectionId: connection.id,
                paused,
              })
            }
            onRemove={() =>
              remove.mutate({ workspaceId, connectionId: connection.id })
            }
            onSync={() =>
              syncNow.mutate({ workspaceId, connectionId: connection.id })
            }
          />
        ))}
      </div>
    </section>
  );
}

function ConnectionRow({
  connection,
  pending,
  onPause,
  onRemove,
  onSync,
}: {
  connection: Connection;
  pending: boolean;
  onPause: (paused: boolean) => void;
  onRemove: () => void;
  onSync: () => void;
}) {
  const status = connectionStatus(connection.status);
  return (
    <div className="border-border flex flex-col gap-3 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-foreground truncate text-sm font-medium">
            {connection.displayName ?? connection.provider}
          </p>
          <StatusPill label={status.label} tone={status.tone} />
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {connection.provider}
          {connection.lastSuccessAt
            ? ` · Last synced ${formatDateTime(connection.lastSuccessAt)}`
            : " · Not synced yet"}
        </p>
        {connection.lastError ? (
          <p className="text-destructive mt-1 text-xs">
            {connection.lastError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending || connection.status !== "active"}
          onClick={onSync}
        >
          <RefreshCwIcon /> Sync now
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => onPause(connection.status === "active")}
        >
          {connection.status === "active" ? "Pause" : "Resume"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={onRemove}
        >
          Disconnect
        </Button>
      </div>
    </div>
  );
}
