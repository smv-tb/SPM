export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { formatPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { ACCOUNT_TYPE_LABEL, NORMAL_BALANCE } from "@/lib/accounting/chart";
import { loadAccountLedger } from "@/lib/accounting/account-ledger-query";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}

const PAGE_SIZE = 200;

function parseDate(value?: string): Date | null {
  if (!value) return null;
  try {
    return toLedgerDate(value);
  } catch {
    return null;
  }
}

export default async function AccountLedgerPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const { id } = await params;
  const query = await searchParams;
  const from = parseDate(query.from);
  const to = parseDate(query.to);

  const account = await prisma.ledgerAccount.findUnique({ where: { id } });
  if (!account) notFound();

  const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
  const ledger = await loadAccountLedger(prisma, {
    accountId: id,
    from,
    to,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  });
  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    if (query.from) qs.set("from", query.from);
    if (query.to) qs.set("to", query.to);
    if (n > 1) qs.set("page", String(n));
    const text = qs.toString();
    return `/books/accounts/${id}${text ? `?${text}` : ""}`;
  };
  const firstShown = ledger.rows.length ? ledger.offset + 1 : 0;
  const lastShown = ledger.offset + ledger.rows.length;

  // Balances are shown on the account's natural side, so a bank account in
  // funds and a loan that is owed both read as positive numbers.
  const sign = NORMAL_BALANCE[account.type] === "DEBIT" ? 1 : -1;
  const show = (pence: number) => {
    const natural = pence * sign;
    return natural < 0 ? `(${formatPence(-natural)})` : formatPence(natural);
  };

  return (
    <>
      <Topbar
        title={`${account.code} ${account.name}`}
        subtitle={`${ACCOUNT_TYPE_LABEL[account.type]} account`}
        breadcrumbs={[
          { label: "Books", href: "/books" },
          { label: "Accounts", href: "/books/accounts" },
          { label: account.code },
        ]}
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <Card>
          <CardContent className="p-4">
            {/* A plain GET form: the filters live in the URL, so the view can be bookmarked or shared. */}
            <form className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="from">
                  From
                </label>
                <Input id="from" name="from" type="date" className="w-44" defaultValue={from ? ledgerDateKey(from) : ""} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block" htmlFor="to">
                  To
                </label>
                <Input id="to" name="to" type="date" className="w-44" defaultValue={to ? ledgerDateKey(to) : ""} />
              </div>
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left px-5 py-2 text-xs font-medium text-muted-foreground w-32">Date</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground w-20">No.</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-32">Debit</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-32">Credit</th>
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground w-36">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-muted/20">
                  <td className="px-5 py-3 text-muted-foreground" colSpan={5}>
                    {ledger.offset > 0
                      ? "Balance brought forward"
                      : `Opening balance${from ? ` at ${formatDate(ledgerDateKey(from))}` : ""}`}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium">{show(ledger.pageOpeningBalance)}</td>
                </tr>
                {ledger.rows.map((row) => (
                  <tr key={row.lineId} className="hover:bg-muted/20">
                    <td className="px-5 py-3 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-3 py-3 tabular-nums">
                      <Link href={`/books/journals/${row.entryId}`} className="text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {row.memo}
                      {row.description && <span className="text-muted-foreground"> · {row.description}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.debit ? formatPence(row.debit) : ""}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.credit ? formatPence(row.credit) : ""}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{show(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30">
                <tr className="font-semibold">
                  <td className="px-5 py-3" colSpan={5}>
                    Closing balance
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{show(ledger.closingBalance)}</td>
                </tr>
              </tfoot>
            </table>
            {ledger.total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
                <span>
                  Showing {firstShown}–{lastShown} of {ledger.total} movements. The closing balance covers all of them.
                </span>
                <span className="flex gap-3">
                  {page > 1 && (
                    <Link href={pageHref(page - 1)} className="text-primary hover:underline">
                      Previous
                    </Link>
                  )}
                  {ledger.truncated && (
                    <Link href={pageHref(page + 1)} className="text-primary hover:underline">
                      Next
                    </Link>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
