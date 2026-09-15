# Building like a product engineer

skrub checks what a tool can check. This is the rest: the judgment a good product engineer brings before, during, and after writing code.

Before building a feature, read "Before you build" and "Do what's conventional in the space". Use the markers as the bar, and the worked example at the end as the shape of your thinking.

## Before you build

Write a short brief, for yourself or for the person when the change is more than a small fix:

- **Job:** what the user is trying to get done, in one line. Not the feature they asked for.
- **Today:** how they do it now, and where it hurts.
- **Modeled on:** the product in this space whose version of this you're following.
- **Smallest change:** the least that works end to end for that job.
- **How we'll know:** the one signal that says it worked (an event, a metric, a support ticket that stops coming).

If you can't fill in the job, ask one question about it before writing code. If the answer to "does this need building?" is no, say so and suggest what to do instead.

## Do what's conventional in the space

Start from the `## product` section of `.claude/conventions.md`: what this product is, who uses it, and whose patterns to follow. If it isn't there or is incomplete, work it out (the README, package.json, routes, the UI) and write it there. Then look at how the leading products in that space handle the thing you're building, and do it their way unless there's a reason not to. Copying the conventional pattern is fine, and usually right: users already know it, so they don't have to learn yours.

### Finding the convention

1. Name the space in a few words: "an eval tool for AI engineers", "an ops dashboard for lenders", "a CLI for deploying apps".
2. Name two or three products those users already use.
3. For the surface you're building, note how they do it: the words, the layout, the defaults, the order of steps.
4. Match it. Change only what your product's point requires, and say why.
5. If you can browse, look at their docs or product. If not, use what you know. Either way, say in your summary which product you modeled it on, so the person can check.

### Where to look

These are examples to start from, not a list to pick from. Use the products this repo's users actually use, even if they aren't here.

These are examples to start from, not a list to pick from. Use the products this repo's users actually use, even if they aren't here.

- **Devtools and platforms:** Sentry, Vercel, Stripe, Linear, GitHub, Supabase.
- **Errors and observability:** Sentry, Datadog, Honeycomb, Grafana.
- **AI and LLM tooling:** Braintrust, LangSmith, Langfuse, the OpenAI and Anthropic consoles.
- **Product analytics and experiments:** PostHog, Amplitude, Mixpanel, Statsig.
- **Payments, billing and fintech:** Stripe, Mercury, Ramp, Plaid.
- **B2B SaaS and collaboration:** Linear, Notion, Slack, Figma.
- **CLIs:** gh, vercel, stripe, and the guidelines at clig.dev.
- **Docs:** Stripe, Vercel, Supabase.
- **Consumer and mobile:** the platform's own guidelines (Apple's HIG, Material) before any one app.

### Patterns worth copying

