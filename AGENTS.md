# Project Agent Instructions

## Skills are mandatory, not optional

**ALWAYS invoke the relevant skill before doing work.** Do not rely on your own judgment, training, or built-in workflows when a project skill applies to the task. Skills encode how we want work done in this project — skipping them produces output that misses project-specific patterns, stack conventions, and past lessons.

**This overrides Claude Code's built-in workflows.** Plan mode's phases (Explore → Plan agent → Review → final plan) are a scaffold, not a replacement for `writing-plans`, `brainstorming`, or other planning skills. If a skill applies, invoke it _inside_ plan mode's phases — not instead of them. The same rule holds for any other built-in behavior that would otherwise lead you to skip a skill.

## Pre-flight checklist — run BEFORE every non-trivial task

Before doing anything else on a new task (reading files, writing plans, exploring the codebase, delegating to sub-agents):

1. **Invoke `using-superpowers` first.** This is the default entry point for any real task. It routes to the right skills and establishes how to find and use them.
2. **Scan the skills list against the task.** Mentally map the task to skills using the routing table below. Multiple skills usually apply — invoke all that match.
3. **Invoke matching skills before any other action.** No exploration, no planning, no file reads until the relevant skills have been invoked.

If you catch yourself mid-task having skipped this checklist, stop and run it immediately. Do not rationalize that "it's too late now" or "the task is almost done."

## Task → skill routing (binding)

| If you are about to…                                    | You MUST first invoke                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Start any non-trivial task                              | `using-superpowers`                                                           |
| Create a feature, component, or new behavior            | `brainstorming`                                                               |
| Write a multi-step implementation plan                  | `writing-plans`                                                               |
| Execute an existing plan                                | `executing-plans` (plus `subagent-driven-development` when tasks parallelize) |
| Dispatch multiple independent sub-agents in parallel    | `dispatching-parallel-agents`                                                 |
| Write or modify production code                         | `test-driven-development`                                                     |
| Debug a bug, test failure, or unexpected behavior       | `systematic-debugging`                                                        |
| Claim work is complete, passing, fixed, or ready        | `verification-before-completion`                                              |
| Receive code review feedback                            | `receiving-code-review`                                                       |
| Request code review or verify work against requirements | `requesting-code-review`                                                      |
| Finish a development branch / decide how to integrate   | `finishing-a-development-branch`                                              |
| Touch Next.js App Router code                           | `nextjs`                                                                      |
| Touch shadcn/ui components or registries                | `shadcn`                                                                      |
| Touch Better Auth configuration or auth flows           | `better-auth-best-practices`                                                  |
| Optimize or review React / Next.js performance          | `vercel-react-best-practices`                                                 |
| Build, modify, or review an MCP server                  | `mcp-builder`                                                                 |
| Build or review a frontend design / UI                  | `frontend-design`, `web-design-guidelines`                                    |
| Work with Claude API / Anthropic SDK code               | `claude-api`                                                                  |
| Automate browser testing                                | `playwright-cli`                                                              |
| Look for a skill you think might exist                  | `find-skills`                                                                 |

Stack-specific skills (`nextjs`, `shadcn`, `better-auth-best-practices`, `mcp-builder`) compose with workflow skills (`brainstorming`, `writing-plans`, `test-driven-development`). Invoking one does not excuse you from invoking the others.

## Hard rules (violations are bugs, not preferences)

1. **Never skip `brainstorming` before creative work.** Its description says MUST. That MUST is binding in this project.
2. **Never write an implementation plan — in plan mode or out of it — without `writing-plans`.** Plan mode's built-in workflow is not a substitute.
3. **Never write production code without `test-driven-development`.** Tests first, code second.
4. **Never debug by pattern-matching.** Use `systematic-debugging` for every bug, test failure, or unexpected behavior — even ones that look obvious.
5. **Never claim something is done, fixed, working, or passing without first running `verification-before-completion`.** Evidence before assertions, always.
6. **Never touch the Next.js / shadcn / Better Auth / MCP layers without their corresponding stack skill.** They are not optional reference material — they are mandatory consultations.
7. **When in doubt, invoke `using-superpowers` and let it route.** Do not guess which skill applies — let the routing skill decide.

## If no skill matches

Only then fall back to your own judgment. When you do, state explicitly in your response: _"I checked the skills list and none applied because …"_ — so the user can correct you if you missed one.

## Why this is strict

Earlier sessions showed that "lean towards" language gets discounted when it competes with explicit built-in workflows (like plan mode). Soft preferences lose; hard rules win. This file is strict because the previous version was not strict enough.
