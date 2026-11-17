import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage } from "@tokenring-ai/bot";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import ProviderStateFile from "../ProviderStateFile.ts";
import RedditMessagingProvider, { RedditInboxStateSchema } from "../RedditMessagingProvider.ts";
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

  it("submits a self post with an explicit title and body", async () => {
    const provider = await startProvider();
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValueOnce(
      jsonResponse({
        json: { errors: [], data: { id: "abc", name: "t3_abc", url: "https://www.reddit.com/r/programming/comments/abc/hello/" } },
      }),
    );

    const post = await provider.submitSelfPost("r/programming", "Hello", "Body text");
    expect(post).toEqual({
      id: "abc",
      name: "t3_abc",
      url: "https://www.reddit.com/r/programming/comments/abc/hello/",
    });

    const params = new URLSearchParams(String(lastFetchCall().opts.body));
    expect(String(lastFetchCall().url)).toContain("https://oauth.reddit.com/api/submit");
    expect(lastFetchCall().opts).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
    expect(params.get("kind")).toBe("self");
    expect(params.get("sr")).toBe("programming");
    expect(params.get("title")).toBe("Hello");
    expect(params.get("text")).toBe("Body text");
    await provider.stop();
  });

  it("does not call the API when a self post is missing a title, text, or subreddit", async () => {
    const provider = await startProvider();
    const calls = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls.length;

    await expect(provider.submitSelfPost("programming", " ", "Body")).rejects.toThrow(/title is required/);
    await expect(provider.submitSelfPost("programming", "Hello", " ")).rejects.toThrow(/text is required/);
    await expect(provider.submitSelfPost(" r/ ", "Hello", "Body")).rejects.toThrow(/subreddit is required/);
    expect((doFetchWithRetry as ReturnType<typeof mock>).mock.calls.length).toBe(calls);
    await provider.stop();
  });

  it("reports Reddit submit errors and does not invent a post id", async () => {
    const provider = await startProvider();
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValueOnce(
      jsonResponse({ json: { errors: [["SUBREDDIT_NOEXIST", "that subreddit does not exist", "sr"]] } }),
    );

    await expect(provider.submitSelfPost("missing", "Hello", "Body")).rejects.toThrow(/Reddit submit failed/);
    await provider.stop();
  });

  it("still submits a subreddit conversation as a self post", async () => {
    const provider = await startProvider();
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValueOnce(jsonResponse({ json: { errors: [], data: { id: "abc" } } }));

    const id = await provider.sendMessage("sub:programming", "Hello\nBody text");
    expect(id).toBe("t3_abc");
    const params = new URLSearchParams(String(lastFetchCall().opts.body));
    expect(params.get("sr")).toBe("programming");
    expect(params.get("title")).toBe("Hello");
    expect(params.get("text")).toBe("Body text");
    await provider.stop();
  });
});

type InboxItem = { kind?: string; name: string; author?: string; body?: string; parent_id?: string; was_comment?: boolean | undefined };

function inbox(items: InboxItem[]) {
  // The API lists newest first.
  return jsonResponse({
    data: {
      children: [...items].reverse().map(item => ({
        kind: item.kind ?? "t1",
        data: {
          id: item.name.slice(3),
          name: item.name,
          author: item.author ?? "alice",
          body: item.body ?? "u/tokenring hi",
          subreddit: "programming",
          link_id: "t3_post1",
          parent_id: item.parent_id ?? "t3_post1",
          was_comment: "was_comment" in item ? item.was_comment : true,
        },
      })),
    },
  });
}

function fetchMock() {
  return doFetchWithRetry as ReturnType<typeof mock>;
}

function markReadCalls() {
  return fetchMock()
    .mock.calls.filter(call => String(call[0]).includes("/api/read_message"))
    .map(call => new URLSearchParams(String((call[1] as { body: string }).body)).get("id"));
}

function poll(provider: RedditMessagingProvider) {
  return (provider as unknown as { poll(): Promise<void> }).poll();
}