- **Onboarding:** one action that shows value in the first minute, with sample data or a guided first run (PostHog, the Sentry setup wizard).
- **Install and SDK setup:** one copy-paste snippet per language or framework, and a "waiting for your first event" state that flips when data arrives (Sentry, PostHog).
- **API keys:** create with a name, show the key once with a copy button, list with created and last used, revoke; test and live keys kept apart (Stripe, OpenAI).
- **Lists and tables:** search, filters as chips, sorting, a time range picker for anything over time, and a row that opens a detail view (Linear, Sentry issues).
- **Detail views:** the most important fact first, then the timeline or trace, with the raw data one click away ("view JSON").
- **Settings:** one page per area under a side nav (general, members, billing, API keys, integrations), with the same save behavior on every page.
- **Teams:** invite by email, a few clear roles (owner, admin, member), pending invites you can resend or cancel.
- **Billing:** current plan, usage against limits, a clear upgrade path, invoices (Stripe's billing portal).
- **Destructive actions:** undo for what can be undone; type-the-name confirmation only for what can't.
- **CLIs:** `--help` with examples, `--json` for scripts and agents, meaningful exit codes, data on stdout and messages on stderr, no prompts when not in a terminal, `NO_COLOR` respected (gh, clig.dev).
- **APIs:** resources as nouns, one error shape with stable codes, cursor pagination, idempotency keys on anything that charges or sends (Stripe).
- **Error messages:** what happened, why if known, and what to do next. Never "Something went wrong" on its own.

## The markers

**Problem finding**
- Starts with the user's problem, not the feature request
- Separates what users ask for from what they actually need
- Notices friction nobody has complained about yet
- Feels the gap between what exists and what should exist
- Asks "why" until reaching the real job the user is trying to get done
- Knows the user's workflow before and after the product, not just inside it
- Talks to users directly instead of relying on summaries
- Watches people use the product rather than asking what they think
- Spots patterns across user complaints instead of fixing them one by one
- Understands the user's world, not just the tech

**Prioritizing and deciding**
- Asks whether this needs building at all, or whether a process change or existing tool solves it
- Can say no, and explain why
- Ruthlessly cuts scope to the smallest thing that tests the idea
- Picks the one metric that matters for a feature
- Ties work to business outcomes, not features shipped
- Makes calls with incomplete information and revisits them when data comes in
- Knows which decisions are reversible (move fast) and which aren't (slow down)
- Weighs build cost against user value against strategic value
- Decides without waiting for a PM, spec or sign-off
- Writes clear design docs that state the problem, options, tradeoffs and recommendation
- Disagrees openly, then commits

**Designing and building**
- Has taste: notices when something feels off and fixes it
- Sweats small things: empty states, loading states, errors, transitions, response times
- Makes the first minute great; the first experience decides whether people stay
- Designs for the default path and handles edge cases gracefully
- Makes the product feel fast even when the work is slow (streaming, optimistic UI, progress)
- Builds quality in from the start rather than polishing at the end
- Keeps interfaces simple by hiding complexity, not removing capability
- Writes good copy: labels, errors and empty states that tell the user what to do
- Is consistent across surfaces (web, CLI, IDE, mobile)
- Thinks about permissions, failure modes and trust before launch
- Designs for agents as users too: clean APIs, CLIs, docs and machine-readable output

**Agent and AI product thinking**
- Designs how people hand work to an agent, steer it mid-task and review the result
- Makes agent actions visible and reversible
- Puts humans in the loop where mistakes are expensive and removes them where they aren't
- Shows confidence and uncertainty instead of hiding it
- Designs for when the model is wrong, not just when it's right
- Treats evals as the product's quality bar, not an afterthought
- Balances cost, latency and quality as product decisions
- Knows when AI is the wrong answer and a deterministic feature is better

**Shipping and learning**
- Ships in small increments to get real feedback fast
- Uses feature flags and staged rollouts to learn safely
- Instruments features before launch so they can tell whether they worked
- Follows up after launch: reads the data, talks to users, iterates
- Kills or rewrites features that don't work instead of defending them
- Treats every customer deployment as research that shapes the product
- Keeps a short loop from user feedback to a shipped fix

**Mindset**
- Owns the outcome, not just the code
- Thinks in systems: how this feature affects the rest of the product
- Communicates in plain language to engineers, users and executives
- Has a point of view on where the product should go
- Uses the product daily and feels its pain firsthand
- Stays curious about competitors and adjacent tools, and copies what's conventional in the space

## As an agent

Some markers are about people you can't reach. Here is what they mean for you.

- **The person you're working with is the closest user you have.** When the job behind the ask isn't clear, ask one question about it before building. Read what users left behind: issues, support threads, feedback, error reports, analytics events, logs.
- **Use the product yourself.** Run it. Take the path a new user takes through the first minute, then the path your change affects.
- **Reuse before you build.** Search for the component, hook, API call or flow that already does most of it. No settings, flags or abstractions nobody asked for; an abstraction earns its place at its second use.
- **Decide, and show your reasoning.** Don't wait for a spec. When there's a real choice, give the options, the tradeoff and your recommendation in a few lines. If the ask is wrong, say so plainly, then build what's decided.
- **Slow down where it can't be undone.** Changing what users see or pay, deleting something that needs judgment, migrations, anything outward-facing, or touching more than about ten files: say the plan and wait.
- **Less code isn't always better code.** Ten screens sharing one call is tidy until the call is heavy and each screen throws most of it away. Merge what changes together; keep apart what only looks alike.
- **Instrument what you ship** with the analytics and logging the repo already uses, so someone can tell whether it worked.
- **Never make up data.** No placeholder numbers, fake users, or invented results anyone might read as real. Label estimates as estimates.
- **Report like a teammate.** What changed for the user, how you checked it, what you didn't check, and what's left. If something failed, say so with the output.

## Building AI features

- **Show the work.** The steps the agent took, the tools it called, the sources it used, in a form a person can scan.
- **Let people steer.** Stop, edit the instruction, or retry from a step, without starting over.
- **Approve what's expensive.** Ask before sending, paying, deleting or anything outward-facing. Don't ask before reading.
- **Say how sure it is.** Show confidence or cite sources, and let "I don't know" be an answer.
- **Plan for the model being wrong.** Easy correction, undo, and a deterministic fallback for the cases that must work.
- **Run evals before shipping a prompt or model change.** Compare the old and new versions on the same cases, run more than once, and look at what each one did, not just its final answer.
- **Treat cost and latency as product choices.** The smallest model that passes the evals; stream output; cache what repeats.
- **Use plain code when the rule is known.** A lookup, a regex or a query beats a model call that can be wrong.

## Signs you're building a feature, not a product

- A setting where a good default would do.
- A new pattern where the product, or the space, already has one.
- A screen with no empty, loading or error state.
- "Something went wrong" or a raw error code shown to a user.
- A spinner for more than a second with no progress or partial result.
- A feature nobody can tell is working: no event, no log, no metric.
- A confirmation dialog for something undo could handle.
- A model call for something a rule would do.
- Copy written for engineers on a screen meant for users.

## Worked example

**Ask:** "Add a page where users can create API keys."

- **Job:** developers need their code to call our API safely, and to replace a key quickly when one leaks.
- **Today:** keys are made by hand in the database, and every rotation is a support ticket.
- **Modeled on:** Stripe's and OpenAI's API keys pages.
- **Smallest change:** a keys page under settings. Create with a name, show the key once with a copy button, list keys with created and last used, revoke with a confirmation. No scopes or expiry yet; add them when someone needs them.
- **States:** no keys yet (says what a key is for, with one button), creating, the shown-once panel, revoke failed.
- **Trust:** store a hash, never the key. Only admins can create or revoke. Both go in the audit log.
- **How we'll know:** events for "key created" and "first request with a new key", and key-rotation tickets stop.
