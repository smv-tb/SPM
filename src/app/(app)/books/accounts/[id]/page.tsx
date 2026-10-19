export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { formatPence, toPence } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ledgerDateKey, toLedgerDate } from "@/lib/accounting/dates";
import { ACCOUNT_TYPE_LABEL, NORMAL_BALANCE } from "@/lib/accounting/chart";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

const ROW_LIMIT = 1000;

/** Pairs each movement with the account balance after it, starting from `opening`. */
function withRunningBalance<T extends { debit: { toFixed(): string }; credit: { toFixed(): string } }>(
  lines: T[],
  opening: number
) {
  const rows: { line: T; debit: number; credit: number; balance: number }[] = [];
  let balance = opening;
  for (const line of lines) {
    const debit = toPence(line.debit);
    const credit = toPence(line.credit);
    balance += debit - credit;
    rows.push({ line, debit, credit, balance });
  }
  return { rows, closing: balance };
}

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

  const [opening, lines] = await Promise.all([
    from
      ? prisma.journalLine.aggregate({
          where: { accountId: id, entry: { status: "POSTED", date: { lt: from } } },
          _sum: { debit: true, credit: true },
        })
      : null,
    prisma.journalLine.findMany({
      where: {
        accountId: id,
        entry: {
          status: "POSTED",
          ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        },
      },
      include: { entry: { select: { id: true, number: true, date: true, memo: true } } },
      orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }, { lineNumber: "asc" }],
      take: ROW_LIMIT,
    }),
  ]);

  // Balances are shown on the account's natural side, so a bank account in
  // funds and a loan that is owed both read as positive numbers.
  const sign = NORMAL_BALANCE[account.type] === "DEBIT" ? 1 : -1;
  const show = (pence: number) => {
    const natural = pence * sign;
    return natural < 0 ? `(${formatPence(-natural)})` : formatPence(natural);
  };

  const openingBalance = opening
    ? toPence(opening._sum.debit ?? 0) - toPence(opening._sum.credit ?? 0)
    : 0;
  const { rows, closing: running } = withRunningBalance(lines, openingBalance);

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
                    Opening balance{from ? ` at ${formatDate(ledgerDateKey(from))}` : ""}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium">{show(openingBalance)}</td>
                </tr>
                {rows.map(({ line, debit, credit, balance }) => (
                  <tr key={line.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3 whitespace-nowrap">{formatDate(ledgerDateKey(line.entry.date))}</td>
                    <td className="px-3 py-3 tabular-nums">
                      <Link href={`/books/journals/${line.entry.id}`} className="text-primary hover:underline">
                        {line.entry.number}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {line.entry.memo}
                      {line.description && <span className="text-muted-foreground"> · {line.description}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{debit ? formatPence(debit) : ""}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{credit ? formatPence(credit) : ""}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{show(balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/30">
                <tr className="font-semibold">
                  <td className="px-5 py-3" colSpan={5}>
                    Closing balance
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{show(running)}</td>
                </tr>
              </tfoot>
            </table>
            {rows.length === ROW_LIMIT && (
              <p className="px-5 py-3 text-xs text-amber-700">
                Showing the first {ROW_LIMIT} movements — narrow the dates to see the rest.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
