import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Sparkles, Video, Loader2 } from "lucide-react";
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

export function SupplierFormDialog({
  open,
  editSupplier,
  onClose,
  onSuccess,
}: {
  open: boolean;
  editSupplier: Supplier | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);

  // Sync form when editSupplier changes (opening edit dialog)
  useEffect(() => {
    if (editSupplier) {
      setForm({
        name: editSupplier.name,
        description: editSupplier.description ?? "",
        shortDescription: editSupplier.shortDescription ?? "",
        publicWebsite: editSupplier.publicWebsite ?? "",
        tradeWebsite: editSupplier.tradeWebsite ?? "",
        agencyId: editSupplier.agencyId ?? "",
        loginUsername: editSupplier.loginUsername ?? "",
        loginPassword: editSupplier.loginPassword ?? "",
        commission: editSupplier.commission ?? "",
        facebookUrl: editSupplier.facebookUrl ?? "",
        accountManager: editSupplier.accountManager ?? "",
        phone: editSupplier.phone ?? "",
        email: editSupplier.email ?? "",
        generalNotes: editSupplier.generalNotes ?? "",
        video1: editSupplier.video1 ?? "",
        video2: editSupplier.video2 ?? "",
        video3: editSupplier.video3 ?? "",
        categories: editSupplier.categories ?? "",
        locations: editSupplier.locations ?? "",
        imageUrl: editSupplier.imageUrl ?? "",
        adminUsername: editSupplier.adminUsername ?? "",
        adminPassword: editSupplier.adminPassword ?? "",
        adminNotes: editSupplier.adminNotes ?? "",
        credentialStage: editSupplier.credentialStage,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [editSupplier]);

  const createMutation = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      toast.success("Supplier created");
      onSuccess();
      onClose();
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.suppliers.update.useMutation({
    onSuccess: () => {
      toast.success("Supplier updated");
      onSuccess();
      onClose();
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

  return (
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

          {/* Locations */}
          <div className="col-span-2 space-y-1">
            <Label>Locations (semicolon-separated)</Label>
            <Input
              value={form.locations}
              onChange={(e) => setForm((f) => ({ ...f, locations: e.target.value }))}
              placeholder="Spain;Greece;Caribbean"
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
}
