import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Key, Plus, Trash2, Copy, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function AdminApiKeys() {
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyAgency, setNewKeyAgency] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();

  const { data: keys, isLoading } = trpc.apiKeys.list.useQuery();

  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setGeneratedKey(data.rawKey);
      setNewKeyName("");
      setNewKeyAgency("");
      utils.apiKeys.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      toast.success("API key revoked");
      setRevokeId(null);
      utils.apiKeys.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleCreate() {
    if (!newKeyName.trim()) {
      toast.error("Please enter a name for this API key");
      return;
    }
    createMutation.mutate({ name: newKeyName.trim(), agencyName: newKeyAgency.trim() || undefined });
  }

  function handleCopy() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Key className="text-[#70FFE8]" size={24} />
            API Keys
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage API keys for external integrations (e.g. Tom's CRM). Each key allows an external
            system to register bookings directly into the JLT portal pipeline.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus size={16} />
          Generate Key
        </Button>
      </div>

      {/* Info card */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
              <p className="font-medium">Keep API keys secure</p>
              <p>
                API keys grant the ability to register bookings into the portal on behalf of any
                agent. Share them only with trusted systems. A key is shown only once — if lost,
                revoke it and generate a new one.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Keys table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Keys</CardTitle>
          <CardDescription>
            {keys?.length ?? 0} key{keys?.length !== 1 ? "s" : ""} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
          ) : !keys?.length ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No API keys yet. Generate one to enable CRM integration.
            </div>
          ) : (
            <div className="divide-y">
              {keys.map((k) => (
                <div key={k.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{k.name}</span>
                      {k.agencyName && (
                        <Badge variant="secondary" className="text-xs">
                          {k.agencyName}
                        </Badge>
                      )}
                      {k.isActive ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs border-0">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">
                          Revoked
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 font-mono">
                      {k.keyPrefix}••••••••••••••••••••••••
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Created {format(new Date(k.createdAt), "d MMM yyyy")}
                      {k.lastUsedAt && (
                        <> · Last used {format(new Date(k.lastUsedAt), "d MMM yyyy, HH:mm")}</>
                      )}
                    </div>
                  </div>
                  {k.isActive && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setRevokeId(k.id)}
                    >
                      <Trash2 size={14} className="mr-1" />
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog
        open={showCreate && !generatedKey}
        onOpenChange={(o) => {
          if (!o) {
            setShowCreate(false);
            setNewKeyName("");
            setNewKeyAgency("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key name *</Label>
              <Input
                id="key-name"
                placeholder="e.g. Tom's CRM"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-agency">Agency name (optional)</Label>
              <Input
                id="key-agency"
                placeholder="e.g. Loupr Travel"
                value={newKeyAgency}
                onChange={(e) => setNewKeyAgency(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Generating…" : "Generate Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show generated key — only shown once */}
      <Dialog
        open={!!generatedKey}
        onOpenChange={(o) => {
          if (!o) {
            setGeneratedKey(null);
            setShowCreate(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <Check size={18} />
              API Key Generated
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
              <strong>Copy this key now.</strong> It will not be shown again. If you lose it, revoke
              it and generate a new one.
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted rounded px-3 py-2 text-xs font-mono break-all">
                {generatedKey}
              </code>
              <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0">
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pass this key in the <code className="bg-muted px-1 rounded">X-API-Key</code> header
              of every request to the JLT booking registration API.
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setGeneratedKey(null);
                setShowCreate(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={revokeId !== null} onOpenChange={(o) => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately disable the key. Any system using it will stop being able to
              register bookings. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeId !== null && revokeMutation.mutate({ id: revokeId })}
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
