# FUP · 2026-10-28 · S11: the task tool's Inbox is listed, and a task in it can join an area

**Agent:** Claude · **Duration:** one run · **PR:** _pending_ · **Outcome:** prisme's Inbox lists what
sits in the task tool's own Inbox as *Unsorted in Todoist*, and **Make it an initiative** adopts one
into an area, which the next pass moves it into. S11 is closed.

## What was found first

- The connector did not know which project is the task tool's Inbox. Its API sends
  `inbox_project: true` on that project and omits the field elsewhere (confirmed in the vendor's
  API v1 reference, not against the live instance).
- The finding's *move to area* is an outward write of a plain task's location, which
  [`11-ownership.md`](../11-ownership.md) gives to the task tool: only an **anchor's** location is
  prisme's. So prisme may not move a plain task — but the reconciler already moves an anchor that
  sits outside its initiative's area, whatever the initiative's status.

## What was done

- **Connector.** `wireProjectSchema` parses `inbox_project`; `mapProject` sets `inbox: true` on that
  project only (+ `map-project.test.ts`).
- **API.** `ExternalDirectory.inboxTasks()` reads the open top-level tasks of the Inbox project (an
  identifier and a title). `GET /task-tool/inbox` (`read:focus`) lists them with what in prisme holds
  each. `POST /task-tool/inbox/:id/initiative` (`write:initiative`) records an initiative — `inbox`,
  `adopted`, unestimated — and a human link to the task, with an `adoption_decision` event, in one
  transaction; `409` when anything holds or links the task, `422` for a Run or Signals lane.
- **Web.** *Unsorted in Todoist* on the Inbox: each task with an outcome title (prefilled from its
  words), an area and **Make it an initiative**. The weekly *Triage what arrived* step counts them.

## Decisions taken

- **Adopt, then let the reconciler move it.** Linking — not binding — is what the queue's *Adopt*
  records, and the reconciler's pending-link path binds it, which keeps guard 1's binding with the
  pass that also moves the anchor. The task is then where its area is, without prisme ever writing
  a plain task's location.
- **No "move and keep as a task".** That write belongs to the task tool; the section says so and
  sends the person there.
- **Top-level tasks only, and only what prisme does not hold.** A subtask goes with its parent; a
  task already adopted is not unsorted.

## Checks run locally

Node 24.21.0: root `pnpm typecheck`; the whole `unit` project, including the connector test; the
API's integration tests for both routes (the list with a held task, adopt once then `409`, a lane
`422`); eslint and prettier on the changed files; the privacy scan with the local supplement.

## Not done

- Not verified against the live task tool: the field name comes from the vendor's reference. If it
  were wrong, the section would be empty — the safe direction.
- A task adopted from the Inbox moves only when writes are enabled; under the write freeze it is
  linked and waits.
- No MCP tool lists or adopts unsorted tasks.

## Specs touched

- `docs/11-ownership.md` §2 (`area_key`, `project_id`), `docs/13-migration.md` §4,
  `docs/18-user-guide.md` (Inbox), `docs/19-how-it-works.md` S11.
