import { describe, expect, it } from "bun:test";
import { createConnectHarness } from "@tokenring-ai/secrets/test/connectHarness";
import { VAULT_LOCKED_MESSAGE } from "@tokenring-ai/secrets/vaultCredentials";
import command from "./reddit.ts";

const ACCESS = "reddit-secret-access";
const REFRESH = "reddit-secret-refresh";
const CLIENT_SECRET = "reddit-secret-client";

function run(harness: ReturnType<typeof createConnectHarness>, args: Record<string, unknown> = {}) {
  return command.execute({ agent: harness.agent, args: { name: "work", save: "workspace", ...args } } as never);
}

const ref = (field: string) => ({ source: "vault", category: "reddit", key: `work.${field}` });

describe("/connect reddit", () => {
  it("saves the secrets to the vault, keeping the client ID in settings", async () => {
    const harness = createConnectHarness({ answers: [ACCESS, REFRESH, "client-id", CLIENT_SECRET] });
    const output = await run(harness);

    expect(harness.prompts.map(prompt => prompt.masked)).toEqual([true, true, false, true]);
    expect(harness.vault.entries.reddit).toEqual({ "work.accessToken": ACCESS, "work.refreshToken": REFRESH, "work.clientSecret": CLIENT_SECRET });
    expect(harness.configuration.overrides.workspace).toEqual({
      reddit: {
        accounts: {
          work: { accessToken: ref("accessToken"), refreshToken: ref("refreshToken"), clientSecret: ref("clientSecret"), clientId: "client-id" },
        },
      },
    });
    for (const value of [ACCESS, REFRESH, CLIENT_SECRET]) {
      expect(harness.settingsContain(value)).toBe(false);
      expect(output).not.toContain(value);
    }
  });

  it("saves only an access token when that is all it is given", async () => {
    const harness = createConnectHarness({ nobodyToAsk: true });
    await run(harness, { accessToken: ACCESS });
    expect(harness.vault.entries.reddit).toEqual({ "work.accessToken": ACCESS });
    expect(harness.configuration.overrides.workspace).toEqual({ reddit: { accounts: { work: { accessToken: ref("accessToken") } } } });
  });

  it("refuses when the vault is locked, saving nothing and asking for nothing", async () => {
    const harness = createConnectHarness({ answers: [ACCESS] });
    harness.vault.writable = false;
    await expect(run(harness)).rejects.toThrow(VAULT_LOCKED_MESSAGE);
    expect(harness.prompts).toEqual([]);
    expect(harness.vault.entries).toEqual({});
    expect(harness.configuration.overrides.workspace).toEqual({});
  });

  it("puts the vault back when the settings can't be saved", async () => {
    const harness = createConnectHarness({ nobodyToAsk: true });
    harness.vault.entries.reddit = { "work.refreshToken": "previous-refresh" };
    harness.configuration.reject = "invalid";
    const error = await run(harness, { accessToken: ACCESS, refreshToken: REFRESH, clientId: "id", clientSecret: CLIENT_SECRET }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    for (const value of [ACCESS, REFRESH, CLIENT_SECRET]) expect((error as Error).message).not.toContain(value);
    expect(harness.vault.entries.reddit).toEqual({ "work.refreshToken": "previous-refresh" });
    expect(harness.configuration.overrides.workspace).toEqual({});
  });
});
