import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, RefreshCw, Mail, Settings, Shield, Database } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";

export default function AdminInboxConfig() {
  const { data: config, isLoading, refetch } = trpc.inbox.getConfig.useQuery();
  const { data: importStatus, refetch: refetchStatus } = trpc.inbox.importStatus.useQuery();

  const [host, setHost] = useState("");
  const [port, setPort] = useState("993");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [useSsl, setUseSsl] = useState(true);
  const [agentAccessEnabled, setAgentAccessEnabled] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const saveConfig = trpc.inbox.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("IMAP configuration saved");
      setEditMode(false);
      setPassword("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const testConnection = trpc.inbox.testConnection.useMutation({
    onSuccess: (result) => {
      setTestResult(result);
      setTesting(false);
    },
    onError: (e) => {
      setTestResult({ success: false, message: e.message });
      setTesting(false);
    },
  });

  const triggerImport = trpc.inbox.triggerImport.useMutation({
    onSuccess: (result) => {
      toast.success(result.message ?? "Import started in background. Check the email count in a few minutes.");
      // Refresh status after a short delay to pick up any quick imports
      setTimeout(() => refetchStatus(), 5000);
    },
    onError: (e) => toast.error(e.message),
  });

  // Toggle agent access without entering full edit mode
  const toggleAgentAccess = trpc.inbox.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("Agent access setting updated");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  function enterEditMode() {
    setHost(config?.host ?? "");
    setPort(String(config?.port ?? 993));
    setEmail(config?.email ?? "");
    setPassword("");
    setUseSsl(config?.useSsl ?? true);
    setAgentAccessEnabled(config?.agentAccessEnabled ?? false);
    setEditMode(true);
    setTestResult(null);
  }

  function handleSave() {
    saveConfig.mutate({
      host,
      port: parseInt(port, 10),
      email,
      password: password || undefined,
      useSsl,
      agentAccessEnabled,
    });
  }

  function handleTest() {
    setTesting(true);
    setTestResult(null);
    testConnection.mutate({
      host: editMode ? host : (config?.host ?? ""),
      port: editMode ? parseInt(port, 10) : (config?.port ?? 993),
      email: editMode ? email : (config?.email ?? ""),
      password: editMode ? (password || undefined) : undefined,
      useSsl: editMode ? useSsl : (config?.useSsl ?? true),
    });
  }

  if (isLoading) {
    return (
      <div className="p-8 text-muted-foreground">Loading IMAP configuration…</div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/settings">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Booking Inbox Configuration</h1>
          <p className="text-sm text-muted-foreground">Configure the IMAP connection for the Booking Documents search feature.</p>
        </div>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Connection Status
            </CardTitle>
            {config?.isConfigured ? (
              <Badge className="bg-green-100 text-green-800 border-green-200">Configured</Badge>
            ) : (
              <Badge variant="secondary">Not Configured</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {config?.isConfigured ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Host:</span>
                <span className="ml-2 font-mono">{config.host}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Port:</span>
                <span className="ml-2 font-mono">{config.port}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Email:</span>
                <span className="ml-2">{config.email}</span>
              </div>
              <div>
                <span className="text-muted-foreground">SSL:</span>
                <span className="ml-2">{config.useSsl ? "Yes" : "No"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Password:</span>
                <span className="ml-2 text-muted-foreground italic">stored encrypted</span>
              </div>
              <div>
                <span className="text-muted-foreground">Last updated:</span>
                <span className="ml-2">{config.updatedAt ? format(new Date(config.updatedAt), "d MMM yyyy HH:mm") : "—"}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No IMAP connection has been configured yet. Click "Edit Configuration" to set one up.</p>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={enterEditMode}>
              <Settings className="h-4 w-4 mr-1" />
              {config?.isConfigured ? "Edit Configuration" : "Configure IMAP"}
            </Button>
            {config?.isConfigured && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Test Connection
              </Button>
            )}
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${testResult.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
              {testResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              {testResult.message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Form */}
      {editMode && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Edit IMAP Settings</CardTitle>
            <CardDescription>The password is stored AES-256 encrypted in the database.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="host">IMAP Host</Label>
                <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="port">Port</Label>
                <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" type="number" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="confirmations@example.com" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password {config?.isConfigured && <span className="text-muted-foreground text-xs">(leave blank to keep existing)</span>}</Label>
              <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={config?.isConfigured ? "••••••••" : "Enter password"} />
            </div>
            <div className="flex items-center gap-3">
              <Switch id="ssl" checked={useSsl} onCheckedChange={setUseSsl} />
              <Label htmlFor="ssl">Use SSL/TLS</Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch id="agentAccess" checked={agentAccessEnabled} onCheckedChange={setAgentAccessEnabled} />
              <Label htmlFor="agentAccess">Enable for agents <span className="text-muted-foreground text-xs">(keep off until testing is complete)</span></Label>
            </div>

            {testResult && (
              <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${testResult.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
                {testResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                {testResult.message}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={handleSave} disabled={saveConfig.isPending || !host || !email}>
                {saveConfig.isPending ? "Saving…" : "Save Configuration"}
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing || !host || !email}>
                {testing ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                Test Connection
              </Button>
              <Button variant="ghost" onClick={() => { setEditMode(false); setTestResult(null); }}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Email Cache
            </CardTitle>
          </div>
          <CardDescription>
            Emails are automatically imported every 15 minutes. The last 48 hours of emails are cached for fast searching.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Cached emails:</span>
              <span className="ml-2 font-semibold">{importStatus?.cachedEmailCount ?? 0}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Last imported:</span>
              <span className="ml-2">
                {importStatus?.lastImportedAt
                  ? format(new Date(importStatus.lastImportedAt), "d MMM yyyy HH:mm")
                  : "Never"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerImport.mutate()}
              disabled={triggerImport.isPending || !config?.isConfigured}
            >
              {triggerImport.isPending ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              {triggerImport.isPending ? "Starting…" : "Run Full Import Now"}
            </Button>
            {triggerImport.isPending && (
              <p className="text-xs text-muted-foreground">Import running in background — this may take several minutes for large mailboxes.</p>
            )}
          </div>
          {!config?.isConfigured && (
            <p className="text-xs text-muted-foreground">Configure IMAP connection first to enable imports.</p>
          )}
        </CardContent>
      </Card>

      {/* Agent Access Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Agent Access
          </CardTitle>
          <CardDescription>
            Agent access is automatically enabled when IMAP is configured. Use this toggle to temporarily disable it if needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Agents can search Booking Documents</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {config?.isConfigured
                  ? "Agents can access Booking Documents (auto-enabled because IMAP is configured). Use the toggle to temporarily disable."
                  : "Configure IMAP first — agent access will enable automatically once connected."}
              </p>
            </div>
            <Switch
              checked={config?.agentAccessEnabled ?? false}
              onCheckedChange={(checked) => {
                if (!config?.isConfigured) {
                  toast.error("Configure IMAP first before enabling agent access.");
                  return;
                }
                toggleAgentAccess.mutate({
                  host: config.host,
                  port: config.port,
                  email: config.email,
                  useSsl: config.useSsl,
                  agentAccessEnabled: checked,
                });
              }}
              disabled={toggleAgentAccess.isPending || !config?.isConfigured}
            />
          </div>
          {config?.agentAccessEnabled && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <strong>Note:</strong> Agents can now search the Booking Documents inbox. Make sure the IMAP connection is stable and the email cache is up to date.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
