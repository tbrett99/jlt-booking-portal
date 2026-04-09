import { useState, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Upload, Users, Send, CheckCircle2, XCircle, AlertTriangle,
  FileText, UserPlus, Mail, Search, ChevronDown, ChevronUp
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface CsvBookingRow {
  opportunityName: string;
  clientName: string;
  agentToken: string; // Contact Name from CSV (agent full name)
  closeDate: string;
  amount: string;
  stage: string;
  ptsRef: string;
  topdogRef: string;
  twoTNumber: string;
  finalSupplierPaymentDate: string;
  reimbursementsRequired: boolean;
  rawRow: Record<string, string>;
}

interface MappedBooking extends CsvBookingRow {
  agentId: number | null;
  agentName: string;
}

// ── Stage mapping from GHL pipeline stages → portal stages ──────────────────

const STAGE_MAP: Record<string, string> = {
  // Direct matches
  "Added to PTS": "Added to PTS",
  "New Booking": "New Booking",
  "Query": "Query",
  "Cancelled": "Cancelled",
  "Holding Account": "Holding Accounts",
  "Holding Accounts": "Holding Accounts",
  // GHL-specific names → portal names
  "Comms Claimable": "Commission Claimable",
  "Comms Claimed": "Commission Claimed",
  "Commission Claimable": "Commission Claimable",
  "Commission Claimed": "Commission Claimed",
  "DPs": "DP",
  "DP": "DP",
  "Not on TD": "Not on Topdog",
  "Not on Topdog": "Not on Topdog",
  "T/O Package": "New Booking",
  "Creating own PTS file": "New Booking",
  "Urgent/Reimb.": "Urgent/Reimb",
  "Urgent/Reimb": "Urgent/Reimb",
  "Reimb. Docs Missing": "Reimb Docs Missing",
  "Reimb Docs Missing": "Reimb Docs Missing",
  // Salesforce legacy names
  "Closed Won": "Added to PTS",
  "Proposal/Price Quote": "New Booking",
  "Needs Analysis": "New Booking",
  "Perception Analysis": "New Booking",
  "Value Proposition": "New Booking",
  "Id. Decision Makers": "New Booking",
  "Qualification": "New Booking",
  "Closed Lost": "Cancelled",
};

function mapStage(raw: string): string {
  return STAGE_MAP[raw.trim()] ?? "New Booking";
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas inside
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; }
      else { current += ch; }
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function extractAgentToken(opportunityName: string): string {
  // Format: "Client Name - AgentFirstName - ..."
  const parts = opportunityName.split(" - ");
  if (parts.length >= 2) return parts[1].trim();
  return "";
}

function extractClientName(opportunityName: string): string {
  const parts = opportunityName.split(" - ");
  return parts[0].trim();
}

function parseDate(raw: string): string {
  // Accepts ISO (2026-04-03T00:00:00.000Z), MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  } catch { /* ignore */ }
  return raw;
}

// ── AGENTS FILE PARSER ────────────────────────────────────────────────────────

function parseAgentsCsv(text: string): AgentRow[] {
  const rows = parseCsv(text);
  return rows
    .filter((r) => r["Email"] || r["email"])
    .map((r) => ({
      firstName: (r["First Name"] || r["firstName"] || "").trim(),
      lastName: (r["Last Name"] || r["lastName"] || "").trim(),
      email: (r["Email"] || r["email"] || "").trim().toLowerCase(),
      phone: (r["Phone"] || r["phone"] || "").trim(),
    }))
    .filter((a) => a.email && a.firstName);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminImport() {
  const utils = trpc.useUtils();

  // ── Existing agents from DB ───────────────────────────────────────────────────────────────────
  const { data: existingAgents = [], refetch: refetchUsers } = trpc.users.listAgents.useQuery();

  // ── Tab 1: Bulk create agents ───────────────────────────────────────────────────────────────────
  const [agentFile, setAgentFile] = useState<File | null>(null);
  const [parsedAgents, setParsedAgents] = useState<AgentRow[]>([]);
  const [agentCreateResults, setAgentCreateResults] = useState<Array<{ email: string; success: boolean; error?: string }> | null>(null);
  const [creatingAgents, setCreatingAgents] = useState(false);
  const agentFileRef = useRef<HTMLInputElement>(null);

  const bulkCreate = trpc.users.bulkCreate.useMutation({
    onSuccess: (data) => {
      setAgentCreateResults(data.results);
      refetchUsers();
      const succeeded = data.results.filter((r) => r.success).length;
      const skipped = data.results.filter((r) => r.error === "already_exists").length;
      const failed = data.results.filter((r) => !r.success && r.error !== "already_exists").length;
      toast.success(`Done: ${succeeded} created, ${skipped} already existed, ${failed} failed`);
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setCreatingAgents(false),
  });

  const handleAgentFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'csv') {
      toast.error(`Please upload a CSV file (.csv). You uploaded a .${ext} file. If you have a Numbers or Excel file, export it as CSV first (File → Export To → CSV).`);
      return;
    }
    setAgentFile(file);
    setAgentCreateResults(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const agents = parseAgentsCsv(text);
      if (agents.length === 0) {
        toast.error('No valid agent rows found. Make sure the CSV has columns: First Name, Last Name, Email, Phone');
        return;
      }
      setParsedAgents(agents);
    };
    reader.readAsText(file);
  }, []);

  const handleBulkCreate = () => {
    if (!parsedAgents.length) return;
    setCreatingAgents(true);
    bulkCreate.mutate(
      parsedAgents.map((a) => ({
        name: `${a.firstName} ${a.lastName}`.trim(),
        email: a.email,
        phone: a.phone || undefined,
      }))
    );
  };

  // ── Tab 2: Import bookings CSV ───────────────────────────────────────────
  const [bookingFile, setBookingFile] = useState<File | null>(null);
  const [parsedBookings, setParsedBookings] = useState<CsvBookingRow[]>([]);
  const [mappedBookings, setMappedBookings] = useState<MappedBooking[]>([]);
  const [importResults, setImportResults] = useState<{ total: number; succeeded: number; results: Array<{ clientName: string; success: boolean; error?: string }> } | null>(null);
  const [importing, setImporting] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const bookingFileRef = useRef<HTMLInputElement>(null);

  const bulkImport = trpc.bookings.bulkImport.useMutation({
    onSuccess: (data) => {
      setImportResults(data);
      utils.bookings.all.invalidate();
      toast.success(`Import complete: ${data.succeeded}/${data.total} bookings imported`);
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setImporting(false),
  });

  const handleBookingFile = useCallback(
    (file: File) => {
      setBookingFile(file);
      setImportResults(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const rows = parseCsv(text);
        const bookings: CsvBookingRow[] = rows
          .filter((r) => r["Opportunity Name"] || r["Name"])
          .map((r) => {
            const oppName = r["Opportunity Name"] || r["Name"] || "";
            // Prefer Contact Name (agent full name) over extracting from Opportunity Name
            const contactName = (r["Contact Name"] || "").trim();
            const agentToken = contactName || extractAgentToken(oppName);
            // Prefer Lead Pax Name as the client name
            const clientName = (r["Lead Pax Name"] || extractClientName(oppName)).trim();
            const stageRaw = (r["stage"] || r["Stage"] || "").trim();
            const reimb = (r["Do you require any reimbursements?"] || "").toLowerCase();
            return {
              opportunityName: oppName,
              clientName,
              agentToken,
              closeDate: parseDate(r["Departure Date"] || r["Close Date"] || ""),
              amount: r["Lead Value"] || r["Amount"] || "",
              stage: stageRaw,
              ptsRef: (r["PTS Booking Reference"] || "").trim(),
              topdogRef: (r["Topdog Booking Reference"] || r["2T Number"] || "").trim(),
              twoTNumber: (r["2T Number"] || "").trim(),
              finalSupplierPaymentDate: parseDate(r["Final Supplier Payment Date"] || ""),
              reimbursementsRequired: reimb === "yes" || reimb === "true",
              rawRow: r,
            };
          });
        setParsedBookings(bookings);

        // Auto-match agents by first name (case-insensitive)
        const mapped: MappedBooking[] = bookings.map((b) => {
          const token = b.agentToken.toLowerCase();
          // Match by full name first, then by first name
          const match = existingAgents.find((a) => {
            const agentName = (a.name ?? "").toLowerCase();
            const tokenLower = token.toLowerCase();
            if (agentName === tokenLower) return true;
            const nameParts = agentName.split(" ");
            return nameParts.some((part) => part === tokenLower || (tokenLower.length > 2 && part.startsWith(tokenLower)));
          });
          return {
            ...b,
            agentId: match?.id ?? null,
            agentName: match?.name ?? "",
          };
        });
        setMappedBookings(mapped);
      };
      reader.readAsText(file);
    },
    [existingAgents]
  );

  const updateMapping = (index: number, agentId: number | null) => {
    setMappedBookings((prev) =>
      prev.map((b, i) => {
        if (i !== index) return b;
        const agent = existingAgents.find((a) => a.id === agentId);
        return { ...b, agentId, agentName: agent?.name ?? "" };
      })
    );
  };

  const handleImport = () => {
    const toImport = mappedBookings.filter((b) => b.agentId !== null);
    if (!toImport.length) {
      toast.error("No bookings have an agent assigned. Please map agents before importing.");
      return;
    }
    setImporting(true);
    bulkImport.mutate(
      toImport.map((b) => {
        const rawDate = b.closeDate;
        let departureDate: Date;
        try {
          // Try MM/DD/YYYY or YYYY-MM-DD
          const parts = rawDate.includes("/") ? rawDate.split("/") : rawDate.split("-");
          if (rawDate.includes("/") && parts.length === 3) {
            departureDate = new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`);
          } else {
            departureDate = new Date(rawDate);
          }
          if (isNaN(departureDate.getTime())) departureDate = new Date();
        } catch {
          departureDate = new Date();
        }
        const commission = b.amount ? parseFloat(b.amount.replace(/[^0-9.]/g, "")) : undefined;
        let finalPaymentDate: Date | undefined;
        if (b.finalSupplierPaymentDate) {
          const d = new Date(b.finalSupplierPaymentDate);
          if (!isNaN(d.getTime())) finalPaymentDate = d;
        }
        return {
          agentId: b.agentId!,
          clientName: b.clientName || b.opportunityName,
          departureDate,
          currentStage: mapStage(b.stage),
          reimbursementsRequired: b.reimbursementsRequired,
          expectedCommission: commission && !isNaN(commission) ? commission : undefined,
          ptsRef: b.ptsRef || undefined,
          topdogRef: b.topdogRef || undefined,
          finalSupplierPaymentDate: finalPaymentDate,
        };
      })
    );
  };

  const filteredMappings = mappedBookings.filter((b) => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return (
      b.clientName.toLowerCase().includes(q) ||
      b.agentToken.toLowerCase().includes(q) ||
      b.agentName.toLowerCase().includes(q)
    );
  });

  const unmappedCount = mappedBookings.filter((b) => b.agentId === null).length;
  const mappedCount = mappedBookings.filter((b) => b.agentId !== null).length;

  // ── Tab 3: Send credentials ──────────────────────────────────────────────
  const [credSearch, setCredSearch] = useState("");
  const [sendingAll, setSendingAll] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const sendCredentials = trpc.users.sendCredentials.useMutation({
    onSuccess: (_, vars) => {
      toast.success("Credentials sent");
      setSendingId(null);
      refetchUsers();
    },
    onError: (e) => { toast.error(e.message); setSendingId(null); },
  });

  const bulkSendCredentials = trpc.users.bulkSendCredentials.useMutation({
    onSuccess: (data) => {
      const ok = data.results.filter((r) => r.success).length;
      toast.success(`Credentials sent to ${ok} agents`);
      setSendingAll(false);
      refetchUsers();
    },
    onError: (e) => { toast.error(e.message); setSendingAll(false); },
  });

  const agentsNeverSentCreds = existingAgents.filter((a) => !(a as any).credentialsSentAt);
  const filteredAgents = existingAgents.filter((a) => {
    if (!credSearch) return true;
    return (a.name ?? "").toLowerCase().includes(credSearch.toLowerCase()) ||
      (a.email ?? "").toLowerCase().includes(credSearch.toLowerCase());
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Import &amp; Setup</h1>
        <p className="text-muted-foreground mt-1">
          Create agent accounts, import bookings from CSV, and send login credentials when ready.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{existingAgents.length}</p>
                <p className="text-sm text-muted-foreground">Agent Accounts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Mail size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{agentsNeverSentCreds.length}</p>
                <p className="text-sm text-muted-foreground">Awaiting Credentials</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{existingAgents.length - agentsNeverSentCreds.length}</p>
                <p className="text-sm text-muted-foreground">Credentials Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="agents">
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="agents">
            <UserPlus size={14} className="mr-1.5" />
            Create Agents
          </TabsTrigger>
          <TabsTrigger value="bookings">
            <FileText size={14} className="mr-1.5" />
            Import Bookings
          </TabsTrigger>
          <TabsTrigger value="credentials">
            <Send size={14} className="mr-1.5" />
            Send Credentials
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Create Agents ─────────────────────────────────────────── */}
        <TabsContent value="agents" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Bulk Create Agent Accounts</CardTitle>
              <CardDescription>
                Upload a CSV with columns: <code className="text-xs bg-muted px-1 rounded">First Name, Last Name, Email, Phone</code>.
                Accounts are created silently — no login emails are sent. Use the "Send Credentials" tab when ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => agentFileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleAgentFile(file);
                }}
              >
                <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {agentFile ? agentFile.name : "Drop a CSV file here or click to browse"}
                </p>
                {!agentFile && (
                  <p className="text-xs text-muted-foreground mt-1">
                    CSV format only. If you have a Numbers or Excel file, export it as CSV first:
                    <strong> File → Export To → CSV</strong>
                  </p>
                )}
                <input
                  ref={agentFileRef}
                  type="file"
                  accept=".csv,.CSV"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAgentFile(f); }}
                />
              </div>

              {parsedAgents.length > 0 && !agentCreateResults && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{parsedAgents.length} agents parsed</p>
                    <Button onClick={handleBulkCreate} disabled={creatingAgents}>
                      {creatingAgents ? "Creating..." : `Create ${parsedAgents.length} Accounts`}
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Name</th>
                          <th className="text-left px-3 py-2 font-medium">Email</th>
                          <th className="text-left px-3 py-2 font-medium">Phone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedAgents.map((a, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2">{a.firstName} {a.lastName}</td>
                            <td className="px-3 py-2 text-muted-foreground">{a.email}</td>
                            <td className="px-3 py-2 text-muted-foreground">{a.phone || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {agentCreateResults && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-green-700">{agentCreateResults.filter((r) => r.success).length}</p>
                      <p className="text-xs text-green-600">Created</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-amber-700">{agentCreateResults.filter((r) => r.error === "already_exists").length}</p>
                      <p className="text-xs text-amber-600">Already Existed</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <p className="text-xl font-bold text-red-700">{agentCreateResults.filter((r) => !r.success && r.error !== "already_exists").length}</p>
                      <p className="text-xs text-red-600">Failed</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Accounts created successfully. Go to the "Send Credentials" tab when you're ready to activate agents.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: Import Bookings ───────────────────────────────────────── */}
        <TabsContent value="bookings" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import Bookings from CSV</CardTitle>
              <CardDescription>
                Upload your GHL pipeline CSV export. Agent names are matched from the <strong>Contact Name</strong> column,
                client names from <strong>Lead Pax Name</strong>. Stage, PTS ref, Topdog ref, departure date, and payment date
                are all mapped automatically. Review and correct agent assignments before importing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {existingAgents.length === 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>No agent accounts exist yet. Create agent accounts first in the "Create Agents" tab so bookings can be matched correctly.</span>
                </div>
              )}

              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => bookingFileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleBookingFile(file);
                }}
              >
                <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {bookingFile ? bookingFile.name : "Drop your Salesforce CSV here or click to browse"}
                </p>
                <input
                  ref={bookingFileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBookingFile(f); }}
                />
              </div>

              {mappedBookings.length > 0 && !importResults && (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                        <CheckCircle2 size={12} className="mr-1" />
                        {mappedCount} matched
                      </Badge>
                      {unmappedCount > 0 && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                          <AlertTriangle size={12} className="mr-1" />
                          {unmappedCount} unmatched
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                        <Input
                          placeholder="Search bookings..."
                          value={searchFilter}
                          onChange={(e) => setSearchFilter(e.target.value)}
                          className="pl-8 h-8 w-48 text-sm"
                        />
                      </div>
                      <Button onClick={handleImport} disabled={importing || mappedCount === 0}>
                        {importing ? "Importing..." : `Import ${mappedCount} Bookings`}
                      </Button>
                    </div>
                  </div>

                  {unmappedCount > 0 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        {unmappedCount} bookings could not be automatically matched to an agent. Please assign them manually below, or they will be skipped during import.
                      </span>
                    </div>
                  )}

                  <div className="max-h-96 overflow-y-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Client Name</th>
                              <th className="text-left px-3 py-2 font-medium">Agent (Contact Name)</th>
                          <th className="text-left px-3 py-2 font-medium">Assigned Agent</th>
                          <th className="text-left px-3 py-2 font-medium">Stage</th>
                          <th className="text-left px-3 py-2 font-medium">Close Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMappings.map((b, i) => {
                          const realIndex = mappedBookings.indexOf(b);
                          return (
                            <tr key={i} className={`border-t ${b.agentId === null ? "bg-amber-50/50" : ""}`}>
                              <td className="px-3 py-2 font-medium max-w-[180px] truncate">{b.clientName}</td>
                              <td className="px-3 py-2 text-muted-foreground">{b.agentToken || "—"}</td>
                              <td className="px-3 py-2">
                                <Select
                                  value={b.agentId?.toString() ?? "unassigned"}
                                  onValueChange={(v) => updateMapping(realIndex, v === "unassigned" ? null : parseInt(v))}
                                >
                                  <SelectTrigger className="h-7 text-xs w-44">
                                    <SelectValue placeholder="Select agent..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unassigned">— Skip this booking —</SelectItem>
                                    {existingAgents.map((a) => (
                                      <SelectItem key={a.id} value={a.id.toString()}>
                                        {a.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="px-3 py-2">
                                <Badge variant="outline" className="text-xs">{mapStage(b.stage)}</Badge>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{b.closeDate || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importResults && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-green-50 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold text-green-700">{importResults.succeeded}</p>
                      <p className="text-sm text-green-600">Bookings Imported</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold text-red-700">{importResults.total - importResults.succeeded}</p>
                      <p className="text-sm text-red-600">Failed</p>
                    </div>
                  </div>
                  {importResults.results.filter((r) => !r.success).length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-red-50 px-3 py-2 text-sm font-medium text-red-800">Failed imports</div>
                      {importResults.results.filter((r) => !r.success).map((r, i) => (
                        <div key={i} className="px-3 py-2 text-sm border-t flex items-center gap-2">
                          <XCircle size={14} className="text-red-500 shrink-0" />
                          <span className="font-medium">{r.clientName}</span>
                          <span className="text-muted-foreground">— {r.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 3: Send Credentials ──────────────────────────────────────── */}
        <TabsContent value="credentials" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Send Login Credentials</CardTitle>
              <CardDescription>
                When you're ready to activate agents, send their login credentials. Each agent will receive an email
                with their temporary password and a prompt to set a new one on first login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agentsNeverSentCreds.length > 0 && (
                <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-amber-800">
                    <AlertTriangle size={16} />
                    <span><strong>{agentsNeverSentCreds.length}</strong> agents have never received login credentials</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setSendingAll(true);
                      bulkSendCredentials.mutate({ userIds: agentsNeverSentCreds.map((a) => a.id) });
                    }}
                    disabled={sendingAll}
                  >
                    {sendingAll ? "Sending..." : `Send to All ${agentsNeverSentCreds.length}`}
                  </Button>
                </div>
              )}

              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={credSearch}
                  onChange={(e) => setCredSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Agent</th>
                      <th className="text-left px-3 py-2 font-medium">Email</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                      <th className="text-right px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgents.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">No agents found</td>
                      </tr>
                    )}
                    {filteredAgents.map((a) => {
                      const sent = !!(a as any).credentialsSentAt;
                      return (
                        <tr key={a.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{a.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{a.email}</td>
                          <td className="px-3 py-2">
                            {sent ? (
                              <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs">
                                <CheckCircle2 size={11} className="mr-1" />
                                Sent {new Date((a as any).credentialsSentAt).toLocaleDateString("en-GB")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-800 text-xs">
                                Not sent
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendingId === a.id}
                              onClick={() => {
                                setSendingId(a.id);
                                sendCredentials.mutate({ userId: a.id });
                              }}
                            >
                              {sendingId === a.id ? "Sending..." : sent ? "Resend" : "Send"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
