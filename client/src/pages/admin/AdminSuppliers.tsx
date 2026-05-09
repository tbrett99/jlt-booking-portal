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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Building2,
  Lock,
  Unlock,
  Sparkles,
  Video,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

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

const EMPTY_FORM = {
  name: "",
  description: "",
  shortDescription: "",
  publicWebsite: "",
  tradeWebsite: "",
  agencyId: "",
  loginUsername: "",
  loginPassword: "",
  commission: "",
  facebookUrl: "",
  accountManager: "",
  phone: "",
  email: "",
  generalNotes: "",
  video1: "",
  video2: "",
  video3: "",
  categories: "",
  locations: "",
  imageUrl: "",
  adminUsername: "",
  adminPassword: "",
  adminNotes: "",
  credentialStage: 2,
};

export default function AdminSuppliers() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.suppliers.list.useQuery(
    { search: search || undefined, page, pageSize: 50 },
    { staleTime: 30000 }
  );

  const createMutation = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      toast.success("Supplier created");
      utils.suppliers.list.invalidate();
      setShowCreate(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      toast.success("Supplier updated");
      utils.suppliers.list.invalidate();
      utils.suppliers.get.invalidate();
      setEditSupplier(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.suppliers.delete.useMutation({
    onSuccess: () => {
      toast.success("Supplier removed");
      utils.suppliers.list.invalidate();
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const scrapeWebsiteMutation = trpc.suppliers.scrapeWebsite.useMutation({
    onSuccess: (data) => {
      setForm((f) => ({
        ...f,
        name: data.name || f.name,
        description: data.description || f.description,
        shortDescription: data.shortDescription || f.shortDescription,
        categories: data.categories || f.categories,
        locations: data.locations || f.locations,
        commission: data.commission || f.commission,
      }));
      toast.success("Fields auto-filled from website");
    },
    onError: (e) => toast.error("Auto-fill failed: " + e.message),
  });

  const analyseVideoMutation = trpc.suppliers.analyseVideo.useMutation({
    onSuccess: (data) => {
      setForm((f) => ({
        ...f,
        name: data.supplierName || f.name,
        description: data.description || f.description,
        categories: data.categories || f.categories,
        locations: data.locations || f.locations,
        generalNotes: data.bookingTips
          ? (f.generalNotes ? f.generalNotes + "\n\n" + data.bookingTips : data.bookingTips)
          : f.generalNotes,
      }));
      toast.success("Fields filled from video analysis");
    },
    onError: (e) => toast.error("Video analysis failed: " + e.message),
  });

  const openEdit = (s: Supplier) => {
    setEditSupplier(s);
    setForm({
      name: s.name,
      description: s.description ?? "",
      shortDescription: s.shortDescription ?? "",
      publicWebsite: s.publicWebsite ?? "",
      tradeWebsite: s.tradeWebsite ?? "",
      agencyId: s.agencyId ?? "",
      loginUsername: s.loginUsername ?? "",
      loginPassword: s.loginPassword ?? "",
      commission: s.commission ?? "",
      facebookUrl: s.facebookUrl ?? "",
      accountManager: s.accountManager ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      generalNotes: s.generalNotes ?? "",
      video1: s.video1 ?? "",
      video2: s.video2 ?? "",
      video3: s.video3 ?? "",
      categories: s.categories ?? "",
      locations: s.locations ?? "",
      imageUrl: s.imageUrl ?? "",
      adminUsername: s.adminUsername ?? "",
      adminPassword: s.adminPassword ?? "",
      adminNotes: s.adminNotes ?? "",
      credentialStage: s.credentialStage,
    });
  };

  const handleSave = () => {
    const payload = {
      name: form.name,
      description: form.description || undefined,
      shortDescription: form.shortDescription || undefined,
      publicWebsite: form.publicWebsite || undefined,
      tradeWebsite: form.tradeWebsite || undefined,
      agencyId: form.agencyId || undefined,
      loginUsername: form.loginUsername || undefined,
      loginPassword: form.loginPassword || undefined,
      commission: form.commission || undefined,
      facebookUrl: form.facebookUrl || undefined,
      accountManager: form.accountManager || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      generalNotes: form.generalNotes || undefined,
      video1: form.video1 || undefined,
      video2: form.video2 || undefined,
      video3: form.video3 || undefined,
      categories: form.categories || undefined,
      locations: form.locations || undefined,
      imageUrl: form.imageUrl || undefined,
      adminUsername: form.adminUsername || undefined,
      adminPassword: form.adminPassword || undefined,
      adminNotes: form.adminNotes || undefined,
      credentialStage: form.credentialStage,
    };

    if (editSupplier) {
      updateMutation.mutate({ id: editSupplier.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const FormDialog = ({
    open,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  }) => (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editSupplier ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {/* Name */}
          <div className="col-span-2 space-y-1">
            <Label>Supplier Name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Abercrombie & Kent"
            />
          </div>

          {/* Description */}
          <div className="col-span-2 space-y-1">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </div>

          {/* Websites */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>Public Website</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-primary"
                disabled={!form.publicWebsite || scrapeWebsiteMutation.isPending}
                onClick={() => scrapeWebsiteMutation.mutate({ url: form.publicWebsite })}
              >
                {scrapeWebsiteMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                Auto-fill from website
              </Button>
            </div>
            <Input
              value={form.publicWebsite}
              onChange={(e) => setForm((f) => ({ ...f, publicWebsite: e.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-1">
            <Label>Trade Portal URL</Label>
            <Input
              value={form.tradeWebsite}
              onChange={(e) => setForm((f) => ({ ...f, tradeWebsite: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          {/* Commission */}
          <div className="space-y-1">
            <Label>Commission</Label>
            <Input
              value={form.commission}
              onChange={(e) => setForm((f) => ({ ...f, commission: e.target.value }))}
              placeholder="e.g. 12.5%"
            />
          </div>

          {/* Credential Stage */}
          <div className="space-y-1">
            <Label>Credential Stage</Label>
            <Select
              value={String(form.credentialStage)}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, credentialStage: parseInt(v) }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">Stage 2 (most agents)</SelectItem>
                <SelectItem value="3">Stage 3 (advanced only)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Login credentials */}
          <div className="space-y-1">
            <Label>Login Username</Label>
            <Input
              value={form.loginUsername}
              onChange={(e) => setForm((f) => ({ ...f, loginUsername: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Login Password</Label>
            <Input
              value={form.loginPassword}
              onChange={(e) => setForm((f) => ({ ...f, loginPassword: e.target.value }))}
            />
          </div>

          {/* Agency ID */}
          <div className="space-y-1">
            <Label>Agency ID</Label>
            <Input
              value={form.agencyId}
              onChange={(e) => setForm((f) => ({ ...f, agencyId: e.target.value }))}
            />
          </div>

          {/* Account Manager */}
          <div className="space-y-1">
            <Label>Account Manager</Label>
            <Input
              value={form.accountManager}
              onChange={(e) => setForm((f) => ({ ...f, accountManager: e.target.value }))}
            />
          </div>

          {/* Phone & Email */}
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>

          {/* Categories */}
          <div className="col-span-2 space-y-1">
            <Label>Categories (semicolon-separated)</Label>
            <Input
              value={form.categories}
              onChange={(e) => setForm((f) => ({ ...f, categories: e.target.value }))}
              placeholder="Tour Operator;Cruise;Hotel"
            />
          </div>

          {/* Image URL */}
          <div className="col-span-2 space-y-1">
            <Label>Logo Image URL</Label>
            <Input
              value={form.imageUrl}
              onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          {/* General Notes */}
          <div className="col-span-2 space-y-1">
            <Label>General Notes</Label>
            <Textarea
              value={form.generalNotes}
              onChange={(e) => setForm((f) => ({ ...f, generalNotes: e.target.value }))}
              rows={2}
            />
          </div>

          {/* Videos */}
          <div className="col-span-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label>Training Video 1 (Loom embed HTML or URL)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1 text-primary"
                disabled={!form.video1 || analyseVideoMutation.isPending}
                onClick={() => analyseVideoMutation.mutate({ videoUrl: form.video1, supplierId: editSupplier?.id })}
              >
                {analyseVideoMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Video className="h-3 w-3" />
                )}
                Analyse video
              </Button>
            </div>
            <Input
              value={form.video1}
              onChange={(e) => setForm((f) => ({ ...f, video1: e.target.value }))}
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Training Video 2</Label>
            <Input
              value={form.video2}
              onChange={(e) => setForm((f) => ({ ...f, video2: e.target.value }))}
            />
          </div>

          {/* Admin credentials */}
          <div className="col-span-2 border-t pt-4 space-y-3">
            <h4 className="text-sm font-semibold text-amber-600">Admin-Only Credentials</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Admin Username</Label>
                <Input
                  value={form.adminUsername}
                  onChange={(e) => setForm((f) => ({ ...f, adminUsername: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Admin Password</Label>
                <Input
                  value={form.adminPassword}
                  onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Admin Notes</Label>
                <Textarea
                  value={form.adminNotes}
                  onChange={(e) => setForm((f) => ({ ...f, adminNotes: e.target.value }))}
                  rows={2}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!form.name || createMutation.isPending || updateMutation.isPending}
          >
            {editSupplier ? "Save Changes" : "Create Supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Supplier Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.total ?? 0} suppliers in the directory
          </p>
        </div>
        <Button onClick={() => { setEditSupplier(null); setForm(EMPTY_FORM); setShowCreate(true); }}>
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
                            onClick={() => openEdit(s as Supplier)}
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

      {/* Create/Edit dialog */}
      <FormDialog
        open={showCreate || editSupplier !== null}
        onClose={() => { setShowCreate(false); setEditSupplier(null); }}
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
