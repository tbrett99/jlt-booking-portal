import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, X, Loader2, PoundSterling, Info, CheckCircle2, CreditCard, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import CountrySelect from "@/components/CountrySelect";

export default function RegisterBooking() {
  const [, navigate] = useLocation();
  const [clientName, setClientName] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [bookedDate, setBookedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [isHistoricBooking, setIsHistoricBooking] = useState(false);
  const [topdogRef, setTopdogRef] = useState("");
  const [reimbursementsRequired, setReimbursementsRequired] = useState(false);
  const [reimbItems, setReimbItems] = useState<{ supplierName: string; amount: string; jltCompanyCard: boolean }[]>([{ supplierName: "", amount: "", jltCompanyCard: false }]);
  const [jltCardConfirmIdx, setJltCardConfirmIdx] = useState<number | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [expectedCommission, setExpectedCommission] = useState("");
  const [grossCost, setGrossCost] = useState("");
  const [destination, setDestination] = useState("");
  const [passengers, setPassengers] = useState("");
  const [numberOfNights, setNumberOfNights] = useState("");
  const [isPersonalBooking, setIsPersonalBooking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successBooking, setSuccessBooking] = useState<{ id: number; clientName: string; departureDate: Date } | null>(null);
  const [showHistoricConfirm, setShowHistoricConfirm] = useState(false);
  const [useFnfVoucher, setUseFnfVoucher] = useState(false);

  // Warn if booked date is >7 days ago and historic toggle is off
  const bookedDateIsOld = useMemo(() => {
    if (!bookedDate) return false;
    const diff = (Date.now() - new Date(bookedDate).getTime()) / (1000 * 60 * 60 * 24);
    return diff > 7;
  }, [bookedDate]);
  const showHistoricWarning = bookedDateIsOld && !isHistoricBooking;
  const fileRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const createBooking = trpc.bookings.create.useMutation();
  const uploadDoc = trpc.bookings.uploadReimbDoc.useMutation();
  const { data: fnfBalance } = trpc.fnf.getBalance.useQuery();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File must be under 10MB");
        return;
      }
      setDocFile(file);
    }
  };

  // Derived margin for live preview — reverse-engineer estimated gross commission from Orbit net (80/20 split, ~1.3% PTS fee)
  const grossNum = parseFloat(grossCost);
  const commNum = parseFloat(expectedCommission);
  const estimatedGrossComm = commNum > 0 ? (commNum / 0.80) / (1 - 0.013) : 0;
  const marginPct = grossNum > 0 && commNum > 0 ? (estimatedGrossComm / grossNum) * 100 : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !departureDate || !bookedDate) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (!destination) {
      toast.error("Please select a destination country");
      return;
    }
    if (!grossCost || parseFloat(grossCost) <= 0) {
      toast.error("Please enter the gross cost of the booking");
      return;
    }
    if (!passengers || parseInt(passengers) < 1) {
      toast.error("Please enter the number of passengers (excluding infants)");
      return;
    }
    if (numberOfNights === "" || numberOfNights === null || numberOfNights === undefined || parseInt(numberOfNights) < 0) {
      toast.error("Please enter the number of nights");
      return;
    }
    setIsSubmitting(true);
    try {
      const validReimbItems = reimbursementsRequired
        ? reimbItems.filter((r) => r.supplierName.trim() && parseFloat(r.amount) > 0).map((r) => ({ supplierName: r.supplierName.trim(), amount: parseFloat(r.amount), jltCompanyCard: r.jltCompanyCard ?? false }))
        : [];
      const booking = await createBooking.mutateAsync({
        clientName,
        departureDate: new Date(departureDate),
        bookedDate: new Date(bookedDate),
        topdogRef: topdogRef || undefined,
        reimbursementsRequired,
        reimbursementItems: validReimbItems,
        expectedCommission: !isPersonalBooking && commNum > 0 ? commNum : undefined,
        grossCost: grossNum,
        destination: destination || undefined,
        passengers: parseInt(passengers),
        numberOfNights: parseInt(numberOfNights),
        isPersonalBooking,
        isHistoricBooking,
        useFnfVoucher: useFnfVoucher && !isPersonalBooking && (fnfBalance?.remaining ?? 0) > 0 ? true : undefined,
      });

      if (booking && docFile) {
        const arrayBuffer = await docFile.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const base64 = btoa(Array.from(uint8).map(b => String.fromCharCode(b)).join(''));
        await uploadDoc.mutateAsync({
          bookingId: booking.id,
          fileBase64: base64,
          fileName: docFile.name,
          mimeType: docFile.type,
        });
      }

      await utils.bookings.myBookings.invalidate();
      if (booking) {
        setSuccessBooking({ id: booking.id, clientName: booking.clientName, departureDate: booking.departureDate as Date });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to register booking");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft size={16} />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold">Register a Booking</h1>
          <p className="text-sm text-muted-foreground">Submit a new booking for processing</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Booking Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Personal Booking Toggle */}
            <div className="rounded-lg border-2 border-dashed p-4 space-y-2" style={{ borderColor: isPersonalBooking ? '#70FFE8' : undefined, background: isPersonalBooking ? '#F0FFFB' : undefined }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPersonalBooking}
                  onChange={(e) => setIsPersonalBooking(e.target.checked)}
                  className="w-4 h-4 mt-0.5 accent-teal-500"
                />
                <div>
                  <span className="text-sm font-semibold">This is my personal booking</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tick this if you are a passenger on this booking. No commission will be claimed.
                  </p>
                </div>
              </label>
            </div>

            {/* Client Name */}
            <div className="space-y-2">
              <Label htmlFor="clientName">
                {isPersonalBooking ? "Your Name" : "Client Name"} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="clientName"
                placeholder={isPersonalBooking ? "Your full name" : "Full name of the client"}
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
              />
            </div>

            {/* Booked Date */}
            <div className="space-y-2">
              <Label htmlFor="bookedDate">
                Booked Date <span className="text-destructive">*</span>
                <span className="text-muted-foreground text-xs ml-1">(date the booking was made)</span>
              </Label>
              <Input
                id="bookedDate"
                type="date"
                value={bookedDate}
                onChange={(e) => setBookedDate(e.target.value)}
                required
              />
              {!isHistoricBooking && (
                <p className="text-xs text-muted-foreground">Defaults to today — bookings should be registered immediately.</p>
              )}
              {showHistoricWarning && (
                <div className="mt-2 flex items-start gap-3 rounded-lg border-2 p-3" style={{ borderColor: '#f59e0b', background: '#fffbeb' }}>
                  <span className="mt-0.5 text-amber-500" style={{ flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: '#92400e' }}>This looks like a historic booking</p>
                    <p className="text-xs mt-0.5" style={{ color: '#78350f' }}>
                      The booked date is more than 7 days ago. If this booking is already on PTS and you need to claim commission, request a refund, or make an amendment — please enable the <strong>"Historic Booking"</strong> toggle at the bottom of this form.
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold underline"
                      style={{ color: '#b45309' }}
                      onClick={() => setIsHistoricBooking(true)}
                    >
                      Enable Historic Booking →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Departure Date */}
            <div className="space-y-2">
              <Label htmlFor="departureDate">
                Departure Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="departureDate"
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                required
              />
            </div>

            {/* Destination Country */}
            <div className="space-y-2">
              <Label>Destination Country <span className="text-destructive">*</span></Label>
              <CountrySelect
                value={destination}
                onChange={setDestination}
                placeholder="Select destination country..."
              />
              {!destination && <p className="text-xs text-muted-foreground">Required — please select the destination country.</p>}
            </div>

            {/* Passengers & Nights */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="passengers">
                  Passengers (excl. infants) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="passengers"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 2"
                  value={passengers}
                  onChange={(e) => setPassengers(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="numberOfNights">
                  Number of Nights <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="numberOfNights"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 7"
                  value={numberOfNights}
                  onChange={(e) => setNumberOfNights(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Topdog Ref */}
            <div className="space-y-2">
              <Label htmlFor="topdogRef">Topdog Booking Reference <span className="text-muted-foreground text-xs font-medium text-amber-600">(mandatory if you have one)</span></Label>
              <Input
                id="topdogRef"
                placeholder="e.g. TD123456"
                value={topdogRef}
                onChange={(e) => setTopdogRef(e.target.value)}
              />
            </div>

            {/* Gross Cost & Commission */}
            <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
              <div className="flex items-center gap-2">
                <PoundSterling size={16} className="text-primary" />
                <h3 className="text-sm font-semibold">Booking Value</h3>
              </div>
              <div className={`grid gap-4 ${isPersonalBooking ? '' : 'grid-cols-2'}`}>
                <div className="space-y-2">
                  <Label htmlFor="grossCost">Gross Price (£) <span className="text-destructive">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                    <Input
                      id="grossCost"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={grossCost}
                      onChange={(e) => setGrossCost(e.target.value)}
                      className="pl-7"
                      required
                    />
                  </div>
                </div>
                {!isPersonalBooking && (
                  <div className="space-y-2">
                    <Label htmlFor="expectedCommission">Expected Commission (£) <span className="text-destructive">*</span> <span className="text-muted-foreground text-xs font-normal">(gross, before fees & split)</span></Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                      <Input
                        id="expectedCommission"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={expectedCommission}
                        onChange={(e) => setExpectedCommission(e.target.value)}
                        className="pl-7"
                        required
                      />
                    </div>
                  </div>
                )}
              </div>
              {/* Live margin preview — only for non-personal */}
              {!isPersonalBooking && marginPct !== null && (
                <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 ${
                  marginPct < 6 && !useFnfVoucher
                    ? "bg-red-50 text-red-700 border border-red-200"
                    : "bg-green-50 text-green-700 border border-green-200"
                }`}>
                  <Info size={14} />
                  <span>
                    Margin: <strong>{marginPct.toFixed(1)}%</strong>
                    {marginPct < 6 && !useFnfVoucher && " — below the 6% monthly average threshold"}
                    {useFnfVoucher && " — F&F voucher active, NET rate permitted"}
                  </span>
                </div>
              )}
              {/* F&F Voucher toggle — only show if agent has remaining vouchers and not personal */}
              {!isPersonalBooking && fnfBalance && fnfBalance.hasAllocation && (
                <div
                  className="rounded-lg border p-3 flex items-center gap-3 cursor-pointer select-none"
                  style={{ background: useFnfVoucher ? '#fdf2f8' : '#f9fafb', borderColor: useFnfVoucher ? '#f9a8d4' : '#e5e7eb' }}
                  onClick={() => {
                    if (fnfBalance.remaining <= 0 && !useFnfVoucher) {
                      toast.error('No Friends & Family vouchers remaining');
                      return;
                    }
                    setUseFnfVoucher((v) => !v);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={useFnfVoucher}
                    onChange={() => {}}
                    className="w-4 h-4 accent-pink-600"
                    disabled={fnfBalance.remaining <= 0 && !useFnfVoucher}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: '#9d174d' }}>
                      Use a Friends &amp; Family voucher
                      <span className="ml-2 text-xs font-normal" style={{ color: '#db2777' }}>
                        ({fnfBalance.remaining} remaining)
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Allows you to sell at NET rate — PTS fees still apply. Once applied, only an admin can remove it.
                    </p>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={useFnfVoucher ? '#db2777' : '#d1d5db'} stroke={useFnfVoucher ? '#db2777' : '#d1d5db'} strokeWidth="0"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                </div>
              )}
              <p className="text-xs text-muted-foreground flex items-start gap-1">
                <Info size={12} className="mt-0.5 shrink-0" />
                You can update these amounts at any time from your booking page.
              </p>
            </div>

            {/* Reimbursements */}
            <div className="rounded-lg border-2 border-dashed p-4 space-y-3" style={{ borderColor: reimbursementsRequired ? '#02E6D2' : '#e5e7eb', background: reimbursementsRequired ? '#f0fffb' : undefined }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reimbursementsRequired}
                  onChange={(e) => {
                    setReimbursementsRequired(e.target.checked);
                    if (e.target.checked && reimbItems.length === 0) setReimbItems([{ supplierName: "", amount: "", jltCompanyCard: false }]);
                  }}
                  className="w-4 h-4 mt-0.5 accent-teal-500"
                />
                <div>
                  <span className="text-sm font-semibold">This booking has reimbursements</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tick this if you are owed reimbursements from a supplier. Enter each one separately below.
                  </p>
                </div>
              </label>

              {reimbursementsRequired && (
                <div className="space-y-3 pt-1">
                  {reimbItems.map((item, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Supplier Name</Label>
                          <Input
                            placeholder="e.g. Cosmos Tours"
                            value={item.supplierName}
                            onChange={(e) => {
                              const updated = [...reimbItems];
                              updated[idx] = { ...updated[idx], supplierName: e.target.value };
                              setReimbItems(updated);
                            }}
                          />
                        </div>
                        <div className="w-32 space-y-1">
                          <Label className="text-xs">Amount (£)</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={item.amount}
                              onChange={(e) => {
                                const updated = [...reimbItems];
                                updated[idx] = { ...updated[idx], amount: e.target.value };
                                setReimbItems(updated);
                              }}
                              className="pl-7"
                            />
                          </div>
                        </div>
                        {reimbItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setReimbItems(reimbItems.filter((_, i) => i !== idx))}
                            className="mb-0.5 text-muted-foreground hover:text-destructive"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                      {/* JLT Company Card toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!item.jltCompanyCard) {
                            setJltCardConfirmIdx(idx);
                          } else {
                            const updated = [...reimbItems];
                            updated[idx] = { ...updated[idx], jltCompanyCard: false };
                            setReimbItems(updated);
                          }
                        }}
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors ${
                          item.jltCompanyCard
                            ? 'bg-amber-50 border-amber-400 text-amber-700 font-semibold'
                            : 'border-dashed border-gray-300 text-muted-foreground hover:border-amber-400 hover:text-amber-600'
                        }`}
                      >
                        <CreditCard size={13} />
                        {item.jltCompanyCard ? 'JLT Company Card — funds return to JLT' : 'Paid with JLT company card?'}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setReimbItems([...reimbItems, { supplierName: "", amount: "", jltCompanyCard: false }])}
                    className="text-xs font-medium underline"
                    style={{ color: '#02E6D2' }}
                  >
                    + Add another reimbursement
                  </button>
                  <p className="text-xs text-muted-foreground">You can upload supporting documents from the booking page after submission.</p>
                </div>
              )}
            </div>

            {/* JLT Company Card confirmation dialog */}
            <Dialog open={jltCardConfirmIdx !== null} onOpenChange={(open) => { if (!open) setJltCardConfirmIdx(null); }}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="text-amber-500" size={18} />
                    JLT Company Card — Are you sure?
                  </DialogTitle>
                </DialogHeader>
                <div className="text-sm text-muted-foreground space-y-2 py-2">
                  <p>Only select this if the reimbursement was paid using the <strong>JLT company card</strong>.</p>
                  <p>This means the funds will be <strong>retained by JLT</strong> and will <strong>not</strong> be paid back to you.</p>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button variant="outline" size="sm" onClick={() => setJltCardConfirmIdx(null)}>Cancel</Button>
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={() => {
                    if (jltCardConfirmIdx !== null) {
                      const updated = [...reimbItems];
                      updated[jltCardConfirmIdx] = { ...updated[jltCardConfirmIdx], jltCompanyCard: true };
                      setReimbItems(updated);
                    }
                    setJltCardConfirmIdx(null);
                  }}>Yes, JLT Company Card</Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Historic Booking Toggle — kept at the bottom to avoid accidental selection */}
            <div className={`rounded-lg border-2 border-dashed p-4 space-y-2 transition-colors`} style={{ borderColor: isHistoricBooking ? '#FFC3BC' : '#e5e7eb', background: isHistoricBooking ? '#FFF6ED' : undefined }}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isHistoricBooking}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setShowHistoricConfirm(true);
                    } else {
                      setIsHistoricBooking(false);
                    }
                  }}
                  className="w-4 h-4 mt-0.5 accent-pink-400"
                />
                <div>
                  <span className="text-sm font-semibold">This is a historic booking</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Only tick this if the booking was made previously and you are registering it now to claim commission. It will be moved directly to <strong>Added to PTS</strong>. Do not tick this for new bookings.
                  </p>
                </div>
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                style={{ background: '#70FFE8', color: '#414141' }}
                className="font-semibold"
              >
                {isSubmitting ? <><Loader2 size={16} className="animate-spin mr-2" />Submitting...</> : "Register Booking"}
              </Button>
              <Link href="/dashboard">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
      {/* Historic Booking Confirmation Dialog */}
      <Dialog open={showHistoricConfirm} onOpenChange={(open) => { if (!open) setShowHistoricConfirm(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span style={{ color: '#FFC3BC', fontSize: 20 }}>⚠</span>
              Are you sure this is a historic booking?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Only tick this if the booking was <strong>already made</strong> and you are registering it retrospectively to claim commission. It will skip the normal pipeline and go directly to <strong>Added to PTS</strong>.
            </p>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
              Do not use this for new bookings — it will cause confusion for the admin team.
            </p>
            <div className="flex gap-3 pt-1">
              <Button
                className="flex-1 font-semibold"
                style={{ background: '#FFC3BC', color: '#414141' }}
                onClick={() => { setIsHistoricBooking(true); setShowHistoricConfirm(false); }}
              >
                Yes, this is a historic booking
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setIsHistoricBooking(false); setShowHistoricConfirm(false); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Success Modal */}
      {successBooking && (
        <Dialog open onOpenChange={() => setSuccessBooking(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 size={20} className="text-green-500" />
                Booking Registered!
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Client</span>
                  <span className="font-medium">{successBooking.clientName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Departure</span>
                  <span className="font-medium">{new Date(successBooking.departureDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Booking ID</span>
                  <span className="font-medium">#{successBooking.id}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Your booking has been submitted to the JLT team for processing.</p>
              <div className="flex gap-3">
                <Button
                  className="flex-1 font-semibold"
                  style={{ background: '#70FFE8', color: '#414141' }}
                  onClick={() => { setSuccessBooking(null); navigate(`/bookings/${successBooking.id}`); }}
                >
                  View Booking
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setSuccessBooking(null);
                    const todayStr = new Date().toISOString().split("T")[0];
                    setClientName(""); setDepartureDate(""); setBookedDate(todayStr); setTopdogRef("");
                    setReimbursementsRequired(false); setReimbItems([{ supplierName: "", amount: "", jltCompanyCard: false }]); setDocFile(null); setExpectedCommission("");
                    setGrossCost(""); setDestination(""); setIsHistoricBooking(false);
                  }}
                >
                  Register Another
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
