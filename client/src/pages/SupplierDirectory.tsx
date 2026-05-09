import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

// ─── Supplier card ────────────────────────────────────────────────────────────
function SupplierCard({
  supplier,
  agentStage,
  onClick,
}: {
  supplier: Supplier;
  agentStage: number;
  onClick: () => void;
}) {
  const cats = supplier.categories?.split(";").filter(Boolean) ?? [];
  const hasCredentials = supplier.loginUsername || supplier.loginPassword;
  const credentialsLocked = hasCredentials && agentStage < supplier.credentialStage;

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
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
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

  const stageLabel = supplier.credentialStage === 2 ? "Stage 2" : "Stage 3";

  // Extract Loom embed src from HTML
  const extractLoomSrc = (html: string | null) => {
    if (!html) return null;
    const match = html.match(/src="([^"]+)"/);
    return match ? match[1] : null;
  };

  const videos = [supplier.video1, supplier.video2, supplier.video3]
    .map(extractLoomSrc)
    .filter(Boolean) as string[];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-4">
            {supplier.imageUrl && (
              <img
                src={supplier.imageUrl}
                alt={supplier.name}
                className="h-16 w-24 object-contain rounded-md border border-border bg-muted/30 p-1 shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-xl">{supplier.name}</DialogTitle>
              {supplier.commission && (
                <p className="text-sm text-muted-foreground mt-1">
                  Commission: {supplier.commission}
                </p>
              )}
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
          {/* Description */}
          {supplier.description && (
            <div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {supplier.description}
              </p>
            </div>
          )}

          {/* Websites */}
          {(supplier.publicWebsite || supplier.tradeWebsite) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Globe className="h-4 w-4" /> Websites
              </h4>
              {supplier.publicWebsite && (
                <a
                  href={supplier.publicWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Public Website
                </a>
              )}
              {supplier.tradeWebsite && (
                <a
                  href={supplier.tradeWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Trade Portal
                </a>
              )}
            </div>
          )}

          {/* Contact */}
          {(supplier.accountManager || supplier.phone || supplier.email) && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4" /> Contact
              </h4>
              {supplier.accountManager && (
                <p className="text-sm">Account Manager: <span className="font-medium">{supplier.accountManager}</span></p>
              )}
              {supplier.phone && (
                <a href={`tel:${supplier.phone}`} className="flex items-center gap-2 text-sm text-primary hover:underline">
                  <Phone className="h-3.5 w-3.5" /> {supplier.phone}
                </a>
              )}
              {supplier.email && (
                <a href={`mailto:${supplier.email}`} className="flex items-center gap-2 text-sm text-primary hover:underline">
                  <Mail className="h-3.5 w-3.5" /> {supplier.email}
                </a>
              )}
            </div>
          )}

          {/* Login Credentials */}
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
                <div className="bg-muted/50 rounded-md px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                  <Lock className="h-4 w-4 shrink-0" />
                  <span>
                    Credentials are locked until you reach <strong>{stageLabel}</strong>. Contact your admin to unlock.
                  </span>
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

          {/* General Notes */}
          {supplier.generalNotes && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Notes</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{supplier.generalNotes}</p>
            </div>
          )}

          {/* Training Videos */}
          {videos.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Play className="h-4 w-4" /> Training Videos
              </h4>
              {videos.map((src, i) => (
                <div key={i} className="rounded-lg overflow-hidden border border-border">
                  <iframe
                    src={src}
                    className="w-full aspect-video"
                    allowFullScreen
                    title={`Training video ${i + 1}`}
                  />
                </div>
              ))}
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

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SupplierDirectory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = trpc.suppliers.list.useQuery(
    {
      search: search || undefined,
      category: category !== "all" ? category : undefined,
      page,
      pageSize: 24,
    },
    { staleTime: 60000 }
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Supplier Directory</h1>
          <p className="text-sm text-muted-foreground mt-1">{stageDescription}</p>
        </div>
        {!isAdmin && (
          <Badge
            variant={agentStage === 1 ? "secondary" : agentStage === 2 ? "default" : "default"}
            className="self-start sm:self-auto"
          >
            {agentStage === 1 ? "🔒 Stage 1" : agentStage === 2 ? "🔓 Stage 2" : "🔓 Stage 3"}
          </Badge>
        )}
      </div>

      {/* Search & Filter */}
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

      {/* Results count */}
      {data && (
        <p className="text-sm text-muted-foreground">
          {data.total} supplier{data.total !== 1 ? "s" : ""}
          {search ? ` matching "${search}"` : ""}
          {category !== "all" ? ` in ${category}` : ""}
        </p>
      )}

      {/* Grid */}
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
  );
}
