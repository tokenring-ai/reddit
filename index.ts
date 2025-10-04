import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import packageJSON from './package.json' with {type: 'json'};
import RedditService from "./RedditService.js";

import * as tools from "./tools.ts";

export const packageInfo: TokenRingPackage = {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    agentTeam.addTools(packageInfo, tools);
    agentTeam.addServices(new RedditService());
  },
};

export {default as RedditService} from "./RedditService.ts";