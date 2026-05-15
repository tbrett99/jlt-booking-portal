import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, CheckCircle2, TrendingUp, AlertCircle, ArrowUpDown, BookOpen, Info } from "lucide-react";
import { Link } from "wouter";

type SortKey = "clientName" | "departureDate" | "grossCost" | "expectedCommission" | "marginPct";
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

function fmt(v: number | null) {
  if (v == null) return "—";
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MyMarginReport() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showIncomplete, setShowIncomplete] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("departureDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");

  const { data, isLoading } = trpc.reports.myCommissionMargin.useQuery({
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
        (b.destination ?? "").toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      let av: number | string | null = null, bv: number | string | null = null;
      if (sortKey === "clientName") { av = a.clientName; bv = b.clientName; }
      else if (sortKey === "departureDate") { av = new Date(a.departureDate).getTime(); bv = new Date(b.departureDate).getTime(); }
      else if (sortKey === "grossCost") { av = a.grossCost ?? -1; bv = b.grossCost ?? -1; }
      else if (sortKey === "expectedCommission") { av = a.expectedCommission ?? -1; bv = b.expectedCommission ?? -1; }
      else if (sortKey === "marginPct") { av = a.marginPct ?? -1; bv = b.marginPct ?? -1; }
      if (av == null || bv == null) return 0;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [data, showIncomplete, search, sortKey, sortDir]);

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => toggleSort(k)}>
      {label}<ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Commission Margin</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Your margin per booking based on gross cost and gross commission. Green ≥ 6% (meets monthly average threshold) · Amber 5–5.99% · Red &lt; 5%.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="h-4 w-4" />My Average Margin</div>
            <p className={`text-2xl font-bold ${data?.avgMarginPct != null ? (data.avgMarginPct >= 6 ? "text-emerald-600" : data.avgMarginPct >= 5 ? "text-amber-600" : "text-red-600") : "text-foreground"}`}>
              {data?.avgMarginPct != null ? `${data.avgMarginPct.toFixed(2)}%` : "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">across bookings with data</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><BookOpen className="h-4 w-4" />Bookings with Data</div>
            <p className="text-2xl font-bold text-foreground">{data?.bookings.filter(b => b.hasData).length ?? "—"}</p>
          </CardContent>
        </Card>
        <Card className={data?.missingDataCount ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" : ""}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><AlertCircle className="h-4 w-4 text-amber-500" />Missing Data</div>
            <p className={`text-2xl font-bold ${data?.missingDataCount ? "text-amber-600" : "text-foreground"}`}>{data?.missingDataCount ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">not included in average</p>
          </CardContent>
        </Card>
      </div>

      {/* Prompt for missing data */}
      {(data?.missingDataCount ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex gap-3">
          <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <p className="font-semibold mb-1">
              {data!.missingDataCount} booking{data!.missingDataCount !== 1 ? "s are" : " is"} missing gross cost or commission data
            </p>
            <p>
              These bookings are excluded from your average margin. To include them, open each booking and add the <strong>gross holiday cost</strong> and <strong>expected commission</strong> — your admin team can also update these for you.
              {" "}<button className="underline font-medium" onClick={() => setShowIncomplete(true)}>Show incomplete bookings below</button>.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap gap-3 items-end">
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
              <Input placeholder="Client or destination…" className="h-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Button
              variant={showIncomplete ? "default" : "outline"}
              size="sm"
              className="h-9 self-end"
              onClick={() => setShowIncomplete(v => !v)}
            >
              {showIncomplete ? "Hiding incomplete" : "Show incomplete"}
            </Button>
            {(fromDate || toDate || search) && (
              <Button variant="ghost" size="sm" className="h-9 self-end text-muted-foreground" onClick={() => { setFromDate(""); setToDate(""); setSearch(""); }}>
                Clear
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
              {showIncomplete ? "No bookings found." : "No bookings with gross cost and commission data yet. Toggle 'Show incomplete' to see all your bookings."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell className="font-medium text-sm">{b.clientName}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{b.destination ?? "—"}</TableCell>
                    <TableCell className="text-sm">{new Date(b.departureDate).toLocaleDateString("en-GB")}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">{b.currentStage}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">{fmt(b.grossCost)}</TableCell>
                    <TableCell className="text-right text-sm">{fmt(b.expectedCommission)}</TableCell>
                    <TableCell className="text-right">
                      {b.hasData ? <MarginBadge pct={b.marginPct} /> : (
                        <Link href={`/bookings/${b.id}`}>
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline cursor-pointer">
                            <AlertCircle className="h-3 w-3" />Add data
                          </span>
                        </Link>
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
