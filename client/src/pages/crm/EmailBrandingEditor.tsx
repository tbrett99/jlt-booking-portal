/**
 * EmailBrandingEditor — visual editor for the JLT email wrapper template.
 * Admins can upload a logo, set colours, footer text, and social links,
 * then see a live preview of exactly how outgoing emails will look.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Upload, RefreshCw, Save, Globe, Facebook, Instagram, Twitter, Linkedin, Image as ImageIcon, Palette, Type } from "lucide-react";

// ── Colour swatch input ───────────────────────────────────────────────────────
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-10 h-10 rounded-lg border cursor-pointer flex-shrink-0"
        title={label}
      />
      <div className="flex-1 min-w-0">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs font-mono mt-0.5"
          maxLength={20}
        />
      </div>
    </div>
  );
}

// ── Live email preview ────────────────────────────────────────────────────────
function EmailPreview({ settings }: { settings: BrandingForm }) {
  const previewHtml = buildPreviewHtml(settings);
  return (
    <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-400" />
        <div className="w-3 h-3 rounded-full bg-yellow-400" />
        <div className="w-3 h-3 rounded-full bg-green-400" />
        <span className="text-xs text-muted-foreground ml-2">Email Preview</span>
      </div>
      <iframe
        srcDoc={previewHtml}
        className="w-full border-0"
        style={{ height: 620 }}
        title="Email preview"
        sandbox="allow-same-origin"
      />
    </div>
  );
}

// ── Build preview HTML (mirrors buildBrandedHtml in resend-email.ts) ──────────
interface BrandingForm {
  logoUrl: string;
  headerBgColor: string;
  headerTextColor: string;
  bodyBgColor: string;
  cardBgColor: string;
  accentColor: string;
  companyName: string;
  tagline: string;
  footerText: string;
  websiteUrl: string;
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
  linkedinUrl: string;
}

function buildPreviewHtml(s: BrandingForm): string {
  const socialLinks = [
    s.websiteUrl && `<a href="${s.websiteUrl}" style="color:${s.accentColor};text-decoration:none;margin:0 6px;">Website</a>`,
    s.facebookUrl && `<a href="${s.facebookUrl}" style="color:${s.accentColor};text-decoration:none;margin:0 6px;">Facebook</a>`,
    s.instagramUrl && `<a href="${s.instagramUrl}" style="color:${s.accentColor};text-decoration:none;margin:0 6px;">Instagram</a>`,
    s.twitterUrl && `<a href="${s.twitterUrl}" style="color:${s.accentColor};text-decoration:none;margin:0 6px;">Twitter</a>`,
    s.linkedinUrl && `<a href="${s.linkedinUrl}" style="color:${s.accentColor};text-decoration:none;margin:0 6px;">LinkedIn</a>`,
  ].filter(Boolean).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:${s.bodyBgColor}; font-family:'Poppins',Arial,sans-serif; }
  a { color:${s.accentColor}; }
</style>
</head>
<body>
<table width="100%" cellpadding="0" cellspacing="0" style="background:${s.bodyBgColor};padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <!-- Header -->
      <tr>
        <td style="background:${s.headerBgColor};border-radius:12px 12px 0 0;padding:28px 32px;text-align:center;">
          ${s.logoUrl
            ? `<img src="${s.logoUrl}" alt="${s.companyName}" style="max-height:60px;max-width:200px;object-fit:contain;display:block;margin:0 auto;" />`
            : `<div style="font-size:24px;font-weight:700;color:${s.headerTextColor};letter-spacing:-0.5px;">${s.companyName}</div>`
          }
          ${s.tagline ? `<div style="font-size:13px;color:${s.headerTextColor};opacity:0.75;margin-top:6px;">${s.tagline}</div>` : ""}
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="background:${s.cardBgColor};padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
          <p style="font-size:16px;color:#414141;line-height:1.6;margin:0 0 16px;">Hi [First Name],</p>
          <p style="font-size:15px;color:#414141;line-height:1.6;margin:0 0 16px;">
            This is a preview of how your email body content will appear inside the branded wrapper.
            Your actual campaign content will be inserted here.
          </p>
          <p style="font-size:15px;color:#414141;line-height:1.6;margin:0 0 24px;">
            You can include <strong>bold text</strong>, <em>italic text</em>, lists, images, and CTA buttons.
          </p>
          <!-- Example CTA button -->
          <div style="text-align:center;margin:24px 0;">
            <a href="#" style="display:inline-block;padding:12px 28px;background:${s.accentColor};color:#414141;font-weight:600;border-radius:6px;text-decoration:none;font-family:'Poppins',Arial,sans-serif;">
              Example Button
            </a>
          </div>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 32px;text-align:center;">
          ${socialLinks ? `<div style="margin-bottom:12px;">${socialLinks}</div>` : ""}
          <p style="font-size:12px;color:#9ca3af;margin:0 0 8px;line-height:1.5;">
            ${s.footerText || `&copy; ${new Date().getFullYear()} ${s.companyName}. All rights reserved.`}
          </p>
          <p style="font-size:11px;color:#d1d5db;margin:0;">
            You received this email because you opted in to communications from ${s.companyName}.
            <a href="#" style="color:#9ca3af;">Unsubscribe</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const DEFAULTS: BrandingForm = {
  logoUrl: "",
  headerBgColor: "#70FFE8",
  headerTextColor: "#414141",
  bodyBgColor: "#f5f5f5",
  cardBgColor: "#ffffff",
  accentColor: "#02E6D2",
  companyName: "JLT Group",
  tagline: "",
  footerText: "",
  websiteUrl: "",
  facebookUrl: "",
  instagramUrl: "",
  twitterUrl: "",
  linkedinUrl: "",
};

export default function EmailBrandingEditor() {
  const { data: saved, isLoading, refetch } = trpc.crm.emailBranding.get.useQuery();
  const updateMutation = trpc.crm.emailBranding.update.useMutation({
    onSuccess: () => { toast.success("Branding settings saved"); refetch(); },
    onError: (e) => toast.error(e.message),
  });
  const uploadLogoMutation = trpc.crm.emailBranding.uploadLogo.useMutation({
    onSuccess: (data) => {
      setForm((f) => ({ ...f, logoUrl: data.url }));
      toast.success("Logo uploaded");
    },
    onError: (e) => toast.error(e.message),
  });

  const [form, setForm] = useState<BrandingForm>(DEFAULTS);
  const [isDirty, setIsDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved settings into form
  useEffect(() => {
    if (saved) {
      setForm({
        logoUrl: saved.logoUrl ?? "",
        headerBgColor: saved.headerBgColor ?? DEFAULTS.headerBgColor,
        headerTextColor: saved.headerTextColor ?? DEFAULTS.headerTextColor,
        bodyBgColor: saved.bodyBgColor ?? DEFAULTS.bodyBgColor,
        cardBgColor: saved.cardBgColor ?? DEFAULTS.cardBgColor,
        accentColor: saved.accentColor ?? DEFAULTS.accentColor,
        companyName: saved.companyName ?? DEFAULTS.companyName,
        tagline: saved.tagline ?? "",
        footerText: saved.footerText ?? "",
        websiteUrl: saved.websiteUrl ?? "",
        facebookUrl: saved.facebookUrl ?? "",
        instagramUrl: saved.instagramUrl ?? "",
        twitterUrl: saved.twitterUrl ?? "",
        linkedinUrl: saved.linkedinUrl ?? "",
      });
      setIsDirty(false);
    }
  }, [saved]);

  function update<K extends keyof BrandingForm>(key: K, value: BrandingForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setIsDirty(true);
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1];
      uploadLogoMutation.mutate({
        fileName: file.name,
        fileBase64: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleSave() {
    updateMutation.mutate({
      logoUrl: form.logoUrl || null,
      headerBgColor: form.headerBgColor,
      headerTextColor: form.headerTextColor,
      bodyBgColor: form.bodyBgColor,
      cardBgColor: form.cardBgColor,
      accentColor: form.accentColor,
      companyName: form.companyName,
      tagline: form.tagline || null,
      footerText: form.footerText || null,
      websiteUrl: form.websiteUrl || null,
      facebookUrl: form.facebookUrl || null,
      instagramUrl: form.instagramUrl || null,
      twitterUrl: form.twitterUrl || null,
      linkedinUrl: form.linkedinUrl || null,
    });
    setIsDirty(false);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Email Branding</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Customise how your emails look — logo, colours, footer, and social links.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || !isDirty}
          className="gap-2"
          style={{ background: "#70FFE8", color: "#414141" }}
        >
          {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Changes
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Left panel: controls ── */}
        <div className="space-y-6">

          {/* Logo */}
          <div className="border rounded-xl p-5 bg-card space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Logo</h3>
            </div>
            {form.logoUrl ? (
              <div className="flex items-start gap-4">
                <img
                  src={form.logoUrl}
                  alt="Logo"
                  className="h-16 max-w-[180px] object-contain rounded-lg border bg-white p-2"
                />
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadLogoMutation.isPending}
                  >
                    {uploadLogoMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    Replace
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive gap-1.5"
                    onClick={() => update("logoUrl", "")}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadLogoMutation.isPending ? (
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                ) : (
                  <>
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">Click to upload your logo</p>
                    <p className="text-xs text-muted-foreground mt-1">PNG, JPG, SVG — recommended max 200 × 60 px</p>
                  </>
                )}
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />

            <div>
              <Label className="text-xs text-muted-foreground">Or paste an image URL</Label>
              <Input
                value={form.logoUrl}
                onChange={(e) => update("logoUrl", e.target.value)}
                placeholder="https://..."
                className="mt-1 text-sm"
              />
            </div>
          </div>

          {/* Company info */}
          <div className="border rounded-xl p-5 bg-card space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Type className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Company Info</h3>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Company name (shown if no logo)</Label>
              <Input
                value={form.companyName}
                onChange={(e) => update("companyName", e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Tagline (optional, shown below logo)</Label>
              <Input
                value={form.tagline}
                onChange={(e) => update("tagline", e.target.value)}
                placeholder="Your trusted travel partner"
                className="mt-1 text-sm"
              />
            </div>
          </div>

          {/* Colours */}
          <div className="border rounded-xl p-5 bg-card space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Palette className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Colours</h3>
            </div>
            <ColorField label="Header background" value={form.headerBgColor} onChange={(v) => update("headerBgColor", v)} />
            <ColorField label="Header text / logo fallback" value={form.headerTextColor} onChange={(v) => update("headerTextColor", v)} />
            <ColorField label="Email background" value={form.bodyBgColor} onChange={(v) => update("bodyBgColor", v)} />
            <ColorField label="Content card background" value={form.cardBgColor} onChange={(v) => update("cardBgColor", v)} />
            <ColorField label="Accent / button colour" value={form.accentColor} onChange={(v) => update("accentColor", v)} />
          </div>

          {/* Footer */}
          <div className="border rounded-xl p-5 bg-card space-y-4">
            <h3 className="font-medium text-sm">Footer</h3>
            <div>
              <Label className="text-xs text-muted-foreground">Footer text (leave blank for default copyright)</Label>
              <Textarea
                value={form.footerText}
                onChange={(e) => update("footerText", e.target.value)}
                placeholder={`© ${new Date().getFullYear()} JLT Group. All rights reserved.`}
                className="mt-1 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>

          {/* Social links */}
          <div className="border rounded-xl p-5 bg-card space-y-4">
            <h3 className="font-medium text-sm">Social Links</h3>
            <div className="space-y-3">
              {[
                { key: "websiteUrl" as const, icon: Globe, label: "Website URL" },
                { key: "facebookUrl" as const, icon: Facebook, label: "Facebook URL" },
                { key: "instagramUrl" as const, icon: Instagram, label: "Instagram URL" },
                { key: "twitterUrl" as const, icon: Twitter, label: "Twitter / X URL" },
                { key: "linkedinUrl" as const, icon: Linkedin, label: "LinkedIn URL" },
              ].map(({ key, icon: Icon, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <Input
                    value={form[key]}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={`https://...`}
                    className="text-sm"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right panel: live preview ── */}
        <div className="sticky top-6 self-start">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm text-muted-foreground">Live Preview</h3>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setForm({ ...form })}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>
          <EmailPreview settings={form} />
          {isDirty && (
            <p className="text-xs text-amber-600 mt-2 text-center">
              You have unsaved changes — click Save Changes to apply.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
