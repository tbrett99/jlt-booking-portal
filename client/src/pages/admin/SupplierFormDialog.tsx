import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { resolveDocUrl } from "@/lib/docUrl";
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
import { Sparkles, Video, Loader2, Upload, X, Paperclip, ImageIcon, KeyRound } from "lucide-react";
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
  instagramUrl: string | null;
  mediaAssetsUrl: string | null;
  phone: string | null;
  email: string | null;
  generalNotes: string | null;
  video1: string | null;
  video2: string | null;
  video3: string | null;
  video4: string | null;
  video5: string | null;
  locations: string | null;
  adminUsername: string | null;
  adminPassword: string | null;
  adminNotes: string | null;
  requiresLoginRequest?: boolean;
  loginRequestNotes?: string | null;
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
  instagramUrl: "",
  mediaAssetsUrl: "",
  additionalWebsite: "",
  accountManager: "",
  phone: "",
  email: "",
  generalNotes: "",
  video1: "",
  video2: "",
  video3: "",
  video4: "",
  video5: "",
  categories: "",
  locations: "",
  imageUrl: "",
  adminUsername: "",
  adminPassword: "",
  adminNotes: "",
  credentialStage: 2,
  requiresLoginRequest: false,
  loginRequestNotes: "",
};

// Convert a File to base64 string
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

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
        instagramUrl: (editSupplier as any).instagramUrl ?? "",
        mediaAssetsUrl: (editSupplier as any).mediaAssetsUrl ?? "",
        additionalWebsite: editSupplier.additionalWebsite ?? "",
        accountManager: editSupplier.accountManager ?? "",
        phone: editSupplier.phone ?? "",
        email: editSupplier.email ?? "",
        generalNotes: editSupplier.generalNotes ?? "",
        video1: editSupplier.video1 ?? "",
        video2: editSupplier.video2 ?? "",
        video3: editSupplier.video3 ?? "",
        video4: editSupplier.video4 ?? "",
        video5: editSupplier.video5 ?? "",
        categories: editSupplier.categories ?? "",
        locations: editSupplier.locations ?? "",
        imageUrl: editSupplier.imageUrl ?? "",
        adminUsername: editSupplier.adminUsername ?? "",
        adminPassword: editSupplier.adminPassword ?? "",
        adminNotes: editSupplier.adminNotes ?? "",
        credentialStage: editSupplier.credentialStage,
        requiresLoginRequest: editSupplier.requiresLoginRequest ?? false,
        loginRequestNotes: editSupplier.loginRequestNotes ?? "",
      });
      setLogoPreview(editSupplier.imageUrl ?? null);
    } else {
      setForm(EMPTY_FORM);
      setLogoPreview(null);
    }
  }, [editSupplier]);

  const createMutation = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      toast.success("Supplier created");
      onSuccess();
      onClose();
      setForm(EMPTY_FORM);
      setLogoPreview(null);
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

  const uploadLogoMutation = trpc.suppliers.uploadLogo.useMutation({
    onSuccess: (data) => {
      setForm((f) => ({ ...f, imageUrl: data.url }));
      setLogoPreview(data.url);
      toast.success("Logo uploaded successfully");
    },
    onError: (e) => toast.error("Logo upload failed: " + e.message),
  });

  const uploadAttachmentMutation = trpc.suppliers.uploadAttachment.useMutation({
    onSuccess: () => {
      toast.success("Attachment uploaded");
      if (editSupplier) attachmentsQuery.refetch();
    },
    onError: (e) => toast.error("Attachment upload failed: " + e.message),
  });

  const deleteAttachmentMutation = trpc.suppliers.deleteAttachment.useMutation({
    onSuccess: () => {
      toast.success("Attachment deleted");
      if (editSupplier) attachmentsQuery.refetch();
    },
    onError: (e) => toast.error("Delete failed: " + e.message),
  });

  const attachmentsQuery = trpc.suppliers.listAttachments.useQuery(
    { supplierId: editSupplier?.id ?? 0 },
    { enabled: !!editSupplier?.id }
  );

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

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB");
      return;
    }

    // Show local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setLogoPreview(objectUrl);

    if (editSupplier?.id) {
      // Existing supplier: upload immediately
      setLogoUploading(true);
      try {
        const base64 = await fileToBase64(file);
        await uploadLogoMutation.mutateAsync({
          supplierId: editSupplier.id,
          fileBase64: base64,
          mimeType: file.type,
          fileName: file.name,
        });
      } finally {
        setLogoUploading(false);
      }
    } else {
      // New supplier: store base64 in form state to upload after creation
      const base64 = await fileToBase64(file);
      (form as any)._pendingLogoBase64 = base64;
      (form as any)._pendingLogoMime = file.type;
      (form as any)._pendingLogoName = file.name;
      toast.info("Logo will be uploaded when the supplier is saved");
    }
    // Reset input
    e.target.value = "";
  };

  const handleAttachmentFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File must be under 50MB");
      return;
    }
    if (!editSupplier?.id) {
      toast.error("Please save the supplier first before uploading attachments");
      return;
    }
    setAttachmentUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await uploadAttachmentMutation.mutateAsync({
        supplierId: editSupplier.id,
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
        fileSize: file.size,
      });
    } finally {
      setAttachmentUploading(false);
      e.target.value = "";
    }
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
      instagramUrl: form.instagramUrl || undefined,
      mediaAssetsUrl: form.mediaAssetsUrl || undefined,
      additionalWebsite: (form as any).additionalWebsite || undefined,
      accountManager: form.accountManager || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      generalNotes: form.generalNotes || undefined,
      video1: form.video1 || undefined,
      video2: form.video2 || undefined,
      video3: form.video3 || undefined,
      video4: form.video4 || undefined,
      video5: form.video5 || undefined,
      categories: form.categories || undefined,
      locations: form.locations || undefined,
      imageUrl: form.imageUrl || undefined,
      adminUsername: form.adminUsername || undefined,
      adminPassword: form.adminPassword || undefined,
      adminNotes: form.adminNotes || undefined,
      credentialStage: form.credentialStage,
      requiresLoginRequest: form.requiresLoginRequest,
      loginRequestNotes: form.loginRequestNotes || undefined,
    };

    if (editSupplier) {
      updateMutation.mutate({ id: editSupplier.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

          {/* Additional Website */}
          <div className="space-y-1">
            <Label>Additional Website</Label>
            <Input
              value={(form as any).additionalWebsite ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, additionalWebsite: e.target.value }))}
              placeholder="https://..."
            />
          </div>

          {/* Social & Media Links */}
          <div className="space-y-1">
            <Label>Facebook Page URL</Label>
            <Input
              value={form.facebookUrl}
              onChange={(e) => setForm((f) => ({ ...f, facebookUrl: e.target.value }))}
              placeholder="https://facebook.com/..."
            />
          </div>
          <div className="space-y-1">
            <Label>Instagram URL</Label>
            <Input
              value={form.instagramUrl}
              onChange={(e) => setForm((f) => ({ ...f, instagramUrl: e.target.value }))}
              placeholder="https://instagram.com/..."
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label>Media Assets URL</Label>
            <Input
              value={form.mediaAssetsUrl}
              onChange={(e) => setForm((f) => ({ ...f, mediaAssetsUrl: e.target.value }))}
              placeholder="https://... (media kit, brand assets page)"
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

          {/* Logo Upload */}
          <div className="col-span-2 space-y-2">
            <Label>Supplier Logo</Label>
            <div className="flex items-start gap-4">
              {/* Preview */}
              <div className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden flex-shrink-0">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain p-1" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                {/* Upload button */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={logoUploading || uploadLogoMutation.isPending}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {logoUploading || uploadLogoMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {logoPreview ? "Replace Logo" : "Upload Logo"}
                </Button>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoFileChange}
                />
                <p className="text-xs text-muted-foreground">
                  PNG, JPG, SVG, WebP — max 10MB. Auto-compressed to WebP (~15–50KB).
                </p>
                {/* Or paste URL */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">or paste URL:</span>
                  <Input
                    value={form.imageUrl}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, imageUrl: e.target.value }));
                      setLogoPreview(e.target.value || null);
                    }}
                    placeholder="https://..."
                    className="h-7 text-xs"
                  />
                </div>
              </div>
            </div>
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

          {/* Videos — 5 Loom URL fields */}
          <div className="col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <Label>Training Videos (Loom URLs)</Label>
            </div>
            {([
              { key: "video1", label: "Video 1", showAnalyse: true },
              { key: "video2", label: "Video 2", showAnalyse: false },
              { key: "video3", label: "Video 3", showAnalyse: false },
              { key: "video4", label: "Video 4", showAnalyse: false },
              { key: "video5", label: "Video 5", showAnalyse: false },
            ] as const).map(({ key, label, showAnalyse }) => (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  {showAnalyse && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1 text-primary"
                      disabled={!form[key] || analyseVideoMutation.isPending}
                      onClick={() => analyseVideoMutation.mutate({ videoUrl: form[key], supplierId: editSupplier?.id })}
                    >
                      {analyseVideoMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Video className="h-3 w-3" />
                      )}
                      Analyse video
                    </Button>
                  )}
                </div>
                <Input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder="https://www.loom.com/share/..."
                />
              </div>
            ))}
          </div>

          {/* Attachments — only shown when editing an existing supplier */}
          {editSupplier && (
            <div className="col-span-2 space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label>Attachments</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={attachmentUploading || uploadAttachmentMutation.isPending}
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  {attachmentUploading || uploadAttachmentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  Upload File
                </Button>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={handleAttachmentFileChange}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                PDF, Word, Excel, PowerPoint, images, ZIP — max 50MB per file.
              </p>
              {attachmentsQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading attachments…
                </div>
              ) : attachmentsQuery.data && attachmentsQuery.data.length > 0 ? (
                <div className="space-y-2">
                  {attachmentsQuery.data.map((att) => (
                    <div key={att.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <a
                          href={resolveDocUrl(att.fileUrl, att.fileKey) ?? '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline truncate"
                        >
                          {att.fileName}
                        </a>
                        {att.fileSize && (
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {formatFileSize(att.fileSize)}
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => deleteAttachmentMutation.mutate({ id: att.id })}
                        disabled={deleteAttachmentMutation.isPending}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No attachments yet.</p>
              )}
            </div>
          )}

          {/* Personal Login Request */}
          <div className="col-span-2 border-t pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Personal Login Request</h4>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="requiresLoginRequest"
                checked={form.requiresLoginRequest ?? false}
                onChange={(e) => setForm((f) => ({ ...f, requiresLoginRequest: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              <label htmlFor="requiresLoginRequest" className="text-sm">
                Agents must request a personal login for this supplier
              </label>
            </div>
            {form.requiresLoginRequest && (
              <div className="space-y-1">
                <Label>Notes for admin (optional)</Label>
                <Textarea
                  value={form.loginRequestNotes ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, loginRequestNotes: e.target.value }))}
                  rows={2}
                  placeholder="e.g. Use the agent's JLT email address when setting up the account"
                />
              </div>
            )}
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
