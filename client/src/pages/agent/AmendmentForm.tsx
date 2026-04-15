import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useParams, Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2, CheckSquare, Square } from "lucide-react";

type LineItemType = "add_supplier" | "remove_supplier" | "change_cost" | "other";

interface LineItem {
  id: string;
  type: LineItemType;
  supplierName: string;
  cost: string;
  oldCost: string;
  notes: string;
}

const TYPE_CONFIG: Record<LineItemType, { label: string; color: string; textColor: string; description: string }> = {
  add_supplier:    { label: "Add Supplier",    color: "#d1fae5", textColor: "#065f46", description: "A new supplier to be added to the booking" },
  remove_supplier: { label: "Remove Supplier", color: "#fee2e2", textColor: "#991b1b", description: "An existing supplier to be removed from the booking" },
  change_cost:     { label: "Change Cost",     color: "#fef3c7", textColor: "#92400e", description: "A supplier's cost has changed" },
  other:           { label: "Other",           color: "#ede9fe", textColor: "#5b21b6", description: "Any other change not covered above" },
};

const ALL_TYPES: LineItemType[] = ["add_supplier", "remove_supplier", "change_cost", "other"];

function newItem(type: LineItemType): LineItem {
  return { id: Math.random().toString(36).slice(2), type, supplierName: "", cost: "", oldCost: "", notes: "" };
}

