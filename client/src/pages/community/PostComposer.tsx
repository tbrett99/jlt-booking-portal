import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { X, Upload, Paperclip, Loader2 } from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";

const CATEGORIES = [
  { id: "business_update", label: "Business Update", adminOnly: true },
  { id: "supplier_news_deals", label: "Supplier News & Deals", adminOnly: true },
  { id: "news_announcements", label: "News & Announcements", adminOnly: true },
  { id: "agent_win", label: "Agent Win", adminOnly: false },
  { id: "jlt_stay_story", label: "JLT Stay & Story", adminOnly: false },
  { id: "events", label: "Events", adminOnly: true },
  { id: "training_webinars", label: "Training & Webinars", adminOnly: true },
  { id: "mindset", label: "Mindset", adminOnly: true },
  { id: "first_class_lounge", label: "First Class Lounge", adminOnly: true },
];

const SUPPLIER_SUBCATEGORIES = [
  "Cruise", "Disney", "Tour Operators", "Flights", "Hotels", "Other",
];

interface PostComposerProps {
  isAdmin: boolean;
  initialData?: any;
  defaultCategory?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PostComposer({ isAdmin, initialData, defaultCategory, onClose, onSuccess }: PostComposerProps) {
  const isEditing = !!initialData;

  const availableCategories = isAdmin
    ? CATEGORIES
    : CATEGORIES.filter((c) => !c.adminOnly);

  const [category, setCategory] = useState<string>(
    initialData?.category ?? defaultCategory ?? (isAdmin ? "business_update" : "agent_win")
  );
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(initialData?.bodyHtml ?? "");
  const [loomUrl, setLoomUrl] = useState(initialData?.loomUrl ?? "");
  const [isPinned, setIsPinned] = useState(initialData?.isPinned ?? false);
  const [isDraft, setIsDraft] = useState(initialData?.isDraft ?? false);
  const [requiresConfirmation, setRequiresConfirmation] = useState(initialData?.requiresConfirmation ?? false);
  const [supplierSubCategory, setSupplierSubCategory] = useState(initialData?.supplierSubCategory ?? "");
  const [supplierPostType, setSupplierPostType] = useState<"news" | "deal" | "">(initialData?.supplierPostType ?? "");
  const [imageUrls, setImageUrls] = useState<string[]>(
    Array.isArray(initialData?.imageUrls) ? initialData.imageUrls : []
  );
  const [attachments, setAttachments] = useState<{ name: string; url: string; key: string }[]>(
    Array.isArray(initialData?.attachmentUrls) ? initialData.attachmentUrls : []
  );
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const uploadAttachment = trpc.community.uploadAttachment.useMutation();

  const createPost = trpc.community.create.useMutation({
    onSuccess: () => { toast.success("Post published!"); onSuccess(); },
    onError: (e) => toast.error(e.message),
  });

  const updatePost = trpc.community.update.useMutation({
    onSuccess: () => { toast.success("Post updated!"); onSuccess(); },
    onError: (e) => toast.error(e.message),
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const maxImages = isAdmin ? 5 : 3;
    if (imageUrls.length + files.length > maxImages) {
      toast.error(`Maximum ${maxImages} images allowed`);
      return;
    }
    setUploading(true);
    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        const result = await uploadAttachment.mutateAsync({
          fileName: file.name,
          mimeType: file.type,
          base64Data: base64,
        });
        setImageUrls((prev) => [...prev, result.url]);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 10MB)`);
        continue;
      }
      try {
        const base64 = await fileToBase64(file);
        const result = await uploadAttachment.mutateAsync({
          fileName: file.name,
          mimeType: file.type,
          base64Data: base64,
        });
        setAttachments((prev) => [...prev, { name: file.name, url: result.url, key: result.key }]);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error("Please add a title"); return; }
    if (!bodyHtml || bodyHtml === "<p></p>") { toast.error("Please add some content"); return; }

    const payload = {
      category: category as any,
      title: title.trim(),
      bodyHtml,
      loomUrl: loomUrl || undefined,
      isPinned: isAdmin ? isPinned : undefined,
      isDraft: isAdmin ? isDraft : undefined,
      requiresConfirmation: isAdmin ? requiresConfirmation : undefined,
      supplierSubCategory: category === "supplier_news_deals" ? supplierSubCategory || undefined : undefined,
      supplierPostType: category === "supplier_news_deals" && supplierPostType ? supplierPostType : undefined,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      attachmentUrls: attachments.length > 0 ? attachments : undefined,
    };

    if (isEditing) {
      updatePost.mutate({ postId: initialData.id, ...payload });
    } else {
      createPost.mutate(payload);
    }
  };

  const isPending = createPost.isPending || updatePost.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Post" : "New Post"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category */}
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Supplier sub-fields */}
          {category === "supplier_news_deals" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Post Type</Label>
                <Select value={supplierPostType} onValueChange={(v) => setSupplierPostType(v as any)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="news">News</SelectItem>
                    <SelectItem value="deal">Deal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Supplier Category</Label>
                <Select value={supplierSubCategory} onValueChange={setSupplierSubCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPLIER_SUBCATEGORIES.map((s) => (
                      <SelectItem key={s} value={s.toLowerCase()}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              placeholder="Post title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <Label>Content</Label>
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Write your post..."
              minHeight="180px"
            />
          </div>

          {/* Loom URL */}
          <div className="space-y-1.5">
            <Label>Loom Video URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              placeholder="https://www.loom.com/share/..."
              value={loomUrl}
              onChange={(e) => setLoomUrl(e.target.value)}
            />
          </div>

          {/* Images */}
          <div className="space-y-1.5">
            <Label>Images <span className="text-muted-foreground font-normal">(optional, max {isAdmin ? 5 : 3})</span></Label>
            {imageUrls.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {imageUrls.map((url, i) => (
                  <div key={i} className="relative group">
                    <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-border" />
                    <button
                      type="button"
                      onClick={() => setImageUrls((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 bg-destructive text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={handleImageUpload} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || imageUrls.length >= (isAdmin ? 5 : 3)}
              onClick={() => imageInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? "Uploading..." : "Add Images"}
            </Button>
          </div>

          {/* Attachments (admin only) */}
          {isAdmin && (
            <div className="space-y-1.5">
              <Label>Attachments <span className="text-muted-foreground font-normal">(PDF, DOCX — max 10MB each)</span></Label>
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-1.5 bg-muted px-3 py-1.5 rounded-full text-sm border border-border">
                      <Paperclip className="w-3 h-3 text-muted-foreground" />
                      <span className="max-w-[120px] truncate">{a.name}</span>
                      <button
                        type="button"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={attachInputRef} type="file" accept=".pdf,.doc,.docx" multiple hidden onChange={handleAttachmentUpload} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => attachInputRef.current?.click()}
              >
                <Paperclip className="w-4 h-4 mr-2" />
                {uploading ? "Uploading..." : "Add Attachment"}
              </Button>
            </div>
          )}

          {/* Admin options */}
          {isAdmin && (
            <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Admin Options</p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Pin post</p>
                  <p className="text-xs text-muted-foreground">Keeps this post at the top of the feed</p>
                </div>
                <Switch checked={isPinned} onCheckedChange={setIsPinned} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Save as draft</p>
                  <p className="text-xs text-muted-foreground">Only visible to admins until published</p>
                </div>
                <Switch checked={isDraft} onCheckedChange={setIsDraft} />
              </div>
              {category === "business_update" && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Requires confirmation</p>
                    <p className="text-xs text-muted-foreground">Agents must confirm they've read this</p>
                  </div>
                  <Switch checked={requiresConfirmation} onCheckedChange={setRequiresConfirmation} />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || uploading}>
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : isEditing ? "Save Changes" : isDraft ? "Save Draft" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
