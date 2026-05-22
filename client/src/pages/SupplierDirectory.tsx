import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from '@/_core/hooks/useAuth';
import {
  Search,
  Globe,
  Phone,
  Mail,
  User,
  Lock,
  Unlock,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Play,
  Building2,
  Tag,
  MapPin,
  Copy,
  Check,
  Eye,
  EyeOff,
  Sparkles,
  MessageSquare,
  X,
  Send,
  Loader2,
  Star,
  AlertCircle,
  Instagram,
  Images,
  Link,
  Users,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type Supplier = {
  id: number;
  name: string;
  description: string | null;
  shortDescription: string | null;
  publicWebsite: string | null;
  tradeWebsite: string | null;
  additionalWebsite: string | null;
  agencyId: string | null;
  loginUsername: string | null;
  loginPassword: string | null;
  commission: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  mediaAssetsUrl: string | null;
  accountManager: string | null;
  phone: string | null;
  email: string | null;
  generalNotes: string | null;
  video1: string | null;
  video2: string | null;
  video3: string | null;
  categories: string | null;
  locations: string | null;
  imageUrl: string | null;
  adminUsername: string | null;
  adminPassword: string | null;
  adminNotes: string | null;
  credentialStage: number;
  isActive: number;
  usp: string | null;
  priceTier: string | null;
  notSuitableFor: string | null;
  aiSummary: string | null;
  idealClient: string | null;
  bookingTips: string | null;
};

type AiSearchResult = {
  id: number;
  name: string;
  imageUrl: string | null;
  categories: string | null;
  commission: string | null;
  aiSummary: string | null;
  relevanceNote: string;
  score: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// ─── Credential field with copy/show ─────────────────────────────────────────
function CredentialField({
  label,
  value,
  isPassword = false,
}: {
  label: string;
  value: string;
  isPassword?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="flex-1 font-mono text-sm truncate">
        {isPassword && !visible ? "••••••••••" : value}
      </span>
      <div className="flex gap-1 shrink-0">
        {isPassword && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copy}>
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── HTML cleaner for supplier descriptions ─────────────────────────────────
function cleanSupplierHtml(raw: string): string {
  return raw
    // Remove HTML comments (WordPress block comments like <!-- wp:paragraph -->)
    .replace(/<!--[\s\S]*?-->/g, "")
    // Fix CSV separator artifact: HTML fragments joined with "; " — strip all "; " between tags
    .replace(/>\s*;\s*</g, "><")
    .replace(/;\s*(<\/?)/g, "$1")
    // Remove WordPress block wrapper divs but keep their content
    .replace(/<div[^>]*class="[^"]*wp-block[^"]*"[^>]*>/gi, "")
    .replace(/<\/div>/gi, "")
    // Convert wp-block-quote blockquotes to a cleaner version
    .replace(/<blockquote[^>]*class="[^"]*wp-block-quote[^"]*"[^>]*>/gi, '<blockquote class="supplier-blockquote">')
    // Make all external links open in new tab safely
    .replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ')
    // Replace &nbsp; bullet indentation patterns (e.g. •&nbsp;&nbsp;&nbsp;) with just the bullet
    .replace(/•(&nbsp;)+/g, "• ")
    // Replace o&nbsp;&nbsp;&nbsp; sub-bullet patterns
    .replace(/o(&nbsp;)+/g, "  – ")
    // Remove empty paragraphs
    .replace(/<p>(&nbsp;|\s)*<\/p>/gi, "")
    // Collapse multiple blank lines
    .replace(/(\s*<br\s*\/?>\s*){3,}/gi, "<br>")
    .trim();
}

// ─── Price tier badge ─────────────────────────────────────────────────────────
function PriceTierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const map: Record<string, { label: string; className: string }> = {
    "budget": { label: "Budget", className: "bg-green-100 text-green-700 border-green-200" },
    "mid-range": { label: "Mid-Range", className: "bg-blue-100 text-blue-700 border-blue-200" },
    "luxury": { label: "Luxury", className: "bg-purple-100 text-purple-700 border-purple-200" },
    "ultra-luxury": { label: "Ultra Luxury", className: "bg-amber-100 text-amber-700 border-amber-200" },
  };
  const config = map[tier.toLowerCase()] ?? { label: tier, className: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${config.className}`}>
      <Star className="h-3 w-3" />
      {config.label}
    </span>
  );
}

// ─── Supplier card ────────────────────────────────────────────────────────────
function SupplierCard({
  supplier,
  agentStage,
  onClick,
  relevanceNote,
}: {
  supplier: Supplier | AiSearchResult;
  agentStage: number;
  onClick: () => void;
  relevanceNote?: string;
}) {
  const cats = supplier.categories?.split(";").filter(Boolean) ?? [];
  const hasCredentials = "loginUsername" in supplier
    ? (supplier.loginUsername || supplier.loginPassword)
    : false;
  const credentialStage = "credentialStage" in supplier ? supplier.credentialStage : 1;
  const credentialsLocked = hasCredentials && agentStage < credentialStage;

  return (
    <button
      onClick={onClick}
      className="group bg-card border border-border rounded-xl overflow-hidden hover:border-primary/50 hover:shadow-md transition-all text-left w-full"
    >
      {/* Logo area */}
      <div className="h-32 bg-muted/30 flex items-center justify-center p-4 border-b border-border">
        {supplier.imageUrl ? (
          <img
            src={supplier.imageUrl}
            alt={supplier.name}
            className="max-h-24 max-w-full object-contain"
            loading="lazy"
          />
        ) : (
          <Building2 className="h-12 w-12 text-muted-foreground/40" />
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-primary transition-colors">
            {supplier.name}
          </h3>
          {credentialsLocked ? (
            <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          ) : hasCredentials ? (
            <Unlock className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
          ) : null}
        </div>

        {supplier.commission && (
          <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
            {supplier.commission}
          </p>
        )}

        {/* AI relevance note */}
        {relevanceNote && (
          <p className="text-xs text-primary/80 mb-2 line-clamp-2 italic">
            {relevanceNote}
          </p>
        )}

        {cats.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {cats.slice(0, 2).map((cat) => (
              <Badge key={cat} variant="secondary" className="text-xs px-1.5 py-0">
                {cat}
              </Badge>
            ))}
            {cats.length > 2 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">
                +{cats.length - 2}
              </Badge>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Supplier detail modal ────────────────────────────────────────────────────
function SupplierModal({
  supplierId,
  agentStage,
  isAdmin,
  onClose,
}: {
  supplierId: number;
  agentStage: number;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { data: supplier, isLoading } = trpc.suppliers.get.useQuery(
    { id: supplierId },
    { staleTime: 60000 }
  );

  if (isLoading) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!supplier) return null;

  const cats = supplier.categories?.split(";").filter(Boolean) ?? [];
  const locs = supplier.locations?.split(";").filter(Boolean) ?? [];
  const hasCredentials = supplier.loginUsername || supplier.loginPassword;
  const credentialsLocked = hasCredentials && agentStage < supplier.credentialStage;
  const uspLines = supplier.usp?.split("\n").filter(Boolean) ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-4">
            {supplier.imageUrl && (
              <div className="w-20 h-20 bg-muted/30 rounded-lg flex items-center justify-center p-2 border border-border shrink-0">
                <img
                  src={supplier.imageUrl}
                  alt={supplier.name}
                  className="max-h-16 max-w-full object-contain"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl">{supplier.name}</DialogTitle>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {supplier.commission && (
                  <p className="text-sm text-muted-foreground">Commission: {supplier.commission}</p>
                )}
                <PriceTierBadge tier={supplier.priceTier ?? null} />
              </div>
              {cats.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {cats.map((cat) => (
                    <Badge key={cat} variant="secondary" className="text-xs">
                      {cat}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* AI Summary */}
          {supplier.aiSummary && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-xs font-semibold text-primary mb-1 flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> AI Summary
              </p>
              <p className="text-sm text-foreground/80">{supplier.aiSummary}</p>
            </div>
          )}

          {/* USP */}
          {uspLines.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Key Selling Points</h4>
              <ul className="space-y-1">
                {uspLines.map((line, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-1">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{line.replace(/^[•\-\*]\s*/, "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Description */}
          {supplier.description && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">About</h4>
              <div
                className="supplier-description text-sm text-muted-foreground prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: cleanSupplierHtml(supplier.description) }}
              />
            </div>
          )}

          {/* Ideal Client */}
          {(supplier as any).idealClient && (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
              <Users className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-green-700">Ideal for</p>
                <p className="text-xs text-green-700 mt-0.5">{(supplier as any).idealClient}</p>
              </div>
            </div>
          )}

          {/* Not suitable for */}
          {supplier.notSuitableFor && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-700">Not ideal for</p>
                <p className="text-xs text-amber-600 mt-0.5">{supplier.notSuitableFor}</p>
              </div>
            </div>
          )}

          {/* Booking Tips */}
          {(supplier as any).bookingTips && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1 flex items-center gap-1">
                <Lightbulb className="h-3 w-3" /> Agent Booking Tips
              </p>
              <ul className="space-y-1">
                {(supplier as any).bookingTips.split(/\n|(?=•)/).filter((l: string) => l.trim()).map((line: string, i: number) => (
                  <li key={i} className="text-xs text-blue-700 flex items-start gap-1">
                    <span className="text-blue-500 mt-0.5 shrink-0">•</span>
                    <span>{line.replace(/^[•\-\*]\s*/, "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Websites & Links */}
          {(supplier.publicWebsite || supplier.tradeWebsite || supplier.additionalWebsite || supplier.facebookUrl || supplier.instagramUrl || supplier.mediaAssetsUrl) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4" /> Links
              </h4>
              <div className="space-y-1">
                {supplier.publicWebsite && (
                  <a
                    href={supplier.publicWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5" /> Public Website
                  </a>
                )}
                {supplier.tradeWebsite && (
                  <a
                    href={supplier.tradeWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Trade Portal
                  </a>
                )}
                {supplier.additionalWebsite && (
                  <a
                    href={supplier.additionalWebsite}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Link className="h-3.5 w-3.5" /> Additional Website
                  </a>
                )}
                {supplier.facebookUrl && (
                  <a
                    href={supplier.facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Facebook
                  </a>
                )}
                {supplier.instagramUrl && (
                  <a
                    href={supplier.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Instagram className="h-3.5 w-3.5" /> Instagram
                  </a>
                )}
                {supplier.mediaAssetsUrl && (
                  <a
                    href={supplier.mediaAssetsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Images className="h-3.5 w-3.5" /> Media Assets
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Contact */}
          {(supplier.accountManager || supplier.phone || supplier.email) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4" /> Contact
              </h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                {supplier.accountManager && (
                  <p className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5" /> {supplier.accountManager}
                  </p>
                )}
                {supplier.phone && (
                  <p className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5" /> {supplier.phone}
                  </p>
                )}
                {supplier.email && (
                  <a
                    href={`mailto:${supplier.email}`}
                    className="flex items-center gap-2 hover:text-primary"
                  >
                    <Mail className="h-3.5 w-3.5" /> {supplier.email}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Login credentials */}
          {hasCredentials && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                {credentialsLocked ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Unlock className="h-4 w-4 text-green-500" />
                )}
                Login Credentials
              </h4>
              {credentialsLocked ? (
                <div className="bg-muted/50 rounded-lg p-4 text-center">
                  <Lock className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Credentials unlock at Stage {supplier.credentialStage}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Contact your team leader to unlock
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {supplier.agencyId && (
                    <CredentialField label="Agency ID" value={supplier.agencyId} />
                  )}
                  {supplier.loginUsername && (
                    <CredentialField label="Username" value={supplier.loginUsername} />
                  )}
                  {supplier.loginPassword && (
                    <CredentialField label="Password" value={supplier.loginPassword} isPassword />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Training videos */}
          {(supplier.video1 || supplier.video2 || supplier.video3) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Play className="h-4 w-4" /> Training Videos
              </h4>
              <div className="space-y-3">
                {[supplier.video1, supplier.video2, supplier.video3]
                  .filter(Boolean)
                  .map((url, i) => {
                    const loomMatch = url!.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/);
                    const embedId = loomMatch?.[1];
                    return embedId ? (
                      <div
                        key={i}
                        className="relative w-full rounded-lg overflow-hidden border border-border"
                        style={{ paddingTop: "56.25%" }}
                      >
                        <iframe
                          src={`https://www.loom.com/embed/${embedId}`}
                          className="absolute inset-0 w-full h-full"
                          allowFullScreen
                          title={`Training Video ${i + 1}`}
                        />
                      </div>
                    ) : (
                      <a
                        key={i}
                        href={url!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        <Play className="h-3.5 w-3.5" /> Training Video {i + 1}
                      </a>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Notes */}
          {supplier.generalNotes && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">General Notes</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {supplier.generalNotes}
              </p>
            </div>
          )}

          {/* Locations */}
          {locs.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Destinations
              </h4>
              <div className="flex flex-wrap gap-1">
                {locs.map((loc) => (
                  <Badge key={loc} variant="outline" className="text-xs">
                    {loc}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Admin-only section */}
          {isAdmin && (supplier.adminUsername || supplier.adminPassword || supplier.adminNotes) && (
            <div className="space-y-2 border border-amber-500/30 rounded-lg p-3 bg-amber-500/5">
              <h4 className="text-sm font-semibold text-amber-600 flex items-center gap-2">
                <Lock className="h-4 w-4" /> Admin Credentials (Admin Only)
              </h4>
              {supplier.adminUsername && (
                <CredentialField label="Username" value={supplier.adminUsername} />
              )}
              {supplier.adminPassword && (
                <CredentialField label="Password" value={supplier.adminPassword} isPassword />
              )}
              {supplier.adminNotes && (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{supplier.adminNotes}</p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── AI Chat Panel ────────────────────────────────────────────────────────────
function AiChatPanel({ onClose, onSelectSupplier }: { onClose: () => void; onSelectSupplier: (id: number) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hi! Tell me about the trip you're planning and I'll recommend the best suppliers for your client. For example: *\"Luxury honeymoon in the Maldives, budget around £8k\"* or *\"Family safari in Kenya, 2 adults 2 children\"*",
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.suppliers.aiChat.useMutation({
    onSuccess: (data) => {
      const reply = typeof data.reply === "string" ? data.reply : String(data.reply);
      setMessages((prev) => [
        ...prev,
        { role: "assistant" as const, content: reply },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I had trouble processing that. Please try again." },
      ]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    chatMutation.mutate({ messages: [...messages, { role: "user" as const, content: text }] });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">AI Supplier Assistant</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef as any}>
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.content.split("\n").map((line, j) => (
                  <p key={j} className={j > 0 ? "mt-1" : ""}>{line}</p>
                ))}
              </div>
            </div>
          ))}
          {chatMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-xl px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Describe the trip..."
            className="min-h-[60px] max-h-[120px] resize-none text-sm"
          />
          <Button
            size="icon"
            onClick={send}
            disabled={!input.trim() || chatMutation.isPending}
            className="shrink-0 self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Press Enter to send, Shift+Enter for new line</p>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SupplierDirectory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // AI search state
  const [aiQuery, setAiQuery] = useState("");
  const [activeAiQuery, setActiveAiQuery] = useState<string | null>(null);
  const [showAiChat, setShowAiChat] = useState(false);

  const { data: aiSearchData, isFetching: aiSearchLoading } = trpc.suppliers.aiSearch.useQuery(
    { query: activeAiQuery ?? "", limit: 12 },
    {
      enabled: !!activeAiQuery,
      staleTime: 0,
      retry: false,
    }
  );

  const aiResults: AiSearchResult[] | null = activeAiQuery
    ? ((aiSearchData?.results ?? null) as AiSearchResult[] | null)
    : null;
  const aiSearchSummary = aiSearchData?.searchSummary ?? "";

  const { data, isLoading } = trpc.suppliers.list.useQuery(
    {
      search: search || undefined,
      category: category !== "all" ? category : undefined,
      page,
      pageSize: 24,
    },
    { staleTime: 60000, enabled: !aiResults }
  );

  const { data: categories } = trpc.suppliers.categories.useQuery(undefined, {
    staleTime: 300000,
  });

  const agentStage = data?.agentStage ?? 1;

  const stageDescription =
    agentStage === 1
      ? "Stage 1 — General info & training videos only"
      : agentStage === 2
      ? "Stage 2 — Credentials unlocked for most suppliers"
      : "Stage 3 — Full access to all supplier credentials";

  const runAiSearch = () => {
    const q = aiQuery.trim();
    if (!q) return;
    setActiveAiQuery(q);
  };

  const clearAiSearch = () => {
    setActiveAiQuery(null);
    setAiQuery("");
  };

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className={`flex-1 p-6 space-y-6 overflow-auto transition-all ${showAiChat ? "pr-3" : ""}`}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Supplier Directory</h1>
            <p className="text-sm text-muted-foreground mt-1">{stageDescription}</p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {!isAdmin && (
              <Badge
                variant={agentStage === 1 ? "secondary" : "default"}
              >
                {agentStage === 1 ? "🔒 Stage 1" : agentStage === 2 ? "🔓 Stage 2" : "🔓 Stage 3"}
              </Badge>
            )}
            <Button
              variant={showAiChat ? "default" : "outline"}
              size="sm"
              onClick={() => setShowAiChat(!showAiChat)}
              className="gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Ask AI
            </Button>
          </div>
        </div>

        {/* AI Search bar */}
        <div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">AI Search</span>
            <span className="text-xs text-muted-foreground">— describe the trip and AI will find the best suppliers</span>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder='e.g. "luxury honeymoon Maldives" or "family safari Kenya budget £5k"'
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runAiSearch()}
              className="flex-1 bg-background"
            />
            <Button
              onClick={runAiSearch}
              disabled={!aiQuery.trim() || aiSearchLoading}
              className="gap-2 shrink-0"
            >
              {aiSearchLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Search
            </Button>
          </div>
          {aiResults && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground italic">{aiSearchSummary}</p>
              <Button variant="ghost" size="sm" onClick={clearAiSearch} className="gap-1 text-xs">
                <X className="h-3 w-3" /> Clear AI results
              </Button>
            </div>
          )}
        </div>

        {/* Regular search & filter (only when not showing AI results) */}
        {!aiResults && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search suppliers..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-9"
              />
            </div>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-56">
                <Tag className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories?.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Results count */}
        {!aiResults && data && (
          <p className="text-sm text-muted-foreground">
            {data.total} supplier{data.total !== 1 ? "s" : ""}
            {search ? ` matching "${search}"` : ""}
            {category !== "all" ? ` in ${category}` : ""}
          </p>
        )}

        {/* AI Results grid */}
        {aiResults && (
          <>
            <p className="text-sm text-muted-foreground">
              {aiResults.length} AI-matched supplier{aiResults.length !== 1 ? "s" : ""}
            </p>
            {aiSearchLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border overflow-hidden">
                    <Skeleton className="h-32 w-full" />
                    <div className="p-3 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : aiResults.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No matching suppliers found for this query</p>
                <Button variant="link" onClick={clearAiSearch} className="mt-2">
                  Browse all suppliers
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {aiResults.map((supplier) => (
                  <SupplierCard
                    key={supplier.id}
                    supplier={supplier as any}
                    agentStage={agentStage}
                    onClick={() => setSelectedId(supplier.id)}
                    relevanceNote={supplier.relevanceNote}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Regular grid */}
        {!aiResults && (
          <>
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border overflow-hidden">
                    <Skeleton className="h-32 w-full" />
                    <div className="p-3 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : data?.suppliers.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No suppliers found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {data?.suppliers.map((supplier) => (
                  <SupplierCard
                    key={supplier.id}
                    supplier={supplier as Supplier}
                    agentStage={agentStage}
                    onClick={() => setSelectedId(supplier.id)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {data.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}

        {/* Supplier detail modal */}
        {selectedId !== null && (
          <SupplierModal
            supplierId={selectedId}
            agentStage={agentStage}
            isAdmin={isAdmin}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* AI Chat side panel */}
      {showAiChat && (
        <div className="w-80 shrink-0 border-l border-border flex flex-col bg-background">
          <AiChatPanel
            onClose={() => setShowAiChat(false)}
            onSelectSupplier={(id) => {
              setSelectedId(id);
            }}
          />
        </div>
      )}
    </div>
  );
}
