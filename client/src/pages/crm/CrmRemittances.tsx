import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, ChevronDown, ChevronRight, Download } from "lucide-react";
import Papa from "papaparse";

export default function CrmRemittances() {
  const [uploadDialog, setUploadDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [periodLabel, setPeriodLabel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: remittances = [], refetch } = trpc.crm.remittances.list.useQuery();
  const { data: expandedRemittance } = trpc.crm.remittances.get.useQuery(
    { id: expandedId ?? 0 },
    { enabled: !!expandedId }
  );

  const uploadMutation = trpc.crm.remittances.upload.useMutation({
    onSuccess: (data) => {
      refetch();
      setUploadDialog(false);
      setCsvFile(null);
      setCsvRows([]);
      setPeriodLabel("");
      toast.success(`Remittance uploaded — ${data.itemCount} rows processed`);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = (result.data as any[]).map((row) => ({
          agentCode: row["Agent Code"] ?? row["agent_code"] ?? row["AgentCode"] ?? "",
          agentName: row["Agent Name"] ?? row["agent_name"] ?? row["AgentName"] ?? "",
          amount: row["Amount"] ?? row["amount"] ?? row["Commission"] ?? row["commission"] ?? "",
          bookingRef: row["Booking Ref"] ?? row["booking_ref"] ?? row["BookingRef"] ?? "",
          description: row["Description"] ?? row["description"] ?? "",
        }));
        setCsvRows(rows);
      },
    });
  };

  const handleUpload = () => {
    if (!csvFile || csvRows.length === 0) {
      toast.error("Please select a valid CSV file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        filename: csvFile.name,
        periodLabel: periodLabel || undefined,
        csvBase64: base64,
        rows: csvRows,
      });
    };
    reader.readAsDataURL(csvFile);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Commission Remittances</h1>
          <p className="text-sm text-muted-foreground">Upload weekly CSV remittances — agents are notified automatically</p>
        </div>
        <Button size="sm" onClick={() => setUploadDialog(true)}><Upload size={14} className="mr-1" />Upload CSV</Button>
      </div>

      {/* CSV format guide */}
      <div className="bg-muted/50 border rounded-lg px-4 py-3 text-sm">
        <p className="font-medium mb-1">Expected CSV columns:</p>
        <p className="text-muted-foreground font-mono text-xs">Agent Code, Agent Name, Amount, Booking Ref, Description</p>
        <p className="text-muted-foreground text-xs mt-1">Agents are matched by Agent Code (unique agent ID) or Agent Name. Matched agents receive an in-app notification.</p>
      </div>

      {/* Remittance list */}
      <div className="space-y-3">
        {(remittances as any[]).length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">
            <p className="font-medium">No remittances uploaded yet</p>
            <p className="text-sm">Upload your first CSV to get started.</p>
          </div>
        ) : (remittances as any[]).map((r: any) => (
          <Card key={r.id}>
            <CardContent className="pt-4">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{r.filename}</h3>
                    {r.periodLabel && <span className="text-xs bg-muted px-2 py-0.5 rounded">{r.periodLabel}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Uploaded {new Date(r.uploadedAt).toLocaleDateString("en-GB")} · {r.itemCount ?? "?"} rows
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a href={r.csvUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline"><Download size={13} className="mr-1" />CSV</Button>
                  </a>
                  {expandedId === r.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </div>
              </div>

              {expandedId === r.id && expandedRemittance && (
                <div className="mt-4 border-t pt-4">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Agent Code</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Agent Name</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Amount</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Booking Ref</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {((expandedRemittance as any).items ?? []).map((item: any) => (
                        <tr key={item.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs">{item.agentCode ?? "—"}</td>
                          <td className="px-3 py-2">{item.agentName ?? "—"}</td>
                          <td className="px-3 py-2 font-medium">£{item.amount}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.bookingRef ?? "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.description ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Upload dialog */}
      <Dialog open={uploadDialog} onOpenChange={setUploadDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Upload Commission Remittance</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Period Label (optional)</Label>
              <Input value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="e.g. Week ending 14 Apr 2026" />
            </div>
            <div className="space-y-1.5">
              <Label>CSV File *</Label>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {csvFile ? (
                  <div>
                    <p className="font-medium text-sm">{csvFile.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{csvRows.length} rows parsed</p>
                  </div>
                ) : (
                  <div>
                    <Upload size={24} className="mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Click to select CSV file</p>
                  </div>
                )}
              </div>
            </div>

            {csvRows.length > 0 && (
              <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Code</th>
                      <th className="text-left px-2 py-1.5 font-medium">Name</th>
                      <th className="text-left px-2 py-1.5 font-medium">Amount</th>
                      <th className="text-left px-2 py-1.5 font-medium">Ref</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {csvRows.slice(0, 20).map((row, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1 font-mono">{row.agentCode || "—"}</td>
                        <td className="px-2 py-1">{row.agentName || "—"}</td>
                        <td className="px-2 py-1">£{row.amount}</td>
                        <td className="px-2 py-1 text-muted-foreground">{row.bookingRef || "—"}</td>
                      </tr>
                    ))}
                    {csvRows.length > 20 && (
                      <tr><td colSpan={4} className="px-2 py-1 text-muted-foreground text-center">…and {csvRows.length - 20} more rows</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialog(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploadMutation.isPending || !csvFile || csvRows.length === 0}>
              {uploadMutation.isPending ? "Uploading…" : `Upload ${csvRows.length} Rows`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
