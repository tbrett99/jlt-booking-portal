import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Lock,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import { SupplierFormDialog } from "./SupplierFormDialog";

type Supplier = {
  id: number;
  name: string;
  categories: string | null;
  commission: string | null;
  loginUsername: string | null;
  credentialStage: number;
  isActive: number;
  imageUrl: string | null;
  accountManager: string | null;
  description: string | null;
  shortDescription: string | null;
  publicWebsite: string | null;
  tradeWebsite: string | null;
  additionalWebsite: string | null;
  agencyId: string | null;
  loginPassword: string | null;
  facebookUrl: string | null;
  phone: string | null;
  email: string | null;
  generalNotes: string | null;
  video1: string | null;
  video2: string | null;
  video3: string | null;
  locations: string | null;
  adminUsername: string | null;
  adminPassword: string | null;
  adminNotes: string | null;
};

export default function AdminSuppliers() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.suppliers.list.useQuery(
    { search: search || undefined, page, pageSize: 50 },
    { staleTime: 30000 }
  );

  const deleteMutation = trpc.suppliers.delete.useMutation({
    onSuccess: () => {
      toast.success("Supplier removed");
      utils.suppliers.list.invalidate();
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSuccess = () => {
    utils.suppliers.list.invalidate();
    utils.suppliers.get.invalidate();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Supplier Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.total ?? 0} suppliers in the directory
          </p>
        </div>
        <Button onClick={() => { setEditSupplier(null); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Add Supplier
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search suppliers..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Categories</TableHead>
              <TableHead>Commission</TableHead>
              <TableHead>Credentials</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.suppliers.map((s) => {
                  const cats = s.categories?.split(";").filter(Boolean) ?? [];
                  const hasCredentials = s.loginUsername || s.loginPassword;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        {s.imageUrl ? (
                          <img
                            src={s.imageUrl}
                            alt={s.name}
                            className="h-8 w-12 object-contain rounded"
                          />
                        ) : (
                          <Building2 className="h-6 w-6 text-muted-foreground/40" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {cats.slice(0, 2).map((cat) => (
                            <Badge key={cat} variant="secondary" className="text-xs">
                              {cat}
                            </Badge>
                          ))}
                          {cats.length > 2 && (
                            <Badge variant="outline" className="text-xs">+{cats.length - 2}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {s.commission ?? "—"}
                      </TableCell>
                      <TableCell>
                        {hasCredentials ? (
                          <Badge variant="outline" className="text-xs gap-1">
                            {s.credentialStage === 3 ? (
                              <Lock className="h-3 w-3" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                            Stage {s.credentialStage}+
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => { setEditSupplier(s as Supplier); setShowCreate(false); }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(s.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {data.totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>
            Next
          </Button>
        </div>
      )}

      {/* Create/Edit dialog — extracted to separate component so parent re-renders don't remount it */}
      <SupplierFormDialog
        open={showCreate || editSupplier !== null}
        editSupplier={editSupplier}
        onClose={() => { setShowCreate(false); setEditSupplier(null); }}
        onSuccess={handleSuccess}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Supplier</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to remove this supplier from the directory? This action can be undone by contacting support.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
              disabled={deleteMutation.isPending}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