export default function AmendmentForm() {
  const { id } = useParams<{ id: string }>();
  const bookingId = Number(id);
  const [, navigate] = useLocation();
  const [selectedTypes, setSelectedTypes] = useState<Set<LineItemType>>(new Set());
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: booking } = trpc.bookings.byId.useQuery({ id: bookingId });
  const submitAmendment = trpc.amendments.submit.useMutation();

  const toggleType = (type: LineItemType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
        // Remove all line items of this type
        setLineItems((items) => items.filter((li) => li.type !== type));
      } else {
        next.add(type);
        // Add a default row for this type
        setLineItems((items) => [...items, newItem(type)]);
      }
      return next;
    });
  };

  const addRow = (type: LineItemType) => {
    setLineItems((items) => [...items, newItem(type)]);
  };

  const removeRow = (itemId: string) => {
    setLineItems((items) => {
      const remaining = items.filter((li) => li.id !== itemId);
      // If no rows left for this type, deselect the type
      const removedType = items.find((li) => li.id === itemId)?.type;
      if (removedType && !remaining.some((li) => li.type === removedType)) {
        setSelectedTypes((prev) => { const next = new Set(prev); next.delete(removedType); return next; });
      }
      return remaining;
    });
  };

  const updateRow = (itemId: string, field: keyof LineItem, value: string) => {
    setLineItems((items) => items.map((li) => li.id === itemId ? { ...li, [field]: value } : li));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTypes.size === 0) { toast.error("Please select at least one amendment type"); return; }

    // Validate required fields per type
    for (const item of lineItems) {
      if (item.type !== "other") {
        if (!item.supplierName.trim()) { toast.error("Please enter a supplier name for all items"); return; }
        if (!item.cost.trim()) { toast.error("Please enter a cost for all items"); return; }
      } else {
        if (!item.notes.trim()) { toast.error("Please describe the 'Other' amendment"); return; }
      }
    }

    // Build a plain-text summary for the details field (backwards compat)
    const summaryLines = lineItems.map((li) => {
      const cfg = TYPE_CONFIG[li.type];
      if (li.type === "other") return `Other: ${li.notes}`;
      if (li.type === "change_cost") return `${cfg.label}: ${li.supplierName} — Old £${li.oldCost || "?"} → New £${li.cost}${li.notes ? ` (${li.notes})` : ""}`;
      return `${cfg.label}: ${li.supplierName} — £${li.cost}${li.notes ? ` (${li.notes})` : ""}`;
    });
    const details = summaryLines.join("\n");

    setIsSubmitting(true);
    try {
      await submitAmendment.mutateAsync({
        bookingId,
        details,
        lineItems: lineItems.map((li) => ({
          type: li.type,
          supplierName: li.supplierName || null,
          cost: li.cost || null,
          oldCost: li.oldCost || null,
          notes: li.notes || null,
        })),
      });
      toast.success("Amendment submitted successfully");
      navigate(`/bookings/${bookingId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit amendment");
    } finally {
      setIsSubmitting(false);
    }
  };

  const itemsByType = (type: LineItemType) => lineItems.filter((li) => li.type === type);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/bookings/${bookingId}`}>
          <Button variant="ghost" size="sm" className="gap-2"><ArrowLeft size={16} />Back</Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Submit Amendment</h1>
          {booking && <p className="text-sm text-muted-foreground">{booking.clientName} — Booking #{bookingId}</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Step 1: Select types */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What type of change do you need?</CardTitle>
            <p className="text-sm text-muted-foreground">Select all that apply — you can add multiple changes in one submission.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {ALL_TYPES.map((type) => {
              const cfg = TYPE_CONFIG[type];
              const selected = selectedTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className="flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-all"
                  style={{
                    borderColor: selected ? cfg.textColor : "#e5e7eb",
                    background: selected ? cfg.color : "transparent",
                  }}
                >
                  <span className="mt-0.5 flex-shrink-0" style={{ color: cfg.textColor }}>
                    {selected ? <CheckSquare size={18} /> : <Square size={18} className="text-muted-foreground" />}
                  </span>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: selected ? cfg.textColor : undefined }}>{cfg.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Step 2: Fill in details per selected type */}
        {ALL_TYPES.filter((t) => selectedTypes.has(t)).map((type) => {
          const cfg = TYPE_CONFIG[type];
          const items = itemsByType(type);
          return (
            <Card key={type} style={{ borderColor: cfg.textColor, borderWidth: 1.5 }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Badge style={{ background: cfg.color, color: cfg.textColor, border: "none" }}>{cfg.label}</Badge>
                  <span className="font-normal text-muted-foreground text-xs">{cfg.description}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {items.map((item, idx) => (
                  <div key={item.id} className="rounded-lg border p-3 space-y-3 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {cfg.label} #{idx + 1}
                      </span>
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeRow(item.id)} className="text-destructive hover:text-destructive/80">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>

                    {type === "other" ? (
                      <div className="space-y-1">
                        <Label className="text-xs">Description <span className="text-destructive">*</span></Label>
                        <Textarea
                          placeholder="Please describe the change required..."
                          value={item.notes}
                          onChange={(e) => updateRow(item.id, "notes", e.target.value)}
                          className="min-h-[80px] text-sm"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Supplier Name <span className="text-destructive">*</span></Label>
                          <Input
                            placeholder="e.g. Bedsonline"
                            value={item.supplierName}
                            onChange={(e) => updateRow(item.id, "supplierName", e.target.value)}
                            className="text-sm"
                          />
                        </div>
                        {type === "change_cost" ? (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs">New Cost (£) <span className="text-destructive">*</span></Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={item.cost}
                                onChange={(e) => updateRow(item.id, "cost", e.target.value)}
                                className="text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Old Cost (£)</Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="0.00"
                                value={item.oldCost}
                                onChange={(e) => updateRow(item.id, "oldCost", e.target.value)}
                                className="text-sm"
                              />
                            </div>
                          </>
                        ) : (
                          <div className="space-y-1">
                            <Label className="text-xs">Cost (£) <span className="text-destructive">*</span></Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              value={item.cost}
                              onChange={(e) => updateRow(item.id, "cost", e.target.value)}
                              className="text-sm"
                            />
                          </div>
                        )}
                        <div className={`space-y-1 ${type === "change_cost" ? "col-span-2" : "col-span-2"}`}>
                          <Label className="text-xs">Notes (optional)</Label>
                          <Input
                            placeholder="Any additional context..."
                            value={item.notes}
                            onChange={(e) => updateRow(item.id, "notes", e.target.value)}
                            className="text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => addRow(type)}
                >
                  <Plus size={13} /> Add another {cfg.label.toLowerCase()} row
                </Button>
              </CardContent>
            </Card>
          );
        })}

        {selectedTypes.size > 0 && (
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={isSubmitting}
              style={{ background: '#70FFE8', color: '#414141' }}
              className="font-semibold"
            >
              {isSubmitting ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting...</> : "Submit Amendment"}
            </Button>
            <Link href={`/bookings/${bookingId}`}><Button type="button" variant="outline">Cancel</Button></Link>
          </div>
        )}
      </form>
    </div>
  );
}
