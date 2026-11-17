import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { BotService } from "@tokenring-ai/bot";
import RedditMessagingProvider from "../RedditMessagingProvider.ts";
import RedditService from "../RedditService.ts";
import { RedditServiceConfigSchema, type ResolvedRedditServiceConfig } from "../schema.ts";

/** Accounts whose clientId is "broken" fail to start; every other account connects. */
const configWith = (clientId: string): ResolvedRedditServiceConfig =>
  RedditServiceConfigSchema.parse({ accounts: { main: { clientId } } }) as ResolvedRedditServiceConfig;

describe("RedditService reconfigure", () => {
  let app: ReturnType<typeof createTestingApp>;
  let botService: BotService;
  let reddit: RedditService;
  const running = new Set<RedditMessagingProvider>();
  const spies: Array<{ mockRestore(): void }> = [];

  beforeEach(() => {
    running.clear();
    spies.push(
      spyOn(RedditMessagingProvider.prototype, "start").mockImplementation(async function (this: RedditMessagingProvider) {
        if ((this as unknown as { config: { clientId?: string } }).config.clientId === "broken") throw new Error("login failed");
        running.add(this);
      }),
      spyOn(RedditMessagingProvider.prototype, "stop").mockImplementation(async function (this: RedditMessagingProvider) {
        running.delete(this);
      }),
    );
    app = createTestingApp();
    botService = app.addService(BotService, new BotService(app));
    reddit = app.addService(RedditService, new RedditService(app));
  });

  afterEach(async () => {
    await reddit.stop();
    for (const spy of spies.splice(0)) spy.mockRestore();
    app.shutdown();
  });

  it("keeps the running provider when the replacement fails to start, and a revert keeps it", async () => {
    await reddit.reconfigure(configWith("good"));
    const original = reddit.getProvider("main")!;
    expect(running.has(original)).toBe(true);
    expect(botService.getProvider("main")).toBe(original);

    await expect(reddit.reconfigure(configWith("broken"))).rejects.toThrow("login failed");
    // The old provider is still running and registered.
    expect(reddit.getProvider("main")).toBe(original);
    expect(running.has(original)).toBe(true);
    expect(botService.getProvider("main")).toBe(original);

    // Reverting to the running config leaves the working provider in place.
    await reddit.reconfigure(configWith("good"));
    expect(reddit.getProvider("main")).toBe(original);
    expect(running.has(original)).toBe(true);
    expect(botService.getProvider("main")).toBe(original);
  });

  it("replaces the provider once a changed config starts, stopping the old one", async () => {
    await reddit.reconfigure(configWith("good"));
    const original = reddit.getProvider("main")!;

    await reddit.reconfigure(configWith("better"));
    const next = reddit.getProvider("main")!;
    expect(next).not.toBe(original);
    expect(running.has(original)).toBe(false);
    expect(running.has(next)).toBe(true);
    expect(botService.getProvider("main")).toBe(next);
  });
});
