import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Mail, Search, Paperclip, Calendar, User, FileText,
  ChevronDown, ChevronUp, AlertCircle, Info, Download, Link2, CheckCircle2,
  ChevronsUpDown, Check, MapPin
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type MatchReason = "name" | "date" | "reference" | "attachment_name" | "attachment_content";

interface AttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  s3Key?: string;
  s3Url?: string;
}

interface EmailResult {
  uid: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  attachments: AttachmentMeta[];
  matchReasons: MatchReason[];
  score: number;
}

const REASON_LABELS: Record<MatchReason, string> = {
  name: "Guest name",
  date: "Departure date",
  reference: "Supplier reference",
  attachment_name: "Attachment filename",
  attachment_content: "PDF content",
};

const REASON_COLORS: Record<MatchReason, string> = {
  name: "bg-blue-100 text-blue-800 border-blue-200",
  date: "bg-purple-100 text-purple-800 border-purple-200",
  reference: "bg-green-100 text-green-800 border-green-200",
  attachment_name: "bg-amber-100 text-amber-800 border-amber-200",
  attachment_content: "bg-orange-100 text-orange-800 border-orange-200",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Link-to-Booking Dialog ───────────────────────────────────────────────────

interface LinkDialogProps {
  emailUid: string;
  emailSubject: string;
  open: boolean;
  onClose: () => void;
}

function LinkToBookingDialog({ emailUid, emailSubject, open, onClose }: LinkDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const searchBookings = trpc.bookings.quickSearch.useQuery(
    { query },
    { enabled: query.length >= 2 }
  );

  const linkEmail = trpc.inbox.linkEmail.useMutation({
    onSuccess: () => {
      toast.success("Email linked to booking");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link to Booking</DialogTitle>
          <DialogDescription>
            Link "<span className="font-medium">{emailSubject}</span>" to a booking for easy reference.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Search Booking</Label>
            <Input
              placeholder="Client name or PTS ref…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedBookingId(null); }}
            />
          </div>
          {searchBookings.data && searchBookings.data.length > 0 && (
            <div className="border rounded-md max-h-40 overflow-auto divide-y text-sm">
              {searchBookings.data.map((b) => (
                <button
                  key={b.id}
                  className={cn(
                    "w-full text-left px-3 py-2 hover:bg-muted transition-colors",
                    selectedBookingId === b.id && "bg-primary/10 font-medium"
                  )}
                  onClick={() => setSelectedBookingId(b.id)}
                >
                  <span className="font-medium">{b.clientName}</span>
                  {b.ptsRef && <span className="text-muted-foreground ml-2 text-xs">{b.ptsRef}</span>}
                  {b.departureDate && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {format(new Date(b.departureDate), "d MMM yyyy")}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Note <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              placeholder="e.g. Hotel confirmation"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!selectedBookingId || linkEmail.isPending}
            onClick={() => selectedBookingId && linkEmail.mutate({ bookingId: selectedBookingId, emailUid, note: note || undefined })}
          >
            {linkEmail.isPending ? "Linking…" : "Link Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Email Result Card ────────────────────────────────────────────────────────

interface EmailCardProps {
  result: EmailResult;
}

function EmailCard({ result }: EmailCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const scoreColor =
    result.score >= 70 ? "bg-green-100 text-green-800 border-green-200" :
    result.score >= 40 ? "bg-amber-100 text-amber-800 border-amber-200" :
    "bg-gray-100 text-gray-600 border-gray-200";

  const handleDownloadEmail = useCallback(() => {
    const dateStr = result.date ? format(new Date(result.date), "d MMM yyyy HH:mm") : "";
    const bodyContent = result.bodyHtml
      ? result.bodyHtml
      : `<pre style="font-family:sans-serif;white-space:pre-wrap;">${result.bodyText || "(no body)"}</pre>`;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${result.subject || "Email"}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
  .email-header { background: #f5f5f5; border-bottom: 2px solid #ddd; padding: 16px 24px; margin-bottom: 16px; }
  .email-header h2 { margin: 0 0 8px; font-size: 16px; color: #111; }
  .email-header p { margin: 2px 0; font-size: 13px; color: #555; }
  .email-body { padding: 0 24px 24px; }
  @media print { .email-header { break-inside: avoid; } }
</style>
</head>
<body>
<div class="email-header">
  <h2>${result.subject || "(no subject)"}</h2>
  <p><strong>From:</strong> ${result.from}</p>
  <p><strong>Date:</strong> ${dateStr}</p>
</div>
<div class="email-body">${bodyContent}</div>
</body>
</html>`;
    const printWin = window.open("", "_blank");
    if (!printWin) {
      toast.error("Pop-up blocked — please allow pop-ups for this site to download emails as PDF.");
      return;
    }
    printWin.document.write(html);
    printWin.document.close();
    printWin.onload = () => { setTimeout(() => { printWin.focus(); printWin.print(); }, 400); };
    setTimeout(() => { if (!printWin.closed) { printWin.focus(); printWin.print(); } }, 1200);
    toast.success("Email opened — use your browser's Save as PDF option.");
  }, [result]);

  const handleDownloadAttachment = useCallback((att: AttachmentMeta) => {
    const url = att.s3Url;
    if (!url) { toast.error("Attachment URL not available. Please try again."); return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Downloading: ${att.filename}`);
  }, []);

  return (
    <>
      <Card className="border border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm text-foreground truncate max-w-md">
                  {result.subject || "(no subject)"}
                </h3>
                <Badge className={`text-xs border ${scoreColor} shrink-0`}>
                  {result.score}% match
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {result.from}
                </span>
                {result.date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(result.date), "d MMM yyyy HH:mm")}
                  </span>
                )}
                {result.attachments.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Paperclip className="h-3 w-3" />
                    {result.attachments.length} attachment{result.attachments.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1"
                onClick={() => setLinkDialogOpen(true)} title="Link to a booking">
                <Link2 className="h-3.5 w-3.5" />
                Link
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2 text-xs gap-1"
                onClick={handleDownloadEmail} title="Download email as PDF">
                <Download className="h-3.5 w-3.5" />
                Email
              </Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {result.matchReasons.map((reason) => (
              <Badge key={reason} className={`text-xs border ${REASON_COLORS[reason]}`}>
                {REASON_LABELS[reason]}
              </Badge>
            ))}
          </div>

          {!expanded && result.snippet && (
            <p className="text-xs text-muted-foreground line-clamp-2">{result.snippet}</p>
          )}

          {expanded && (
            <div className="space-y-3">
              <Separator />
              {result.bodyHtml ? (
                <div
                  className="text-xs border rounded p-3 bg-muted/30 max-h-64 overflow-auto prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: result.bodyHtml }}
                />
              ) : (
                <pre className="text-xs whitespace-pre-wrap bg-muted/30 rounded p-3 max-h-64 overflow-auto">
                  {result.bodyText || "(no body)"}
                </pre>
              )}
              {result.attachments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attachments</p>
                  <div className="space-y-1">
                    {result.attachments.map((att) => (
                      <div key={att.id} className="flex items-center gap-2 text-xs p-2 bg-muted/30 rounded">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate flex-1">{att.filename}</span>
                        <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 shrink-0"
                          onClick={() => handleDownloadAttachment(att)}>
                          <Download className="h-3 w-3" />
                          Download
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <LinkToBookingDialog
        emailUid={result.uid}
        emailSubject={result.subject}
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
      />
    </>
  );
}

// ─── Booking Combobox ─────────────────────────────────────────────────────────

interface BookingOption {
  id: number;
  clientName: string;
  departureDate: string | null;
  destination: string | null;
  topdogRef: string | null;
  crmRef: string | null;
  agentName: string | null;
}

interface BookingComboboxProps {
  bookings: BookingOption[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  isAdmin: boolean;
}

function BookingCombobox({ bookings, selectedId, onSelect, isAdmin }: BookingComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = bookings.find((b) => b.id === selectedId);

  const filtered = useMemo(() => {
    if (!search.trim()) return bookings;
    const q = search.toLowerCase();
    return bookings.filter((b) =>
      b.clientName.toLowerCase().includes(q) ||
      (b.destination ?? "").toLowerCase().includes(q) ||
      (b.topdogRef ?? "").toLowerCase().includes(q) ||
      (b.crmRef ?? "").toLowerCase().includes(q) ||
      (b.agentName ?? "").toLowerCase().includes(q)
    );
  }, [bookings, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal h-auto min-h-10 py-2"
        >
          {selected ? (
            <div className="text-left">
              <div className="font-medium text-sm">{selected.clientName}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                {selected.departureDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {format(new Date(selected.departureDate), "d MMM yyyy")}
                  </span>
                )}
                {selected.destination && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {selected.destination}
                  </span>
                )}
                {isAdmin && selected.agentName && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {selected.agentName}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <span className="text-muted-foreground">Select a booking…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by client name, destination, or reference…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>No bookings found.</CommandEmpty>
            <CommandGroup>
              {filtered.slice(0, 100).map((b) => (
                <CommandItem
                  key={b.id}
                  value={String(b.id)}
                  onSelect={() => {
                    onSelect(b.id === selectedId ? null : b.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="flex items-start gap-2 py-2"
                >
                  <Check className={cn("h-4 w-4 mt-0.5 shrink-0", selectedId === b.id ? "opacity-100" : "opacity-0")} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{b.clientName}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      {b.departureDate && (
                        <span>{format(new Date(b.departureDate), "d MMM yyyy")}</span>
                      )}
                      {b.destination && <span>{b.destination}</span>}
                      {(b.topdogRef || b.crmRef) && (
                        <span className="font-mono">{b.topdogRef ?? b.crmRef}</span>
                      )}
                      {isAdmin && b.agentName && <span className="text-primary/70">{b.agentName}</span>}
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BookingDocuments() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const { data: isAvailable, isLoading: checkingAccess } = trpc.inbox.isAvailable.useQuery();
  const { data: agentBookings = [], isLoading: loadingBookings } = trpc.inbox.listAgentBookings.useQuery(
    undefined,
    { enabled: !!isAvailable || isAdmin }
  );

  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null);
  const [extraRef, setExtraRef] = useState("");
  const [results, setResults] = useState<EmailResult[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [cachedCount, setCachedCount] = useState<number | null>(null);

  const selectedBooking = agentBookings.find((b) => b.id === selectedBookingId);

  const search = trpc.inbox.searchForBooking.useMutation({
    onSuccess: (data) => {
      setResults(data.results as EmailResult[]);
      setCachedCount(data.cachedCount);
      setSearched(true);
    },
    onError: (e) => {
      setResults([]);
      setSearched(true);
      toast.error(e.message);
    },
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedBookingId) return;
    setResults(null);
    setSearched(false);
    search.mutate({
      bookingId: selectedBookingId,
      extraRef: extraRef.trim() || undefined,
    });
  }

  if (checkingAccess) {
    return <div className="p-8 text-muted-foreground">Loading…</div>;
  }

  if (!isAvailable && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
            <h2 className="font-semibold text-lg">Not Available Yet</h2>
            <p className="text-sm text-muted-foreground">
              The Booking Documents search is not yet available. Please contact an administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" />
          Booking Documents
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search the confirmations inbox for supplier emails and documents related to one of your bookings.
        </p>
      </div>

      {/* Admin notice */}
      {isAdmin && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Admin mode.</strong> You can search across all agents' bookings.
            {!isAvailable && " Agents cannot currently access this feature — it will auto-enable once IMAP is configured."}
          </div>
        </div>
      )}

      {/* Search Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Find Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            {/* Booking selector */}
            <div className="space-y-1.5">
              <Label>Select Booking <span className="text-destructive">*</span></Label>
              {loadingBookings ? (
                <div className="h-10 bg-muted animate-pulse rounded-md" />
              ) : agentBookings.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No bookings found. Bookings are synced from Orbit automatically.
                </p>
              ) : (
                <BookingCombobox
                  bookings={agentBookings}
                  selectedId={selectedBookingId}
                  onSelect={setSelectedBookingId}
                  isAdmin={isAdmin}
                />
              )}
              <p className="text-xs text-muted-foreground">
                The search will use the client name and departure date from the selected booking.
                A ±3 day window is applied to the departure date automatically.
              </p>
            </div>

            {/* Selected booking summary */}
            {selectedBooking && (
              <div className="bg-muted/40 rounded-md px-3 py-2 text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-4 flex-wrap">
                  <span><strong className="text-foreground">Client:</strong> {selectedBooking.clientName}</span>
                  {selectedBooking.departureDate && (
                    <span><strong className="text-foreground">Departure:</strong> {format(new Date(selectedBooking.departureDate), "d MMM yyyy")}</span>
                  )}
                  {selectedBooking.destination && (
                    <span><strong className="text-foreground">Destination:</strong> {selectedBooking.destination}</span>
                  )}
                  {(selectedBooking.topdogRef || selectedBooking.crmRef) && (
                    <span><strong className="text-foreground">Ref:</strong> {selectedBooking.topdogRef ?? selectedBooking.crmRef}</span>
                  )}
                </div>
              </div>
            )}

            {/* Optional extra reference */}
            <div className="space-y-1.5">
              <Label htmlFor="extraRef">
                Supplier Reference <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="extraRef"
                value={extraRef}
                onChange={(e) => setExtraRef(e.target.value)}
                placeholder="e.g. supplier confirmation number"
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">
                Add the supplier's own reference to narrow results further.
              </p>
            </div>

            <Button type="submit" disabled={search.isPending || !selectedBookingId}>
              {search.isPending ? (
                <>
                  <Search className="h-4 w-4 mr-2 animate-pulse" />
                  Searching…
                </>
              ) : (
                <>
                  <Search className="h-4 w-4 mr-2" />
                  Search Inbox
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Searching indicator */}
      {search.isPending && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Searching the email cache…
        </div>
      )}

      {/* Results */}
      {searched && !search.isPending && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-foreground">
              {results && results.length > 0
                ? `${results.length} result${results.length !== 1 ? "s" : ""} found`
                : "No results found"}
            </h2>
            {results && results.length > 0 && (
              <p className="text-xs text-muted-foreground">Sorted by relevance score</p>
            )}
          </div>

          {results && results.length === 0 && (
            <Card>
              <CardContent className="p-6 text-center space-y-2">
                <Mail className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  No emails matched <strong>{selectedBooking?.clientName}</strong>
                  {selectedBooking?.departureDate && (
                    <> with a departure date around <strong>{format(new Date(selectedBooking.departureDate), "d MMM yyyy")}</strong></>
                  )}.
                </p>
                {cachedCount !== null && cachedCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {cachedCount.toLocaleString()} emails are cached. Try adding a supplier reference above to narrow results,
                    or check that the client name in the portal matches how it appears in the supplier confirmation.
                  </p>
                )}
                {cachedCount === 0 && (
                  <p className="text-xs text-amber-600">
                    The email cache is empty. Please ask an administrator to run an import from the Inbox Configuration page.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {results && results.length > 0 && results.map((r) => (
            <EmailCard key={r.uid} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
