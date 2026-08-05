"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";

import { useAnalytics } from "~/app/_components/analytics";
import { useTRPC } from "~/trpc/react";

export function MembersSettings({ workspaceId }: { workspaceId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const membersQuery = useQuery(
    trpc.members.list.queryOptions({ workspaceId }),
  );
  const groupsQuery = useQuery(trpc.groups.list.queryOptions({ workspaceId }));
  const accessQuery = useQuery(
    trpc.access.listFolderAccess.queryOptions({ workspaceId, path: "" }),
  );

  async function invalidateMembers() {
    await queryClient.invalidateQueries(
      trpc.members.list.queryFilter({ workspaceId }),
    );
  }

  async function invalidateGroups() {
    await queryClient.invalidateQueries(
      trpc.groups.list.queryFilter({ workspaceId }),
    );
  }

  async function invalidateAccess() {
    await queryClient.invalidateQueries(
      trpc.access.listFolderAccess.queryFilter({ workspaceId, path: "" }),
    );
  }

  const data = membersQuery.data;
  const groups = groupsQuery.data ?? [];
  const accessData = accessQuery.data;
  const allMembersGrant = accessData?.grants.find(
    (g) => g.principalType === "all_members",
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ── Members ── */}
      <MembersSection
        workspaceId={workspaceId}
        members={data?.members ?? []}
        invites={data?.invites ?? []}
        viewerIsAdmin={data?.viewerIsAdmin ?? false}
        isPending={membersQuery.isPending}
        isError={membersQuery.isError}
        onMutated={() => void invalidateMembers()}
      />

      {/* ── Groups ── */}
      <GroupsSection
        workspaceId={workspaceId}
        groups={groups}
        members={data?.members ?? []}
        viewerIsAdmin={data?.viewerIsAdmin ?? false}
        isPending={groupsQuery.isPending}
        isError={groupsQuery.isError}
        onMutated={() => {
          void invalidateGroups();
        }}
      />

      {/* ── Default access ── */}
      <DefaultAccessSection
        workspaceId={workspaceId}
        allMembersGrant={allMembersGrant ?? null}
        canManage={accessData?.canManage ?? false}
        isPending={accessQuery.isPending}
        isError={accessQuery.isError}
        onMutated={() => void invalidateAccess()}
      />
    </div>
  );
}

// ─── Members section ──────────────────────────────────────────────────────────

interface MemberData {
  id: string;
  userId: string;
  role: "owner" | "admin" | "member";
  name: string | null;
  email: string | null;
  createdAt: Date;
}

interface InviteRow {
  id: string;
  email: string;
  role: "admin" | "member";
  createdAt: Date;
}

