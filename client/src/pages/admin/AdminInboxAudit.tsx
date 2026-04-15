import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, User, Calendar, Hash, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";

export default function AdminInboxAudit() {
  const [filter, setFilter] = useState("");
  const { data: logs = [], isLoading, refetch, isFetching } = trpc.inbox.auditLogs.useQuery(
    { limit: 200, offset: 0 },
    { refetchOnWindowFocus: false }
  );

  const filtered = filter.trim()
    ? logs.filter((l) => {
        const q = filter.toLowerCase();
        return (
          l.guestName?.toLowerCase().includes(q) ||
          l.departureDate?.toLowerCase().includes(q) ||
          l.bookingReference?.toLowerCase().includes(q)
        );
      })
    : logs;

  // Aggregate stats
  const totalSearches = logs.length;
  const searchesWithResults = logs.filter((l) => l.resultsCount > 0).length;
  const searchesNoResults = totalSearches - searchesWithResults;

  // Unique searchers (by userId)
  const uniqueUserIds = new Set(logs.map((l) => l.userId)).size;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/inbox-config">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Inbox Search History</h1>
          <p className="text-sm text-muted-foreground">All Booking Documents searches made by users.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Searches", value: totalSearches },
          { label: "With Results", value: searchesWithResults },
          { label: "No Results", value: searchesNoResults },
          { label: "Unique Users", value: uniqueUserIds },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-foreground">{value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Filter by guest name, date, or reference…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Search Log</CardTitle>
          <CardDescription>
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
            {filter ? ` matching "${filter}"` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {filter ? "No entries match your filter." : "No searches have been made yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">When</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">User</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Guest Name</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Departure</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Supplier Ref</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Results</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log, i) => (
                    <tr
                      key={log.id}
                      className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span
                          className="text-foreground"
                          title={log.searchedAt ? format(new Date(log.searchedAt), "d MMM yyyy HH:mm:ss") : ""}
                        >
                          {log.searchedAt
                            ? formatDistanceToNow(new Date(log.searchedAt), { addSuffix: true })
                            : "—"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {log.searchedAt ? format(new Date(log.searchedAt), "d MMM yyyy HH:mm") : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground">{(log as any).userName ?? `User #${log.userId}`}</span>
                        </span>
                        {(log as any).userEmail && (
                          <span className="block text-xs text-muted-foreground pl-5">{(log as any).userEmail}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{log.guestName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {log.departureDate}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {log.bookingReference ? (
                          <span className="flex items-center gap-1.5">
                            <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="font-mono text-xs">{log.bookingReference}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge
                          className={
                            log.resultsCount > 0
                              ? "bg-green-100 text-green-800 border-green-200"
                              : "bg-gray-100 text-gray-500 border-gray-200"
                          }
                        >
                          {log.resultsCount} result{log.resultsCount !== 1 ? "s" : ""}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
