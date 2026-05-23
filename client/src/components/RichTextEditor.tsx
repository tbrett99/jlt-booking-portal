/**
 * RichTextEditor — lightweight TipTap editor for community posts.
 * Supports: bold, italic, underline, headings, bullet/ordered lists, links, Loom embeds.
 */
import { useEditor, EditorContent, Node, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon,
  List, ListOrdered, Heading2, Heading3, Undo, Redo, Video,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Loom embed node ────────────────────────────────────────────────────────────
const LoomEmbed = Node.create({
  name: "loomEmbed",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      videoId: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-loom-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-loom-id": HTMLAttributes.videoId, class: "loom-embed-block" })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "loom-embed-block my-4 rounded-lg overflow-hidden border border-border";
      const videoId = node.attrs.videoId;
      if (videoId) {
        dom.innerHTML = `
          <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;">
            <iframe src="https://www.loom.com/embed/${videoId}" 
                    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
                    allowfullscreen></iframe>
          </div>`;
      } else {
        dom.innerHTML = `<div class="p-4 text-muted-foreground text-sm">Invalid Loom URL</div>`;
      }
      return { dom };
    };
  },
});

function extractLoomId(url: string): string | null {
  const match = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something...",
  className,
  minHeight = "200px",
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      Underline,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      LoomEmbed,
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value]);

  if (!editor) return null;

  const insertLoom = () => {
    const url = window.prompt("Paste your Loom video URL:");
    if (!url) return;
    const videoId = extractLoomId(url);
    if (!videoId) {
      alert("That doesn't look like a valid Loom URL. Try: https://www.loom.com/share/...");
      return;
    }
    editor.chain().focus().insertContent({ type: "loomEmbed", attrs: { url, videoId } }).run();
  };

  const insertLink = () => {
    const url = window.prompt("Enter URL:");
    if (!url) return;
    editor.chain().focus().setLink({ href: url }).run();
  };

  const toolbarBtn = (active: boolean, onClick: () => void, icon: React.ReactNode, title: string) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded hover:bg-muted transition-colors",
        active && "bg-muted text-foreground",
        !active && "text-muted-foreground"
      )}
    >
      {icon}
    </button>
  );

  return (
    <div className={cn("border border-input rounded-md overflow-hidden", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-input bg-muted/30">
        {toolbarBtn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold className="w-4 h-4" />, "Bold")}
        {toolbarBtn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic className="w-4 h-4" />, "Italic")}
        {toolbarBtn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon className="w-4 h-4" />, "Underline")}
        <div className="w-px h-5 bg-border mx-1" />
        {toolbarBtn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="w-4 h-4" />, "Heading 2")}
        {toolbarBtn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 className="w-4 h-4" />, "Heading 3")}
        <div className="w-px h-5 bg-border mx-1" />
        {toolbarBtn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List className="w-4 h-4" />, "Bullet list")}
        {toolbarBtn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="w-4 h-4" />, "Numbered list")}
        <div className="w-px h-5 bg-border mx-1" />
        {toolbarBtn(editor.isActive("link"), insertLink, <LinkIcon className="w-4 h-4" />, "Insert link")}
        {toolbarBtn(false, insertLoom, <Video className="w-4 h-4" />, "Embed Loom video")}
        <div className="w-px h-5 bg-border mx-1" />
        {toolbarBtn(false, () => editor.chain().focus().undo().run(), <Undo className="w-4 h-4" />, "Undo")}
        {toolbarBtn(false, () => editor.chain().focus().redo().run(), <Redo className="w-4 h-4" />, "Redo")}
      </div>
      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-3 py-2 focus-within:outline-none"
        style={{ minHeight }}
      />
    </div>
  );
}