describe("RedditMessagingProvider sending", () => {
  beforeEach(() => {
    mock.clearAllMocks();
    fetchMock().mockReset();
  });

  it("posts each response once, when final, rather than editing it while it streams", async () => {
    const provider = await startProvider();
    expect(provider.editsInPlace).toBe(false);
    await provider.stop();
  });

  it("throws on a comment rejected inside a 200 response, and never invents an id", async () => {
    const provider = await startProvider();
    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { errors: [["RATELIMIT", "you are doing that too much", "ratelimit"]] } }));
    await expect(provider.sendMessage("post:t3_1", "hello")).rejects.toThrow(/RATELIMIT/);

    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { errors: [], data: {} } }));
    await expect(provider.sendMessage("post:t3_1", "hello")).rejects.toThrow(/did not include/);
    await provider.stop();
  });

  it("sends comments, posts and PMs without retrying server errors", async () => {
    const provider = await startProvider();
    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { data: { things: [{ data: { name: "t1_x" } }] } } }));
    await provider.sendMessage("post:t3_1", "hello");
    expect(fetchMock().mock.calls.at(-1)?.[2]).toEqual({ idempotent: false });

    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { errors: [], data: {} } }));
    await provider.sendMessage("pm:alice", "hello");
    expect(String(fetchMock().mock.calls.at(-1)?.[0])).toContain("/api/compose");
    expect(fetchMock().mock.calls.at(-1)?.[2]).toEqual({ idempotent: false });

    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { errors: [], data: { name: "t3_p" } } }));
    await provider.submitSelfPost("programming", "Title", "Body");
    expect(fetchMock().mock.calls.at(-1)?.[2]).toEqual({ idempotent: false });
    await provider.stop();
  });

  it("throws on a rate-limited edit instead of posting a duplicate comment", async () => {
    const provider = await startProvider();
    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { errors: [["RATELIMIT", "slow down", "ratelimit"]] } }));
    await expect(provider.updateMessage("post:t3_1", "t1_mine", "edited")).rejects.toThrow(/RATELIMIT/);

    fetchMock().mockResolvedValueOnce(jsonResponse({ error: 429 }, 429));
    await expect(provider.updateMessage("post:t3_1", "t1_mine", "edited")).rejects.toThrow(/429/);

    expect(fetchMock().mock.calls.some(call => String(call[0]).includes("/api/comment"))).toBe(false);
    await provider.stop();
  });

  it("replaces a deleted comment with a new one", async () => {
    const provider = await startProvider();
    fetchMock()
      .mockResolvedValueOnce(jsonResponse({ json: { errors: [["DELETED_COMMENT", "that comment has been deleted", "thing_id"]] } }))
      .mockResolvedValueOnce(jsonResponse({ json: { data: { things: [{ data: { name: "t1_new" } }] } } }));
    expect(await provider.updateMessage("post:t3_1", "t1_gone", "edited")).toBe("t1_new");
    expect(String(fetchMock().mock.calls.at(-1)?.[0])).toContain("/api/comment");
    await provider.stop();
  });
});

