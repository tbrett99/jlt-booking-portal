/**
 * EmailEditor — a WYSIWYG rich-text editor for composing HTML emails.
 * Built on Tiptap. Outputs clean HTML suitable for Resend.
 */
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { useEffect, useCallback, useState } from "react";
import {
  Bold, Italic, List, ListOrdered, Link2, AlignLeft, AlignCenter,
  AlignRight, Heading2, Heading3, Quote, Undo, Redo, Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

function ToolbarButton({
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
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export default function EmailEditor({ value, onChange, placeholder }: EmailEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          style: "color:#02E6D2;text-decoration:underline;",
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
    ],
    content: value || "",
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[220px] px-4 py-3 text-sm text-foreground focus:outline-none prose prose-sm max-w-none dark:prose-invert",
      },
    },
  });

  // Sync external value changes (e.g. when dialog opens with existing content)
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, "");
    setLinkText(selectedText);
    const existingHref = editor.getAttributes("link").href ?? "";
    setLinkUrl(existingHref);
    setLinkDialogOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    if (!linkUrl) {
      editor.chain().focus().unsetLink().run();
    } else {
      const href = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      if (linkText && editor.state.selection.empty) {
        editor
          .chain()
          .focus()
          .insertContent(`<a href="${href}">${linkText}</a>`)
          .run();
      } else {
        editor.chain().focus().setLink({ href }).run();
      }
    }
    setLinkDialogOpen(false);
    setLinkUrl("");
    setLinkText("");
  }, [editor, linkUrl, linkText]);

  if (!editor) return null;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/30">
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
          <Italic size={14} />
        </ToolbarButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">
          <Heading2 size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">
          <Heading3 size={14} />
        </ToolbarButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Numbered list">
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Quote">
          <Quote size={14} />
        </ToolbarButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })} title="Align left">
          <AlignLeft size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })} title="Align center">
          <AlignCenter size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })} title="Align right">
          <AlignRight size={14} />
        </ToolbarButton>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton onClick={openLinkDialog} active={editor.isActive("link")} title="Insert link">
          <Link2 size={14} />
        </ToolbarButton>
        {editor.isActive("link") && (
          <ToolbarButton onClick={() => editor.chain().focus().unsetLink().run()} title="Remove link">
            <Unlink size={14} />
          </ToolbarButton>
        )}
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
          <Undo size={14} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
          <Redo size={14} />
        </ToolbarButton>

        {/* Button inserter */}
        <div className="w-px h-4 bg-border mx-1" />
        <button
          type="button"
          title="Insert CTA button"
          className="text-xs px-2 py-1 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          onClick={() => {
            const url = window.prompt("Button URL:", "https://");
            const label = window.prompt("Button label:", "Click here");
            if (url && label) {
              editor
                .chain()
                .focus()
                .insertContent(
                  `<p style="text-align:center;margin:24px 0;"><a href="${url}" style="display:inline-block;background:#02E6D2;color:#1a1a1a;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">${label}</a></p>`
                )
                .run();
            }
          }}
        >
          + Button
        </button>
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} placeholder={placeholder} />

      {/* Template variable hint */}
      <div className="px-3 py-1.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
        Variables: <code className="font-mono">{"{{firstName}}"}</code> · <code className="font-mono">{"{{lastName}}"}</code> · <code className="font-mono">{"{{email}}"}</code>
      </div>

      {/* Link dialog */}
      {linkDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setLinkDialogOpen(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-sm mb-3">Insert Link</h3>
            {!editor.state.selection.empty ? null : (
              <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1 block">Link text</label>
                <Input
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  placeholder="Click here"
                  className="h-8 text-sm"
                />
              </div>
            )}
            <div className="mb-4">
              <label className="text-xs text-muted-foreground mb-1 block">URL</label>
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === "Enter" && applyLink()}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={applyLink} style={{ background: "#02E6D2", color: "#1a1a1a" }}>Apply</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
