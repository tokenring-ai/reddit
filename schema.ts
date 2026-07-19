import { z } from "zod";

export const RedditAccessTokenSchema = z.object({
  access_token: z.string(),
});

export const RedditFlairRichtextSchema = z
  .object({
    e: z.string().optional(),
    t: z.string().optional(),
    a: z.string().optional(),
    u: z.string().optional(),
  })
  .loose();

export const RedditThingDataSchema = z.object({
  // Identity
  id: z.string(),
  name: z.string(),
  permalink: z.string(),
  url: z.string(),
  domain: z.string().optional(),

  // Subreddit
  subreddit: z.string(),
  subreddit_id: z.string().optional(),
  subreddit_name_prefixed: z.string().optional(),
  subreddit_type: z.string().optional(),
  subreddit_subscribers: z.number().optional(),

  // Author
  author: z.string(),
  author_fullname: z.string().optional(),
  author_premium: z.boolean().optional(),
  author_is_blocked: z.boolean().optional(),
  author_patreon_flair: z.boolean().optional(),
  author_flair_type: z.string().nullable().optional(),
  author_flair_text: z.string().nullable().optional(),
  author_flair_css_class: z.string().nullable().optional(),
  author_flair_richtext: z.array(RedditFlairRichtextSchema).optional(),
  author_flair_background_color: z.string().nullable().optional(),
  author_flair_text_color: z.string().nullable().optional(),
  author_flair_template_id: z.string().nullable().optional(),

  // Content
  title: z.string(),
  selftext: z.string().optional(),
  selftext_html: z.string().nullable().optional(),
  is_self: z.boolean().optional(),
  is_video: z.boolean().optional(),
  is_original_content: z.boolean().optional(),
  is_reddit_media_domain: z.boolean().optional(),
  is_meta: z.boolean().optional(),
  is_crosspostable: z.boolean().optional(),
  is_robot_indexable: z.boolean().optional(),
  is_created_from_ads_ui: z.boolean().optional(),
  media_only: z.boolean().optional(),
  over_18: z.boolean().optional(),
  spoiler: z.boolean().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  pinned: z.boolean().optional(),
  stickied: z.boolean().optional(),
  archived: z.boolean().optional(),
  quarantine: z.boolean().optional(),
  clicked: z.boolean().optional(),
  visited: z.boolean().optional(),
  saved: z.boolean().optional(),

  // Thumbnails / media
  thumbnail: z.string().optional(),
  thumbnail_width: z.number().nullable().optional(),
  thumbnail_height: z.number().nullable().optional(),
  media: z.unknown().nullable().optional(),
  media_embed: z.record(z.string(), z.unknown()).optional(),
  secure_media: z.unknown().nullable().optional(),
  secure_media_embed: z.record(z.string(), z.unknown()).optional(),

  // Link flair
  link_flair_text: z.string().nullable().optional(),
  link_flair_type: z.string().optional(),
  link_flair_css_class: z.string().nullable().optional(),
  link_flair_richtext: z.array(RedditFlairRichtextSchema).optional(),
  link_flair_background_color: z.string().nullable().optional(),
  link_flair_text_color: z.string().nullable().optional(),
  link_flair_template_id: z.string().optional(),

  // Scoring
  score: z.number().optional(),
  ups: z.number().optional(),
  downs: z.number().optional(),
  upvote_ratio: z.number().optional(),
  hide_score: z.boolean().optional(),
  likes: z.boolean().nullable().optional(),

  // Comments / engagement
  num_comments: z.number().optional(),
  num_crossposts: z.number().optional(),
  num_reports: z.number().nullable().optional(),
  view_count: z.number().nullable().optional(),
  allow_live_comments: z.boolean().optional(),
  send_replies: z.boolean().optional(),
  suggested_sort: z.string().nullable().optional(),
  discussion_type: z.string().nullable().optional(),
  contest_mode: z.boolean().optional(),

  // Awards / gilding
  gilded: z.number().optional(),
  gildings: z.record(z.string(), z.unknown()).optional(),
  total_awards_received: z.number().optional(),
  all_awardings: z.array(z.unknown()).optional(),
  awarders: z.array(z.unknown()).optional(),
  top_awarded_type: z.string().nullable().optional(),
  can_gild: z.boolean().optional(),

  // Moderation
  approved_at_utc: z.number().nullable().optional(),
  approved_by: z.string().nullable().optional(),
  banned_at_utc: z.number().nullable().optional(),
  banned_by: z.string().nullable().optional(),
  removed_by: z.string().nullable().optional(),
  removed_by_category: z.string().nullable().optional(),
  removal_reason: z.string().nullable().optional(),
  mod_reason_title: z.string().nullable().optional(),
  mod_reason_by: z.string().nullable().optional(),
  mod_note: z.string().nullable().optional(),
  mod_reports: z.array(z.unknown()).optional(),
  user_reports: z.array(z.unknown()).optional(),
  report_reasons: z.array(z.unknown()).nullable().optional(),
  can_mod_post: z.boolean().optional(),
  distinguished: z.string().nullable().optional(),

  // Timestamps
  created: z.number().optional(),
  created_utc: z.number().optional(),
  edited: z.union([z.number(), z.boolean()]).optional(),

  // Misc
  pwls: z.number().nullable().optional(),
  wls: z.number().nullable().optional(),
  category: z.string().nullable().optional(),
  content_categories: z.array(z.string()).nullable().optional(),
  treatment_tags: z.array(z.unknown()).optional(),
  no_follow: z.boolean().optional(),
});

export const RedditThingSchema = z.object({
  kind: z.string().optional(),
  data: RedditThingDataSchema,
});

export const RedditListingResponseSchema = z.object({
  data: z
    .object({
      children: z.array(RedditThingSchema).default([]),
    })
    .prefault({}),
});

export const RedditAccountSchema = z.object({
  oauthBaseUrl: z.string().default("https://oauth.reddit.com"),
  accessToken: z.string().exactOptional().meta({ sensitive: true, description: "OAuth access token" }),
  refreshToken: z.string().exactOptional().meta({ sensitive: true, description: "OAuth refresh token" }),
  clientId: z.string().exactOptional().meta({ description: "Reddit app client ID" }),
  clientSecret: z.string().exactOptional().meta({ sensitive: true, description: "Reddit app client secret" }),
  username: z.string().exactOptional(),
  defaultSubreddit: z.string().exactOptional(),
  social: z.boolean().exactOptional(),
});

export type ParsedRedditAccount = z.output<typeof RedditAccountSchema>;

export const RedditConfigSchema = z.object({
  baseUrl: z.string().exactOptional().default("https://www.reddit.com"),
  userAgent: z.string().default("TokenRing/1.0 (https://github.com/tokenring-ai/monorepo)"),
  accounts: z.record(z.string(), RedditAccountSchema).default({}),
});

export type ParsedRedditConfig = z.output<typeof RedditConfigSchema>;
