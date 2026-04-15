import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Mail, Search, Paperclip, Calendar, User, FileText,
  ChevronDown, ChevronUp, ExternalLink, AlertCircle, Info
} from "lucide-react";
import { format } from "date-fns";

type MatchReason = "name" | "date" | "reference" | "attachment_name" | "attachment_content";

interface AttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
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
  reference: "Booking reference",
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

function EmailCard({ result }: { result: EmailResult }) {
  const [expanded, setExpanded] = useState(false);

  const scoreColor =
    result.score >= 70 ? "bg-green-100 text-green-800 border-green-200" :
    result.score >= 40 ? "bg-amber-100 text-amber-800 border-amber-200" :
    "bg-gray-100 text-gray-600 border-gray-200";

  return (
    <Card className="border border-border">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>

        {/* Match reasons */}
        <div className="flex flex-wrap gap-1.5">
          {result.matchReasons.map((reason) => (
            <Badge key={reason} className={`text-xs border ${REASON_COLORS[reason]}`}>
              {REASON_LABELS[reason]}
            </Badge>
          ))}
        </div>

        {/* Snippet */}
        {!expanded && result.snippet && (
          <p className="text-xs text-muted-foreground line-clamp-2">{result.snippet}</p>
        )}

        {/* Expanded body */}
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

            {/* Attachments */}
            {result.attachments.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Attachments</p>
                <div className="space-y-1">
                  {result.attachments.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 text-xs p-2 bg-muted/30 rounded">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate flex-1">{att.filename}</span>
                      <span className="text-muted-foreground shrink-0">{formatBytes(att.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function BookingDocuments() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const { data: isAvailable, isLoading: checkingAccess } = trpc.inbox.isAvailable.useQuery();

  const [guestName, setGuestName] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [results, setResults] = useState<EmailResult[] | null>(null);
  const [searched, setSearched] = useState(false);

  const search = trpc.inbox.search.useMutation({
    onSuccess: (data) => {
      setResults(data as EmailResult[]);
      setSearched(true);
    },
    onError: (e) => {
      setResults([]);
      setSearched(true);
    },
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim() || !departureDate) return;
    setResults(null);
    setSearched(false);
    search.mutate({
      guestName: guestName.trim(),
      departureDate,
      bookingReference: bookingRef.trim() || undefined,
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
          Search the confirmations inbox for emails and documents related to a booking.
        </p>
      </div>

      {/* Admin notice */}
      {isAdmin && (
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Admin mode.</strong> You are searching the full email cache.
            {!isAvailable && " Agents cannot currently access this feature — enable it in the "}
            {!isAvailable && <a href="/admin/inbox-config" className="underline">Inbox Configuration</a>}
            {!isAvailable && " page once testing is complete."}
          </div>
        </div>
      )}

      {/* Search Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="guestName">Guest Name <span className="text-destructive">*</span></Label>
                <Input
                  id="guestName"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. John Smith"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="departureDate">Departure Date <span className="text-destructive">*</span></Label>
                <Input
                  id="departureDate"
                  type="date"
                  value={departureDate}
                  onChange={(e) => setDepartureDate(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">A ±3 day window is applied automatically.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bookingRef">Supplier Reference <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input
                id="bookingRef"
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value)}
                placeholder="e.g. supplier confirmation number"
                className="max-w-xs"
              />
              <p className="text-xs text-muted-foreground">Enter the supplier's own reference number, not a Topdog or PTS reference.</p>
            </div>
            <Button type="submit" disabled={search.isPending || !guestName.trim() || !departureDate}>
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

      {/* Results */}
      {search.isPending && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Searching the email cache…
        </div>
      )}

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
                  No emails matched <strong>{guestName}</strong> with a departure date around{" "}
                  <strong>{departureDate ? format(new Date(departureDate), "d MMM yyyy") : ""}</strong>.
                </p>
                <p className="text-xs text-muted-foreground">
                  Try a different spelling or date. The search covers the last 48 hours of cached emails.
                </p>
              </CardContent>
            </Card>
          )}

          {results && results.length > 0 && results.map((r) => (
            <EmailCard key={r.uid} result={r} />
          ))}
        </div>
      )}

      {search.error && (
        <Card className="border-destructive">
          <CardContent className="p-4 flex items-start gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            {search.error.message}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
