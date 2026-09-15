# Colocation

Code that changes together lives together. Apply these to new code and to reorganizations the user asked for; in an existing layout, follow the layout. A reader should find everything a feature needs in one place, and deleting a feature should mean deleting one folder.

## Rules

- **A helper with one caller lives in the caller's file, unexported.** Move it out when a second caller in another file appears, not before.
- **Group by feature, not by kind.**

  ```
  # no                       # yes
  components/InvoiceRow.tsx  invoices/
  hooks/useInvoices.ts         InvoiceRow.tsx
  types/invoice.ts             invoices.ts        # queries + types
  utils/formatInvoice.ts       invoices.test.ts
  ```

- **Promote to shared only at the second feature.** `lib/` (or `shared/`) is for code used by two or more features, and each file in it is named for what it holds (`lib/money.ts`), never `utils.ts`, `helpers.ts`, `common.ts`, or `misc/`.
- **Types live with the code that produces them.** The return type of `listInvoices` sits in `invoices.ts`, not in a global `types.ts`.
- **Tests, styles, and fixtures sit next to the file they cover.**
- **Don't add barrel files** (`index.ts` that only re-exports). They hide where code lives, invite import cycles, and keep dead exports looking used. If the repo already uses them, import through them like the rest of the code does.
- **No file for a single small function used once.** Fold it into its caller.

## Smells to fix when you touch them

- A `utils.ts` whose functions each have one caller: move each into its caller.
- A component folder and a hook folder that always change in the same commit.
- `../../../` imports between files that belong to the same feature.
