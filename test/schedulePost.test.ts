import { afterEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentJobService, AgentManager } from "@tokenring-ai/agent";
import type Agent from "@tokenring-ai/agent/Agent";
import { AgentJobsConfigSchema } from "@tokenring-ai/agent/schema";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent.test";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import ChatService from "@tokenring-ai/chat/ChatService";
import PermissionService, { MemoryPermissionStore } from "@tokenring-ai/chat/PermissionService";
import { permissionSlug } from "@tokenring-ai/chat/permissions/permissionIds";
import { ChatAgentConfigSchema, type ParsedChatConfig } from "@tokenring-ai/chat/schema";
import SchedulerService from "@tokenring-ai/scheduler/SchedulerService";
import { SchedulerConfigSchema } from "@tokenring-ai/scheduler/schema";
import RedditService from "../RedditService.ts";
import schedulePost from "../tools/schedulePost.ts";
import submitPost from "../tools/submitPost.ts";
import tools from "../tools.ts";

const HOUR = 3_600_000;
const future = () => new Date(Date.now() + HOUR).toISOString();
const post = { subreddit: "r/writing", title: "Hello", text: "Body text" };

function fakeAgent({ approve = true, account = "acct" } = {}) {
  const checkToolApproval = mock(async (_options: { safetyLevel: number; permission?: { id: string; summary: string } }) => approve);
  const reddit = {
    resolveAccountName: (name?: string) => {
      if (name && name !== account) throw new Error(`Reddit account "${name}" is not connected`);
      return account;
    },
    submitSelfPost: mock(async () => ({ name: "t3_1", url: "https://reddit.com/x" })),
  };
  const addSchedule = mock((_name: string, _definition: unknown) => ({}));
  const agent = {
    config: { agentType: "social" },
    requireService: (service: unknown) =>
      service === ChatService ? { checkToolApproval } : service === RedditService ? reddit : service === SchedulerService ? { addSchedule } : undefined,
    infoMessage: () => {},
  } as unknown as Agent;
  return { agent, checkToolApproval, reddit, addSchedule };
}

describe("reddit_schedulePost", () => {
  it("is registered next to reddit_submitPost", () => {
    expect(tools.map(tool => tool.name)).toContain("reddit_schedulePost");
  });

  it("shares reddit_submitPost's permission id, summary and level", async () => {
    const now = fakeAgent({ account: "My Account.2" });
    await submitPost.execute(submitPost.inputSchema.parse(post), now.agent);
    const later = fakeAgent({ account: "My Account.2" });
    await schedulePost.execute(schedulePost.inputSchema.parse({ ...post, at: future() }), later.agent);
    const scheduled = later.checkToolApproval.mock.calls[0]![0];
    expect(scheduled.permission).toEqual({ id: `reddit.${permissionSlug("My Account.2")}.post`, summary: "Post on Reddit as My Account.2" });
    expect(scheduled.permission).toEqual(now.checkToolApproval.mock.calls[0]![0].permission);
    expect(scheduled.safetyLevel).toBe(8);
  });

  it("stores a social-reddit-<id> tool schedule whose input is exactly reddit_submitPost's input", async () => {
    const { agent, addSchedule } = fakeAgent();
    const at = new Date(Date.now() + HOUR);
    await schedulePost.execute(schedulePost.inputSchema.parse({ ...post, at: at.toISOString() }), agent);
    const [name, definition] = addSchedule.mock.calls[0]!;
    expect(name).toMatch(/^social-reddit-[0-9a-f]{8}$/);
    expect(definition).toEqual({
      at: at.toISOString(),
      action: {
        kind: "tool",
        agentType: "social",
        tool: "reddit_submitPost",
        input: { subreddit: "writing", title: "Hello", text: "Body text", account: "acct" },
      },
    });
    expect(submitPost.inputSchema.safeParse((definition as { action: { input: unknown } }).action.input).success).toBe(true);
  });

  it("schedules nothing when declined, and refuses bad times, unknown accounts and bad input before asking", async () => {
    const declined = fakeAgent({ approve: false });
    await expect(schedulePost.execute(schedulePost.inputSchema.parse({ ...post, at: future() }), declined.agent)).rejects.toThrow(/did not approve/);
    expect(declined.addSchedule).not.toHaveBeenCalled();

    const { agent, checkToolApproval, addSchedule } = fakeAgent();
    const run = (extra: Record<string, unknown>) => schedulePost.execute(schedulePost.inputSchema.parse({ ...post, at: future(), ...extra }), agent);
    await expect(run({ at: new Date(Date.now() - HOUR).toISOString() })).rejects.toThrow(/must be in the future/);
    await expect(run({ at: "2099-01-01T09:00:00" })).rejects.toThrow(/UTC offset/);
    await expect(run({ account: "ghost" })).rejects.toThrow(/"ghost" is not connected/);
    await expect(run({ title: "t".repeat(301) })).rejects.toThrow(/300 characters/);
    await expect(run({ subreddit: " " })).rejects.toThrow(/subreddit is required/);
    expect(checkToolApproval).not.toHaveBeenCalled();
    expect(addSchedule).not.toHaveBeenCalled();
  });
});

