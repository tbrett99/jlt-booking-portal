import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Eye, Send, FileText, Upload, Tag, X, CheckCircle, XCircle, ExternalLink } from "lucide-react";

const STAGES = ["New Enquiry","AR Submitted","AR Approved","Discovery Call Booked","Approved","Rejected","Lost","Won"] as const;
type Stage = (typeof STAGES)[number];

const PRESET_TAGS = ["prospect","agent","core team","cancelled"];

const UK_REGIONS = ["North West","North East","Yorkshire & Humber","East Midlands","West Midlands","East of England","London","South East","South West","Wales","Scotland","Northern Ireland"];

export default function ProspectDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const prospectId = parseInt(id ?? "0");
  const utils = trpc.useUtils();

  const { data: prospect, isLoading, refetch } = trpc.crm.prospects.get.useQuery({ id: prospectId });

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [tagInput, setTagInput] = useState("");
  const [moveDialog, setMoveDialog] = useState(false);
  const [newStage, setNewStage] = useState<Stage>("New Enquiry");
  const [moveNote, setMoveNote] = useState("");
  const [supplierDialog, setSupplierDialog] = useState<any>(null);
  const [arReviewDialog, setArReviewDialog] = useState<any>(null);
  const [arReviewStatus, setArReviewStatus] = useState<"approved"|"rejected">("approved");
  const [arReviewNotes, setArReviewNotes] = useState("");
  const [contractDialog, setContractDialog] = useState(false);
  const [docUploadType, setDocUploadType] = useState<"id"|"proofOfAddress">("id");
  const docInputRef = useRef<HTMLInputElement>(null);

  const updateProspect = trpc.crm.prospects.update.useMutation({ onSuccess: () => { refetch(); setEditing(false); toast.success("Saved"); } });
  const moveStage = trpc.crm.prospects.moveStage.useMutation({ onSuccess: () => { refetch(); setMoveDialog(false); toast.success("Stage updated"); } });
  const addTag = trpc.crm.prospects.addTag.useMutation({ onSuccess: () => refetch() });
  const removeTag = trpc.crm.prospects.removeTag.useMutation({ onSuccess: () => refetch() });
  const addSupplier = trpc.crm.supplierLogins.add.useMutation({ onSuccess: () => { refetch(); setSupplierDialog(null); toast.success("Supplier login added"); } });
  const deleteSupplier = trpc.crm.supplierLogins.delete.useMutation({ onSuccess: () => { refetch(); toast.success("Deleted"); } });
  const reviewAr = trpc.crm.arForm.review.useMutation({ onSuccess: () => { refetch(); setArReviewDialog(null); toast.success("AR form reviewed"); } });
  const sendContract = trpc.crm.contracts.sendSigningLink.useMutation({
    onSuccess: (data) => { refetch(); setContractDialog(false); toast.success("Contract signing link sent"); },
    onError: (e) => toast.error(e.message),
  });
  const uploadDoc = trpc.crm.prospects.uploadDoc.useMutation({ onSuccess: () => { refetch(); toast.success("Document uploaded"); } });

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (!prospect) return <div className="p-8 text-center text-muted-foreground">Prospect not found.</div>;

  const p = prospect as any;

  const handleEdit = () => {
    setEditData({
      firstName: p.firstName, lastName: p.lastName, email: p.email,
      phone: p.phone ?? "", mobile: p.mobile ?? "", personalEmail: p.personalEmail ?? "",
      jltEmail: p.jltEmail ?? "", addressLine1: p.addressLine1 ?? "", addressLine2: p.addressLine2 ?? "",
      city: p.city ?? "", postcode: p.postcode ?? "", ukRegion: p.ukRegion ?? "",
      bankAccountName: p.bankAccountName ?? "", bankSortCode: p.bankSortCode ?? "",
      bankAccountNumber: p.bankAccountNumber ?? "", adminNotes: p.adminNotes ?? "",
    });
    setEditing(true);
  };

  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadDoc.mutate({ prospectId: p.id, docType: docUploadType, fileBase64: base64, fileName: file.name, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  const stageColor: Record<string, string> = {
    "New Enquiry": "bg-blue-100 text-blue-700",
    "AR Submitted": "bg-yellow-100 text-yellow-700",
    "AR Approved": "bg-green-100 text-green-700",
    "Discovery Call Booked": "bg-purple-100 text-purple-700",
    "Approved": "bg-emerald-100 text-emerald-700",
    "Rejected": "bg-red-100 text-red-700",
    "Lost": "bg-gray-100 text-gray-600",
    "Won": "bg-amber-100 text-amber-700",
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/crm/pipeline")}><ArrowLeft size={14} className="mr-1" />Pipeline</Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold">{p.firstName} {p.lastName}</h1>
            {p.uniqueAgentId && <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{p.uniqueAgentId}</span>}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageColor[p.stage] ?? "bg-gray-100 text-gray-600"}`}>{p.stage}</span>
          </div>
          <p className="text-sm text-muted-foreground">{p.email}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={() => { setNewStage(p.stage); setMoveDialog(true); }}>Move Stage</Button>
          <Button size="sm" onClick={handleEdit}>Edit Profile</Button>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 items-center">
        {(p.tags ?? []).map((t: string) => (
          <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted font-medium">
            {t}
            <button onClick={() => removeTag.mutate({ prospectId: p.id, tag: t })} className="hover:text-destructive"><X size={10} /></button>
          </span>
        ))}
        <div className="flex items-center gap-1">
          <Select onValueChange={(v) => addTag.mutate({ prospectId: p.id, tag: v })}>
            <SelectTrigger className="h-6 text-xs w-36"><SelectValue placeholder="Add tag…" /></SelectTrigger>
            <SelectContent>
              {PRESET_TAGS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            className="h-6 text-xs w-28"
            placeholder="Custom tag"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { addTag.mutate({ prospectId: p.id, tag: tagInput.trim() }); setTagInput(""); } }}
          />
        </div>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="ar">Application Form</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="suppliers">Supplier Logins</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* ── Profile tab ── */}
        <TabsContent value="profile">
          <Card>
            <CardContent className="pt-4">
              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    {[["firstName","First Name"],["lastName","Last Name"],["email","Email"],["phone","Phone"],["mobile","Mobile"],["personalEmail","Personal Email"],["jltEmail","JLT Email"],["addressLine1","Address Line 1"],["addressLine2","Address Line 2"],["city","City"],["postcode","Postcode"]].map(([k,l]) => (
                      <div key={k} className={`space-y-1 ${k==="email"||k==="addressLine1"||k==="addressLine2" ? "col-span-2" : ""}`}>
                        <Label className="text-xs">{l}</Label>
                        <Input className="h-8 text-sm" value={editData[k] ?? ""} onChange={(e) => setEditData((d: any) => ({ ...d, [k]: e.target.value }))} />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <Label className="text-xs">UK Region</Label>
                      <Select value={editData.ukRegion ?? ""} onValueChange={(v) => setEditData((d: any) => ({ ...d, ukRegion: v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select region…" /></SelectTrigger>
                        <SelectContent>{UK_REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="border-t pt-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Bank Details (Commission Payouts)</p>
                    <div className="grid grid-cols-3 gap-3">
                      {[["bankAccountName","Account Name"],["bankSortCode","Sort Code"],["bankAccountNumber","Account Number"]].map(([k,l]) => (
                        <div key={k} className="space-y-1">
                          <Label className="text-xs">{l}</Label>
                          <Input className="h-8 text-sm" value={editData[k] ?? ""} onChange={(e) => setEditData((d: any) => ({ ...d, [k]: e.target.value }))} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Admin Notes</Label>
                    <Textarea rows={3} value={editData.adminNotes ?? ""} onChange={(e) => setEditData((d: any) => ({ ...d, adminNotes: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => updateProspect.mutate({ id: p.id, ...editData })} disabled={updateProspect.isPending}>{updateProspect.isPending ? "Saving…" : "Save"}</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  {[
                    ["Email", p.email], ["Phone", p.phone], ["Mobile", p.mobile],
                    ["Personal Email", p.personalEmail], ["JLT Email", p.jltEmail],
                    ["Address", [p.addressLine1, p.addressLine2, p.city, p.postcode].filter(Boolean).join(", ")],
                    ["UK Region", p.ukRegion], ["Bank Account Name", p.bankAccountName],
                    ["Sort Code", p.bankSortCode], ["Account Number", p.bankAccountNumber],
                    ["Source", p.source], ["Marketing Consent", p.marketingConsent ? "Yes" : "No"],
                  ].map(([label, value]) => value ? (
                    <div key={label as string} className="flex gap-2">
                      <span className="text-muted-foreground w-36 flex-shrink-0">{label}</span>
                      <span className="font-medium">{value as string}</span>
                    </div>
                  ) : null)}
                  {p.adminNotes && (
                    <div className="col-span-2 mt-2 p-3 bg-muted/50 rounded text-sm">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Admin Notes</p>
                      <p>{p.adminNotes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AR Form tab ── */}
        <TabsContent value="ar">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agent Application Forms</CardTitle>
            </CardHeader>
            <CardContent>
              {(p.arForms ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No application form submitted yet.</p>
              ) : (
                <div className="space-y-4">
                  {(p.arForms as any[]).map((form: any) => (
                    <div key={form.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Submitted {new Date(form.submittedAt).toLocaleDateString("en-GB")}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${form.reviewStatus === "approved" ? "bg-green-100 text-green-700" : form.reviewStatus === "rejected" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>
                            {form.reviewStatus ?? "Pending Review"}
                          </span>
                        </div>
                        {!form.reviewStatus && (
                          <Button size="sm" onClick={() => { setArReviewDialog(form); setArReviewStatus("approved"); setArReviewNotes(""); }}>Review</Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {[
                          ["Why Interested", form.whyInterested],
                          ["Self Employed", form.isSelfEmployed],
                          ["Travel Experience", form.hasTravelExperience],
                          ["Experience Details", form.travelExperienceDetails],
                          ["Current Job", form.currentJob],
                          ["12-Month Goal", form.businessGoal12Months],
                          ["Specialisation", form.travelSpecialisation],
                          ["Weekly Hours", form.weeklyHours],
                          ["Home Support", form.hasHomeSupport],
                          ["Investment Readiness", form.investmentReadiness],
                          ["Understands Self-Employment", form.understandsSelfEmployed],
                          ["Biggest Hesitation", form.biggestHesitation],
                          ["Tech Confidence", form.techConfidence],
                          ["Financial Readiness", form.financialReadiness],
                          ["2-Year Vision", form.twoYearVision],
                          ["How Did You Hear", form.hearAboutUs],
                          ["Hear About Us Details", form.hearAboutUsDetails],
                          ["Looking at Other Agencies", form.lookingAtOtherAgencies],
                        ].filter(([, v]) => v).map(([l, v]) => (
                          <div key={l as string} className="flex gap-2">
                            <span className="text-muted-foreground w-44 flex-shrink-0 text-xs">{l}</span>
                            <span className="text-xs">{v as string}</span>
                          </div>
                        ))}
                      </div>
                      {form.reviewNotes && (
                        <div className="p-2 bg-muted/50 rounded text-xs">
                          <span className="font-medium">Review Notes: </span>{form.reviewNotes}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Contracts tab ── */}
        <TabsContent value="contracts">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Contracts</CardTitle>
              <Button size="sm" onClick={() => setContractDialog(true)}><Send size={13} className="mr-1" />Send Contract</Button>
            </CardHeader>
            <CardContent>
              {(p.contracts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No contracts sent yet.</p>
              ) : (
                <div className="space-y-3">
                  {(p.contracts as any[]).map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between border rounded-lg p-3">
                      <div>
                        <p className="text-sm font-medium">Contract #{c.id}</p>
                        <p className="text-xs text-muted-foreground">
                          Sent {c.sentAt ? new Date(c.sentAt).toLocaleDateString("en-GB") : "—"} ·{" "}
                          {c.signedAt ? <span className="text-green-600 font-medium">Signed {new Date(c.signedAt).toLocaleDateString("en-GB")}</span> : <span className="text-yellow-600">Awaiting signature</span>}
                        </p>
                        {c.signerName && <p className="text-xs text-muted-foreground">Signed by: {c.signerName}</p>}
                      </div>
                      {c.signedPdfUrl && (
                        <a href={c.signedPdfUrl} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" variant="outline"><Eye size={13} className="mr-1" />View</Button>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Supplier Logins tab ── */}
        <TabsContent value="suppliers">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-base">Supplier Logins</CardTitle>
              <Button size="sm" onClick={() => setSupplierDialog({ supplierName: "", username: "", password: "", loginUrl: "", notes: "" })}><Plus size={13} className="mr-1" />Add</Button>
            </CardHeader>
            <CardContent>
              {(p.supplierLogins ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No supplier logins added yet.</p>
              ) : (
                <div className="space-y-2">
                  {(p.supplierLogins as any[]).map((s: any) => (
                    <div key={s.id} className="flex items-start justify-between border rounded-lg p-3">
                      <div className="space-y-0.5">
                        <p className="text-sm font-semibold">{s.supplierName}</p>
                        {s.username && <p className="text-xs text-muted-foreground">User: {s.username}</p>}
                        {s.password && <p className="text-xs text-muted-foreground">Pass: {s.password}</p>}
                        {s.loginUrl && <a href={s.loginUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-0.5">{s.loginUrl}<ExternalLink size={10} /></a>}
                        {s.notes && <p className="text-xs text-muted-foreground">{s.notes}</p>}
                      </div>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteSupplier.mutate({ id: s.id })}><Trash2 size={13} /></Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Documents tab ── */}
        <TabsContent value="documents">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <input ref={docInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleDocUpload} />
              {[
                { type: "id" as const, label: "ID Document", url: p.idDocUrl },
                { type: "proofOfAddress" as const, label: "Proof of Address", url: p.proofOfAddressUrl },
              ].map(({ type, label, url }) => (
                <div key={type} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    {url ? <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} />Uploaded</p> : <p className="text-xs text-muted-foreground">Not uploaded</p>}
                  </div>
                  <div className="flex gap-2">
                    {url && <a href={url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><Eye size={13} className="mr-1" />View</Button></a>}
                    <Button size="sm" variant="outline" onClick={() => { setDocUploadType(type); docInputRef.current?.click(); }}><Upload size={13} className="mr-1" />{url ? "Replace" : "Upload"}</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── History tab ── */}
        <TabsContent value="history">
          <Card>
            <CardContent className="pt-4">
              {(p.history ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet.</p>
              ) : (
                <div className="space-y-2">
                  {(p.history as any[]).map((h: any) => (
                    <div key={h.id} className="flex gap-3 text-sm">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">{h.fromStage} → {h.toStage}</p>
                        {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
                        <p className="text-xs text-muted-foreground">{new Date(h.movedAt).toLocaleString("en-GB")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Move stage dialog */}
      <Dialog open={moveDialog} onOpenChange={setMoveDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Move Stage</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>New Stage</Label>
              <Select value={newStage} onValueChange={(v) => setNewStage(v as Stage)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea rows={2} value={moveNote} onChange={(e) => setMoveNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveDialog(false)}>Cancel</Button>
            <Button onClick={() => moveStage.mutate({ id: p.id, stage: newStage, note: moveNote || undefined })} disabled={moveStage.isPending}>{moveStage.isPending ? "Moving…" : "Move"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AR review dialog */}
      <Dialog open={!!arReviewDialog} onOpenChange={() => setArReviewDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review Application Form</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Decision</Label>
              <Select value={arReviewStatus} onValueChange={(v) => setArReviewStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approve</SelectItem>
                  <SelectItem value="rejected">Reject</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={3} value={arReviewNotes} onChange={(e) => setArReviewNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArReviewDialog(null)}>Cancel</Button>
            <Button onClick={() => reviewAr.mutate({ formId: arReviewDialog.id, prospectId: p.id, reviewStatus: arReviewStatus, reviewNotes: arReviewNotes || undefined })} disabled={reviewAr.isPending}>
              {reviewAr.isPending ? "Saving…" : "Submit Review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add supplier dialog */}
      <Dialog open={!!supplierDialog} onOpenChange={() => setSupplierDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Supplier Login</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {[["supplierName","Supplier Name *"],["username","Username"],["password","Password"],["loginUrl","Login URL"],["notes","Notes"]].map(([k,l]) => (
              <div key={k} className="space-y-1.5">
                <Label className="text-sm">{l}</Label>
                <Input value={supplierDialog?.[k] ?? ""} onChange={(e) => setSupplierDialog((d: any) => ({ ...d, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierDialog(null)}>Cancel</Button>
            <Button onClick={() => addSupplier.mutate({ prospectId: p.id, ...supplierDialog })} disabled={addSupplier.isPending || !supplierDialog?.supplierName}>
              {addSupplier.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send contract dialog */}
      <Dialog open={contractDialog} onOpenChange={setContractDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send Contract for Signing</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will send {p.firstName} a secure link to review and sign the contract template. The signed copy will be stored here and emailed to them.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContractDialog(false)}>Cancel</Button>
            <Button onClick={() => sendContract.mutate({ prospectId: p.id, origin: window.location.origin })} disabled={sendContract.isPending}>
              {sendContract.isPending ? "Sending…" : "Send Signing Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
