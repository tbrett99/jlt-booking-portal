import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Search, Eye, ChevronLeft, ChevronRight } from "lucide-react";

const TRIGGER_LABELS: Record<string, string> = {
  gc_receipt: "Membership Receipt",
  gc_payment_failed: "Payment Failed",
  payment_received: "Client Payment",
  direct: "Direct Message",
  credentials: "Login Credentials",
  password_reset: "Password Reset",
  nudge: "Abandoned Sign-Up Nudge",
  campaign: "Email Campaign",
};

const TRIGGER_COLORS: Record<string, string> = {
  gc_receipt: "bg-emerald-100 text-emerald-800",
  gc_payment_failed: "bg-red-100 text-red-800",
  payment_received: "bg-blue-100 text-blue-800",
  direct: "bg-purple-100 text-purple-800",
  credentials: "bg-amber-100 text-amber-800",
  password_reset: "bg-orange-100 text-orange-800",
  nudge: "bg-cyan-100 text-cyan-800",
  campaign: "bg-indigo-100 text-indigo-800",
};

const PAGE_SIZE = 50;

export default function AgentEmailLog() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [triggerFilter, setTriggerFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [previewId, setPreviewId] = useState<number | null>(null);

  // Debounce search
  const handleSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout((window as any).__emailLogSearchTimer);
    (window as any).__emailLogSearchTimer = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(0);
    }, 400);
  };

  const queryInput = useMemo(() => ({
    search: debouncedSearch || undefined,
    triggerKey: triggerFilter !== "all" ? triggerFilter : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [debouncedSearch, triggerFilter, page]);

  const { data, isLoading } = trpc.crm.agentEmailLog.list.useQuery(queryInput);
  const { data: previewData } = trpc.crm.agentEmailLog.getBody.useQuery(
    { id: previewId! },
    { enabled: previewId !== null }
  );

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-[#70FFE8]/20 rounded-lg">
          <Mail className="h-6 w-6 text-[#02E6D2]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Agent Email Log</h1>
          <p className="text-sm text-muted-foreground">All emails sent to agents from the portal</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by email, name or subject..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={triggerFilter} onValueChange={(v) => { setTriggerFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {Object.entries(TRIGGER_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {isLoading ? "Loading..." : `${data?.total ?? 0} emails`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : !data?.rows.length ? (
            <div className="p-8 text-center text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>No emails found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Recipient</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Subject</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sent</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.toName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{row.toEmail}</div>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <span className="line-clamp-1">{row.subject}</span>
                      </td>
                      <td className="px-4 py-3">
                        {row.triggerKey ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TRIGGER_COLORS[row.triggerKey] ?? "bg-gray-100 text-gray-700"}`}>
                            {TRIGGER_LABELS[row.triggerKey] ?? row.triggerKey}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={row.status === "sent" ? "default" : "destructive"}
                          className={row.status === "sent" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}
                        >
                          {row.status ?? "sent"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(row.sentAt).toLocaleString("en-GB", {
                          day: "2-digit", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewId(row.id)}
                          className="h-7 px-2"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Preview
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Preview Dialog */}
      <Dialog open={previewId !== null} onOpenChange={(open) => !open && setPreviewId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {previewData?.subject ?? "Email Preview"}
            </DialogTitle>
            {previewData && (
              <p className="text-sm text-muted-foreground">
                To: {previewData.toName ? `${previewData.toName} <${previewData.toEmail}>` : previewData.toEmail}
                {" · "}
                {new Date(previewData.sentAt).toLocaleString("en-GB")}
              </p>
            )}
          </DialogHeader>
          {previewData?.bodyHtml ? (
            <div
              className="border rounded-lg overflow-hidden mt-2"
              style={{ minHeight: 300 }}
            >
              <iframe
                srcDoc={previewData.bodyHtml}
                title="Email preview"
                className="w-full"
                style={{ height: 500, border: "none" }}
                sandbox="allow-same-origin"
              />
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">No preview available</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