describe("a scheduled Reddit post, end to end (Reddit client stubbed)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function boot() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reddit-scheduled-"));
    dirs.push(dir);
    const app = createTestingApp() as TokenRingApp;
    const starter = createTestingAgent(app);
    const withChat = { ...starter.config, chat: ChatAgentConfigSchema.parse({ systemPrompt: "test" }) };
    app.requireService(AgentManager).addAgentConfigs(withChat);
    const chat = app.addService(ChatService, new ChatService(app));
    chat.getChatConfig = (agent: Agent) => ({ autoToolApprovalLevel: agent.id === starter.id ? 8 : 3, toolApprovalMode: "ask" }) as ParsedChatConfig;
    chat.updateChatConfig = () => {};
    chat.addTools(tools);
    const permissions = app.addService(PermissionService, new PermissionService(app, new MemoryPermissionStore()));
    const submitted: unknown[][] = [];
    const reddit = {
      resolveAccountName: (name?: string) => name ?? "acct",
      async submitSelfPost(...args: unknown[]) {
        submitted.push(args);
        return { name: "t3_9", url: "https://reddit.com/r/writing/9" };
      },
    };
    app.addService(RedditService, reddit as unknown as RedditService);
    const jobs = app.addService(
      AgentJobService,
      new AgentJobService(app, { recordsFile: path.join(dir, "jobs.json"), config: AgentJobsConfigSchema.parse({}) }),
    );
    jobs.setChatIntegration(chat.jobIntegration());
    const scheduler = app.addService(SchedulerService, new SchedulerService(app, { storeFile: path.join(dir, "schedules.json") }));
    scheduler.reconfigure(SchedulerConfigSchema.parse({}));
    scheduler.load();
    const controller = new AbortController();
    scheduler.start(controller.signal);
    return {
      starter,
      permissions,
      jobs,
      scheduler,
      submitted,
      stop: async () => {
        controller.abort();
        jobs.stop();
        await jobs.flush();
        await scheduler.flush();
      },
    };
  }

  async function waitFor(condition: () => boolean, timeoutMs = 3000) {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }

  async function scheduleAndWait(ctx: Awaited<ReturnType<typeof boot>>) {
    await schedulePost.execute(schedulePost.inputSchema.parse({ ...post, at: new Date(Date.now() + 150).toISOString() }), ctx.starter);
    const [name] = ctx.scheduler.listSchedules().map(view => view.name);
    expect(ctx.submitted).toEqual([]);
    await waitFor(() => (ctx.scheduler.getHistory(name!)[name!] ?? []).some(run => run.status !== "running"));
    return ctx.scheduler.getHistory(name!)[name!]!.at(-1)!;
  }

  it("with no grant it is refused and posts nothing; with the grant it posts the exact fixed text", async () => {
    const refused = await boot();
    try {
      const run = await scheduleAndWait(refused);
      expect(run.status).toBe("failed");
      expect(refused.submitted).toEqual([]);
      expect(refused.jobs.get(run.jobId!)?.refusals[0]).toMatchObject({ tool: "reddit_submitPost", permissionId: "reddit.acct.post" });
    } finally {
      await refused.stop();
    }

    const allowed = await boot();
    try {
      await allowed.permissions.grant({ id: "reddit.acct.post" });
      const run = await scheduleAndWait(allowed);
      expect(run.status).toBe("completed");
      expect(allowed.submitted).toEqual([["writing", "Hello", "Body text", "acct"]]);
    } finally {
      await allowed.stop();
    }
  });
});
