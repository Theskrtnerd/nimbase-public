"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, Loader2Icon } from "lucide-react";

import { Button } from "@acme/ui/button";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";

import { formatDate, formatDateTime } from "~/lib/format-date";
import { useTRPC } from "~/trpc/react";
import { scopeLabel } from "./consumer-rows";

const ROOT_OPTION = "__root__";

/** Expiry presets. "" = never; otherwise a day count. */
const EXPIRY_OPTIONS: { value: string; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "", label: "Never" },
];

export function CreateTokenForm({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<"viewer" | "contributor">("viewer");
  const [folder, setFolder] = useState(ROOT_OPTION);
  const [expiryDays, setExpiryDays] = useState("90");
  // The raw token exists only in this response — once the sheet closes it is
  // unrecoverable, so it is held here rather than refetched.
  const [minted, setMinted] = useState<string | null>(null);

  const targets = useQuery(
    trpc.access.captureTargets.queryOptions({ workspaceId }),
  );

  const create = useMutation(
    trpc.token.create.mutationOptions({
      onSuccess: async (res) => {
        setMinted(res.token);
        await queryClient.invalidateQueries(
          trpc.token.list.queryFilter({ workspaceId }),
        );
      },
    }),
  );

  if (minted) {
    return (
      <div className="flex flex-col gap-3">
        <div className="border-border bg-card rounded-xl border p-4">
          <p className="text-foreground text-[13px] font-medium">
            Copy this token now
          </p>
          <p className="text-muted-foreground mt-1 text-[12px] leading-5">
            It is shown once and never again. Only its hash is stored — if you
            lose it, revoke the token and mint a new one.
          </p>
          <CopyBlock value={minted} />
        </div>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="token-label">Label</Label>
        <Input
          id="token-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="CI pipeline"
        />
        <p className="text-muted-foreground text-[12px]">
          How you&apos;ll recognise this token in the list later.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Scope</Label>
        <Select value={folder} onValueChange={setFolder}>
          <SelectTrigger>
            <SelectValue placeholder="Workspace root" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ROOT_OPTION}>Workspace root</SelectItem>
            {(targets.data ?? []).flatMap((t) =>
              t.folderId ? (
                <SelectItem key={t.folderId} value={t.folderId}>
                  {t.label}
                </SelectItem>
              ) : (
                []
              ),
            )}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-[12px]">
          The folder this token can reach. You need manager access to it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Access</Label>
        <Select
          value={role}
          onValueChange={(v) => setRole(v as "viewer" | "contributor")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="viewer">Viewer — read only</SelectItem>
            <SelectItem value="contributor">
              Contributor — read and capture
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-[12px]">
          A token can never carry manager: no permission changes, no minting
          further tokens.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Expires</Label>
        <Select value={expiryDays} onValueChange={setExpiryDays}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRY_OPTIONS.map((o) => (
              <SelectItem key={o.label} value={o.value || "never"}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {create.isError && (
        <p className="text-destructive text-[12px]">
          {create.error.message.includes("Manager")
            ? "You need manager access to that folder to mint a token there."
            : "Could not create the token."}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!label.trim() || create.isPending}
          onClick={() => {
            const days = Number(expiryDays);
            create.mutate({
              workspaceId,
              label: label.trim(),
              role,
              targetFolderId: folder === ROOT_OPTION ? null : folder,
              expiresAt: Number.isFinite(days)
                ? new Date(Date.now() + days * 86_400_000)
                : null,
            });
          }}
        >
          {create.isPending && <Loader2Icon className="size-4 animate-spin" />}
          Create token
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function TokenDetail({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}) {
  const trpc = useTRPC();
  const tokens = useQuery(trpc.token.list.queryOptions({ workspaceId }));
  const token = tokens.data?.find((t) => t.id === tokenId);
  // Snapshot "now" once on mount rather than reading the clock during render —
  // expiry is a display detail, and a render-time Date.now() is impure.
  const [now] = useState(() => Date.now());

  if (!token) {
    return (
      <p className="text-muted-foreground text-[13px]">
        {tokens.isLoading ? "Loading…" : "This token is no longer available."}
      </p>
    );
  }

  const expired = token.expiresAt !== null && token.expiresAt.getTime() < now;

  return (
    <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
      <Row label="Label" value={token.label} />
      <Row label="Scope" value={scopeLabel(token.folderPath)} mono />
      <Row label="Access" value={token.role} />
      <Row
        label="Expires"
        value={
          token.expiresAt
            ? `${formatDate(token.expiresAt)}${expired ? " (expired)" : ""}`
            : "Never"
        }
      />
      <Row
        label="Last used"
        value={token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "Never"}
      />
      <Row label="Created" value={formatDate(token.createdAt)} />
      <p className="text-muted-foreground border-border border-t pt-3 text-[12px] leading-5">
        The token value itself is not recoverable — only its hash is stored. To
        replace it, revoke this one and mint a new token.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-3">
      <span className="text-muted-foreground font-mono text-[10px] font-semibold">
        {label}
      </span>
      <span
        className={
          mono
            ? "text-foreground font-mono text-[12px]"
            : "text-foreground text-[13px]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function CopyBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-secondary mt-3 flex items-center gap-2 rounded-lg p-2">
      <code className="text-foreground min-w-0 flex-1 truncate font-mono text-[11px]">
        {value}
      </code>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
        <span className="sr-only">Copy token</span>
      </Button>
    </div>
  );
}
