export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { loadBillFormOptions } from "@/lib/accounting/bill-options";
import { NewBillClient } from "./new-bill-client";

export default async function NewBillPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session, "books:post")) redirect("/books");

  const { suppliers, accounts } = await loadBillFormOptions();
  return <NewBillClient suppliers={suppliers} accounts={accounts} canApprove={hasPermission(session, "books:approve")} />;
}
