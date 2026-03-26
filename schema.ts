import {z} from "zod";

export const RedditConfigSchema = z.object({
  baseUrl: z.string().default("https://www.reddit.com")
});
export type ParsedRedditConfig = z.output<typeof RedditConfigSchema>;