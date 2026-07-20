import { Buffer } from "node:buffer";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage, IncomingMessageHandler, MembershipHandler, MessagingProvider, SendOptions } from "@tokenring-ai/bot";
import { HTTPRetriever } from "@tokenring-ai/utility/http/HTTPRetriever";
import type RedditService from "./RedditService.ts";
import { RedditAccessTokenSchema, RedditJsonActionSchema, RedditListingResponseSchema, RedditMeSchema, type ResolvedRedditAccountConfig } from "./schema.ts";

/** Matches the working placeholder ConversationStream posts before real text arrives. */
const WORKING_PLACEHOLDER = /^\*\*\*.*⏳\*\*\*$/;

/**
 * Conversation ids on this transport:
 * - `pm:{username}` — private message thread with a user
 * - `post:{t3_id}` — comment thread under a submission
 * - `sub:{name}` — a subreddit (used for join announcements / outbound posts)
 */
const PM_PREFIX = "pm:";
const POST_PREFIX = "post:";
const SUB_PREFIX = "sub:";
const PENDING_PREFIX = "pending:";

/**
 * One Reddit account, exposed as a messaging transport. Inbound traffic comes
 * from the account inbox (comment replies, username mentions, private messages).
 * Subreddits are rooms bots join via channel config (`reddit:r/programming`).
 */
export default class RedditMessagingProvider implements MessagingProvider {
  readonly maxMessageLength: number;

  private oauth!: HTTPRetriever;
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;
  private username = "";
  private userId = "";
  private handlers = new Set<IncomingMessageHandler>();
  private membershipHandlers = new Set<MembershipHandler>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private stopped = false;
  private reportedSubs = new Set<string>();
  private pendingSeq = 0;
  private pending = new Map<string, { conversationId: string; options?: SendOptions | undefined }>();
  /** Fullnames of comments we authored, for edit and reply addressing. */
  private ownThings = new Set<string>();