function MembersSection({
  workspaceId,
  members,
  invites,
  viewerIsAdmin,
  isPending,
  isError,
  onMutated,
}: {
  workspaceId: string;
  members: MemberData[];
  invites: InviteRow[];
  viewerIsAdmin: boolean;
  isPending: boolean;
  isError: boolean;
  onMutated: () => void;
}) {
  const trpc = useTRPC();
  const analytics = useAnalytics();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const setRoleMutation = useMutation(
    trpc.members.setRole.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  const removeMutation = useMutation(
    trpc.members.remove.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  const inviteMutation = useMutation(
    trpc.members.invite.mutationOptions({
      onSuccess: (result, variables) => {
        analytics.capture("member_invited", {
          role: variables.role,
          email_sent: result.emailSent,
          workspace_id: workspaceId,
        });
        setInviteEmail("");
        setInviteError(null);
        setInviteSuccess(
          result.emailSent
            ? "Invite sent."
            : "Invite created (email not sent).",
        );
        onMutated();
        // No cleanup: React 18+ ignores setState after unmount.
        window.setTimeout(() => setInviteSuccess(null), 4000);
      },
      onError: (err) => {
        setInviteError(err.message);
      },
    }),
  );

  const revokeInviteMutation = useMutation(
    trpc.members.revokeInvite.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  function handleInvite() {
    setInviteError(null);
    setInviteSuccess(null);
    const email = inviteEmail.trim();
    if (!email) return;
    inviteMutation.mutate({ workspaceId, email, role: inviteRole });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">Members</h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          People with access to this workspace.
        </p>
      </div>

      {isPending ? (
        <div className="bg-card border-border rounded-xl border p-4">
          <p className="text-muted-foreground text-[13px]">Loading…</p>
        </div>
      ) : isError ? (
        <div className="bg-card border-border rounded-xl border p-4">
          <p className="text-muted-foreground text-[13px]">
            Couldn&apos;t load members.
          </p>
        </div>
      ) : (
        <div className="bg-card border-border flex flex-col gap-1 rounded-xl border p-4">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              viewerIsAdmin={viewerIsAdmin}
              onSetRole={(role) =>
                setRoleMutation.mutate({ workspaceId, memberId: m.id, role })
              }
              onRemove={() => {
                const label = m.name ?? m.email ?? m.userId;
                if (window.confirm(`Remove ${label} from this workspace?`)) {
                  removeMutation.mutate({ workspaceId, memberId: m.id });
                }
              }}
            />
          ))}
        </div>
      )}

      {viewerIsAdmin && (
        <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-foreground text-[13px] font-medium">
            Invite a member
          </p>

          <div className="flex flex-wrap gap-2">
            <Input
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleInvite();
              }}
              className="min-w-0 flex-1"
            />
            <select
              aria-label="Role for invite"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "member" | "admin")
              }
              className={cn(
                "border-input bg-background text-foreground h-9 rounded-md border px-2 text-[13px]",
                "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
              )}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              type="button"
              size="sm"
              disabled={inviteMutation.isPending || !inviteEmail.trim()}
              onClick={handleInvite}
            >
              {inviteMutation.isPending ? "Inviting…" : "Invite"}
            </Button>
          </div>

          {inviteError && (
            <p className="text-destructive text-[12px]">{inviteError}</p>
          )}
          {inviteSuccess && (
            <p className="text-muted-foreground text-[12px]">{inviteSuccess}</p>
          )}

          <p className="text-muted-foreground text-[11.5px]">
            Inviting an existing member doesn&apos;t change their role — use the
            role menu instead.
          </p>

          {invites.length > 0 && (
            <div className="flex flex-col gap-1 border-t pt-3">
              <p className="text-muted-foreground mb-1 text-[11px] font-semibold">
                Pending invites
              </p>
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="text-foreground min-w-0 truncate text-[13px]">
                    {inv.email}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[12px]">
                    {inv.role}
                  </span>
                  <button
                    type="button"
                    aria-label={`Revoke invite for ${inv.email}`}
                    onClick={() =>
                      revokeInviteMutation.mutate({
                        workspaceId,
                        inviteId: inv.id,
                      })
                    }
                    className="text-muted-foreground hover:text-foreground shrink-0 p-1 transition-colors"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MemberRow({
  member,
  viewerIsAdmin,
  onSetRole,
  onRemove,
}: {
  member: MemberData;
  viewerIsAdmin: boolean;
  onSetRole: (role: "member" | "admin") => void;
  onRemove: () => void;
}) {
  const label = member.name ?? member.email ?? member.userId;
  const isOwner = member.role === "owner";

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">
        {label}
      </span>

      {isOwner ? (
        <Badge variant="outline" className="shrink-0 text-[11px]">
          owner
        </Badge>
      ) : viewerIsAdmin ? (
        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label={`Role for ${label}`}
            value={member.role}
            onChange={(e) => onSetRole(e.target.value as "member" | "admin")}
            className={cn(
              "border-input bg-background text-foreground h-8 rounded-md border px-2 text-[12px]",
              "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
            )}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
            className="text-muted-foreground hover:text-foreground p-1 transition-colors"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ) : (
        <Badge variant="secondary" className="shrink-0 text-[11px]">
          {member.role}
        </Badge>
      )}
    </div>
  );
}

// ─── Groups section ───────────────────────────────────────────────────────────

interface GroupRow {
  id: string;
  name: string;
  members: {
    groupId: string;
    userId: string;
    name: string | null;
    email: string | null;
  }[];
}

function GroupsSection({
  workspaceId,
  groups,
  members,
  viewerIsAdmin,
  isPending,
  isError,
  onMutated,
}: {
  workspaceId: string;
  groups: GroupRow[];
  members: MemberData[];
  viewerIsAdmin: boolean;
  isPending: boolean;
  isError: boolean;
  onMutated: () => void;
}) {
  const trpc = useTRPC();
  const [newGroupName, setNewGroupName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = useMutation(
    trpc.groups.create.mutationOptions({
      onSuccess: () => {
        setNewGroupName("");
        setCreateError(null);
        onMutated();
      },
      onError: (err) => {
        setCreateError(err.message);
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.groups.delete.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  const addMemberMutation = useMutation(
    trpc.groups.addMember.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  const removeMemberMutation = useMutation(
    trpc.groups.removeMember.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  function handleCreate() {
    const name = newGroupName.trim();
    if (!name) return;
    setCreateError(null);
    createMutation.mutate({ workspaceId, name });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">Groups</h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          Organize members into groups for access control.
        </p>
      </div>

      {isPending ? (
        <div className="bg-card border-border rounded-xl border p-4">
          <p className="text-muted-foreground text-[13px]">Loading…</p>
        </div>
      ) : isError ? (
        <div className="bg-card border-border rounded-xl border p-4">
          <p className="text-muted-foreground text-[13px]">
            Couldn&apos;t load groups.
          </p>
        </div>
      ) : groups.length === 0 && !viewerIsAdmin ? (
        <div className="bg-card border-border rounded-xl border p-4">
          <p className="text-muted-foreground text-[13px]">No groups yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              allMembers={members}
              viewerIsAdmin={viewerIsAdmin}
              onDeleteGroup={() => {
                if (window.confirm(`Delete group "${group.name}"?`)) {
                  deleteMutation.mutate({ workspaceId, groupId: group.id });
                }
              }}
              onAddMember={(userId) =>
                addMemberMutation.mutate({
                  workspaceId,
                  groupId: group.id,
                  userId,
                })
              }
              onRemoveMember={(userId) =>
                removeMemberMutation.mutate({
                  workspaceId,
                  groupId: group.id,
                  userId,
                })
              }
            />
          ))}
        </div>
      )}

      {viewerIsAdmin && (
        <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-4">
          <p className="text-foreground text-[13px] font-medium">
            Create a group
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Group name"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              disabled={createMutation.isPending || !newGroupName.trim()}
              onClick={handleCreate}
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </div>
          {createError && (
            <p className="text-destructive text-[12px]">{createError}</p>
          )}
        </div>
      )}
    </section>
  );
}

function GroupCard({
  group,
  allMembers,
  viewerIsAdmin,
  onDeleteGroup,
  onAddMember,
  onRemoveMember,
}: {
  group: GroupRow;
  allMembers: MemberData[];
  viewerIsAdmin: boolean;
  onDeleteGroup: () => void;
  onAddMember: (userId: string) => void;
  onRemoveMember: (userId: string) => void;
}) {
  const [addUserId, setAddUserId] = useState("");

  const memberUserIds = new Set(group.members.map((m) => m.userId));
  const available = allMembers.filter((m) => !memberUserIds.has(m.userId));

  return (
    <div className="bg-card border-border flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-foreground text-[13px] font-medium">{group.name}</p>
        {viewerIsAdmin && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete group ${group.name}`}
            onClick={onDeleteGroup}
            className="size-7"
          >
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>

      {group.members.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {group.members.map((m) => {
            const chipLabel = m.name ?? m.email ?? m.userId;
            return (
              <span
                key={m.userId}
                className="bg-secondary text-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]"
              >
                {chipLabel}
                {viewerIsAdmin && (
                  <button
                    type="button"
                    aria-label={`Remove ${chipLabel} from group`}
                    onClick={() => onRemoveMember(m.userId)}
                    className="text-muted-foreground hover:text-foreground ml-0.5 transition-colors"
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-[12px]">No members yet.</p>
      )}

      {viewerIsAdmin && available.length > 0 && (
        <div className="flex gap-2">
          <select
            aria-label={`Add member to ${group.name}`}
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className={cn(
              "border-input bg-background text-foreground h-8 flex-1 rounded-md border px-2 text-[12px]",
              "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
            )}
          >
            <option value="">Add member…</option>
            {available.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email ?? m.userId}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={!addUserId}
            onClick={() => {
              if (addUserId) {
                onAddMember(addUserId);
                setAddUserId("");
              }
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Default access section ───────────────────────────────────────────────────

interface Grant {
  id: string;
  principalType: "user" | "group" | "all_members";
  principalId: string | null;
  role: "viewer" | "contributor" | "manager";
  label: string;
}

function DefaultAccessSection({
  workspaceId,
  allMembersGrant,
  canManage,
  isPending,
  isError,
  onMutated,
}: {
  workspaceId: string;
  allMembersGrant: Grant | null;
  canManage: boolean;
  isPending: boolean;
  isError: boolean;
  onMutated: () => void;
}) {
  const trpc = useTRPC();

  const upsertMutation = useMutation(
    trpc.access.upsertGrant.mutationOptions({
      onSuccess: onMutated,
    }),
  );

  function handleRoleChange(role: "viewer" | "contributor") {
    upsertMutation.mutate({
      workspaceId,
      path: "",
      principalType: "all_members",
      principalId: null,
      role,
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[13px] font-medium">
          Default access
        </h2>
        <p className="text-muted-foreground text-[12px] leading-5">
          Applies to every member, everywhere except restricted spaces.
        </p>
      </div>

      <div className="bg-card border-border flex items-center justify-between gap-3 rounded-xl border p-4">
        {isPending ? (
          <p className="text-muted-foreground text-[13px]">Loading…</p>
        ) : isError ? (
          <p className="text-muted-foreground text-[13px]">
            Couldn&apos;t load access settings.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <p className="text-foreground text-[13px]">
                {allMembersGrant
                  ? `All members — ${allMembersGrant.role}`
                  : "No default access set"}
              </p>
              {!allMembersGrant && (
                <p className="text-muted-foreground text-[12px]">
                  Members rely on explicit grants only.
                </p>
              )}
            </div>

            {canManage && (
              <select
                aria-label="Default access role for all members"
                value={
                  allMembersGrant?.role === "viewer" ||
                  allMembersGrant?.role === "contributor"
                    ? allMembersGrant.role
                    : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "viewer" || v === "contributor") {
                    handleRoleChange(v);
                  }
                }}
                disabled={upsertMutation.isPending}
                className={cn(
                  "border-input bg-background text-foreground h-8 shrink-0 rounded-md border px-2 text-[12px]",
                  "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <option value="">— none —</option>
                <option value="viewer">Viewer</option>
                <option value="contributor">Contributor</option>
              </select>
            )}
          </>
        )}
      </div>
    </section>
  );
}
