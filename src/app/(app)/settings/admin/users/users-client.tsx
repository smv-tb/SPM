"use client";

import { confirmDialog } from "@/components/ui/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UserModal } from "@/components/modals/UserModal";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Users, ShieldAlert } from "lucide-react";
import { clientFetch } from "@/lib/client-fetch";
import { SortableTh } from "@/components/ui/sortable-th";
import { useSort, sortItems, type Accessor } from "@/hooks/use-sortable-data";
import { formatDate } from "@/lib/utils";

const roleColor: Record<string, string> = {
  ADMIN: "bg-violet-100 text-violet-700",
  PM: "bg-primary/10 text-primary",
  CONTRIBUTOR: "bg-emerald-100 text-emerald-700",
  VIEWER: "bg-muted text-muted-foreground",
};

interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "PM" | "CONTRIBUTOR" | "VIEWER";
  avatarUrl?: string | null;
  isActive: boolean;
  mfaEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  initialUsers: User[];
}

const userAccessors: Record<string, Accessor<User>> = {
  name: u => u.name,
  email: u => u.email,
  role: u => u.role,
  status: u => (u.isActive ? 1 : 0),
  created: u => new Date(u.createdAt),
};

export function UsersClient({ initialUsers }: Props) {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const { sortKey, sortDir, toggleSort } = useSort("smartvie:sort:users");

  const filteredUsers = sortItems(
    users.filter((u) => {
      const matchesSearch =
        !search ||
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase());
      const matchesRole = !roleFilter || u.role === roleFilter;
      return matchesSearch && matchesRole;
    }),
    userAccessors,
    sortKey,
    sortDir
  );

  async function handleToggleActive(user: User) {
    const newStatus = !user.isActive;
    const res = await clientFetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: newStatus }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to update user status");
      return;
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, isActive: newStatus } : u))
    );
    toast.success(`User ${newStatus ? "activated" : "deactivated"}`);
  }

  async function handleDelete(user: User) {
    if (!await confirmDialog(`Permanently delete "${user.name}"? This cannot be undone.`)) return;

    const res = await clientFetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to delete user");
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    toast.success("User deleted");
  }

  function handleSaved() {
    router.refresh();
    clientFetch("/api/users")
      .then((r) => r.json())
      .then((data) => {
        if (data.data) setUsers(data.data);
      });
  }

  const activeCount = users.filter((u) => u.isActive).length;
  const inactiveCount = users.filter((u) => !u.isActive).length;

  return (
    <>
      <Topbar
        title="User Management"
        subtitle="Manage team members and access levels"
        breadcrumbs={[
          { label: "Settings", href: "/settings" },
          { label: "Admin", href: "/settings/admin/users" },
        ]}
      />

      <main className="flex-1 overflow-auto p-6 space-y-5">
        <div className="flex flex-col sm:flex-row justify-between gap-3">
          <div className="flex gap-2 flex-1 max-w-xl">
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-40"
            >
              <option value="">All roles</option>
              <option value="ADMIN">ADMIN</option>
              <option value="PM">PM</option>
              <option value="CONTRIBUTOR">CONTRIBUTOR</option>
              <option value="VIEWER">VIEWER</option>
            </Select>
          </div>
          <Button
            onClick={() => {
              setEditingUser(null);
              setModalOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Add User
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Total Users</p>
              <p className="text-2xl font-bold">{users.length}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Inactive</p>
              <p className="text-2xl font-bold text-muted-foreground">{inactiveCount}</p>
            </div>
          </Card>
          <Card>
            <div className="p-4">
              <p className="text-sm text-muted-foreground">Admins</p>
              <p className="text-2xl font-bold text-violet-600">
                {users.filter((u) => u.role === "ADMIN").length}
              </p>
            </div>
          </Card>
        </div>

        <Card>
          <CardContent className="px-0 pb-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <SortableTh label="Name" sortKey="name" activeKey={sortKey} direction={sortDir} onSort={toggleSort} className="px-5" />
                  <SortableTh label="Email" sortKey="email" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh label="Role" sortKey="role" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <SortableTh label="Created" sortKey="created" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                  <th className="text-right px-5 py-2 text-xs font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon={Users}
                        title="No users found"
                        description="Try adjusting your search or filters."
                      />
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => (
                    <tr
                      key={u.id}
                      className={`hover:bg-muted/20 ${!u.isActive ? "opacity-60" : ""}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-semibold shrink-0">
                            {u.name.charAt(0)}
                          </div>
                          <span className="font-medium">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            roleColor[u.role] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            u.isActive
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {u.isActive ? "Active" : "Inactive"}
                        </span>
                        {u.mfaEnabled && (
                          <span
                            title="Two-factor sign-in is on"
                            className="ml-1.5 inline-flex items-center rounded-full bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary"
                          >
                            2FA
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-xs">
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            onClick={() => {
                              setEditingUser(u);
                              setModalOpen(true);
                            }}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-muted-foreground"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(u)}
                            className={`p-1 rounded hover:bg-muted ${
                              u.isActive
                                ? "text-muted-foreground hover:text-orange-600"
                                : "text-muted-foreground hover:text-emerald-600"
                            }`}
                            title={u.isActive ? "Deactivate" : "Activate"}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(u)}
                            className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>

      <UserModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        user={editingUser}
        onSaved={handleSaved}
      />
    </>
  );
}
