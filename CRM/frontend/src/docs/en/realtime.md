# Realtime & Presence

When two or more teammates work in the same organization, the CRM turns multiplayer — you see each other live, on every page. There's nothing to switch on: it starts the moment a colleague opens the same console.

## Who's here — the presence stack

Every project, product and organization page shows an **avatar stack** in the header: the people currently on that page. Up to five faces are shown; a "+N" chip covers the rest.

- Click the stack to open the **presence menu** — a live list of everyone in scope, with the page each person is on.
- On an organization page the menu labels each person with their location, e.g. *Tortoly · Polo Sweater · Product Overview* (project · product · page).
- The **Team** page also shows a small blue dot next to anyone who is online right now.

## Live cursors

On any page you share with a teammate, you see their **cursor move in real time**, labelled with their name. Cursors are element-locked, so a teammate pointing at the "Polo Sweater" card lands on the same card for you — even when your screens are different sizes. A cursor fades out after about 15 seconds of no movement and returns as soon as the person moves again.

## Cursor chat

Press **Ctrl + M** to pin a short message to your cursor — a word in the moment, with no thread and no inbox. Teammates see it ride your cursor for a few seconds, then it fades. You can also start one from the **Send a quick message** row in the presence menu.

## Live editing

When someone is typing into a shared field, everyone else on the same page sees the text appear **as it's typed**, with a *"… is editing"* indicator. This works in the **email composer** (subject and body) and the **product overview** (title, subtitle, description).

> Live editing is last-write-wins: if two people type into the *same* field at the *same* second, the later keystroke wins. It's built for "I'll take this, you take that", not for two people hammering one input simultaneously.

## Jump to a teammate

Open the presence menu and click anyone to **land exactly where they're working** — the right project, product and page. If your role doesn't grant access to that page, the jump is blocked with a short notice instead (presence is visible across your organization, but navigation still respects [roles](/docs/team)).

## What you see (scope)

| Where you are | Who you see |
|---------------|-------------|
| A **project** page | Teammates anywhere inside that project (its products and sub-pages) |
| An **organization** page | Everyone across the organization, and which project / product they're in |
| Dashboard, Settings, Docs | No presence — these are personal, out of scope |

Presence is scoped to your **organization** — you never see, and are never seen by, people outside it.

## Good to know

- **No setup.** It's always on for everyone on the team.
- **One secure connection.** Each session uses a single authenticated channel; it keeps working across multiple server instances.
- **Tabs count.** Pages with tabs (Emails, Chat, Authentication, …) put the tab in the address bar, so presence can tell two people apart when they're on different tabs of the same page.

See also: [Team & Roles](/docs/team) · [Organizations & Projects](/docs/organizations-projects).
