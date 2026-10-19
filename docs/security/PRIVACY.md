# Privacy and retention

What personal data Smartvie PM holds, how long it is kept, and how it is exported
or removed. The code that enforces it is S3.6 in `docs/security/ROADMAP.md`.

This is an operating policy for the people running the system, not legal advice.
Have the retention periods confirmed by whoever advises the company on tax and
data protection.

## What is held, and where

| Data | Where | Personal? | Kept |
|---|---|---|---|
| Customers and suppliers: name, email, phone, tax id, addresses, notes | `contacts` | Yes, when the contact is an individual or names one | Until the contact's retention period ends, then anonymised |
| The customer printed on a document (name, address, tax id) | `invoices`, `credit_notes` (snapshot columns) | Same | Same: scrubbed together with the contact |
| Payment notes | `customer_payments.notes` | Possibly | Same |
| Invoices, credit notes, payments, journals (amounts, numbers, dates) | the books | No (once the snapshot is scrubbed) | Six years after the end of the financial year, then kept as anonymous figures |
| Staff accounts: name, email, role, sign-in history | `users`, `audit_logs` | Yes | While the person works here; deactivated, not deleted, so the audit trail keeps its actor |
| Staff and project resources (people on tasks) | `resources` | Yes | While the project exists |
| Audit log | `audit_logs` | Minimised (below) | Indefinitely: it is append-only and hash-chained, so it cannot be edited or pruned |
| Server logs | container stdout | Minimised by `src/lib/log.ts` (S3.5) | Docker's log rotation |
| Backups | `/opt/smartvie-backups/` | Contains everything above | Per `docs/security/BACKUPS.md`; encrypted |

## Retention

Company accounting records are kept for **six years after the end of the
financial year** they belong to (the UK limit for companies; confirm yours). A
contact's period is counted from the financial year of its **most recent**
document of any kind: invoice, credit note or payment, voided ones included. The
financial year comes from Books settings.

A contact is **held back** while it has a draft, unpaid or part-paid invoice, or
a draft credit note, however old.

Both rules are in the database (`contact_retention_until()`,
`contact_has_open_documents()`), not only the application, so a script or a psql
session is held to the same answer.

## Anonymising a contact

Books → Contacts → open the contact → *Privacy and retention* (Admin only). The
panel says when the contact becomes eligible. Once eligible, give a reason and
choose *Remove personal details*. It asks for a second-factor check, and it
cannot be undone.

What it does, in one transaction (`anonymise_contact()`):

- The contact becomes `Anonymised contact <id>`; email, phone, tax id, both
  addresses and notes are removed; it is archived and stamped `anonymisedAt`.
- The customer snapshot on its invoices and credit notes becomes `Anonymised
  contact` with no address or tax id, and their free-text notes are cleared. This is
  the only edit the approval guards allow on an approved document, and only
  for a contact past its retention period.
- Payment notes are cleared.
- Numbers, dates, amounts, statuses and journals are **not** touched: the
  figures must still add up and the sequence of document numbers must stay intact.
- An anonymised contact cannot be edited again.
- One audit row (`contact.anonymise`) records who, when and why, and nothing about
  what was removed.

**Inside the retention period nothing is scrubbed**, whoever asks. If a person
asks to be erased while their documents must still be kept, tell them the legal
obligation to keep company records applies, and when the data will be removed.

## Subject access requests

Open the contact → *Export their data* (Admin only). It downloads one JSON file:
the contact record, invoices with lines, credit notes, payments, and the audit
entries about the contact. Staff identifiers and the log's hash fields are left out
because they describe our people and our log, not the requester. The export is itself
audited (`contact.export`).

Reply within one month of the request. Check the person's identity first, and
send the file over a channel you trust. For a person who is also a user of this
system, add their `users` row and their sign-in entries from the audit log by
hand; that is rare enough not to automate.

## The audit log and personal data

The audit log can never be edited, so personal data must not go into it:

- Contact audit rows (create, update, delete) keep the name and commercial terms and
  replace email, phone, tax id, addresses and notes with a marker (`on file #1a2b3c4d`)
  that changes when the value does. See `auditableContact` in
  `src/lib/accounting/privacy.ts`.
- User audit rows hold only email, name, role and flags (S2.1) and never a secret.
- **Rows written before S3.6 still hold the full contact record.** They are inside
  the tamper-evident chain and cannot be rewritten. They stay for as long as the
  log does; say so if asked. The names of people who are staff users are kept in
  the log as the actor label for the same reason.

## Staff leaving

Deactivate the user (Settings → Team); do not delete. Deactivation ends their
sessions at once. Their name stays on audit rows and documents they created.
If they ask for their data, see *Subject access requests*.

## Backups

Backups hold anonymised contacts' old details until they age out of the
retention of the backup set (`BACKUP_MAX_TOTAL_MB` and the monthly cycle in
`docs/security/BACKUPS.md`). A restore therefore brings details back that were
anonymised after the backup was taken. After any restore, re-run the anonymisation
for contacts in the audit log's `contact.anonymise` entries.
