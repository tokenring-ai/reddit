import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import { type ConfigLayer, ConfigurationService } from "@tokenring-ai/app";
import SecretService from "@tokenring-ai/secrets/SecretService";
import type { SecretVaultRef } from "@tokenring-ai/secrets/secret";
import { accountCredentialRef, saveToVaultThen, VAULT_LOCKED_MESSAGE } from "@tokenring-ai/secrets/vaultCredentials";

const inputSchema = {
  args: {
    name: {
      description: "The name to save the Reddit account under",
      type: "string",
      defaultValue: "reddit",
    },
    save: {
      description: "Where to save the Reddit account configuration",
      type: "enum",
      values: ["global", "workspace"],
      defaultValue: "workspace",
    },
  },
  positionals: [
    {
      name: "accessToken",
      description: "OAuth access token. Typed inline it stays in the chat history; omit it to use a masked prompt",
      required: false,
    },
    {
      name: "refreshToken",
      description: "OAuth refresh token (optional if accessToken is long-lived)",
      required: false,
    },
    {
      name: "clientId",
      description: "Reddit app client ID (required with refreshToken)",
      required: false,
    },
    {
      name: "clientSecret",
      description: "Reddit app client secret (required with refreshToken)",
      required: false,
    },
  ],
} as const satisfies AgentCommandInputSchema;

export default {
  name: "connect reddit",
  alias: "reddit connect",
  description: "Connects a Reddit account for bot messaging",
  inputSchema,
  execute: async ({
    agent,
    args: { accessToken, refreshToken, clientId, clientSecret, name, save },
  }: AgentCommandInputType<typeof inputSchema>): Promise<string> => {
    const secrets = agent.requireService(SecretService);
    if (!secrets.canStore()) throw new CommandFailedError(VAULT_LOCKED_MESSAGE);

    accessToken ??=
      (await agent.askForText({
        message: "What is the OAuth access token for the Reddit account? Leave blank if using a refresh token.",
        label: "Access Token (optional)",
        masked: true,
      })) || undefined;
    refreshToken ??=
      (await agent.askForText({
        message: "What is the OAuth refresh token? Leave blank if the access token alone is enough.",
        label: "Refresh Token (optional)",
        masked: true,
      })) || undefined;
    if (refreshToken) {
      clientId ??=
        (await agent.askForText({
          message: "What is the Reddit app client ID?",
          label: "Client ID",
          masked: false,
        })) ?? undefined;
      clientSecret ??=
        (await agent.askForText({
          message: "What is the Reddit app client secret?",
          label: "Client Secret",
          masked: true,
        })) ?? undefined;
    }

    if (!accessToken && !refreshToken) {
      throw new CommandFailedError("Usage: /connect reddit <accessToken>  — or provide a refreshToken with clientId and clientSecret");
    }
    if (refreshToken && (!clientId || !clientSecret)) {
      throw new CommandFailedError("A refreshToken requires clientId and clientSecret");
    }

    const credentials: Partial<Record<"accessToken" | "refreshToken" | "clientSecret", SecretVaultRef>> = {};
    const values: [SecretVaultRef, string][] = [];
    for (const [field, value] of [
      ["accessToken", accessToken],
      ["refreshToken", refreshToken],
      ["clientSecret", clientSecret],
    ] as const) {
      if (!value) continue;
      const ref = accountCredentialRef("reddit", name, field);
      credentials[field] = ref;
      values.push([ref, value]);
    }

    const configService = agent.requireService(ConfigurationService);
    await saveToVaultThen(secrets, values, async () => {
      const overrides = configService.getOverrides(save);
      const reddit = (overrides.reddit ?? {}) as { accounts?: Record<string, unknown> };
      const accounts = reddit.accounts ?? {};
      const existingAccount = (accounts[name] ?? {}) as Record<string, unknown>;
      const next = {
        ...overrides,
        reddit: {
          ...reddit,
          accounts: {
            ...accounts,
            [name]: {
              ...existingAccount,
              ...credentials,
              ...(clientId && { clientId }),
            },
          },
        },
      } satisfies ConfigLayer;

      const result = await configService.apply(save, next);
      if (!result.ok) {
        throw new CommandFailedError(result.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
      }
    });

    return `Reddit account "${name}" connected. Its credentials are in the vault under reddit/${name}.*.`;
  },
  help: `Connect a Reddit account. The access token, refresh token and client secret are
saved in the vault (category "reddit", keys "<name>.accessToken", "<name>.refreshToken",
"<name>.clientSecret"), and the configuration only references them; the client ID is
stored in the configuration as-is. The vault must be unlocked.

Requires an OAuth access token, or a refresh token plus app client ID and secret.
Scopes typically include identity, privatemessages, submit, and read.

When run interactively, credentials are requested using masked prompts. Passing them as
arguments also works (where nobody can answer the prompts), but then they stay in the chat history.

## Example

/connect reddit --name=reddit`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
