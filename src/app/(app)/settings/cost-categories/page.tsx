import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CostCategoriesManager } from "@/components/settings/CostCategoriesManager";

export default async function CostCategoriesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <>
      <Topbar title="Cost categories" subtitle="Shared by every project" breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Cost categories" }]} />
      <main className="flex-1 overflow-auto p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Cost categories</CardTitle>
          </CardHeader>
          <CardContent>
            <CostCategoriesManager />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
