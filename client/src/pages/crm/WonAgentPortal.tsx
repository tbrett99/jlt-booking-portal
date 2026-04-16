import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle, Upload, Play, BookOpen, CreditCard } from "lucide-react";

const UK_REGIONS = [
  "North West","North East","Yorkshire & Humber","East Midlands","West Midlands",
  "East of England","London","South East","South West","Wales","Scotland","Northern Ireland",
];

export default function WonAgentPortal() {
  const { user } = useAuth();
  const [idFile, setIdFile] = useState<File | null>(null);
  const [poaFile, setPoaFile] = useState<File | null>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const poaRef = useRef<HTMLInputElement>(null);

  // For now this page is a shell — data will be wired to the agent's own prospect record
  // when the full agent portal is built. For now show the welcome content and upload forms.

  const { data: myRemittances = [] } = trpc.crm.remittances.myItems.useQuery();

  const handleFileUpload = (file: File, type: "id" | "proofOfAddress") => {
    // Placeholder — will wire to the agent's own prospect record upload endpoint
    toast.success(`${type === "id" ? "ID document" : "Proof of address"} upload coming soon — please contact JLT Group directly for now.`);
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      {/* Welcome header */}
      <div className="rounded-2xl p-6 text-white" style={{ background: "linear-gradient(135deg, #1a2a3a 0%, #0d1a26 100%)" }}>
        <h1 className="text-2xl font-bold mb-1">Welcome to JLT Group! 🎉</h1>
        <p className="text-white/80">You've been approved as a JLT Group travel agent. Here's what you need to do next.</p>
      </div>

      {/* Next steps checklist */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your Next Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { icon: <Play size={16} />, label: "Watch the welcome video", desc: "Coming soon — we'll notify you when it's ready", done: false },
              { icon: <BookOpen size={16} />, label: "Read your onboarding guide", desc: "Coming soon — your step-by-step guide to getting started", done: false },
              { icon: <Upload size={16} />, label: "Upload your ID documents", desc: "Required for compliance — upload below", done: false },
              { icon: <CreditCard size={16} />, label: "Provide bank details for commission payouts", desc: "So we can pay your commissions — complete below", done: false },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg border">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${step.done ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground"}`}>
                  {step.done ? <CheckCircle size={16} /> : step.icon}
                </div>
                <div>
                  <p className="text-sm font-medium">{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Welcome video placeholder */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Welcome Video</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border-2 border-dashed">
            <div className="text-center text-muted-foreground">
              <Play size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">Welcome video coming soon</p>
              <p className="text-xs">We'll notify you when it's ready</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ID Documents */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Identity Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Please upload the following documents. These are required for compliance purposes.</p>
          <input ref={idRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setIdFile(f); handleFileUpload(f, "id"); } }} />
          <input ref={poaRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPoaFile(f); handleFileUpload(f, "proofOfAddress"); } }} />
          {[
            { ref: idRef, label: "Photo ID", desc: "Passport or driving licence", file: idFile },
            { ref: poaRef, label: "Proof of Address", desc: "Utility bill or bank statement (dated within 3 months)", file: poaFile },
          ].map(({ ref, label, desc, file }) => (
            <div key={label} className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
                {file && <p className="text-xs text-green-600 mt-0.5 flex items-center gap-1"><CheckCircle size={10} />{file.name}</p>}
              </div>
              <Button size="sm" variant="outline" onClick={() => ref.current?.click()}>
                <Upload size={13} className="mr-1" />{file ? "Replace" : "Upload"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* UK Region */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Let us know which UK region you're based in so we can connect you with local opportunities.</p>
          <div className="space-y-1.5">
            <Label>UK Region</Label>
            <Select onValueChange={(v) => toast.success("Region saved — this will be fully wired in the next update.")}>
              <SelectTrigger><SelectValue placeholder="Select your region…" /></SelectTrigger>
              <SelectContent>{UK_REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bank Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bank Details for Commission Payouts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Your commission payments will be sent to the account below. Please ensure these details are accurate.</p>
          {[["Account Name","text","e.g. Jane Smith"],["Sort Code","text","00-00-00"],["Account Number","text","12345678"]].map(([label, type, placeholder]) => (
            <div key={label as string} className="space-y-1.5">
              <Label className="text-sm">{label as string}</Label>
              <Input type={type as string} placeholder={placeholder as string} onChange={() => {}} />
            </div>
          ))}
          <Button className="w-full" onClick={() => toast.success("Bank details saved — this will be fully wired in the next update.")}>Save Bank Details</Button>
        </CardContent>
      </Card>

      {/* Commission Remittances */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">My Commission Remittances</CardTitle>
        </CardHeader>
        <CardContent>
          {(myRemittances as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">No commission remittances yet. They'll appear here once uploaded by the JLT Group team.</p>
          ) : (
            <div className="space-y-2">
              {(myRemittances as any[]).map((item: any) => (
                <div key={item.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium">£{item.amount}</p>
                    {item.periodLabel && <p className="text-xs text-muted-foreground">{item.periodLabel}</p>}
                    {item.bookingRef && <p className="text-xs text-muted-foreground">Ref: {item.bookingRef}</p>}
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString("en-GB")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
