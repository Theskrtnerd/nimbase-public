"use client";

import { useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MessageCircleIcon,
} from "lucide-react";

import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";

function mcpUrl(): string {
  if (typeof window === "undefined") return "https://app.nimbase.ai/mcp";
  return `${window.location.origin}/mcp`;
}

interface McpClient {
  id: string;
  name: string;
  setupLabel: string;
  setupHint: string;
  configText: (url: string) => string;
  promptText: (url: string) => string;
  connectHref?: (url: string) => string;
}

const MCP_CLIENTS: McpClient[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    setupLabel: "Run this command in your terminal",
    setupHint:
      "Claude Code opens your browser so you can approve Nimbase access.",
    configText: (url) => `claude mcp add --transport http nimbase ${url}`,
    promptText: (url) =>
      `Add the Nimbase MCP server at ${url} with the name "nimbase", then help me sign in with OAuth.`,
  },
  {
    id: "codex",
    name: "Codex",
    setupLabel: "Add this to ~/.codex/config.toml",
    setupHint: "Then run `codex mcp login nimbase` to approve Nimbase access.",
    configText: (url) => `[mcp_servers.nimbase]\nurl = "${url}"`,
    promptText: (url) =>
      `Add the Nimbase MCP server to my Codex config with the name "nimbase" and URL ${url}, then guide me through signing in.`,
  },
  {
    id: "cursor",
    name: "Cursor",
    setupLabel: "Connect Nimbase to Cursor",
    setupHint: "Install the server directly, then approve Nimbase access.",
    configText: (url) => JSON.stringify({ nimbase: { url } }, null, 2),
    promptText: (url) =>
      `Add Nimbase as an MCP server in Cursor using ${url}, then help me authenticate with OAuth.`,
    connectHref: (url) =>
      `cursor://anysphere.cursor-deeplink/mcp/install?name=nimbase&config=${btoa(
        JSON.stringify({ url }),
      )}`,
  },
  {
    id: "vscode",
    name: "VS Code",
    setupLabel: "Connect Nimbase to VS Code",
    setupHint: "Install the server directly, then approve Nimbase access.",
    configText: (url) =>
      `code --add-mcp '${JSON.stringify({ name: "nimbase", type: "http", url })}'`,
    promptText: (url) =>
      `Add the Nimbase MCP server in VS Code using ${url}, then help me authenticate with OAuth.`,
    connectHref: (url) =>
      `vscode:mcp/install?${encodeURIComponent(
        JSON.stringify({ name: "nimbase", type: "http", url }),
      )}`,
  },
];

export function McpSettings() {
  const [selectedClientId, setSelectedClientId] = useState("claude-code");
  const url = mcpUrl();
  const client =
    MCP_CLIENTS.find((candidate) => candidate.id === selectedClientId) ??
    MCP_CLIENTS.at(0);

  if (!client) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-foreground text-[15px] font-semibold tracking-tight">
          Use Nimbase in your AI tools
        </h2>
        <p className="text-muted-foreground max-w-xl text-[12px] leading-5">
          Give your preferred assistant secure access to this workspace&apos;s
          memory.
        </p>
      </div>

      <div className="bg-card border-border overflow-hidden rounded-xl border">
        <div
          aria-label="Choose an AI app"
          className="border-border flex overflow-x-auto border-b"
          role="tablist"
        >
          {MCP_CLIENTS.map((candidate) => {
            const selected = candidate.id === client.id;
            return (
              <button
                key={candidate.id}
                id={`mcp-tab-${candidate.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="mcp-setup-panel"
                onClick={() => setSelectedClientId(candidate.id)}
                className={cn(
                  "border-primary/0 text-muted-foreground hover:bg-muted/50 relative min-w-32 flex-1 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                  selected && "border-primary text-foreground bg-primary/5",
                )}
              >
                {candidate.name}
              </button>
            );
          })}
        </div>

        <div
          id="mcp-setup-panel"
          role="tabpanel"
          aria-labelledby={`mcp-tab-${client.id}`}
          className="flex flex-col gap-6 p-5 sm:p-6"
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-foreground text-[17px] font-semibold tracking-tight">
              {client.setupLabel}
            </h3>
            <p className="text-muted-foreground text-[12px] leading-5">
              {client.setupHint}
            </p>
          </div>

          {client.connectHref ? (
            <div>
              <Button asChild size="sm">
                <a href={client.connectHref(url)}>
                  <ExternalLinkIcon />
                  Connect {client.name}
                </a>
              </Button>
            </div>
          ) : (
            <>
              <CodeBlock
                text={client.configText(url)}
                label={
                  client.id === "claude-code" ? "Copy command" : "Copy config"
                }
              />
              <PromptAction client={client} url={url} />
            </>
          )}

          {client.connectHref ? (
            <PromptAction client={client} url={url} />
          ) : null}

          <EndpointBlock url={url} />
        </div>
      </div>
    </section>
  );
}

function PromptAction({ client, url }: { client: McpClient; url: string }) {
  return (
    <div className="border-primary/10 bg-primary/5 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
          <MessageCircleIcon className="size-4" />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-foreground text-[13px] font-medium">
            Assistant setup prompt
          </p>
          <p className="text-muted-foreground text-[12px] leading-5">
            Paste this into {client.name} for guided help adding Nimbase.
          </p>
        </div>
      </div>
      <CopyButton text={client.promptText(url)} label="Copy setup prompt" />
    </div>
  );
}

function EndpointBlock({ url }: { url: string }) {
  return (
    <div className="border-border flex flex-col gap-4 border-t pt-5 md:flex-row md:items-center md:justify-between">
      <div className="flex max-w-52 flex-col gap-1">
        <p className="text-foreground text-[13px] font-medium">
          Server endpoint
        </p>
        <p className="text-muted-foreground text-[12px] leading-5">
          Use this URL if your app asks for the MCP server address.
        </p>
      </div>
      <div className="min-w-0 flex-1 md:max-w-lg">
        <CodeBlock text={url} label="Copy URL" />
      </div>
    </div>
  );
}

function CodeBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="bg-foreground text-background flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
      <pre className="min-w-0 overflow-x-auto font-mono text-[12px] leading-5 break-all whitespace-pre-wrap">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={label} inverse />
    </div>
  );
}

function CopyButton({
  text,
  label,
  inverse = false,
  size = "sm",
}: {
  text: string;
  label: string;
  inverse?: boolean;
  size?: "sm" | "xs";
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Button
      variant={inverse ? "secondary" : "outline"}
      size={size}
      onClick={handleCopy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : label}
    </Button>
  );
}
