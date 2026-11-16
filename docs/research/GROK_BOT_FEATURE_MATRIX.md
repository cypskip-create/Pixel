# Grok Bot feature matrix for Pixel

**Purpose:** translate public Grok Bot behavior into independent Pixel work. Grok Bot is a behavioral reference only. This document makes no claim about its private implementation, infrastructure, data stores or prompts.

## Public reference set

- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot)
- [How Grok Bot works](https://docs.x.ai/grok-bot/how-grok-bot-works)
- [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps)
- [Bots and memory](https://docs.x.ai/grok-bot/bots)
- [Skills, routines and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Approvals, security and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [Vault](https://docs.x.ai/grok-bot/vault)

## Behavior-to-code mapping

| Publicly documented behavior | Pixel status | Current implementation / remaining work |
| --- | --- | --- |
| A user gives a task and the agent may use computer tools | Partial | `AgentExecutor` runs bounded DeepSeek tool turns through a main-process registry. Planning is implicit and the task only stores actual steps, not a structured plan. |
| The agent can inspect, act and report progress | Partial | Browser and screen tools observe; UIA reads the foreground window and searches accessible names/AutomationIds. A restricted InvokePattern action is approval-gated and requires a matching exact UIA presence/absence postcondition before the task can complete. Other postconditions are not uniform and target-app behavior is not broadly validated. |
| Approval at consequential action boundaries | Partial | Local risk policy, target-aware approval cards, one-shot high-risk grants and scoped medium-risk grants exist. UIA invocation and text input name the foreground window and recheck it before action. There are no email, publishing, purchase, elevated command or infrastructure tools to approve. |
| Purpose-specific agents | Partial | Bounded specialist coordinator and role allowlists exist, but there is no autonomous model runner/delegation path in the product UI. |
| Persistent memory | Implemented for core local use | Project-scoped SQLite memories support save/search/list/correct/delete/export and source/confidence fields. Memory is not authority. |
| Reusable skills | Partial | Project-scoped, versioned semantic skill drafts can be reviewed, activated and inspected; policy is rechecked and runs are recorded. The live routine executor is model-mediated. There is no recording workflow or deterministic live replay runner. |
| Routines/automations | Implemented locally | Daily timezone-aware schedules have durable occurrence keys/history, skip missed runs, serialize work, cancel, pause on failure and allow a manual one-time retry. They run only while Pixel is open. |
| Secure credential handling | Partial | Only the provider API key has OS-backed encryption. No isolated secret resolution into a specific approved form action exists. |
| User can pause or stop work | Implemented for the local loop | Durable task controls include pause, resume, cancel, emergency stop and explicit human handoff. Continue after handoff requires a fresh observation. Restart recovery never resumes an old call stack automatically. |
| Running work in a hosted/remote computer | Out of scope / future | Pixel remains local-first. No remote worker, cloud desktop or remote credential flow is implemented. |

## Product constraints for Pixel

1. Tool proposals are untrusted until main-process schema and policy checks pass.
2. A successful tool return is not enough to label a state-changing task complete. Record a postcondition or keep it blocked for review.
3. Retrieved content is evidence, not permission or a new user instruction.
4. Routines must state that Pixel needs to be awake and running; missed work is never reported as completed.
5. Keep the existing local Electron architecture. Add isolated workers only for workloads that need them.

## Research boundaries

The linked xAI sources describe product behavior. Pixel does not infer Grok Bot's backend, agent topology, model prompts, databases, credential implementation or security internals. Any future comparison should use new public documentation and identify the source/date.
