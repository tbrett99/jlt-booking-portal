import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Shield, Plus, Trash2, Copy, CheckCircle, ExternalLink, AlertTriangle } from "lucide-react";

export default function AdminOAuthClients() {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRedirectUri, setNewRedirectUri] = useState("");
  const [newLogoUrl, setNewLogoUrl] = useState("");
  const [credentials, setCredentials] = useState<{ clientId: string; rawSecret: string } | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const { data: clients, refetch } = trpc.oauthClients.list.useQuery();
  const createMutation = trpc.oauthClients.create.useMutation({
    onSuccess: (data) => {
      setCredentials(data);
      setShowCreate(false);
      setNewName("");
      setNewRedirectUri("");
      setNewLogoUrl("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const revokeMutation = trpc.oauthClients.revoke.useMutation({
    onSuccess: () => {
      setRevokeId(null);
      refetch();
      toast.success("OAuth client revoked.");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const activeClients = clients?.filter((c) => c.isActive) ?? [];
  const revokedClients = clients?.filter((c) => !c.isActive) ?? [];

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            OAuth Clients
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Register trusted external applications that can use the JLT portal as an identity provider for agent login.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Register Client
        </Button>
      </div>

      {/* Info card */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          OAuth clients allow external apps (such as Tom's CRM) to authenticate agents using their JLT portal accounts.
          Agents click "Log in with JLT Portal" in the external app and are redirected here to authorise access.
          <strong> Client secrets are shown only once</strong> — store them securely immediately after creation.
        </AlertDescription>
      </Alert>

      {/* Active clients */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Active Clients</h2>
        {activeClients.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No OAuth clients registered yet. Click <strong>Register Client</strong> to add one.
            </CardContent>
          </Card>
        ) : (
          activeClients.map((client) => (
            <Card key={client.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{client.name}</CardTitle>
                    <CardDescription className="mt-1">
                      Registered {new Date(client.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50">Active</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-28 shrink-0">Client ID</span>
                    <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono flex-1 truncate">{client.clientId}</code>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(client.clientId, `cid-${client.id}`)}>
                      {copied === `cid-${client.id}` ? <CheckCircle className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-28 shrink-0">Client Secret</span>
                    <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono text-muted-foreground">{client.clientSecretPrefix}••••••••••••••••••••••••••••••</code>
                    <span className="text-xs text-muted-foreground">(shown once at creation)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground w-28 shrink-0">Redirect URI</span>
                    <code className="bg-muted px-2 py-0.5 rounded text-xs font-mono flex-1 truncate">{client.redirectUri}</code>
                    <a href={client.redirectUri} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </a>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setRevokeId(client.id)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Revoke
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Revoked clients (collapsed) */}
      {revokedClients.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Revoked Clients</h2>
          {revokedClients.map((client) => (
            <Card key={client.id} className="opacity-60">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base text-muted-foreground">{client.name}</CardTitle>
                  <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50">Revoked</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground font-mono">{client.clientId}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register OAuth Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Application Name</Label>
              <Input
                placeholder="e.g. Tom's CRM"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Redirect URI</Label>
              <Input
                placeholder="https://jlt-dashboard-c4pzyiw4.manus.space/api/auth/jlt/callback"
                value={newRedirectUri}
                onChange={(e) => setNewRedirectUri(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The exact callback URL in Tom's CRM that will receive the authorisation code. Must match exactly.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Logo URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                placeholder="https://example.com/logo.png"
                value={newLogoUrl}
                onChange={(e) => setNewLogoUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Shown on the consent screen agents see when authorising.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  name: newName,
                  redirectUri: newRedirectUri,
                  ...(newLogoUrl ? { logoUrl: newLogoUrl } : {}),
                })
              }
              disabled={!newName || !newRedirectUri || createMutation.isPending}
            >
              {createMutation.isPending ? "Registering…" : "Register Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials reveal dialog (shown once) */}
      <Dialog open={!!credentials} onOpenChange={() => setCredentials(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-5 w-5" />
              Client Registered Successfully
            </DialogTitle>
          </DialogHeader>
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <strong>Copy these credentials now.</strong> The client secret will never be shown again.
            </AlertDescription>
          </Alert>
          {credentials && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Client ID</Label>
                <div className="flex items-center gap-2">
                  <code className="bg-muted px-3 py-2 rounded text-sm font-mono flex-1 break-all">{credentials.clientId}</code>
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(credentials.clientId, "cid")}>
                    {copied === "cid" ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Client Secret</Label>
                <div className="flex items-center gap-2">
                  <code className="bg-muted px-3 py-2 rounded text-sm font-mono flex-1 break-all">{credentials.rawSecret}</code>
                  <Button variant="outline" size="icon" onClick={() => copyToClipboard(credentials.rawSecret, "cs")}>
                    {copied === "cs" ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Share these with Tom securely (e.g. via a password manager or encrypted message). Do not send via email or chat.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCredentials(null)}>I've saved the credentials</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirm dialog */}
      <Dialog open={revokeId !== null} onOpenChange={() => setRevokeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke OAuth Client?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Revoking this client will immediately prevent any external app using it from authenticating agents.
            Agents currently logged in via this client will not be affected until their session expires.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => revokeId !== null && revokeMutation.mutate({ id: revokeId })}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking…" : "Revoke Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
