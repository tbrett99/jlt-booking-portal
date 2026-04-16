import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { PencilLine, CheckCircle2, Clock, XCircle, User, Mail, Phone, MapPin, Building2, CreditCard, Shield } from "lucide-react";

const CHANGEABLE_FIELDS = [
  { name: "personalEmail", label: "Personal Email" },
  { name: "mobile", label: "Mobile Number" },
  { name: "addressLine1", label: "Address Line 1" },
  { name: "addressLine2", label: "Address Line 2" },
  { name: "city", label: "City" },
  { name: "postcode", label: "Postcode" },
  { name: "bankSortCode", label: "Bank Sort Code" },
  { name: "bankAccountNumber", label: "Bank Account Number" },
  { name: "bankAccountName", label: "Bank Account Name" },
  { name: "ukRegion", label: "UK Region" },
];

export default function MyProfile() {
  const { user } = useAuth();
  const { data, isLoading, refetch } = trpc.crm.agentCrm.getMyProfile.useQuery();
  const { data: changeRequests, refetch: refetchRequests } = trpc.crm.agentCrm.getMyChangeRequests.useQuery();
  const submitRequest = trpc.crm.agentCrm.submitChangeRequest.useMutation({
    onSuccess: () => {
      toast.success("Change request submitted — our team will review it shortly.");
      setRequestDialog(false);
      refetchRequests();
    },
    onError: (e) => toast.error(e.message),
  });

  const [requestDialog, setRequestDialog] = useState(false);
  const [form, setForm] = useState({ fieldName: "", fieldLabel: "", currentValue: "", requestedValue: "", reason: "" });

  const openRequest = (fieldName: string, fieldLabel: string, currentValue: string) => {
    setForm({ fieldName, fieldLabel, currentValue, requestedValue: "", reason: "" });
    setRequestDialog(true);
  };

  const profile = data?.profile;
  const tags = data?.tags ?? [];
  const suppliers = data?.suppliers ?? [];

  const statusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  };

  if (isLoading) return (
    <div className="p-8 space-y-4">
      {[1,2,3].map(i => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Profile</h1>
        <p className="text-muted-foreground text-sm mt-1">View your details on file. To update any information, submit a change request and our team will review it.</p>
      </div>

      {/* Contact Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" /> Contact Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ProfileField label="Full Name" value={user?.name} icon={<User className="h-3.5 w-3.5" />} />
          <ProfileField label="JLT Email" value={profile?.jltEmail} icon={<Mail className="h-3.5 w-3.5" />} />
          <ProfileField label="Personal Email" value={profile?.personalEmail} icon={<Mail className="h-3.5 w-3.5" />}
            onRequest={() => openRequest("personalEmail", "Personal Email", profile?.personalEmail ?? "")} />
          <ProfileField label="Mobile" value={profile?.mobile} icon={<Phone className="h-3.5 w-3.5" />}
            onRequest={() => openRequest("mobile", "Mobile Number", profile?.mobile ?? "")} />
          <ProfileField label="UK Region" value={profile?.ukRegion} icon={<MapPin className="h-3.5 w-3.5" />}
            onRequest={() => openRequest("ukRegion", "UK Region", profile?.ukRegion ?? "")} />
          <ProfileField label="Address" value={[profile?.addressLine1, profile?.city, profile?.postcode].filter(Boolean).join(", ")} icon={<MapPin className="h-3.5 w-3.5" />}
            onRequest={() => openRequest("addressLine1", "Address", profile?.addressLine1 ?? "")} />
        </CardContent>
      </Card>

      {/* Business Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" /> Business Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ProfileField label="Business Name" value={profile?.businessName} />
          <ProfileField label="Retailer Code" value={profile?.retailerCode} />
          <ProfileField label="Membership Tier" value={profile?.membershipTier} />
          <ProfileField label="Agent Status" value={profile?.agentStatus?.replace("_", " ")} />
        </CardContent>
      </Card>

      {/* Bank Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><CreditCard className="h-4 w-4" /> Bank Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ProfileField label="Account Name" value={profile?.bankAccountName} icon={<CreditCard className="h-3.5 w-3.5" />}
            onRequest={() => openRequest("bankAccountName", "Bank Account Name", profile?.bankAccountName ?? "")} />
          <ProfileField label="Sort Code" value={profile?.bankSortCode ? "••-••-••" : undefined}
            onRequest={() => openRequest("bankSortCode", "Bank Sort Code", "")} />
          <ProfileField label="Account Number" value={profile?.bankAccountNumber ? "••••••••" : undefined}
            onRequest={() => openRequest("bankAccountNumber", "Bank Account Number", "")} />
        </CardContent>
      </Card>

      {/* Supplier Access */}
      {suppliers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Supplier Access</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {suppliers.map(s => (
                <Badge key={s} variant="secondary">{s}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {tags.map(t => (
                <Badge key={t} variant="outline">{t}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Change Requests */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PencilLine className="h-4 w-4" /> Change Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!changeRequests || changeRequests.length === 0) ? (
            <p className="text-sm text-muted-foreground">No change requests submitted yet. Use the "Request Update" buttons above to request changes to your details.</p>
          ) : (
            <div className="space-y-3">
              {changeRequests.map(req => (
                <div key={req.id} className="flex items-start justify-between rounded-lg border p-3 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{req.fieldLabel}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Requested: <span className="text-foreground">{req.requestedValue}</span></p>
                    {req.adminNote && <p className="text-xs text-muted-foreground mt-0.5">Note: {req.adminNote}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{new Date(req.createdAt).toLocaleDateString("en-GB")}</p>
                  </div>
                  <Badge className={`text-xs flex-shrink-0 ${statusColors[req.status] ?? ""}`}>
                    {req.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                    {req.status === "approved" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {req.status === "rejected" && <XCircle className="h-3 w-3 mr-1" />}
                    {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Change Request Dialog */}
      <Dialog open={requestDialog} onOpenChange={setRequestDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Update: {form.fieldLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {form.currentValue && (
              <div>
                <Label className="text-xs text-muted-foreground">Current Value</Label>
                <p className="text-sm mt-1">{form.currentValue}</p>
              </div>
            )}
            <div>
              <Label htmlFor="newValue">New Value</Label>
              <Input
                id="newValue"
                value={form.requestedValue}
                onChange={e => setForm({ ...form, requestedValue: e.target.value })}
                placeholder={`Enter new ${form.fieldLabel.toLowerCase()}`}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="reason">Reason (optional)</Label>
              <Textarea
                id="reason"
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                placeholder="Why are you requesting this change?"
                className="mt-1 resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestDialog(false)}>Cancel</Button>
            <Button
              onClick={() => submitRequest.mutate({
                fieldName: form.fieldName,
                fieldLabel: form.fieldLabel,
                currentValue: form.currentValue || undefined,
                requestedValue: form.requestedValue,
                reason: form.reason || undefined,
              })}
              disabled={!form.requestedValue.trim() || submitRequest.isPending}
            >
              {submitRequest.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileField({
  label, value, icon, onRequest,
}: {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
  onRequest?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          {icon}{label}
        </p>
        <p className="text-sm font-medium mt-0.5 truncate">
          {value || <span className="text-muted-foreground font-normal">Not on file</span>}
        </p>
      </div>
      {onRequest && (
        <Button variant="ghost" size="sm" className="h-7 text-xs flex-shrink-0 mt-3" onClick={onRequest}>
          <PencilLine className="h-3 w-3 mr-1" /> Request Update
        </Button>
      )}
    </div>
  );
}
