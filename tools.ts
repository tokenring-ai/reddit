import getLatestPosts from "./tools/getLatestPosts.ts";
import retrievePost from "./tools/retrievePost.ts";
import schedulePost from "./tools/schedulePost.ts";
import searchSubreddit from "./tools/searchSubreddit.ts";
import submitPost from "./tools/submitPost.ts";

export default [searchSubreddit, retrievePost, getLatestPosts, submitPost, schedulePost];
