import { beforeEach, describe, expect, it, mock } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage } from "@tokenring-ai/bot";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import RedditMessagingProvider from "../RedditMessagingProvider.ts";
import type RedditService from "../RedditService.ts";
import { RedditAccountConfigSchema, type ResolvedRedditAccountConfig } from "../schema.ts";

void mock.module("@tokenring-ai/utility/http/doFetchWithRetry", () => ({
  doFetchWithRetry: mock(),
}));

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

function fetchCall(index: number) {
  const call = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls[index]!;
  return { url: String(call[0]), opts: call[1] as Record<string, unknown> };
}

function lastFetchCall() {
  const calls = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls;
  return fetchCall(calls.length - 1);
}

function mockApp(): TokenRingApp {
  return {
    serviceOutput: mock(),
    serviceError: mock(),
  } as unknown as TokenRingApp;
}

function mockService(): RedditService {
  return { name: "RedditService" } as unknown as RedditService;
}

function parsedAccount(overrides: Partial<ResolvedRedditAccountConfig> = {}): ResolvedRedditAccountConfig {
  const base = RedditAccountConfigSchema.parse({ accessToken: "secret-token" });
  const { accessToken: _accessTokenRef, refreshToken: _refreshTokenRef, clientSecret: _clientSecretRef, ...rest } = base;
  return { ...rest, accessToken: "secret-token", ...overrides };
}

async function startProvider(account = parsedAccount()) {
  const provider = new RedditMessagingProvider(mockApp(), mockService(), "reddit", account);
  const fetch = doFetchWithRetry as ReturnType<typeof mock>;

  fetch
    .mockResolvedValueOnce(jsonResponse({ id: "t2_abc", name: "tokenring" }))
    // seed unread inbox
    .mockResolvedValueOnce(jsonResponse({ data: { children: [] } }));

  await provider.start();
  return provider;
}

describe("RedditMessagingProvider", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("connects by looking up /api/v1/me", async () => {
    const provider = await startProvider();
    expect(fetchCall(0).url).toContain("/api/v1/me");
    expect(fetchCall(0).opts).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
    await provider.stop();
  });

  it("resolves targets into pm/post/sub conversation ids", async () => {
    const provider = await startProvider();
    expect(provider.resolveConversation("alice")).toBe("pm:alice");
    expect(provider.resolveConversation("u/alice")).toBe("pm:alice");
    expect(provider.resolveConversation("r/programming")).toBe("sub:programming");
    expect(provider.resolveConversation("pm:bob")).toBe("pm:bob");
    expect(provider.resolveConversation("post:t3_abc")).toBe("post:t3_abc");
    await provider.stop();
  });

  it("holds working placeholders without calling the API", async () => {
    const provider = await startProvider();
    const callsBefore = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls.length;

    const id = await provider.sendMessage("post:t3_1", "***Thinking... ⏳***");
    expect(id.startsWith("pending:")).toBe(true);
    expect((doFetchWithRetry as ReturnType<typeof mock>).mock.calls.length).toBe(callsBefore);

    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValueOnce(
      jsonResponse({
        json: { data: { things: [{ data: { name: "t1_reply1", id: "reply1" } }] } },
      }),
    );

    const realId = await provider.updateMessage("post:t3_1", id, "hello from the bot");
    expect(realId).toBe("t1_reply1");
    expect(lastFetchCall().url).toContain("/api/comment");
    await provider.stop();
  });

  it("sends a private message via /api/compose", async () => {
    const provider = await startProvider();
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValueOnce(jsonResponse({ json: { errors: [], data: {} } }));

    await provider.sendMessage("pm:alice", "private hello");
    expect(lastFetchCall().url).toContain("/api/compose");
    expect(String(lastFetchCall().opts.body)).toContain("to=alice");
    await provider.stop();
  });

  it("delivers polled inbox comments as channel messages", async () => {
    const provider = await startProvider();
    const received: IncomingMessage[] = [];
    provider.onMessage(message => {
      received.push(message);
    });

    (doFetchWithRetry as ReturnType<typeof mock>)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            children: [
              {
                kind: "t1",
                data: {
                  id: "c1",
                  name: "t1_c1",
                  author: "alice",
                  body: "u/tokenring please help",
                  subreddit: "programming",
                  link_id: "t3_post1",
                  parent_id: "t3_post1",
                  was_comment: true,
                },
              },
            ],
          },
        }),
      )
      // mark read
      .mockResolvedValueOnce(jsonResponse({ json: {} }));

    await (provider as unknown as { poll(): Promise<void> }).poll();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        conversationId: "post:t3_post1",
        roomId: "r/programming",
        userId: "alice",
        text: "please help",
        messageId: "t1_c1",
        direct: false,
        addressed: true,
      }),
    );
    await provider.stop();
  });

  it("delivers polled private messages as DMs", async () => {
    const provider = await startProvider();
    const received: IncomingMessage[] = [];
    provider.onMessage(message => {
      received.push(message);
    });

    (doFetchWithRetry as ReturnType<typeof mock>)
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            children: [
              {
                kind: "t4",
                data: {
                  id: "m1",
                  name: "t4_m1",
                  author: "bob",
                  body: "hi bot",
                  subject: "Hello",
                  was_comment: false,
                },
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ json: {} }));

    await (provider as unknown as { poll(): Promise<void> }).poll();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        conversationId: "pm:bob",
        userId: "bob",
        text: "hi bot",
        direct: true,
        addressed: true,
      }),
    );
    await provider.stop();
  });
});
