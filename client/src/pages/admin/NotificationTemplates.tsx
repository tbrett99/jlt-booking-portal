import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Loader2, Mail, Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Link as LinkIcon, Unlink } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TiptapLink from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import TiptapUnderline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";

// ── Toolbar button helper ─────────────────────────────────────────────────────
function ToolbarBtn({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`p-1.5 rounded transition-colors ${active ? "bg-[#70FFE8] text-[#0d1a26]" : "hover:bg-muted text-foreground"}`}
    >
      {children}
    </button>
  );
}

// ── Rich text editor component ────────────────────────────────────────────────
function RichEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapUnderline,
      TiptapLink.configure({ openOnClick: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "Write your email here…" }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href ?? "";
    const url = window.prompt("Enter URL", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b bg-muted/30">
        <ToolbarBtn title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={14} />
        </ToolbarBtn>
        <ToolbarBtn title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={14} />
        </ToolbarBtn>
        <ToolbarBtn title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={14} />
        </ToolbarBtn>
        <ToolbarBtn title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft size={14} />
        </ToolbarBtn>
        <ToolbarBtn title="Align centre" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter size={14} />
        </ToolbarBtn>
        <ToolbarBtn title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight size={14} />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn title="Add link" active={editor.isActive("link")} onClick={setLink}>
          <LinkIcon size={14} />
        </ToolbarBtn>
        <ToolbarBtn title="Remove link" onClick={() => editor.chain().focus().unsetLink().run()}>
          <Unlink size={14} />
        </ToolbarBtn>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none p-4 min-h-[200px] focus-within:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[180px] [&_.ProseMirror_p]:my-3 [&_.ProseMirror_p]:leading-relaxed [&_.ProseMirror_ul]:my-3 [&_.ProseMirror_ol]:my-3 [&_.ProseMirror_li]:my-1 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NotificationTemplates() {
  const utils = trpc.useUtils();
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const { data: templates = [], isLoading } = trpc.notifications.templates.list.useQuery();
  const upsertTemplate = trpc.notifications.templates.update.useMutation({
    onSuccess: () => utils.notifications.templates.invalidate(),
  });

  const openEdit = (t: any) => {
    setEditingTemplate(t);
    setSubject(t.subject);
    setBodyHtml(t.bodyHtml);
  };

  const handleSave = async () => {
    if (!editingTemplate) return;
    setIsSaving(true);
    try {
      await upsertTemplate.mutateAsync({
        triggerKey: editingTemplate.triggerKey,
        label: editingTemplate.label,
        subject,
        bodyHtml,
        recipientType: editingTemplate.recipientType,
      });
      toast.success("Template saved");
      setEditingTemplate(null);
    } catch (err: any) {
      toast.error(err.message || "Failed to save template");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notification Templates</h1>
        <p className="text-sm text-muted-foreground">
          Edit the email templates sent automatically when booking stages change or actions are taken.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
        </div>
      ) : (
        <div className="grid gap-4">
          {(templates as any[]).map((t) => (
            <Card key={t.id ?? t.triggerKey}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail size={14} style={{ color: '#02E6D2' }} />
                      <span className="font-semibold text-sm">{t.label}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full ml-2"
                        style={{ background: t.recipientType === 'agent' ? '#70FFE8' : '#FFC3BC', color: '#414141' }}>
                        → {t.recipientType}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">Subject: {t.subject}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {t.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)}…
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="gap-1 flex-shrink-0" onClick={() => openEdit(t)}>
                    <Pencil size={12} />Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {templates.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No templates found</p>
          )}
        </div>
      )}

      <Dialog open={!!editingTemplate} onOpenChange={() => setEditingTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Template: {editingTemplate?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Variable hint */}
            <div className="p-3 rounded-lg text-xs" style={{ background: '#FFF6ED', color: '#92400e' }}>
              You can use these placeholders in your text — they'll be replaced automatically when the email is sent:{" "}
              <strong>{"{{agentName}}"}</strong>, <strong>{"{{clientName}}"}</strong>, <strong>{"{{bookingId}}"}</strong>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label>Email Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line…" />
            </div>

            {/* WYSIWYG body editor */}
            <div className="space-y-2">
              <Label>Email Body</Label>
              {editingTemplate && (
                <RichEditor key={editingTemplate.triggerKey} value={bodyHtml} onChange={setBodyHtml} />
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button onClick={handleSave} disabled={isSaving} style={{ background: '#70FFE8', color: '#414141' }} className="font-semibold">
                {isSaving ? <><Loader2 size={14} className="animate-spin mr-2" />Saving…</> : "Save Template"}
              </Button>
              <Button variant="outline" onClick={() => setEditingTemplate(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
