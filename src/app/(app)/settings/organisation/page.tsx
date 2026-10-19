export const dynamic = "force-dynamic";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { hasPermission } from "@/lib/permissions";
import { COMPANY_SETTINGS_ID } from "@/lib/accounting/posting";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The company's details, read-only. They are edited in one place only — Books
 * settings — because they print on invoices and drive the financial year.
 * Bank details are deliberately not shown here.
 */
export default async function OrganisationPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const s = await prisma.companySettings.findUnique({
    where: { id: COMPANY_SETTINGS_ID },
    select: {
      legalName: true, companyNumber: true, vatNumber: true, vatRegistered: true, baseCurrency: true,
      yearStartMonth: true, yearStartDay: true, registeredAddress: true, placeOfRegistration: true,
    },
  });
  const canEdit = hasPermission(session, "books:settings");

  const rows: [string, string][] = s
    ? [
        ["Legal name", s.legalName || "—"],
        ["Company number", s.companyNumber || "—"],
        ["Place of registration", s.placeOfRegistration || "—"],
        ["Registered address", s.registeredAddress || "—"],
        ["VAT", s.vatRegistered ? `Registered${s.vatNumber ? ` · ${s.vatNumber}` : ""}` : "Not registered"],
        ["Base currency", s.baseCurrency],
        ["Financial year starts", `${s.yearStartDay} ${MONTHS[s.yearStartMonth - 1] ?? "?"}`],
      ]
    : [];

  return (
    <>
      <Topbar title="Organisation" subtitle="Company details" breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Organisation" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold">Company details</CardTitle>
              {canEdit && (
                <Link href="/books/settings">
                  <Button variant="outline" size="sm">Edit in Books settings</Button>
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Company details haven&apos;t been set up yet{canEdit ? "." : "; ask an Admin."}</p>
            ) : (
              <dl className="divide-y divide-border text-sm">
                {rows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-2.5">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="sm:col-span-2 whitespace-pre-line font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              These print on invoices and set the financial year. They are company-wide, shared by every project.
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
