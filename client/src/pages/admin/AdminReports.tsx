import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { format } from "date-fns";

export default function AdminReports() {
  const [agentId, setAgentId] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data: users = [] } = trpc.users.list.useQuery();
  const agents = users.filter((u) => u.role === "agent");

  const { data: bookings = [], isLoading, refetch } = trpc.reports.bookings.useQuery({
    agentId: agentId !== "all" ? Number(agentId) : undefined,
    fromDate: fromDate ? new Date(fromDate) : undefined,
    toDate: toDate ? new Date(toDate) : undefined,
  });

  const downloadCSV = () => {
    if (bookings.length === 0) { toast.error("No data to export"); return; }
    const headers = ["ID", "Client Name", "Agent", "Departure Date", "Topdog Ref", "PTS Ref", "Stage", "Expected Commission", "Reimbursements", "Created At"];
    const rows = bookings.map((b) => [
      b.id,
      `"${b.clientName}"`,
      `"${(b as any).agentName ?? ''}"`,
      format(new Date(b.departureDate), "dd/MM/yyyy"),
      b.topdogRef ?? "",
      b.ptsRef ?? "",
      `"${b.currentStage}"`,
      b.expectedCommission ?? "",
      b.reimbursementsRequired ? "Yes" : "No",
      format(new Date(b.createdAt), "dd/MM/yyyy"),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jlt-bookings-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const downloadExcel = () => {
    if (bookings.length === 0) { toast.error("No data to export"); return; }
    // Build a simple HTML table that Excel can open
    const headers = ["ID", "Client Name", "Agent", "Departure Date", "Topdog Ref", "PTS Ref", "Stage", "Expected Commission (£)", "Reimbursements", "Created At"];
    const rows = bookings.map((b) => [
      b.id,
      b.clientName,
      (b as any).agentName ?? "",
      format(new Date(b.departureDate), "dd/MM/yyyy"),
      b.topdogRef ?? "",
      b.ptsRef ?? "",
      b.currentStage,
      b.expectedCommission ?? "",
      b.reimbursementsRequired ? "Yes" : "No",
      format(new Date(b.createdAt), "dd/MM/yyyy"),
    ]);
    const tableHtml = `<table><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
    const blob = new Blob([tableHtml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jlt-bookings-${format(new Date(), "yyyy-MM-dd")}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Excel file downloaded");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-sm text-muted-foreground">Filter and export booking data</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Agent</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="All agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">
            Results <span className="text-muted-foreground font-normal text-sm">({bookings.length} bookings)</span>
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={downloadCSV} className="gap-2">
              <FileText size={14} />CSV
            </Button>
            <Button variant="outline" size="sm" onClick={downloadExcel} className="gap-2">
              <FileSpreadsheet size={14} />Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Client</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden sm:table-cell">Agent</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden md:table-cell">Departure</th>
                    <th className="pb-3 font-semibold text-muted-foreground">Stage</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden lg:table-cell">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 font-medium">{b.clientName}</td>
                      <td className="py-3 text-muted-foreground hidden sm:table-cell">{(b as any).agentName}</td>
                      <td className="py-3 text-muted-foreground hidden md:table-cell">
                        {format(new Date(b.departureDate), "dd MMM yyyy")}
                      </td>
                      <td className="py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{b.currentStage}</span>
                      </td>
                      <td className="py-3 hidden lg:table-cell">
                        {b.expectedCommission ? `£${Number(b.expectedCommission).toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bookings.length === 0 && (
                <p className="text-center py-8 text-muted-foreground">No bookings match the selected filters</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
