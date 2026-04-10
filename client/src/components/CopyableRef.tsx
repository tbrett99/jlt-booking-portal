import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyableRefProps {
  value: string;
  label?: string;
  className?: string;
}

/**
 * Displays a reference code (Topdog ref, PTS ref, etc.) with a one-click copy button.
 * Shows a brief checkmark confirmation after copying.
 */
export default function CopyableRef({ value, label, className }: CopyableRefProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label ?? "reference"}: ${value}`}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded border",
        "border-border bg-muted/50 text-foreground",
        "hover:bg-muted hover:border-muted-foreground/40 transition-colors cursor-pointer select-none",
        copied && "border-green-400 bg-green-50 text-green-700",
        className
      )}
    >
      <span>{value}</span>
      {copied ? (
        <Check size={11} className="text-green-600 flex-shrink-0" />
      ) : (
        <Copy size={11} className="text-muted-foreground flex-shrink-0 opacity-60" />
      )}
    </button>
  );
}
