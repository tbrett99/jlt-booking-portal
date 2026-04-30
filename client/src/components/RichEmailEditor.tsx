/**
 * RichEmailEditor — TipTap-based rich text editor for composing marketing emails.
 * Supports: bold, italic, underline, headings, lists, links, images, Loom video embeds,
 *           text colour picker, font size, horizontal rule divider, and CTA button blocks.
 */
import { useEditor, EditorContent, Node, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon,
  Image as ImageIcon, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Video, Undo, Redo, Strikethrough, Minus, MousePointerClick,
  Palette, Type,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Custom FontSize extension ─────────────────────────────────────────────────
const FontSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (el) => el.style.fontSize || null,
        renderHTML: (attrs) => {
          if (!attrs.fontSize) return {};
          return { style: `font-size: ${attrs.fontSize}` };
        },
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setFontSize:
        (fontSize: string) =>
        ({ chain }: { chain: any }) => {
          return chain().setMark("textStyle", { fontSize }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }: { chain: any }) => {
          return chain().setMark("textStyle", { fontSize: null }).run();
        },
    } as any;
  },
});

// ── Custom ButtonBlock node (renders as a styled CTA button in email HTML) ────
const ButtonBlock = Node.create({
  name: "buttonBlock",
  group: "block",
  content: "inline*",
  atom: false,
  addAttributes() {
    return {
      href: { default: "#" },
      bgColor: { default: "#02E6D2" },
      textColor: { default: "#414141" },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-button-block]" }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes({ "data-button-block": "true", style: "text-align:center;margin:16px 0;" }),
      [
        "a",
        {
          href: HTMLAttributes.href,
          style: `display:inline-block;padding:12px 28px;background:${HTMLAttributes.bgColor};color:${HTMLAttributes.textColor};font-weight:600;border-radius:6px;text-decoration:none;font-family:Poppins,Arial,sans-serif;`,
        },
        0,
      ],
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.style.cssText = "text-align:center;margin:16px 0;";

      const btn = document.createElement("a");
      btn.href = node.attrs.href;
      btn.style.cssText = `display:inline-block;padding:12px 28px;background:${node.attrs.bgColor};color:${node.attrs.textColor};font-weight:600;border-radius:6px;text-decoration:none;font-family:Poppins,Arial,sans-serif;cursor:text;`;
      btn.contentEditable = "true";

      dom.appendChild(btn);

      // Sync inner text back to node content
      btn.addEventListener("input", () => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos !== null && pos !== undefined) {
          const tr = editor.state.tr;
          tr.insertText(btn.innerText, pos + 1, pos + 1 + node.content.size);
          editor.view.dispatch(tr);
        }
      });

      return { dom, contentDOM: btn };
    };
  },
});

// ── Preset colours ─────────────────────────────────────────────────────────────
const PRESET_COLORS = [
  "#414141", "#000000", "#ffffff", "#70FFE8", "#02E6D2",
  "#FFC3BC", "#FFF6ED", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899",
];

