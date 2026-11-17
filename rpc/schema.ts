import type { RPCSchema } from "@tokenring-ai/rpc/types";
import { SuccessSchema } from "@tokenring-ai/rpc/types";
import { z } from "zod";

/**
 * Browser-safe: the web app bundles this file, so it imports only zod and the RPC types.
 * Posting here is a person clicking Post in the Social app, which is itself the approval:
 * these methods do not go through agent tool approval and create no permission grants.
 */
export default {
  name: "Reddit RPC",
  path: "/rpc/reddit",
  methods: {
    /** Connected Reddit accounts, and the longest title Reddit accepts. */
    listAccounts: {
      type: "query",
      input: z.object({}),
      result: SuccessSchema.extend({
        accounts: z.array(z.object({ name: z.string() })),
        titleMaxLength: z.number(),
      }),
    },
    /** Publishes a text (self) post to a subreddit. It is public and cannot be unsent. */
    submitPost: {
      type: "mutation",
      input: z.object({
        subreddit: z.string().min(1),
        title: z.string().min(1),
        text: z.string().min(1),
        account: z.string().min(1).exactOptional(),
      }),
      result: SuccessSchema.extend({
        account: z.string(),
        subreddit: z.string(),
        id: z.string(),
        /** Link to the post, when Reddit returns one. */
        url: z.string().exactOptional(),
      }),
    },
  },
} satisfies RPCSchema;
