export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { SYSTEM_ACCOUNT_CODES } from "@/lib/accounting/chart";
import { serializeProduct } from "@/lib/accounting/serialize";
import { ProductsClient } from "./products-client";

export default async function ProductsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:view")) redirect("/dashboard");

  const [products, incomeAccounts] = await Promise.all([
    prisma.productService.findMany({
      include: { incomeAccount: { select: { code: true, name: true } } },
      orderBy: { code: "asc" },
    }),
    prisma.ledgerAccount.findMany({
      where: { type: "INCOME", isArchived: false },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  return (
    <ProductsClient
      products={products.map(serializeProduct)}
      incomeAccounts={incomeAccounts}
      defaultIncomeCode={SYSTEM_ACCOUNT_CODES.SALES}
      canEdit={hasPermission(session, "books:post")}
      canDelete={hasPermission(session, "books:settings")}
    />
  );
}
