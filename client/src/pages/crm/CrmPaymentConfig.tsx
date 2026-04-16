import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Save, ExternalLink, Upload } from "lucide-react";

const GOCARDLESS_FIELDS = [
  { key: "businessClassDay1Url", label: "Business Class — 1st of month" },
  { key: "businessClassDay15Url", label: "Business Class — 15th of month" },
  { key: "businessClassDay28Url", label: "Business Class — 28th of month" },
  { key: "firstClassDay1Url", label: "First Class — 1st of month" },
  { key: "firstClassDay15Url", label: "First Class — 15th of month" },
  { key: "firstClassDay28Url", label: "First Class — 28th of month" },
];

export default function CrmPaymentConfig() {
  const { data: config, refetch } = trpc.crm.paymentConfig.get.useQuery();
  const { data: templates, refetch: refetchTemplates } = trpc.crm.contractTemplates.list.useQuery();
  const [form, setForm] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState("");
  const [templateFile, setTemplateFile] = useState<File | null>(null);

  useEffect(() => {
    if (config) {
      setForm({
        stripeJoiningFeeUrl: (config as any).stripeJoiningFeeUrl ?? "",
        businessClassDay1Url: (config as any).businessClassDay1Url ?? "",
        businessClassDay15Url: (config as any).businessClassDay15Url ?? "",
        businessClassDay28Url: (config as any).businessClassDay28Url ?? "",
        firstClassDay1Url: (config as any).firstClassDay1Url ?? "",
        firstClassDay15Url: (config as any).firstClassDay15Url ?? "",
        firstClassDay28Url: (config as any).firstClassDay28Url ?? "",
      });
    }
  }, [config]);

  const upsert = trpc.crm.paymentConfig.upsert.useMutation({
    onSuccess: () => { refetch(); toast.success("Payment config saved"); },
    onError: (e) => toast.error(e.message),
  });

  const uploadTemplate = trpc.crm.contractTemplates.upload.useMutation({
    onSuccess: () => { refetchTemplates(); setTemplateName(""); setTemplateFile(null); toast.success("Contract template uploaded"); },
    onError: (e) => toast.error(e.message),
  });

  const handleSave = () => {
    upsert.mutate({
      stripeJoiningFeeUrl: form.stripeJoiningFeeUrl || null,
      businessClassDay1Url: form.businessClassDay1Url || null,
      businessClassDay15Url: form.businessClassDay15Url || null,
      businessClassDay28Url: form.businessClassDay28Url || null,
      firstClassDay1Url: form.firstClassDay1Url || null,
      firstClassDay15Url: form.firstClassDay15Url || null,
      firstClassDay28Url: form.firstClassDay28Url || null,
    });
  };

  const handleTemplateUpload = () => {
    if (!templateFile || !templateName.trim()) {
      toast.error("Please provide a name and select a PDF file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadTemplate.mutate({ name: templateName.trim(), fileBase64: base64, fileName: templateFile.name });
    };
    reader.readAsDataURL(templateFile);
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold">Payment Configuration</h1>
        <p className="text-sm text-muted-foreground">Configure Stripe and GoCardless payment links for agent onboarding</p>
      </div>

      {/* Stripe */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Stripe — Joining Fee (£297)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Stripe Payment Link URL</Label>
            <Input
              value={form.stripeJoiningFeeUrl ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, stripeJoiningFeeUrl: e.target.value }))}
              placeholder="https://buy.stripe.com/..."
            />
            <p className="text-xs text-muted-foreground">Agents are redirected here after signing their contract to pay the £297 joining fee.</p>
          </div>
          {form.stripeJoiningFeeUrl && (
            <a href={form.stripeJoiningFeeUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1">
              Test link <ExternalLink size={10} />
            </a>
          )}
        </CardContent>
      </Card>

      {/* GoCardless */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">GoCardless — Monthly Membership Direct Debit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Enter the GoCardless payment page URLs for each tier and payment date combination. Agents are redirected to the correct link based on their selection.</p>
          <div className="grid grid-cols-1 gap-3">
            {GOCARDLESS_FIELDS.map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-sm">{label}</Label>
                <Input
                  value={form[key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder="https://pay.gocardless.com/..."
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={upsert.isPending} className="w-full">
        <Save size={14} className="mr-1.5" />{upsert.isPending ? "Saving…" : "Save Payment Config"}
      </Button>

      {/* Contract Templates */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contract Templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Upload a PDF contract template. The most recently uploaded template will be used for all new contract signing requests.</p>

          {/* Existing templates */}
          {(templates as any[] ?? []).length > 0 && (
            <div className="space-y-2">
              {(templates as any[]).map((t: any, i: number) => (
                <div key={t.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">Uploaded {new Date(t.uploadedAt).toLocaleDateString("en-GB")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {i === 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active</span>}
                    <a href={t.pdfUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="outline"><ExternalLink size={12} className="mr-1" />View</Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upload new template */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Upload New Template</p>
            <div className="space-y-1.5">
              <Label className="text-sm">Template Name</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. JLT Agent Contract v2" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">PDF File</Label>
              <input
                type="file"
                accept=".pdf"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                onChange={(e) => setTemplateFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleTemplateUpload}
              disabled={uploadTemplate.isPending || !templateFile || !templateName.trim()}
            >
              <Upload size={13} className="mr-1.5" />{uploadTemplate.isPending ? "Uploading…" : "Upload Template"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
