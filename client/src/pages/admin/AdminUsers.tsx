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
import { Plus, Search, UserCheck, UserX, Loader2, Trash2 } from "lucide-react";
import { format } from "date-fns";

export default function AdminUsers() {
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"agent" | "admin" | "super_admin">("agent");
  const [isCreating, setIsCreating] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: users = [], isLoading } = trpc.users.list.useQuery();
  const createUser = trpc.users.create.useMutation();
  const updateRole = trpc.users.updateRole.useMutation();
  const toggleActive = trpc.users.toggleActive.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });
  const deleteUser = trpc.users.delete.useMutation({
    onSuccess: () => utils.users.list.invalidate(),
  });

  const filtered = users.filter(
    (u) =>
      !search ||
      (u.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

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
          <p className="text-sm text-muted-foreground">{users.length} users total</p>
        </div>
        <div className="sm:ml-auto flex gap-3 flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64"
            />
          </div>
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
                  A temporary password will be generated and emailed to the user from support@thejltgroup.co.uk.
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
              Are you sure you want to permanently delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone and will remove all their data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-3 font-semibold text-muted-foreground">Name</th>
                    <th className="py-3 font-semibold text-muted-foreground hidden sm:table-cell">Email</th>
                    <th className="py-3 font-semibold text-muted-foreground">Role</th>
                    <th className="py-3 font-semibold text-muted-foreground hidden md:table-cell">Created</th>
                    <th className="py-3 font-semibold text-muted-foreground">Status</th>
                    <th className="py-3 font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((u) => (
                    <tr
                      key={u.id}
                      className={`hover:bg-muted/30 transition-colors ${!u.isActive ? "opacity-50" : ""}`}
                    >
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
                      <td className="py-3">
                        <span className={`text-xs font-medium ${u.isActive ? "text-green-600" : "text-red-500"}`}>
                          {u.isActive ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="py-3">
                        {u.id !== me?.id && (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7 gap-1"
                              onClick={() => toggleActive.mutate({ userId: u.id, isActive: !u.isActive })}
                            >
                              {u.isActive
                                ? <><UserX size={12} />Suspend</>
                                : <><UserCheck size={12} />Activate</>}
                            </Button>
                            {/* Delete only available to super admin */}
                            {isSuperAdmin && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7 gap-1 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setDeleteTarget({ id: u.id, name: u.name ?? "this user" })}
                              >
                                <Trash2 size={12} />Delete
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="text-center py-8 text-muted-foreground">No users found</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
