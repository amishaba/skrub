# APIs and return values

## Grouping endpoints

- **Group by resource, not by verb or layer.** `invoices/` holds the list, get, create, and void handlers, their schemas, and their queries. Not `getHandlers.ts` / `postHandlers.ts`, and not `controllers/` + `services/` + `repositories/` for a three-endpoint feature.
- **Plural nouns for routes; actions as sub-resources:** `GET /invoices`, `GET /invoices/:id`, `POST /invoices`, `POST /invoices/:id/void`. No `/getInvoice` or `/invoices/doVoid`.
- **One error shape for the whole API,** e.g. `{ error: { code: "invoice_not_found", message } }`, with stable machine-readable codes and the matching HTTP status. Don't return 200 with `{ success: false }`.
- **One success shape.** Either always return the resource or always wrap it in the same envelope; don't mix.
- **Mutations return the updated resource** (or nothing, with 204), not unrelated data.

## Return values in functions

- **One shape per function.** Not `User | null | undefined | false`. Choose:
  - `null` for "looked it up, it isn't there" (`findUser(id): User | null`);
  - a thrown error for bugs and broken invariants the caller can't handle;
  - a result type for failures the caller must handle:
    `{ ok: true; invoice: Invoice } | { ok: false; reason: "card_declined" | "expired" }`.
- **Collections are never null.** Return `[]`.
- **No sentinels.** No `-1`, `""`, `{}`, or `0` meaning "missing".
- **Don't swallow errors into a boolean.** `try { …; return true } catch { return false }` hides why it failed. Let it throw, or return a result that says why.
- **Async all the way or not at all.** If any path awaits, the function is `async` and every path returns a promise.
- **Return the thing itself.** Not `{ data: thing }` with one field, unless that's the API-wide envelope.
- **Don't hand out mutable internals.** Return a copy or a read-only view of internal maps and arrays.

## Errors

- Catch only where you can do something: turn it into a response, retry, or fall back. Don't log-and-rethrow at every layer.
- Keep the cause: `throw new Error("could not load invoice", { cause: err })`.
