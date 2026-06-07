# Team & Roles

**Organization → Team** is where you control who can access the CRM and what they're allowed to do. The organization owner can always open it — and can delegate it to a teammate by granting the **Team** permission in a role (see below).

## Members

The **Members** tab lists everyone on your team — name, email, and a summary of their access per project.

- **Add member** — opens a reusable invite link for your organization. Share it; whoever opens it joins as a member. You can reset the link at any time to invalidate the old one.
- **Manage access** (per-member ⋮ menu) — assign that member a **role** in each project independently. A member can be a Manager in one store and have no access to another.
- **Remove** — revokes the member's access to the whole organization.

The owner always has full access and can't be removed.

> **View-only Team.** If your role grants **Team** at *View* (not *Manage*), you can browse members and roles but the action controls — *Add employee*, *New role*, and the per-row ⋮ menus — are hidden. You can still open a role to inspect its permissions, read-only.

## Roles

The **Roles** tab is where you define what a role can do. A role is a **permission matrix** over the console pages, with three levels each:

| Level | Meaning |
|-------|---------|
| **None** | the page is hidden |
| **View** | can open and read the page |
| **Manage** | can edit / act on the page |

- Preset roles come ready-made (Admin, Manager, Staff, Viewer); create your own with **New role**.
- The editor groups pages and has bulk *Clear all / All view / All manage* shortcuts.
- Changes save automatically — there's no Save button.

### What a role can cover

A role spans two kinds of pages:

- **Organization pages** — the org-level console: **Org Analytics, Customers (cross-project), Team, Payments, Usage, Org Settings**. Grant these to delegate organization administration without handing over ownership. A teammate with *Team: Manage*, for example, can run the team page for you.
- **Project pages** — everything inside a single project's console (Overview, Products, Orders, Booking, Chat, Authentication, …), assigned per project in **Manage access**.

Two pages are intentionally outside the matrix:

- **Projects** (the project list) is always available to every member — it can't be turned off.
- **Billing** can **never** be delegated — only the owner can ever open it, by design.

## How access works

Access is enforced on the backend, not just hidden in the UI. A member only ever sees the pages their role grants — project pages per project, organization pages org-wide — and notifications follow the same rule: you won't get alerts for a project (or a page like Chat) you can't access.

See also: [Organizations & Projects](/docs/organizations-projects) · [Realtime & Presence](/docs/realtime).
