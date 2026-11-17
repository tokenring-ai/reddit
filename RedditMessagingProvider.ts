import { Buffer } from "node:buffer";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage, IncomingMessageHandler, MembershipHandler, MessagingProvider, SendOptions } from "@tokenring-ai/bot";
import type { FetchRetryOptions } from "@tokenring-ai/utility/http/doFetchWithRetry";
import { HTTPError, HTTPRetriever } from "@tokenring-ai/utility/http/HTTPRetriever";
import { z } from "zod";
import type ProviderStateFile from "./ProviderStateFile.ts";
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

/** Reddit rejects self-post titles longer than this. */
const SELF_POST_TITLE_MAX = 300;

/** Unread inbox items fetched per poll (Reddit's maximum page size). */
const INBOX_PAGE_SIZE = 100;

/** Inbox item names remembered as handled, so none is delivered twice. */
const MAX_REMEMBERED_ITEMS = 1000;

/** Comments, posts and PMs must not be sent twice: retried on a 429 only, never on a 5xx. */
const SEND_ONCE = { idempotent: false } as const;

/** Edit errors meaning the comment is gone (or can no longer be edited), so a new one must be posted. */
const GONE_EDIT_ERRORS = new Set(["DELETED_COMMENT", "DELETED_LINK", "NO_THING_ID", "TOO_OLD", "THREAD_LOCKED"]);

/**
 * Inbox state saved between runs: whether the inbox was ever seeded (so a restart delivers what
 * arrived while it was down instead of marking it read unseen), and the items already handled.
 */
export const RedditInboxStateSchema = z.object({
  /** The account the state belongs to; a token for a different account starts fresh. */
  username: z.string(),
  seeded: z.boolean().default(false),
  handled: z.array(z.string()).default([]),
});

export type RedditInboxStateFile = ProviderStateFile<typeof RedditInboxStateSchema>;

/** A Reddit API error code, from a `json.errors` entry such as `["RATELIMIT", "you are doing that too much", "ratelimit"]`. */
function errorCodes(errors: unknown[]): string[] {
  return errors.map(error => (Array.isArray(error) ? String(error[0]) : String(error)));
}

class RedditApiError extends Error {
  constructor(
    context: string,
    readonly errors: unknown[],
  ) {
    super(`${context} failed: ${JSON.stringify(errors)}`);
  }

  get codes(): string[] {
    return errorCodes(this.errors);
  }
}

export type RedditSelfPost = {
  id: string;
  name: string;
  url?: string;
};

/**
 * One Reddit account, exposed as a messaging transport. Inbound traffic comes
 * from the account inbox (comment replies, username mentions, private messages).
 * Subreddits are rooms bots join via channel config (`reddit:r/programming`).
 */
export default class RedditMessagingProvider implements MessagingProvider {
  readonly maxMessageLength: number;
  /**
   * Comments and PMs are posted once each part is final. Editing a public comment every few
   * hundred milliseconds while a response streams costs rate limit and notifies nobody, and a PM
   * cannot be edited at all.
   */
  readonly editsInPlace = false;

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
  /** Things this account posted in this run, so a reply to one keeps its parent as the reply target. */
  private ownThingIds = new Set<string>();
  /** Inbox items already delivered or skipped, oldest first. */
  private handled = new Set<string>();
  private seeded = false;

  constructor(
    private readonly app: TokenRingApp,
    private readonly service: RedditService,
    readonly accountName: string,
    private readonly config: ResolvedRedditAccountConfig,
    /** Where inbox state persists between runs; without one it lives only in memory. */
    private readonly stateFile?: RedditInboxStateFile,
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

    // The first run ever seeds by setting aside the current unread without delivering it, so the
    // bot does not answer an old backlog. A restart resumes instead: what arrived while it was
    // down is still unread (or not yet handled), and is delivered.
    this.restoreState();
    if (!this.seeded) {
      try {
        await this.seedInbox();
      } catch (error: unknown) {
        this.app.serviceError(this.service, "Could not seed Reddit inbox (will retry):", error);
      }
    }

    this.pollTimer = setInterval(() => {
      void this.poll().catch((error: unknown) => {
        if (!this.stopped) this.app.serviceError(this.service, "Reddit poll error:", error);
      });
    }, this.config.pollIntervalMs);
  }