describe("RedditMessagingProvider inbox polling", () => {
  let dir: string;

  beforeEach(() => {
    mock.clearAllMocks();
    fetchMock().mockReset();
    // Anything not queued below — mark-read calls — succeeds.
    fetchMock().mockResolvedValue(jsonResponse({ json: {} }));
    dir = mkdtempSync(path.join(tmpdir(), "reddit-inbox-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function stateFile() {
    return new ProviderStateFile(path.join(dir, "reddit.json"), RedditInboxStateSchema);
  }

  async function start(account = parsedAccount(), file = stateFile(), seed: Response | Error | null = inbox([])) {
    fetchMock().mockResolvedValueOnce(jsonResponse({ id: "t2_abc", name: "tokenring" }));
    if (seed instanceof Error) fetchMock().mockRejectedValueOnce(seed);
    else if (seed) fetchMock().mockResolvedValueOnce(seed);
    const provider = new RedditMessagingProvider(mockApp(), mockService(), "reddit", account, file);
    const received: IncomingMessage[] = [];
    provider.onMessage(message => {
      received.push(message);
    });
    await provider.start();
    return { provider, received };
  }

  it("answers a comment under the comment itself, and a reply to our own comment under ours", async () => {
    const { provider, received } = await start();
    fetchMock().mockResolvedValueOnce(jsonResponse({ json: { data: { things: [{ data: { name: "t1_ours" } }] } } }));
    await provider.sendMessage("post:t3_post1", "a question");

    fetchMock().mockResolvedValueOnce(
      inbox([
        { name: "t1_a", parent_id: "t1_someone_else" },
        { name: "t1_b", parent_id: "t1_ours" },
        { kind: "t4", name: "t4_c", was_comment: false },
      ]),
    );
    await poll(provider);

    // [message, its parent, where the answer goes]: always under the message itself.
    expect(received.map(message => [message.messageId, message.replyToMessageId, message.replyTarget ?? message.replyToMessageId])).toEqual([
      ["t1_a", "t1_someone_else", "t1_a"],
      ["t1_b", "t1_ours", "t1_b"],
      ["t4_c", "t4_c", "t4_c"],
    ]);
    await provider.stop();
  });

  it("marks skipped items read along with delivered ones, so they cannot stall the inbox", async () => {
    const { provider, received } = await start();
    fetchMock().mockResolvedValueOnce(
      inbox([
        { name: "t1_self", author: "tokenring" },
        { name: "t1_gone", author: "[deleted]" },
        { kind: "t3", name: "t3_odd", was_comment: undefined },
        { name: "t1_real" },
      ]),
    );
    await poll(provider);

    expect(received.map(message => message.messageId)).toEqual(["t1_real"]);
    expect(markReadCalls().at(-1)).toBe("t1_self,t1_gone,t3_odd,t1_real");
    await provider.stop();
  });

  it("stops mid-poll without delivering or marking read the rest", async () => {
    const { provider, received } = await start();
    provider.onMessage(async () => {
      await provider.stop();
    });
    fetchMock().mockResolvedValueOnce(inbox([{ name: "t1_1" }, { name: "t1_2" }, { name: "t1_3" }]));
    await poll(provider);

    expect(received.map(message => message.messageId)).toEqual(["t1_1"]);
    expect(markReadCalls().at(-1)).toBe("t1_1");
  });

  it("with markRead off, delivers each item once though it stays unread", async () => {
    const { provider, received } = await start(parsedAccount({ markRead: false }));
    fetchMock()
      .mockResolvedValueOnce(inbox([{ name: "t1_1" }]))
      .mockResolvedValueOnce(inbox([{ name: "t1_1" }, { name: "t1_2" }]));
    await poll(provider);
    await poll(provider);

    expect(received.map(message => message.messageId)).toEqual(["t1_1", "t1_2"]);
    expect(markReadCalls()).toEqual([]);
    await provider.stop();
  });

  it("does not deliver until the inbox is seeded, retrying a failed seed", async () => {
    const { provider, received } = await start(parsedAccount(), stateFile(), new Error("inbox down"));
    fetchMock().mockResolvedValueOnce(inbox([{ name: "t1_old" }]));
    await poll(provider);
    expect(received).toHaveLength(0);
    expect(markReadCalls().at(-1)).toBe("t1_old");

    fetchMock().mockResolvedValueOnce(inbox([{ name: "t1_new" }]));
    await poll(provider);
    expect(received.map(message => message.messageId)).toEqual(["t1_new"]);
    await provider.stop();
  });

  it("delivers what arrived while it was down after a restart, without redelivering what it handled", async () => {
    const file = stateFile();
    const first = await start(parsedAccount({ markRead: false }), file, inbox([{ name: "t1_old" }]));
    fetchMock().mockResolvedValueOnce(inbox([{ name: "t1_old" }, { name: "t1_1" }]));
    await poll(first.provider);
    expect(first.received.map(message => message.messageId)).toEqual(["t1_1"]);
    await first.provider.stop();

    // No seed this time: the saved state says the inbox was seeded.
    const second = await start(parsedAccount({ markRead: false }), file, null);
    fetchMock().mockResolvedValueOnce(inbox([{ name: "t1_old" }, { name: "t1_1" }, { name: "t1_downtime" }]));
    await poll(second.provider);
    expect(second.received.map(message => message.messageId)).toEqual(["t1_downtime"]);
    await second.provider.stop();
  });
});
