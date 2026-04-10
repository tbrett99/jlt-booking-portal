import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Search, ChevronLeft, ChevronRight, Loader2, Trash2, UserCheck, LogIn } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "super_admin" | "admin" | "agent">("all");
  const [loginFilter, setLoginFilter] = useState<"all" | "never">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"agent" | "admin" | "super_admin">("agent");
  const [isCreating, setIsCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data, isLoading } = trpc.users.list.useQuery({
    search: search || undefined,
    role: roleFilter === "all" ? undefined : roleFilter,
    page,
    pageSize: PAGE_SIZE,
  });

  const allUsers = data?.items ?? [];
  // Client-side filter for never-logged-in (lastSignedIn is set to createdAt on account creation, so we check credentialsSentAt set but lastSignedIn hasn't changed meaningfully — use mustChangePassword as proxy: if credentials sent and mustChangePassword is still true, they haven't logged in yet)
  const users = loginFilter === "never"
    ? allUsers.filter((u) => (u as any).credentialsSentAt && (u as any).mustChangePassword)
    : allUsers;
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const createUser = trpc.users.create.useMutation();
  const updateRole = trpc.users.updateRole.useMutation();
  const toggleActive = trpc.users.toggleActive.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });
  const deleteUser = trpc.users.delete.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });
  const [, navigate] = useLocation();
  const impersonate = trpc.users.impersonate.useMutation({
    onSuccess: (data) => {
      toast.success(`Now viewing as ${data.targetName}`);
      // Reload the page so the new session cookie takes effect
      window.location.href = "/";
    },
    onError: (err) => toast.error(err.message || "Failed to impersonate user"),
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newEmail) { toast.error("Name and email are required"); return; }
    setIsCreating(true);
    try {
      const result = await createUser.mutateAsync({ name: newName, email: newEmail });
      if (newRole !== "agent" && result?.userId) {
        await updateRole.mutateAsync({ userId: result.userId, role: newRole });
      }
      await utils.users.list.invalidate();
      toast.success(`Account created for ${newName}. Credentials have been emailed.`);
      setIsCreateOpen(false);
      setNewName(""); setNewEmail(""); setNewRole("agent");
    } catch (err: any) {
      toast.error(err.message || "Failed to create user");
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteUser.mutateAsync({ userId: deleteTarget.id });
      toast.success(`${deleteTarget.name} has been deleted.`);
      setDeleteTarget(null);
      await utils.users.list.invalidate();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user");
    } finally {
      setIsDeleting(false);
    }
  };

  const roleLabel = (role: string) => {
    if (role === "super_admin") return "Super Admin";
    if (role === "admin") return "Admin";
    return "Agent";
  };

  const roleBg = (role: string) => {
    if (role === "super_admin") return { background: "#70FFE8", color: "#414141" };
    if (role === "admin") return { background: "#FFC3BC", color: "#414141" };
    return { background: "#FFF6ED", color: "#414141" };
  };

  const isSuperAdmin = me?.role === "super_admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">{total} users total</p>
        </div>
        <div className="sm:ml-auto flex gap-3 flex-wrap">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9 w-52"
              />
            </div>
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v as any); setPage(1); }} defaultValue="all">
              <SelectTrigger className="w-32"><SelectValue placeholder="All roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="agent">Agent</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="outline">Search</Button>
            <button
              type="button"
              onClick={() => { setLoginFilter(loginFilter === "never" ? "all" : "never"); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                loginFilter === "never"
                  ? "border-orange-400 bg-orange-50 text-orange-700"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <LogIn size={13} />
              {loginFilter === "never" ? "Showing: Never logged in" : "Never logged in"}
            </button>
          </form>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button style={{ background: "#70FFE8", color: "#414141" }} className="gap-2 font-semibold">
                <Plus size={16} />Create User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input placeholder="Jane Smith" value={newName} onChange={(e) => setNewName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input type="email" placeholder="jane@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={newRole} onValueChange={(v) => setNewRole(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  A temporary password will be generated and emailed to the user.
                </p>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={isCreating} style={{ background: "#70FFE8", color: "#414141" }} className="font-semibold">
                    {isCreating ? <><Loader2 size={14} className="animate-spin mr-2" />Creating...</> : "Create & Send Credentials"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>Cancel</Button>
            <Button onClick={handleDelete} disabled={isDeleting} className="bg-red-600 hover:bg-red-700 text-white">
              {isDeleting ? <><Loader2 size={14} className="animate-spin mr-2" />Deleting...</> : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "#70FFE8" }} />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-3 font-semibold text-muted-foreground">Name</th>
                      <th className="py-3 font-semibold text-muted-foreground hidden sm:table-cell">Email</th>
                      <th className="py-3 font-semibold text-muted-foreground">Role</th>
                      <th className="py-3 font-semibold text-muted-foreground hidden md:table-cell">Created</th>
                      <th className="py-3 font-semibold text-muted-foreground hidden lg:table-cell">Last Login</th>
                      <th className="py-3 font-semibold text-muted-foreground">Status</th>
                      <th className="py-3 font-semibold text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-muted-foreground">
                          No users found{search ? ` matching "${search}"` : ""}.
                        </td>
                      </tr>
                    ) : users.map((u) => (
                      <tr key={u.id} className={`hover:bg-muted/30 transition-colors ${!u.isActive ? "opacity-50" : ""}`}>
                        <td className="py-3 font-medium">{u.name ?? "—"}</td>
                        <td className="py-3 text-muted-foreground hidden sm:table-cell">{u.email ?? "—"}</td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={roleBg(u.role)}>
                            {roleLabel(u.role)}
                          </span>
                        </td>
                        <td className="py-3 text-muted-foreground hidden md:table-cell">
                          {format(new Date(u.createdAt), "dd MMM yyyy")}
                        </td>
                        <td className="py-3 hidden lg:table-cell">
                          {(u as any).mustChangePassword && (u as any).credentialsSentAt ? (
                            <span className="text-xs font-medium text-orange-500 flex items-center gap-1">
                              <LogIn size={11} /> Never logged in
                            </span>
                          ) : (u as any).lastSignedIn ? (
                            <span className="text-xs text-muted-foreground">
                              {format(new Date((u as any).lastSignedIn), "dd MMM yyyy")}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3">
                          <span className={`text-xs font-medium ${u.isActive ? "text-green-600" : "text-red-500"}`}>
                            {u.isActive ? "Active" : "Suspended"}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={async () => {
                                try {
                                  await toggleActive.mutateAsync({ userId: u.id, isActive: !u.isActive });
                                  toast.success(u.isActive ? "User suspended" : "User reactivated");
                                } catch (err: any) {
                                  toast.error(err.message || "Failed to update user");
                                }
                              }}
                            >
                              {u.isActive ? "Suspend" : "Reactivate"}
                            </Button>
                            {isSuperAdmin && u.role !== "super_admin" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 text-blue-600 border-blue-200 hover:bg-blue-50"
                                title={`View portal as ${u.name ?? u.email}`}
                                disabled={impersonate.isPending}
                                onClick={() => impersonate.mutate({ userId: u.id })}
                              >
                                <UserCheck size={12} />
                              </Button>
                            )}
                            {isSuperAdmin && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7 text-red-600 border-red-200 hover:bg-red-50"
                                onClick={() => setDeleteTarget({ id: u.id, name: u.name ?? "this user" })}
                              >
                                <Trash2 size={12} />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t mt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <span className="text-sm flex items-center px-2">Page {page} of {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