  constructor(
    private readonly app: TokenRingApp,
    private readonly service: RedditService,
    readonly accountName: string,
    private readonly config: ResolvedRedditAccountConfig,
  ) {
    this.maxMessageLength = config.maxMessageLength;
    this.accessToken = config.accessToken;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.oauth = new HTTPRetriever({
      baseUrl: this.config.oauthBaseUrl,
      headers: { "User-Agent": this.config.userAgent },
      timeout: 15_000,
    });

    const me = await this.authedJson("/api/v1/me", { method: "GET" }, RedditMeSchema, "Reddit account lookup");
    this.username = me.name;
    this.userId = String(me.id);

    this.app.serviceOutput(this.service, `Reddit account ${this.accountName} connected as u/${this.username}`);

    // Seed by consuming current unread without delivering, so reconnect does not
    // replay the whole inbox.
    await this.seedInbox();

    this.pollTimer = setInterval(() => {
      void this.poll().catch((error: unknown) => {
        this.app.serviceError(this.service, "Reddit poll error:", error);
      });
    }, this.config.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.handlers.clear();
    this.membershipHandlers.clear();
    this.pending.clear();
    this.ownThings.clear();
    this.reportedSubs.clear();
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handlers.add(handler);
  }

  onMembershipChange(handler: MembershipHandler): void {
    this.membershipHandlers.add(handler);
  }

  /**
   * Accepts:
   * - `r/{sub}` / `{sub}` → subreddit room
   * - `pm:{user}` / `post:{id}` / `sub:{name}` already in transport form
   * - bare username → private message conversation
   */
  resolveConversation(targetId: string): string {
    if (targetId.startsWith(PM_PREFIX) || targetId.startsWith(POST_PREFIX) || targetId.startsWith(SUB_PREFIX)) {
      return targetId;
    }
    const sub = parseSubredditTarget(targetId);
    if (sub) return `${SUB_PREFIX}${sub}`;
    return `${PM_PREFIX}${targetId.replace(/^u\//i, "")}`;
  }

  async sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<string> {
    if (WORKING_PLACEHOLDER.test(text.trim())) {
      const pendingId = `${PENDING_PREFIX}${++this.pendingSeq}`;
      this.pending.set(pendingId, { conversationId, options });
      return pendingId;
    }
    return this.post(conversationId, text, options);
  }

  async updateMessage(conversationId: string, messageId: string, text: string): Promise<string> {
    if (messageId.startsWith(PENDING_PREFIX)) {
      const pending = this.pending.get(messageId);
      if (!pending) return messageId;
      if (WORKING_PLACEHOLDER.test(text.trim())) return messageId;
      this.pending.delete(messageId);
      return this.post(pending.conversationId, text, pending.options);
    }

    try {
      await this.editThing(messageId, text);
      return messageId;
    } catch {
      return this.post(conversationId, text, { replyToMessageId: messageId });
    }
  }

  private async post(conversationId: string, text: string, options?: SendOptions): Promise<string> {
    if (conversationId.startsWith(PM_PREFIX)) {
      const user = conversationId.slice(PM_PREFIX.length);
      const parent = options?.replyToMessageId && !options.replyToMessageId.startsWith(PENDING_PREFIX) ? options.replyToMessageId : undefined;
      if (parent?.startsWith("t4_") || parent?.startsWith("t1_")) {
        return this.replyToThing(parent, text);
      }
      return this.composePrivateMessage(user, text);
    }

    if (conversationId.startsWith(POST_PREFIX)) {
      const postId = conversationId.slice(POST_PREFIX.length);
      const parent =
        options?.replyToMessageId && !options.replyToMessageId.startsWith(PENDING_PREFIX)
          ? options.replyToMessageId
          : postId.startsWith("t3_")
            ? postId
            : `t3_${postId}`;
      return this.replyToThing(parent, text);
    }

    if (conversationId.startsWith(SUB_PREFIX)) {
      const subreddit = conversationId.slice(SUB_PREFIX.length);
      return this.submitSelfPost(subreddit, text);
    }

    throw new Error(`Reddit messaging provider does not know how to post to conversation "${conversationId}"`);
  }

  private async replyToThing(thingId: string, text: string): Promise<string> {
    const body = new URLSearchParams({
      api_type: "json",
      thing_id: thingId,
      text,
    });

    const response = await this.authedForm("/api/comment", body, "Reddit comment");
    const name = extractCreatedName(response) ?? `t1_${Date.now()}`;
    this.rememberOwn(name);
    return name;
  }

  private async editThing(thingId: string, text: string): Promise<void> {
    const body = new URLSearchParams({
      api_type: "json",
      thing_id: thingId,
      text,
    });
    const response = await this.authedForm("/api/editusertext", body, "Reddit edit");
    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new Error(`Reddit edit failed: ${JSON.stringify(errors)}`);
  }

  private async composePrivateMessage(to: string, text: string): Promise<string> {
    const subject = text.split("\n")[0]?.slice(0, 100) || "Message";
    const body = new URLSearchParams({
      api_type: "json",
      to,
      subject,
      text,
    });
    const response = await this.authedForm("/api/compose", body, "Reddit compose PM");
    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new Error(`Reddit compose failed: ${JSON.stringify(errors)}`);
    return extractCreatedName(response) ?? `t4_${Date.now()}`;
  }

  private async submitSelfPost(subreddit: string, text: string): Promise<string> {
    const lines = text.trim().split("\n");
    const title = (lines[0] || "Post").slice(0, 300);
    const selftext = lines.length > 1 ? lines.slice(1).join("\n").trim() : text;

    const body = new URLSearchParams({
      api_type: "json",
      sr: subreddit,
      kind: "self",
      title,
      text: selftext,
      resubmit: "true",
      sendreplies: "true",
    });

    const response = await this.authedForm("/api/submit", body, "Reddit submit post");
    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new Error(`Reddit submit failed: ${JSON.stringify(errors)}`);
    const id = response.json?.data?.id;
    const name = id ? (id.startsWith("t3_") ? id : `t3_${id}`) : `t3_${Date.now()}`;
    this.rememberOwn(name);
    return name;
  }

  private async seedInbox(): Promise<void> {
    try {
      const listing = await this.authedJson("/message/unread?limit=25&raw_json=1", { method: "GET" }, RedditListingResponseSchema, "Reddit seed inbox");
      const names = listing.data.children.map(child => child.data.name).filter(Boolean);
      if (names.length > 0 && this.config.markRead) {
        await this.markRead(names);
      }
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Could not seed Reddit inbox:", error);
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      const listing = await this.authedJson("/message/unread?limit=25&raw_json=1", { method: "GET" }, RedditListingResponseSchema, "Reddit poll inbox");

      // Newest first from API; reverse so bots see oldest first.
      const items = [...listing.data.children].reverse();
      const delivered: string[] = [];

      for (const child of items) {
        const kind = child.kind ?? "";
        const data = child.data;
        if (!data.name || !data.author || data.author === this.username || data.author === "[deleted]") continue;

        if (kind === "t4" || data.was_comment === false) {
          await this.emitPm({
            name: data.name,
            author: data.author,
            body: data.body,
            subject: data.subject,
            parent_id: data.parent_id,
          });
          delivered.push(data.name);
          continue;
        }

        // Comment reply or username mention (t1, or was_comment true).
        if (kind === "t1" || data.was_comment === true) {
          await this.emitComment({
            name: data.name,
            author: data.author,
            body: data.body,
            subreddit: data.subreddit,
            link_id: data.link_id,
            parent_id: data.parent_id,
          });
          delivered.push(data.name);
        }
      }

      if (delivered.length > 0 && this.config.markRead) {
        await this.markRead(delivered);
      }
    } finally {
      this.polling = false;
    }
  }

  private async emitPm(data: {
    name: string;
    author: string;
    body?: string | undefined;
    subject?: string | undefined;
    parent_id?: string | undefined;
  }): Promise<void> {
    const text = data.body?.trim() || data.subject?.trim() || "";
    const message: IncomingMessage = {
      conversationId: `${PM_PREFIX}${data.author}`,
      userId: data.author,
      userName: `u/${data.author}`,
      text,
      messageId: data.name,
      replyToMessageId: data.parent_id,
      hasAttachments: false,
      direct: true,
      addressed: true,
    };
    await this.emit(message);
  }

  private async emitComment(data: {
    name: string;
    author: string;
    body?: string | undefined;
    subreddit?: string | undefined;
    link_id?: string | undefined;
    parent_id?: string | undefined;
  }): Promise<void> {
    const linkId = data.link_id ?? data.parent_id;
    if (!linkId) return;

    const postId = linkId.startsWith("t3_") ? linkId : `t3_${linkId}`;
    const roomId = data.subreddit ? `r/${data.subreddit}` : undefined;

    if (roomId) await this.reportSubOnFirstSight(roomId, data.subreddit);

    const raw = data.body ?? "";

    const message: IncomingMessage = {
      conversationId: `${POST_PREFIX}${postId}`,
      roomId,
      userId: data.author,
      userName: `u/${data.author}`,
      text: this.stripOwnMention(raw),
      messageId: data.name,
      replyToMessageId: data.parent_id ?? postId,
      hasAttachments: false,
      // Inbox items are already directed at this account (reply or mention).
      direct: false,
      addressed: true,
    };
    await this.emit(message);
  }

  private async reportSubOnFirstSight(roomId: string, title?: string): Promise<void> {
    if (this.reportedSubs.has(roomId)) return;
    this.reportedSubs.add(roomId);

    this.app.serviceOutput(this.service, `Reddit account ${this.accountName} received traffic from ${roomId}`);

    for (const handler of this.membershipHandlers) {
      try {
        await handler({ conversationId: roomId, title: title ? `r/${title}` : roomId, joined: true, via: "observed" });
      } catch (error: unknown) {
        this.app.serviceError(this.service, "Error delivering Reddit membership event:", error);
      }
    }
  }

  private async emit(message: IncomingMessage): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(message);
      } catch (error: unknown) {
        this.app.serviceError(this.service, "Error delivering Reddit message to bot handler:", error);
      }
    }
  }

  private async markRead(names: string[]): Promise<void> {
    if (names.length === 0) return;
    const body = new URLSearchParams({ id: names.join(",") });
    try {
      await this.authedForm("/api/read_message", body, "Reddit mark read");
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Failed to mark Reddit messages read:", error);
    }
  }

  private stripOwnMention(text: string): string {
    if (!this.username) return text;
    return text
      .replace(new RegExp(`/?u/${escapeRegExp(this.username)}(?![A-Za-z0-9_-])`, "gi"), "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  private rememberOwn(name: string): void {
    this.ownThings.add(name);
    if (this.ownThings.size > 2000) {
      const oldest = this.ownThings.values().next().value;
      if (oldest) this.ownThings.delete(oldest);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }
    if (this.accessToken && !this.config.refreshToken) {
      return this.accessToken;
    }
    if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) {
      if (this.accessToken) return this.accessToken;
      throw new Error(`Reddit account "${this.accountName}" needs an accessToken, or refreshToken + clientId + clientSecret`);
    }

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
    });

    // tokenUrl is the full endpoint (default https://www.reddit.com/api/v1/access_token).
    const tokenUrl = new URL(this.config.tokenUrl);
    const tokenRetriever = new HTTPRetriever({
      baseUrl: tokenUrl.origin,
      headers: { "User-Agent": this.config.userAgent },
      timeout: 15_000,
    });

    const result = await tokenRetriever.fetchValidatedJson({
      url: `${tokenUrl.pathname}${tokenUrl.search}`,
      opts: {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      schema: RedditAccessTokenSchema,
      context: "Reddit token refresh",
    });

    this.accessToken = result.access_token;
    this.tokenExpiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }

  private async authedJson<T extends import("zod").ZodType>(
    path: string,
    opts: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
    schema: T,
    context: string,
  ): Promise<import("zod").output<T>> {
    const token = await this.getAccessToken();
    return this.oauth.fetchValidatedJson({
      url: path,
      opts: {
        ...opts,
        headers: {
          ...opts.headers,
          Authorization: `Bearer ${token}`,
        },
      },
      schema,
      context,
    });
  }

  private async authedForm(path: string, body: URLSearchParams, context: string) {
    const token = await this.getAccessToken();
    return this.oauth.fetchValidatedJson({
      url: path,
      opts: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      schema: RedditJsonActionSchema,
      context,
    });
  }
}

function extractCreatedName(response: import("zod").output<typeof RedditJsonActionSchema>): string | undefined {
  const things = response.json?.data?.things;
  const fromThings = things?.[0]?.data?.name ?? things?.[0]?.data?.id;
  if (fromThings) return fromThings.startsWith("t") ? fromThings : `t1_${fromThings}`;
  const id = response.json?.data?.id;
  return id;
}

/** Accepts `r/foo`, `/r/foo`, or bare `foo` when it looks like a subreddit target. */
function parseSubredditTarget(targetId: string): string | undefined {
  const match = /^(?:\/?r\/)?([A-Za-z0-9][A-Za-z0-9_]{1,20})$/.exec(targetId);
  if (!match) return undefined;
  // Bare usernames and subreddit names look alike; only treat as sub when prefixed with r/.
  if (!/^[/]?r\//i.test(targetId)) return undefined;
  return match[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
