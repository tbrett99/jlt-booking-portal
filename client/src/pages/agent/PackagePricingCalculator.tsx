import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Info, Calculator } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGBP(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[£,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parsePercent(raw: string): number {
  const n = parseFloat(raw.replace(/[%\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

// ─── Margin badge ─────────────────────────────────────────────────────────────

function MarginBadge({ margin }: { margin: number }) {
  if (margin >= 6) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4" />
        {margin.toFixed(2)}% mark-up — Meets 6% threshold
      </span>
    );
  }
  if (margin > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 text-red-800 px-3 py-1 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4" />
        {margin.toFixed(2)}% mark-up — Below 6% threshold
      </span>
    );
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PackagePricingCalculator() {
  const [grossInput, setGrossInput] = useState("");
  const [rateInput, setRateInput] = useState("");
  const [chargeInput, setChargeInput] = useState("");

  const gross = parseMoney(grossInput);
  const rate = parsePercent(rateInput) / 100;

  // Base calculation
  const commissionTotal = gross * rate;
  const vatOnCommission = commissionTotal * 0.2;
  const netPrice = gross - commissionTotal - vatOnCommission;

  // Minimum charge = net + 6% (net × 1.06)
  const minimumCharge = netPrice > 0 ? netPrice * 1.06 : 0;

  // Optional: agent's desired charge
  const chargeAmount = parseMoney(chargeInput);
  const hasCharge = chargeAmount > 0 && netPrice > 0;

  // Mark-up % over net = (charge - net) / net * 100
  const chargeOverNet = hasCharge ? chargeAmount - netPrice : 0;
  const actualMargin = hasCharge && netPrice > 0 ? (chargeOverNet / netPrice) * 100 : 0;

  // VAT-on-commission breakdown for the agent's actual charge
  // The mark-up the agent adds is treated as VAT-inclusive commission
  // so their gross commission = chargeOverNet, ex-VAT = chargeOverNet / 1.2
  const newCommissionExVat = hasCharge ? chargeOverNet / 1.2 : 0;
  const newVatOnCommission = hasCharge ? newCommissionExVat * 0.2 : 0;

  // For the minimum-charge scenario, show what VAT would look like
  const minChargeOverNet = netPrice > 0 ? minimumCharge - netPrice : 0;
  const minCommissionExVat = netPrice > 0 ? minChargeOverNet / 1.2 : 0;
  const minVatOnCommission = netPrice > 0 ? minCommissionExVat * 0.2 : 0;

  const baseReady = gross > 0 && rate > 0;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-[#70FFE8]/20 p-2.5">
          <Calculator className="h-6 w-6 text-[#02E6D2]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Package Pricing Calculator</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Work out your net rate and minimum charge for package holidays
          </p>
        </div>
      </div>

      {/* VAT-on-commission note */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 flex gap-3">
        <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 dark:text-amber-200 space-y-1.5">
          <p className="font-semibold">Remember — VAT on commission will reduce your take-home</p>
          <p>
            On package holidays where VAT on commission applies, HMRC requires 20% VAT to be paid on the commission you earn. This comes out of your margin — so if your mark-up equates to <strong>£200</strong>, your gross commission after VAT is deducted will be <strong>£166.67</strong> (£200 ÷ 1.2). Bear this in mind when pricing to ensure your net take-home meets expectations.
          </p>
          <p>
            The calculator below shows you this breakdown so you can price accordingly.
          </p>
        </div>
      </div>

      {/* Step 1 — Inputs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 1 — Enter the supplier details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="gross">Gross Holiday Cost (£)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  id="gross"
                  className="pl-7"
                  placeholder="e.g. 2500"
                  value={grossInput}
                  onChange={(e) => setGrossInput(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">The price shown on the supplier's trade portal or invoice</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate">Commission Rate (%)</Label>
              <div className="relative">
                <Input
                  id="rate"
                  className="pr-7"
                  placeholder="e.g. 11"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">Enter as a whole number, e.g. 11 for 11%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 2 — Base breakdown */}
      {baseReady && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Step 2 — Your net rate breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <span className="text-muted-foreground">Gross Holiday Cost</span>
              <span className="font-medium text-right">{formatGBP(gross)}</span>

              <span className="text-muted-foreground">Commission ({(rate * 100).toFixed(2)}%)</span>
              <span className="font-medium text-right text-red-600">− {formatGBP(commissionTotal)}</span>

              <span className="text-muted-foreground">VAT on Commission (20%)</span>
              <span className="font-medium text-right text-red-600">− {formatGBP(vatOnCommission)}</span>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">Net Price (what you pay the supplier)</span>
              <span className="font-bold text-lg text-foreground">{formatGBP(netPrice)}</span>
            </div>

            <div className="rounded-lg bg-[#70FFE8]/10 border border-[#70FFE8]/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-sm text-foreground">Minimum you can charge your client</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Net price + 6% — the minimum mark-up threshold</p>
                </div>
                <span className="font-bold text-xl text-[#02E6D2] ml-4 shrink-0">{formatGBP(minimumCharge)}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground border-t border-[#70FFE8]/30 pt-2 mt-1">
                <span>Mark-up over net</span>
                <span className="text-right">{formatGBP(minChargeOverNet)}</span>
                <span>Your gross commission (ex-VAT)</span>
                <span className="text-right text-emerald-700 font-medium">{formatGBP(minCommissionExVat)}</span>
                <span>VAT on commission (20%)</span>
                <span className="text-right text-red-600">{formatGBP(minVatOnCommission)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Custom charge */}
      {baseReady && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Step 3 — What do you want to charge your client?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="charge">I want to charge my client (£)</Label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  id="charge"
                  className="pl-7"
                  placeholder={baseReady ? formatGBP(minimumCharge).replace("£", "") : "e.g. 2700"}
                  value={chargeInput}
                  onChange={(e) => setChargeInput(e.target.value)}
                />
              </div>
            </div>

            {hasCharge && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <span className="text-muted-foreground">Net Price</span>
                  <span className="font-medium text-right">{formatGBP(netPrice)}</span>

                  <span className="text-muted-foreground">Mark-up over net</span>
                  <span className="font-medium text-right">{formatGBP(chargeOverNet)}</span>

                  <span className="text-muted-foreground">Your gross commission (ex-VAT)</span>
                  <span className="font-medium text-right text-emerald-700">{formatGBP(newCommissionExVat)}</span>

                  <span className="text-muted-foreground">VAT on commission (20%)</span>
                  <span className="font-medium text-right text-red-600">− {formatGBP(newVatOnCommission)}</span>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Your actual mark-up</span>
                  <MarginBadge margin={actualMargin} />
                </div>

                {actualMargin > 0 && actualMargin < 6 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-200">
                    <p className="font-semibold mb-1">Below the 6% threshold</p>
                    <p>
                      To meet the minimum, you need to charge at least{" "}
                      <strong>{formatGBP(minimumCharge)}</strong> (net + 6%).
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Footer note */}
      <p className="text-xs text-muted-foreground text-center pb-4">
        This calculator is a guide only. Always verify commission rates and pricing with your supplier confirmation. VAT on commission applies to package holidays — check with JLT if you are unsure whether it applies to your booking.
      </p>
    </div>
  );
}
