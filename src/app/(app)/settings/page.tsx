import { redirect } from "next/navigation";

/** Settings opens on the current project; with no project yet, on the projects list. */
export default function SettingsPage() {
  redirect("/settings/project");
}
