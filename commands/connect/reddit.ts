import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import { type ConfigLayer, ConfigurationService } from "@tokenring-ai/app";

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
      description: "OAuth access token (or leave blank to enter interactively)",
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
    if (!agent.headless) {
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
    }

    if (!accessToken && !refreshToken) {
      throw new CommandFailedError("Usage: /connect reddit <accessToken>  — or provide a refreshToken with clientId and clientSecret");
    }
    if (refreshToken && (!clientId || !clientSecret)) {
      throw new CommandFailedError("A refreshToken requires clientId and clientSecret");
    }

    const configService = agent.requireService(ConfigurationService);
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
            ...(accessToken && { accessToken }),
            ...(refreshToken && { refreshToken }),
            ...(clientId && { clientId }),
            ...(clientSecret && { clientSecret }),
          },
        },
      },
    } satisfies ConfigLayer;

    const result = await configService.apply(save, next);
    if (!result.ok) {
      throw new CommandFailedError(result.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
    }

    return `Reddit account "${name}" connected.`;
  },
  help: `Connect a Reddit account and save its OAuth credentials in the configuration.

Requires an OAuth access token, or a refresh token plus app client ID and secret.
Scopes typically include identity, privatemessages, submit, and read.

When run interactively, credentials are requested using masked prompts.

## Example

/connect reddit --name=reddit`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
