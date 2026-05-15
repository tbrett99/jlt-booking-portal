import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, TrendingUp, Users, BookOpen, AlertCircle, ArrowUpDown, Download } from "lucide-react";

type SortKey = "clientName" | "agentName" | "departureDate" | "grossCost" | "expectedCommission" | "marginPct";
type SortDir = "asc" | "desc";

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <Badge variant="outline" className="text-muted-foreground">No data</Badge>;
  if (pct >= 6) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-xs font-semibold">
      <CheckCircle2 className="h-3 w-3" />{pct.toFixed(2)}%
    </span>
  );
  if (pct >= 5) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-xs font-semibold">
      <AlertCircle className="h-3 w-3" />{pct.toFixed(2)}%
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-800 px-2.5 py-0.5 text-xs font-semibold">
      <AlertTriangle className="h-3 w-3" />{pct.toFixed(2)}%
    </span>
  );
}

function fmt(v: number | null, prefix = "£") {
  if (v == null) return "—";
  return `${prefix}${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CommissionMarginReport() {
  const [agentId, setAgentId] = useState<number | undefined>(undefined);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("departureDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  const { data, isLoading } = trpc.reports.commissionMargin.useQuery({
    agentId,
    fromDate: fromDate ? new Date(fromDate) : undefined,
    toDate: toDate ? new Date(toDate) : undefined,
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const displayed = useMemo(() => {
    if (!data) return [];
    let rows = showIncomplete ? data.bookings : data.bookings.filter(b => b.hasData);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(b =>
        b.clientName.toLowerCase().includes(q) ||
        b.agentName.toLowerCase().includes(q) ||
        (b.destination ?? "").toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      let av: number | string | null = null, bv: number | string | null = null;
      if (sortKey === "clientName") { av = a.clientName; bv = b.clientName; }
      else if (sortKey === "agentName") { av = a.agentName; bv = b.agentName; }
      else if (sortKey === "departureDate") { av = new Date(a.departureDate).getTime(); bv = new Date(b.departureDate).getTime(); }
      else if (sortKey === "grossCost") { av = a.grossCost ?? -1; bv = b.grossCost ?? -1; }
      else if (sortKey === "expectedCommission") { av = a.expectedCommission ?? -1; bv = b.expectedCommission ?? -1; }
      else if (sortKey === "marginPct") { av = a.marginPct ?? -1; bv = b.marginPct ?? -1; }
      if (av == null || bv == null) return 0;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, showIncomplete, search, sortKey, sortDir]);

  const overallAvg = useMemo(() => {
    if (!data) return null;
    const withData = data.bookings.filter(b => b.hasData && b.marginPct != null);
    if (!withData.length) return null;
    return withData.reduce((s, b) => s + b.marginPct!, 0) / withData.length;
  }, [data]);

  const missingCount = data?.bookings.filter(b => !b.hasData).length ?? 0;
  const belowCount = data?.bookings.filter(b => b.hasData && !b.meetsThreshold).length ?? 0;

  const exportCsv = () => {
    if (!displayed.length) return;
    const headers = ["Agent", "Client", "Destination", "Departure Date", "Stage", "Gross Cost", "Commission", "Margin %", "Meets 6%"];
    const rows = displayed.map(b => [
      b.agentName, b.clientName, b.destination ?? "", new Date(b.departureDate).toLocaleDateString("en-GB"),
      b.currentStage, b.grossCost ?? "", b.expectedCommission ?? "", b.marginPct != null ? b.marginPct.toFixed(2) : "",
      b.meetsThreshold == null ? "" : b.meetsThreshold ? "Yes" : "No",
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "commission-margin-report.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => toggleSort(k)}>
      {label}<ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Commission Margin Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Margin = gross commission ÷ gross cost × 100. Green ≥ 6% (meets monthly average threshold) · Amber 5–5.99% · Red &lt; 5%.</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
          <Download className="h-4 w-4" />Export CSV
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="h-4 w-4" />Overall Avg Margin</div>
            <p className="text-2xl font-bold text-foreground">{overallAvg != null ? `${overallAvg.toFixed(2)}%` : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><BookOpen className="h-4 w-4" />Bookings with Data</div>
            <p className="text-2xl font-bold text-foreground">{data?.bookings.filter(b => b.hasData).length ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertCircle className="h-4 w-4 text-amber-500" />Missing Data</div>
            <p className="text-2xl font-bold text-amber-600">{missingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertTriangle className="h-4 w-4 text-red-500" />Below 6% Threshold</div>
            <p className="text-2xl font-bold text-red-600">{belowCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Agent summary table */}
      {data?.agentSummaries && data.agentSummaries.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />Agent Averages</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Total Bookings</TableHead>
                  <TableHead className="text-right">With Data</TableHead>
                  <TableHead className="text-right">Missing Data</TableHead>
                  <TableHead className="text-right">Avg Margin</TableHead>
                  <TableHead className="text-right">Below 6%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.agentSummaries.map(a => (
                  <TableRow key={a.agentId} className="cursor-pointer hover:bg-muted/50" onClick={() => setAgentId(agentId === a.agentId ? undefined : a.agentId)}>
                    <TableCell className="font-medium">{a.agentName}</TableCell>
                    <TableCell className="text-right">{a.totalBookings}</TableCell>
                    <TableCell className="text-right">{a.bookingsWithData}</TableCell>
                    <TableCell className="text-right">
                      {a.bookingsMissingData > 0 ? <span className="text-amber-600 font-medium">{a.bookingsMissingData}</span> : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.avgMarginPct != null ? (
                        <span className={a.avgMarginPct >= 6 ? "text-emerald-700 font-semibold" : a.avgMarginPct >= 5 ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"}>
                          {a.avgMarginPct.toFixed(2)}%
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {a.belowThresholdCount > 0 ? <span className="text-red-600 font-medium">{a.belowThresholdCount}</span> : <span className="text-muted-foreground">0</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {agentId && <p className="text-xs text-muted-foreground px-4 py-2">Filtering bookings by selected agent. Click row again to clear.</p>}
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">Agent</label>
              <Select value={agentId ? String(agentId) : "all"} onValueChange={v => setAgentId(v === "all" ? undefined : Number(v))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All agents" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {data?.allAgents.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">From (departure)</label>
              <Input type="date" className="h-9 w-40" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">To (departure)</label>
              <Input type="date" className="h-9 w-40" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <Input placeholder="Client, agent, destination…" className="h-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Button
              variant={showIncomplete ? "default" : "outline"}
              size="sm"
              className="h-9 self-end"
              onClick={() => setShowIncomplete(v => !v)}
            >
              {showIncomplete ? "Hiding incomplete" : "Show incomplete"}
            </Button>
            {(agentId || fromDate || toDate || search) && (
              <Button variant="ghost" size="sm" className="h-9 self-end text-muted-foreground" onClick={() => { setAgentId(undefined); setFromDate(""); setToDate(""); setSearch(""); }}>
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bookings table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : displayed.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {showIncomplete ? "No bookings found." : "No bookings with gross cost and commission data. Toggle 'Show incomplete' to see all bookings."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><SortBtn k="agentName" label="Agent" /></TableHead>
                  <TableHead><SortBtn k="clientName" label="Client" /></TableHead>
                  <TableHead className="hidden md:table-cell">Destination</TableHead>
                  <TableHead><SortBtn k="departureDate" label="Departure" /></TableHead>
                  <TableHead className="hidden sm:table-cell">Stage</TableHead>
                  <TableHead className="text-right"><SortBtn k="grossCost" label="Gross Cost" /></TableHead>
                  <TableHead className="text-right"><SortBtn k="expectedCommission" label="Commission" /></TableHead>
                  <TableHead className="text-right"><SortBtn k="marginPct" label="Margin" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map(b => (
                  <TableRow key={b.id} className={!b.hasData ? "opacity-60" : ""}>
                    <TableCell className="font-medium text-sm">{b.agentName}</TableCell>
                    <TableCell className="text-sm">{b.clientName}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{b.destination ?? "—"}</TableCell>
                    <TableCell className="text-sm">{new Date(b.departureDate).toLocaleDateString("en-GB")}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">{b.currentStage}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{fmt(b.grossCost)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(b.expectedCommission)}</TableCell>
                    <TableCell className="text-right">
                      {b.hasData ? <MarginBadge pct={b.marginPct} /> : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <AlertCircle className="h-3 w-3" />Incomplete
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground text-center">Personal bookings are excluded. Margin = gross commission ÷ gross cost × 100.</p>
    </div>
  );
}
