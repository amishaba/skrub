# Server and client

Every module runs somewhere. Make that obvious, and make crossing the line by accident impossible.

## Where code runs

- **Mark server-only modules.** Use the framework's marker (`import "server-only"`, `"use server"`) or keep them in a `server/` folder that client code never imports. Database clients, secrets, and privileged SDKs live only there.
- **Only explicitly public env vars reach the client** (`NEXT_PUBLIC_*`, `VITE_*`). Never read a secret in a module the client bundle can import.
- **The server enforces; the client only helps.** Auth, permissions, prices, quotas, and validation are decided on the server even if the UI checks them too.

## The wire contract

- **One module defines what crosses the wire**: request and response types (ideally schemas, e.g. zod, with types inferred from them). Both sides import it. Never hand-copy a type to the other side.
- **Validate every input at the server boundary**, including requests from your own client.
- **Send view models, not rows.** Map database records to what the screen needs at the boundary. Sending whole rows leaks fields (password hashes, internal flags) and ties the UI to the schema.

## Data access

- **Queries for a resource live in one server module** (`invoices/queries.ts`), not inline in route handlers and components.
- **The client calls typed functions, not URL strings.** One `getInvoice(id)` wrapper per endpoint, next to the contract, instead of `fetch("/api/invoices/" + id)` scattered across components.
- **Fetch at the route or page level, in parallel.** Avoid request waterfalls where each child component fetches after its parent renders.
- **Don't duplicate server state into client state.** Cache it with the data library you already use, and invalidate after mutations instead of hand-syncing copies.