// ── Font sizes ─────────────────────────────────────────────────────────────────
const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px", "48px"];

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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [customColor, setCustomColor] = useState("#414141");
  const [fontSizeOpen, setFontSizeOpen] = useState(false);
  const [buttonDialog, setButtonDialog] = useState(false);
  const [buttonText, setButtonText] = useState("Click here");
  const [buttonUrl, setButtonUrl] = useState("https://");
  const [buttonBg, setButtonBg] = useState("#02E6D2");
  const [buttonTextColor, setButtonTextColor] = useState("#414141");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const fontSizeRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      Underline,
      FontSize,
      Color,
      HorizontalRule,
      ButtonBlock,
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

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as globalThis.Node)) {
        setColorPickerOpen(false);
      }
      if (fontSizeRef.current && !fontSizeRef.current.contains(e.target as globalThis.Node)) {
        setFontSizeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

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

  function applyColor(color: string) {
    editor?.chain().focus().setColor(color).run();
    setColorPickerOpen(false);
  }

  function applyFontSize(size: string) {
    (editor?.chain().focus() as any).setFontSize(size).run();
    setFontSizeOpen(false);
  }

  function insertButtonBlock() {
    if (!buttonText || !buttonUrl) return;
    const html = `<div data-button-block="true" style="text-align:center;margin:16px 0;"><a href="${buttonUrl}" style="display:inline-block;padding:12px 28px;background:${buttonBg};color:${buttonTextColor};font-weight:600;border-radius:6px;text-decoration:none;font-family:Poppins,Arial,sans-serif;">${buttonText}</a></div>`;
    editor?.chain().focus().insertContent(html).run();
    setButtonDialog(false);
    setButtonText("Click here");
    setButtonUrl("https://");
    setButtonBg("#02E6D2");
    setButtonTextColor("#414141");
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

  // Current active text colour
  const activeColor = editor.getAttributes("textStyle").color ?? "#414141";

  return (
    <div className={cn("border rounded-lg overflow-hidden bg-background", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 p-2 border-b bg-muted/30">
        {/* Text formatting */}
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

        {/* Text colour picker */}
        <div className="relative" ref={colorPickerRef}>
          <button
            type="button"
            title="Text Colour"
            onClick={() => setColorPickerOpen((o) => !o)}
            className="p-1.5 rounded hover:bg-muted transition-colors flex flex-col items-center gap-0.5"
          >
            <Palette className="h-4 w-4" />
            <div className="h-1 w-4 rounded-sm" style={{ backgroundColor: activeColor }} />
          </button>
          {colorPickerOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg p-3 w-52">
              <p className="text-xs font-medium text-muted-foreground mb-2">Text Colour</p>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onClick={() => applyColor(c)}
                    className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="w-8 h-8 rounded border cursor-pointer"
                  title="Custom colour"
                />
                <span className="text-xs text-muted-foreground flex-1">{customColor}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyColor(customColor)}>
                  Apply
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="w-full mt-1 h-7 text-xs"
                onClick={() => { editor?.chain().focus().unsetColor().run(); setColorPickerOpen(false); }}
              >
                Remove colour
              </Button>
            </div>
          )}
        </div>

        {/* Font size */}
        <div className="relative" ref={fontSizeRef}>
          <button
            type="button"
            title="Font Size"
            onClick={() => setFontSizeOpen((o) => !o)}
            className="p-1.5 rounded hover:bg-muted transition-colors flex items-center gap-0.5"
          >
            <Type className="h-4 w-4" />
            <span className="text-xs">▾</span>
          </button>
          {fontSizeOpen && (
            <div className="absolute left-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg py-1 w-28">
              {FONT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => applyFontSize(size)}
                  className="w-full text-left px-3 py-1 text-sm hover:bg-muted transition-colors"
                >
                  {size}
                </button>
              ))}
              <div className="border-t mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => { (editor?.chain().focus() as any).unsetFontSize().run(); setFontSizeOpen(false); }}
                  className="w-full text-left px-3 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  Reset size
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Headings */}
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

        {/* Lists */}
        <ToolbarBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet List">
          <List className="h-4 w-4" />
        </ToolbarBtn>
        <ToolbarBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered List">
          <ListOrdered className="h-4 w-4" />
        </ToolbarBtn>

        <div className="w-px h-5 bg-border mx-1" />

        {/* Alignment */}
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

        {/* Divider / Horizontal Rule */}
        <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Insert Divider">
          <Minus className="h-4 w-4" />
        </ToolbarBtn>

        {/* CTA Button Block */}
        <ToolbarBtn onClick={() => setButtonDialog(true)} title="Insert CTA Button">
          <MousePointerClick className="h-4 w-4" />
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
        className="prose prose-sm max-w-none p-4 min-h-[300px] focus-within:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[280px] [&_hr]:border-t [&_hr]:border-border [&_hr]:my-4"
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

      {/* CTA Button dialog */}
      {buttonDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setButtonDialog(false)}>
          <div className="bg-background border rounded-lg p-5 w-96 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-3">Insert CTA Button</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Button text</label>
                <Input value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="Click here" autoFocus />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Link URL</label>
                <Input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Background colour</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={buttonBg} onChange={(e) => setButtonBg(e.target.value)} className="w-8 h-8 rounded border cursor-pointer" />
                    <span className="text-xs text-muted-foreground">{buttonBg}</span>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground mb-1 block">Text colour</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={buttonTextColor} onChange={(e) => setButtonTextColor(e.target.value)} className="w-8 h-8 rounded border cursor-pointer" />
                    <span className="text-xs text-muted-foreground">{buttonTextColor}</span>
                  </div>
                </div>
              </div>
              {/* Preview */}
              <div className="flex justify-center py-2 bg-muted/30 rounded-lg">
                <a
                  href="#"
                  style={{ background: buttonBg, color: buttonTextColor, padding: "10px 24px", borderRadius: "6px", fontWeight: 600, textDecoration: "none", fontSize: "14px" }}
                  onClick={(e) => e.preventDefault()}
                >
                  {buttonText || "Button text"}
                </a>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" size="sm" onClick={() => setButtonDialog(false)}>Cancel</Button>
              <Button size="sm" onClick={insertButtonBlock}>Insert Button</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
