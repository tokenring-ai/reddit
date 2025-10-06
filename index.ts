import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import {ScriptingService} from "@tokenring-ai/scripting";
import {ScriptingThis} from "@tokenring-ai/scripting/ScriptingService.ts";
import packageJSON from './package.json' with {type: 'json'};
import RedditService from "./RedditService.js";

import * as tools from "./tools.ts";

export const packageInfo: TokenRingPackage = {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    agentTeam.services.waitForItemByType(ScriptingService).then((scriptingService: ScriptingService) => {
      scriptingService.registerFunction("searchSubreddit", {
          type: 'native',
          params: ['subreddit', 'query'],
          async execute(this: ScriptingThis, subreddit: string, query: string): Promise<string> {
            const result = await this.agent.requireServiceByType(RedditService).searchSubreddit(subreddit, query);
            return JSON.stringify(result.data.children);
          }
        }
      );

      scriptingService.registerFunction("getRedditPost", {
          type: 'native',
          params: ['url'],
          async execute(this: ScriptingThis, url: string): Promise<string> {
            const result = await this.agent.requireServiceByType(RedditService).retrievePost(url);
            return JSON.stringify(result);
          }
        }
      );

      scriptingService.registerFunction("getLatestPosts", {
          type: 'native',
          params: ['subreddit'],
          async execute(this: ScriptingThis, subreddit: string): Promise<string> {
            const result = await this.agent.requireServiceByType(RedditService).getLatestPosts(subreddit);
            return JSON.stringify(result.data.children);
          }
        }
      );
    });
    agentTeam.addTools(packageInfo, tools);
    agentTeam.addServices(new RedditService());
  },
};

export {default as RedditService} from "./RedditService.ts";