  /**
   * Stops polling. A poll already in flight checks `stopped` before each item, so it delivers
   * nothing further, and marks read only what it did handle.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.handlers.clear();
    this.membershipHandlers.clear();
    this.pending.clear();
    this.reportedSubs.clear();
  }

  /** Read through a call: `stop()` flips the flag while a poll is suspended in an await, which narrowing cannot see. */
  private isStopped(): boolean {
    return this.stopped;
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
    } catch (error: unknown) {
      // Only a comment that is gone is replaced by a new one. Anything else — a rate limit above
      // all — is thrown for the caller to retry: posting anew would leave a duplicate comment.
      if (!isGoneEditError(error)) throw error;
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
      return this.submitConversationSelfPost(subreddit, text);
    }

    throw new Error(`Reddit messaging provider does not know how to post to conversation "${conversationId}"`);
  }

  private async replyToThing(thingId: string, text: string): Promise<string> {
    const body = new URLSearchParams({
      api_type: "json",
      thing_id: thingId,
      text,
    });

    const response = await this.authedForm("/api/comment", body, "Reddit comment", SEND_ONCE);
    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new RedditApiError("Reddit comment", errors);
    const name = extractCreatedName(response);
    if (!name) throw new Error("Reddit comment failed: response did not include the new comment's id");
    this.rememberOwnThing(name);
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
    if (errors.length > 0) throw new RedditApiError("Reddit edit", errors);
  }

  private async composePrivateMessage(to: string, text: string): Promise<string> {
    const subject = text.split("\n")[0]?.slice(0, 100) || "Message";
    const body = new URLSearchParams({
      api_type: "json",
      to,
      subject,
      text,
    });
    const response = await this.authedForm("/api/compose", body, "Reddit compose PM", SEND_ONCE);
    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new RedditApiError("Reddit compose", errors);
    // /api/compose does not return the new message. The stand-in is deliberately not a `t4_`
    // name, so nothing later tries to reply to it as one: a follow-up composes a new PM.
    const name = extractCreatedName(response);
    if (name) this.rememberOwnThing(name);
    return name ?? `pm-sent-${Date.now()}`;
  }

  /**
   * Publishes a self post on this connected account. Bot traffic to a subreddit
   * still goes through sendMessage, which derives a title from the first line.
   */
  async submitSelfPost(subreddit: string, title: string, text: string): Promise<RedditSelfPost> {
    const sr = normalizeSubreddit(subreddit);
    const postTitle = title.trim();
    const body = text.trim();
    if (!sr) throw new Error("subreddit is required");
    if (!postTitle) throw new Error("title is required");
    if (!body) throw new Error("text is required");
    if (postTitle.length > SELF_POST_TITLE_MAX) throw new Error(`title must be ${SELF_POST_TITLE_MAX} characters or fewer`);

    const response = await this.postSelf(sr, postTitle, body);
    return selfPostFromResponse(response);
  }

  private async submitConversationSelfPost(subreddit: string, text: string): Promise<string> {
    const lines = text.trim().split("\n");
    const title = (lines[0] || "Post").slice(0, SELF_POST_TITLE_MAX);
    const selftext = lines.length > 1 ? lines.slice(1).join("\n").trim() : text;

    const response = await this.postSelf(subreddit, title, selftext);
    const id = response.json?.data?.id;
    return id ? (id.startsWith("t3_") ? id : `t3_${id}`) : `t3_${Date.now()}`;
  }

  private async postSelf(subreddit: string, title: string, text: string) {
    const body = new URLSearchParams({
      api_type: "json",
      sr: subreddit,
      kind: "self",
      title,
      text,
      resubmit: "true",
      sendreplies: "true",
    });

    const response = await this.authedForm("/api/submit", body, "Reddit submit post", SEND_ONCE);
    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new RedditApiError("Reddit submit", errors);
    const name = response.json?.data?.name;
    if (name) this.rememberOwnThing(name);
    return response;
  }

  private restoreState(): void {
    const saved = this.stateFile?.load();
    if (!saved || saved.username !== this.username) return;
    this.seeded = saved.seeded;
    this.handled = new Set(saved.handled);
  }

  private saveState(): void {
    if (!this.stateFile) return;
    try {
      this.stateFile.save({ username: this.username, seeded: this.seeded, handled: [...this.handled] });
    } catch (error: unknown) {
      this.app.serviceError(this.service, `Could not save Reddit inbox state to ${this.stateFile.filePath}:`, error);
    }
  }

  /** Remembers an inbox item as handled, forgetting the oldest past the cap. */
  private rememberHandled(name: string): void {
    this.handled.delete(name);
    this.handled.add(name);
    while (this.handled.size > MAX_REMEMBERED_ITEMS) {
      const oldest = this.handled.values().next().value;
      if (oldest === undefined) break;
      this.handled.delete(oldest);
    }
  }

  private rememberOwnThing(name: string): void {
    this.ownThingIds.add(name);
    if (this.ownThingIds.size > MAX_REMEMBERED_ITEMS) {
      const oldest = this.ownThingIds.values().next().value;
      if (oldest) this.ownThingIds.delete(oldest);
    }
  }

  private fetchUnread(context: string) {
    return this.authedJson(`/message/unread?limit=${INBOX_PAGE_SIZE}&raw_json=1`, { method: "GET" }, RedditListingResponseSchema, context);
  }

  /** Sets the current unread aside, undelivered. Throws on failure; the next poll retries. */
  private async seedInbox(): Promise<void> {
    const listing = await this.fetchUnread("Reddit seed inbox");
    if (this.isStopped()) return;
    const names = listing.data.children.map(child => child.data.name).filter(Boolean);
    for (const name of names) this.rememberHandled(name);
    this.seeded = true;
    this.saveState();
    if (names.length > 0 && this.config.markRead) {
      await this.markRead(names);
    }
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      if (!this.seeded) {
        await this.seedInbox();
        return;
      }

      const listing = await this.fetchUnread("Reddit poll inbox");
      if (this.isStopped()) return;

      // Newest first from API; reverse so bots see oldest first.
      const items = [...listing.data.children].reverse();
      // Everything handled this poll — delivered or skipped — is marked read, so skipped items
      // cannot fill the unread page and stall polling. What is left unhandled stays unread.
      const toMarkRead: string[] = [];

      try {
        for (const child of items) {
          if (this.isStopped()) break;
          const name = child.data.name;
          if (!name) continue;

          if (!this.handled.has(name)) {
            await this.deliverInboxItem(child.kind ?? "", child.data);
            this.rememberHandled(name);
            this.saveState();
          }
          toMarkRead.push(name);
        }
      } finally {
        if (toMarkRead.length > 0 && this.config.markRead) {
          await this.markRead(toMarkRead);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /** Delivers one inbox item, or quietly skips one that is ours, deleted, or of a kind we do not handle. */
  private async deliverInboxItem(kind: string, data: z.output<typeof RedditListingResponseSchema>["data"]["children"][number]["data"]): Promise<void> {
    if (!data.author || data.author === this.username || data.author === "[deleted]") return;

    if (kind === "t4" || data.was_comment === false) {
      await this.emitPm({
        name: data.name,
        author: data.author,
        body: data.body,
        subject: data.subject,
      });
      return;
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
    }
  }

  private async emitPm(data: { name: string; author: string; body?: string | undefined; subject?: string | undefined }): Promise<void> {
    const text = data.body?.trim() || data.subject?.trim() || "";
    const message: IncomingMessage = {
      conversationId: `${PM_PREFIX}${data.author}`,
      userId: data.author,
      userName: `u/${data.author}`,
      text,
      messageId: data.name,
      // The answer goes into this message's PM thread.
      replyToMessageId: data.name,
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
      // The answer goes under this comment, not its parent.
      replyToMessageId: data.parent_id,
      replyTarget: data.name,
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

  private async authedForm(path: string, body: URLSearchParams, context: string, retry?: FetchRetryOptions) {
    const token = await this.getAccessToken();
    return this.oauth.fetchValidatedJson({
      ...(retry ? { retry } : {}),
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

/** Whether an edit failed because the comment is gone, rather than for a reason worth retrying. */
function isGoneEditError(error: unknown): boolean {
  if (error instanceof RedditApiError) return error.codes.some(code => GONE_EDIT_ERRORS.has(code));
  return error instanceof HTTPError && error.status === 404;
}

function selfPostFromResponse(response: import("zod").output<typeof RedditJsonActionSchema>): RedditSelfPost {
  const data = response.json?.data;
  const raw = data?.name ?? data?.id;
  if (!raw) throw new Error("Reddit submit failed: response did not include a post id");
  const name = raw.startsWith("t3_") ? raw : `t3_${raw}`;
  const url = data?.url;
  return url ? { id: name.slice("t3_".length), name, url } : { id: name.slice("t3_".length), name };
}

function normalizeSubreddit(value: string): string {
  return value
    .trim()
    .replace(/^\/?r\//i, "")
    .trim();
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
