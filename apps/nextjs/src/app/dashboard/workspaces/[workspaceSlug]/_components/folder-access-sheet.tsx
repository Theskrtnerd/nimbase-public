"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import { Button } from "@acme/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@acme/ui/sheet";
import { Switch } from "@acme/ui/switch";

import { useTRPC } from "~/trpc/react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Grant {
  id: string;
  principalType: "user" | "group" | "all_members";
  principalId: string | null;
  role: "viewer" | "contributor" | "manager";
  label: string;
}

type GrantRole = "viewer" | "contributor" | "manager";

// ─── FolderAccessSheet ────────────────────────────────────────────────────────

export function FolderAccessSheet({
  workspaceId,
  path,
  onClose,
}: {
  workspaceId: string;
  path: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[420px] gap-0 p-0 sm:max-w-[420px]"
      >
        <FolderAccessSheetBody
          workspaceId={workspaceId}
          path={path}
          onClose={onClose}
        />
      </SheetContent>
    </Sheet>
  );
}

// ─── Body (separate so layout is clean) ──────────────────────────────────────

function FolderAccessSheetBody({
  workspaceId,
  path,
  onClose,
}: {
  workspaceId: string;
  path: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const accessQuery = useQuery(
    trpc.access.listFolderAccess.queryOptions({ workspaceId, path }),
  );
  const membersQuery = useQuery(
    trpc.members.list.queryOptions({ workspaceId }),
  );
  const groupsQuery = useQuery(trpc.groups.list.queryOptions({ workspaceId }));

  // Grant and restriction changes can both flip a folder's locked/visible
  // state in the notes tree, so every access mutation invalidates the tree
  // query alongside this folder's access query.
  async function invalidateAccessAndTree() {
    await Promise.all([
      queryClient.invalidateQueries(
        trpc.access.listFolderAccess.queryFilter({ workspaceId, path }),
      ),
      queryClient.invalidateQueries(
        trpc.kb.listCompiledNodes.queryFilter({ workspaceId }),
      ),
    ]);
  }

  const accessData = accessQuery.data;
  const members = membersQuery.data?.members ?? [];
  const groups = groupsQuery.data ?? [];

  const folderLabel = path.split("/").filter(Boolean).join(" / ") || path;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <SheetHeader className="border-sidebar-border flex flex-row items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <SheetTitle className="text-[15px] font-semibold tracking-tight">
            Access
          </SheetTitle>
          <p className="text-muted-foreground truncate text-[12px] leading-none">
            {folderLabel}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="shrink-0"
        >
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </Button>
      </SheetHeader>

      {/* Body */}
      <div className="app-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        {accessQuery.isPending ? (
          <p className="text-muted-foreground text-[13px]">Loading…</p>
        ) : accessQuery.isError ? (
          <p className="text-muted-foreground text-[13px]">
            Couldn&apos;t load access settings.
          </p>
        ) : (
          <>
            {/* Restricted toggle */}
            <RestrictedToggle
              workspaceId={workspaceId}
              path={path}
              restricted={accessData?.restricted ?? false}
              canManage={accessData?.canManage ?? false}
              onMutated={invalidateAccessAndTree}
            />

            {/* Grant list */}
            <GrantList
              workspaceId={workspaceId}
              grants={accessData?.grants ?? []}
              canManage={accessData?.canManage ?? false}
              onMutated={invalidateAccessAndTree}
            />

            {/* Add grant */}
            {(accessData?.canManage ?? false) && (
              <AddGrantForm
                workspaceId={workspaceId}
                path={path}
                members={members}
                groups={groups}
                onMutated={invalidateAccessAndTree}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Restricted toggle ────────────────────────────────────────────────────────

function RestrictedToggle({
  workspaceId,
  path,
  restricted,
  canManage,
  onMutated,
}: {
  workspaceId: string;
  path: string;
  restricted: boolean;
  canManage: boolean;
  onMutated: () => Promise<void>;
}) {
  const trpc = useTRPC();
  const [pendingOn, setPendingOn] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  const setRestrictedMutation = useMutation(
    trpc.access.setRestricted.mutationOptions({
      onSuccess: async () => {
        setPendingOn(false);
        setMutateError(null);
        await onMutated();
      },
      onError: (err) => {
        setPendingOn(false);
        setMutateError(err.message);
      },
    }),
  );

  function handleToggle(checked: boolean) {
    setMutateError(null);
    if (checked) {
      // Show confirm inline instead of applying immediately.
      setPendingOn(true);
    } else {
      setRestrictedMutation.mutate({ workspaceId, path, restricted: false });
    }
  }

  function confirmRestrict() {
    // pendingOn stays true while saving so the switch reads ON throughout;
    // it resets in the mutation's onSuccess/onError.
    setRestrictedMutation.mutate({ workspaceId, path, restricted: true });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">
          Restricted space
        </h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          When restricted, only people with explicit grants (and admins) can see
          this folder.
        </p>
      </div>

      <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-4">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-foreground text-[13px]">
            {restricted ? "Restricted" : "Not restricted"}
          </span>
          <Switch
            checked={restricted || pendingOn}
            disabled={!canManage || setRestrictedMutation.isPending}
            onCheckedChange={handleToggle}
            aria-label="Restricted space"
          />
        </label>

        {pendingOn && (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-[12px] leading-5">
              Only people granted access on this folder — and admins — will keep
              seeing it.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={setRestrictedMutation.isPending}
                onClick={confirmRestrict}
              >
                {setRestrictedMutation.isPending ? "Saving…" : "Confirm"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={setRestrictedMutation.isPending}
                onClick={() => setPendingOn(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mutateError && (
          <p className="text-destructive text-[12px]">{mutateError}</p>
        )}
      </div>
    </section>
  );
}

// ─── Grant list ───────────────────────────────────────────────────────────────

function GrantList({
  workspaceId,
  grants,
  canManage,
  onMutated,
}: {
  workspaceId: string;
  grants: Grant[];
  canManage: boolean;
  onMutated: () => Promise<void>;
}) {
  const trpc = useTRPC();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const removeMutation = useMutation(
    trpc.access.removeGrant.mutationOptions({
      onSuccess: async () => {
        setRemoveError(null);
        await onMutated();
      },
      onError: (err) => {
        setRemoveError(err.message);
      },
    }),
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">
          Access rules
        </h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          Grants applied directly on this folder.
        </p>
      </div>

      <div className="bg-card border-border flex flex-col rounded-xl border">
        {grants.length === 0 ? (
          <p className="text-muted-foreground px-4 py-3 text-[12px] leading-5">
            No access rules on this folder. Everyone who can see its parent can
            see it.
          </p>
        ) : (
          <div className="flex flex-col divide-y">
            {grants.map((grant) => (
              <div
                key={grant.id}
                className="flex items-center justify-between gap-2 px-4 py-2.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-foreground truncate text-[13px]">
                    {grant.label}
                  </span>
                  <span className="text-muted-foreground text-[11px] capitalize">
                    {grant.role}
                  </span>
                </div>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Remove grant for ${grant.label}`}
                    disabled={removeMutation.isPending}
                    onClick={() =>
                      removeMutation.mutate({
                        workspaceId,
                        grantId: grant.id,
                      })
                    }
                    className="text-muted-foreground hover:text-foreground shrink-0 p-1 transition-colors disabled:opacity-50"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {removeError && (
        <p className="text-destructive text-[12px]">{removeError}</p>
      )}
    </section>
  );
}

// ─── Add grant form ───────────────────────────────────────────────────────────

interface MemberRow {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
}

interface GroupRow {
  id: string;
  name: string;
}

function AddGrantForm({
  workspaceId,
  path,
  members,
  groups,
  onMutated,
}: {
  workspaceId: string;
  path: string;
  members: MemberRow[];
  groups: GroupRow[];
  onMutated: () => Promise<void>;
}) {
  const trpc = useTRPC();
  // principalValue: "" (none) | "all_members" | "user:<userId>" | "group:<groupId>"
  const [principalValue, setPrincipalValue] = useState("");
  const [role, setRole] = useState<GrantRole>("viewer");
  const [addError, setAddError] = useState<string | null>(null);

  const upsertMutation = useMutation(
    trpc.access.upsertGrant.mutationOptions({
      onSuccess: async () => {
        setPrincipalValue("");
        setRole("viewer");
        setAddError(null);
        await onMutated();
      },
      onError: (err) => {
        setAddError(err.message);
      },
    }),
  );

  function handleAdd() {
    setAddError(null);
    if (!principalValue) return;

    let principalType: "user" | "group" | "all_members";
    let principalId: string | null = null;

    if (principalValue === "all_members") {
      principalType = "all_members";
    } else if (principalValue.startsWith("user:")) {
      principalType = "user";
      principalId = principalValue.slice(5);
    } else if (principalValue.startsWith("group:")) {
      principalType = "group";
      principalId = principalValue.slice(6);
    } else {
      setAddError("Invalid principal selection.");
      return;
    }

    upsertMutation.mutate({
      workspaceId,
      path,
      principalType,
      principalId,
      role,
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">Add access</h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          Grant a person, group, or all members access to this folder.
        </p>
      </div>

      <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex flex-wrap gap-2">
          <Select value={principalValue} onValueChange={setPrincipalValue}>
            <SelectTrigger className="min-w-0 flex-1 text-[13px]">
              <SelectValue placeholder="Select principal…" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Workspace</SelectLabel>
                <SelectItem value="all_members">
                  Everyone in workspace
                </SelectItem>
              </SelectGroup>
              {members.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Members</SelectLabel>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={`user:${m.userId}`}>
                      {m.name ?? m.email ?? m.userId}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {groups.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Groups</SelectLabel>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={`group:${g.id}`}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>

          <Select value={role} onValueChange={(v) => setRole(v as GrantRole)}>
            <SelectTrigger className="text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">Viewer</SelectItem>
              <SelectItem value="contributor">Contributor</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
            </SelectContent>
          </Select>

          <Button
            type="button"
            size="sm"
            className="h-9"
            disabled={!principalValue || upsertMutation.isPending}
            onClick={handleAdd}
          >
            {upsertMutation.isPending ? "Adding…" : "Add"}
          </Button>
        </div>

        {addError && <p className="text-destructive text-[12px]">{addError}</p>}
      </div>
    </section>
  );
}
