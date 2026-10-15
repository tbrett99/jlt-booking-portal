import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef } from "react";
import { Bold, Heading2, Italic, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { academyQuestionHtmlToText, academyQuestionTextToHtml } from "@shared/academy-question-rich-text";
import { cn } from "@/lib/utils";

export function AcademyQuestionRichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
  label: string;
}) {
  const lastValue = useRef(value);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2] } }),
      Placeholder.configure({ placeholder }),
    ],
    content: academyQuestionTextToHtml(value),
    editorProps: {
      attributes: {
        class: "academy-question-rich-editor min-h-[180px] px-3 py-2 text-sm leading-6 focus:outline-none",
        "aria-label": label,
      },
    },
    onUpdate: ({ editor }) => {
      const next = academyQuestionHtmlToText(editor.getHTML());
      lastValue.current = next;
      onChange(next);
    },
  });

  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    editor.commands.setContent(academyQuestionTextToHtml(value), { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const ToolButton = ({ active, title, onClick, children }: { active?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn("rounded p-1.5 transition hover:bg-muted", active && "bg-muted text-primary")}
    >
      {children}
    </button>
  );

  return (
    <div className={cn("overflow-hidden rounded-md border bg-background", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 p-1.5" role="toolbar" aria-label={`${label} formatting`}>
        <ToolButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={15} /></ToolButton>
        <ToolButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={15} /></ToolButton>
        <span className="mx-1 h-5 border-l" aria-hidden="true" />
        <ToolButton title="Heading" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={15} /></ToolButton>
        <ToolButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={15} /></ToolButton>
        <ToolButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={15} /></ToolButton>
        <span className="mx-1 h-5 border-l" aria-hidden="true" />
        <ToolButton title="Undo" onClick={() => editor.chain().focus().undo().run()}><Undo2 size={15} /></ToolButton>
        <ToolButton title="Redo" onClick={() => editor.chain().focus().redo().run()}><Redo2 size={15} /></ToolButton>
      </div>
      <EditorContent editor={editor} />
      <p className="border-t bg-muted/10 px-3 py-2 text-xs text-muted-foreground">Paste from Word, Google Docs or ChatGPT to keep headings, bold, italics, bullets, numbered lists and paragraph breaks. Formatting is stored safely with the question.</p>
    </div>
  );
}
