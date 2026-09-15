# Naming

A name should tell the reader what the thing is in the domain, so they don't have to read its body.

## Rules

- **Say what it holds, not its type or role.** `unpaidInvoices`, not `data`, `result`, `res`, `list`, `items`, `info`, `obj`, `payload`, `temp`. Short names are fine in a three-line lambda (`rows.map((r) => r.id)`).
- **Functions that act are verb + object.** `chargeCard`, `archiveProject`. Functions that compute a value are named for the value: `invoiceTotal(invoice)`, not `calculateInvoiceTotal`.
- **Booleans read as a yes/no question.** `isPaid`, `hasAccess`, `canRetry`, `shouldNotify`. Avoid negatives: `isEnabled`, not `isNotDisabled`.
- **No empty verbs or suffixes.** `handle`, `process`, `manage`, `do`, `perform`, `helper`, `util`, `Manager`, `Service`, `Handler`, `Data`, `Info`: unless the codebase already gives one a precise meaning, replace it with what actually happens (`handleSubmit` → `saveDraft`).
- **One word per concept, everywhere.** If the codebase says `account`, don't introduce `user` or `member` for the same thing. Grep for the existing word before naming.
- **Put units in ambiguous numbers.** `timeoutMs`, `priceCents`, `widthPx`, `createdAtIso`.
- **Don't encode types.** No `userList`, `nameStr`, `IUser`, `TProps`, `EStatus`.
- **Name length tracks scope.** Loop index: `i`. Module-level constant: `MAX_UPLOAD_BYTES`.
- **Name files after what they hold.** `invoice-pdf.ts`, not `generator.ts`.

## When renaming

- Rename every reference in the same change. Don't leave an alias (`export const oldName = newName`).
- A rename is a reorg step: no behavior change in the same commit (see [reorg.md](reorg.md)).
