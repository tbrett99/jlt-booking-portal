import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Bold, Italic, Heading2, List, ListOrdered, Link as LinkIcon, Undo, Redo } from "lucide-react";
import { digestTextToEditorHtml, sanitizeDigestEditorHtml } from "@shared/community-digest-format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface DigestIntroEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  className?: string;
}

// Detect explicit Markdown only. Never infer headings or rewrite pasted wording.
function hasMarkdownSyntax(text: string): boolean {
  return /(?:\*\*|__)[^\r\n]+?(?:\*\*|__)/.test(text)
    || /(?:^|[\s(])(?:\*[^*\n]+\*|_[^_\n]+_)(?=$|[\s).,!?:;])/.test(text)
    || /^\s{0,3}#{1,6}\s+/m.test(text)
    || /^\s*(?:[-+*•●▪◦‣⁃]|\d+[.)])\s+/m.test(text)
    || /!?\[[^\]\n]+\]\([^)]+\)/.test(text)
    || /^\s{0,3}(?:>\s|```|~~~)/m.test(text);
}

function hasSemanticHtml(html: string): boolean {
  const template = document.createElement("template");
  template.innerHTML = html;
  return Boolean(template.content.querySelector("p, h1, h2, h3, h4, h5, h6, strong, b, em, i, ul, ol, li, a, br"));
}

function hasUnrenderedHtmlMarkdown(html: string): boolean {
  const template = document.createElement("template");
  template.innerHTML = html;
  // Rendered lists do not contain their bullet markers in the HTML text.
  // Do not throw away rich formatting just because text/plain includes bullets.
  template.content.querySelectorAll("pre, code").forEach((node) => node.remove());
  const blocks = Array.from(template.content.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li"));
  const text = blocks.length ? blocks.map((node) => node.textContent ?? "").join("\n") : template.content.textContent ?? "";
  return hasMarkdownSyntax(text);
}

/** A writing-only editor: no images, uploads, embeds or email-personalisation tools. */
export function DigestIntroEditor({ value, onChange, disabled = false, className }: DigestIntroEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmittedHtml = useRef<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    content: "",
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        protocols: ["mailto"],
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Placeholder.configure({ placeholder: "Add a personal message from the team…" }),
    ],
    editorProps: {
      attributes: {
        id: "digest-personal-intro",
        role: "textbox",
        "aria-label": "Personal intro message",
        "aria-describedby": "digest-personal-intro-help",
        "aria-multiline": "true",
        "aria-disabled": String(disabled),
        class: "min-h-[180px] px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_p]:my-3 [&_p:first-child]:mt-0 [&_h1]:my-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:my-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:my-3 [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:my-3 [&_h4]:font-semibold [&_h5]:my-3 [&_h5]:font-semibold [&_h6]:my-3 [&_h6]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li>p]:my-1 [&_a]:text-primary [&_a]:underline [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:pointer-events-none",
      },
      transformPastedHTML: sanitizeDigestEditorHtml,
      handlePaste: (view, event) => {
        if (!view.editable) return false;
        const clipboard = event.clipboardData;
        if (!clipboard) return false;
        const text = clipboard.getData("text/plain");
        const rawHtml = clipboard.getData("text/html");
        // Some ChatGPT copies include HTML paragraphs containing raw **markers**.
        // Convert those markers, but preserve HTML that is already formatted.
        const safeHtml = rawHtml ? sanitizeDigestEditorHtml(rawHtml) : "";
        const html = text && (!hasSemanticHtml(safeHtml) || (hasMarkdownSyntax(text) && hasUnrenderedHtmlMarkdown(safeHtml)))
          ? digestTextToEditorHtml(text)
          : safeHtml;
        if (!text && !rawHtml && !clipboard.files.length) return false;
        event.preventDefault();
        if (html) {
          const container = document.createElement("div");
          container.innerHTML = html;
          const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container);
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        }
        return true;
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (!currentEditor.isEditable) return;
      const html = currentEditor.isEmpty ? "" : sanitizeDigestEditorHtml(currentEditor.getHTML());
      lastEmittedHtml.current = html;
      onChangeRef.current(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const html = sanitizeDigestEditorHtml(value);
    // Parent echoes must not replace the document/cursor while the user types.
    if (html === lastEmittedHtml.current || html === editor.getHTML()) return;
    lastEmittedHtml.current = null;
    editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute("aria-disabled", String(disabled));
    if (disabled) setLinkOpen(false);
  }, [editor, disabled]);

  function openLink() {
    if (!editor || disabled) return;
    setLinkUrl(editor.getAttributes("link").href ?? "");
    setLinkError("");
    setLinkOpen((open) => !open);
  }

  function applyLink() {
    if (!editor || disabled) return;
    const url = linkUrl.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    if (!/^(?:https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(url)) {
      setLinkError("Use a full https:// or http:// address, or a mailto: link.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false);
  }

  function toolbarButton(label: string, icon: ReactNode, action: () => void, active?: boolean, unavailable = false) {
    return (
      <Button
        type="button"
        variant={active ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label={label}
        title={label}
        aria-pressed={active}
        disabled={disabled || !editor || unavailable}
        onMouseDown={(event) => event.preventDefault()}
        onClick={action}
      >
        {icon}
      </Button>
    );
  }

  return (
    <div className={cn("overflow-hidden rounded-md border border-input bg-background", disabled && "opacity-60", className)}>
      <div role="toolbar" aria-label="Personal intro formatting" aria-disabled={disabled} className="flex flex-wrap items-center gap-1 border-b border-input bg-muted/30 p-1.5">
        {toolbarButton("Bold", <Bold className="h-4 w-4" />, () => { editor?.chain().focus().toggleBold().run(); }, editor?.isActive("bold") ?? false)}
        {toolbarButton("Italic", <Italic className="h-4 w-4" />, () => { editor?.chain().focus().toggleItalic().run(); }, editor?.isActive("italic") ?? false)}
        {toolbarButton("Heading", <Heading2 className="h-4 w-4" />, () => {
          if (editor?.isActive("heading")) editor.chain().focus().setParagraph().run();
          else editor?.chain().focus().toggleHeading({ level: 2 }).run();
        }, editor?.isActive("heading") ?? false)}
        {toolbarButton("Bullet list", <List className="h-4 w-4" />, () => { editor?.chain().focus().toggleBulletList().run(); }, editor?.isActive("bulletList") ?? false)}
        {toolbarButton("Numbered list", <ListOrdered className="h-4 w-4" />, () => { editor?.chain().focus().toggleOrderedList().run(); }, editor?.isActive("orderedList") ?? false)}
        {toolbarButton("Add or edit link", <LinkIcon className="h-4 w-4" />, openLink, editor?.isActive("link") ?? false)}
        <span aria-hidden="true" className="mx-1 h-5 border-l border-input" />
        {toolbarButton("Undo", <Undo className="h-4 w-4" />, () => { editor?.chain().focus().undo().run(); }, undefined, !editor?.can().undo())}
        {toolbarButton("Redo", <Redo className="h-4 w-4" />, () => { editor?.chain().focus().redo().run(); }, undefined, !editor?.can().redo())}
      </div>
      {linkOpen && (
        <div className="space-y-2 border-b border-input p-3">
          <Label htmlFor="digest-intro-link">Link address</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="digest-intro-link"
              value={linkUrl}
              onChange={(event) => { setLinkUrl(event.target.value); setLinkError(""); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); applyLink(); }
                if (event.key === "Escape") { event.preventDefault(); setLinkOpen(false); editor?.commands.focus(); }
              }}
              placeholder="https://example.com"
              aria-invalid={Boolean(linkError)}
              aria-describedby={linkError ? "digest-intro-link-error" : undefined}
              disabled={disabled}
              className="min-w-40 flex-1"
            />
            <Button type="button" size="sm" onClick={applyLink} disabled={disabled}>Apply</Button>
            {editor?.isActive("link") && <Button type="button" size="sm" variant="outline" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }} disabled={disabled}>Remove link</Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>Cancel</Button>
          </div>
          {linkError && <p id="digest-intro-link-error" role="alert" className="text-xs text-destructive">{linkError}</p>}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
