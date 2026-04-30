/**
 * RichEmailEditor — TipTap-based rich text editor for composing marketing emails.
 * Supports: bold, italic, underline, headings, lists, links, images, and Loom video embeds.
 */
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon,
  Image as ImageIcon, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Video, Undo, Redo, Strikethrough,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichEmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export function RichEmailEditor({ value, onChange, placeholder = "Compose your email…", className }: RichEmailEditorProps) {
  const [linkDialog, setLinkDialog] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageDialog, setImageDialog] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [loomDialog, setLoomDialog] = useState(false);
  const [loomUrl, setLoomUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-blue-600 underline" } }),
      Image.configure({ HTMLAttributes: { class: "max-w-full rounded my-2" } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync external value changes (e.g. loading a template)
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  function insertLink() {
    if (!linkUrl) return;
    editor?.chain().focus().setLink({ href: linkUrl }).run();
    setLinkDialog(false);
    setLinkUrl("");
  }

  function insertImage() {
    if (!imageUrl) return;
    editor?.chain().focus().setImage({ src: imageUrl }).run();
    setImageDialog(false);
    setImageUrl("");
  }

  function insertLoom() {
    if (!loomUrl) return;
    // Extract Loom video ID and create an embed
    const match = loomUrl.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
    const videoId = match ? match[1] : null;
    if (!videoId) {
      alert("Please enter a valid Loom share URL (e.g. https://www.loom.com/share/abc123)");
      return;
    }
    const embedHtml = `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%;margin:16px 0;"><iframe src="https://www.loom.com/embed/${videoId}" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:8px;"></iframe></div>`;
    editor?.chain().focus().insertContent(embedHtml).run();
    setLoomDialog(false);
    setLoomUrl("");
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      editor?.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const ToolbarBtn = ({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded hover:bg-muted transition-colors",
        active && "bg-muted text-primary"
      )}
    >
      {children}
    </button>
  );

  return (
    <div className={cn("border rounded-lg overflow-hidden bg-background", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b bg-muted/30">
        <ToolbarBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <Bold className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <Italic className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <Strikethrough className="h-4 w-4" />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          <Heading1 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          <Heading2 className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          <Heading3 className="h-4 w-4" />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
          <List className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
          <ListOrdered className="h-4 w-4" />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Align Left">
          <AlignLeft className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Align Center">
          <AlignCenter className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Align Right">
          <AlignRight className="h-4 w-4" />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Link */}
        <ToolbarBtn active={editor.isActive("link")} onClick={() => { setLinkUrl(editor.getAttributes("link").href ?? ""); setLinkDialog(true); }} title="Insert Link">
          <LinkIcon className="h-4 w-4" />
        </ToolbarBtn>

        {/* Image */}
        <ToolbarBtn onClick={() => setImageDialog(true)} title="Insert Image URL">
          <ImageIcon className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => fileInputRef.current?.click()} title="Upload Image">
          <span className="text-xs font-medium px-1">IMG</span>
        </ToolbarBtn>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />

        {/* Loom */}
        <ToolbarBtn onClick={() => setLoomDialog(true)} title="Embed Loom Video">
          <Video className="h-4 w-4" />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Undo">
          <Undo className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Redo">
          <Redo className="h-4 w-4" />
        </ToolbarBtn>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none p-4 min-h-[300px] focus-within:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[280px]"
      />

      {/* Link dialog */}
      {linkDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLinkDialog(false)}>
          <div className="bg-background border rounded-lg p-4 w-80 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-2">Insert Link</p>
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." className="mb-3" autoFocus onKeyDown={(e) => e.key === "Enter" && insertLink()} />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setLinkDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={insertLink}>Insert</Button>
            </div>
          </div>
        </div>
      )}

      {/* Image URL dialog */}
      {imageDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setImageDialog(false)}>
          <div className="bg-background border rounded-lg p-4 w-80 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-2">Insert Image from URL</p>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." className="mb-3" autoFocus onKeyDown={(e) => e.key === "Enter" && insertImage()} />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setImageDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={insertImage}>Insert</Button>
            </div>
          </div>
        </div>
      )}

      {/* Loom dialog */}
      {loomDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLoomDialog(false)}>
          <div className="bg-background border rounded-lg p-4 w-96 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-1">Embed Loom Video</p>
            <p className="text-xs text-muted-foreground mb-2">Paste your Loom share URL (e.g. https://www.loom.com/share/abc123)</p>
            <Input value={loomUrl} onChange={(e) => setLoomUrl(e.target.value)} placeholder="https://www.loom.com/share/..." className="mb-3" autoFocus onKeyDown={(e) => e.key === "Enter" && insertLoom()} />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setLoomDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={insertLoom}>Embed</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
