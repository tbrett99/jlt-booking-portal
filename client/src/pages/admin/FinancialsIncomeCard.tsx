import { PoundSterling } from "lucide-react";
import type { FinancialsIncome } from "@shared/financials-income";
import { Card, CardContent } from "@/components/ui/card";

const sourceNote = "20% VAT deducted from GoCardless only; commission share unchanged. Recorded GoCardless paid-out income and PTS remittance share by batch date. Before fees/refunds/chargebacks; not profit or a bank reconciliation.";

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMinor(minor: number): string {
  return money.format(minor / 100);
}

export default function FinancialsIncomeCard({
  income,
  periodLabel,
}: {
  income?: FinancialsIncome | null;
  periodLabel: "This Week" | "This Month";
}) {
  // Missing or incomplete evidence must never be presented as zero income.
  const available = income?.available === true && [
    income.gcGrossMinor,
    income.gcVatMinor,
    income.gcExVatMinor,
    income.commissionMinor,
    income.grossIncomeMinor,
    income.incomeAfterVatMinor,
  ].every(value => typeof value === "number" && Number.isSafeInteger(value)) &&
    income.gcGrossMinor! >= 0 && income.gcVatMinor! >= 0 && income.gcExVatMinor! >= 0 &&
    income.gcGrossMinor! - income.gcVatMinor! === income.gcExVatMinor &&
    income.gcGrossMinor! + income.commissionMinor! === income.grossIncomeMinor &&
    income.gcExVatMinor! + income.commissionMinor! === income.incomeAfterVatMinor;

  return (
    <Card className="border-l-4 border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Income after VAT · {periodLabel}</p>
            {available && income ? (
              <>
                <p className="text-3xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">{fmtMinor(income.incomeAfterVatMinor!)}</p>
                <dl className="mt-3 space-y-1 text-xs text-muted-foreground max-w-xl">
                  <div className="flex justify-between gap-4">
                    <dt>Gross recorded income</dt>
                    <dd className="font-semibold whitespace-nowrap">{fmtMinor(income.grossIncomeMinor!)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>GoCardless paid out (gross)</dt>
                    <dd className="font-semibold whitespace-nowrap">{fmtMinor(income.gcGrossMinor!)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>GoCardless VAT deduction (20%)</dt>
                    <dd className="font-semibold whitespace-nowrap">{income.gcVatMinor! > 0 ? "-" : ""}{fmtMinor(income.gcVatMinor!)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>GoCardless income excluding VAT</dt>
                    <dd className="font-semibold whitespace-nowrap">{fmtMinor(income.gcExVatMinor!)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>JLT commission share (no VAT deducted)</dt>
                    <dd className="font-semibold whitespace-nowrap">{fmtMinor(income.commissionMinor!)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <p className="text-xl font-bold mt-1 text-foreground">Income after VAT unavailable</p>
                <p className="mt-1 text-xs text-muted-foreground">Recorded income cannot be reliably calculated for this period.</p>
              </>
            )}
          </div>
          <div className="shrink-0 w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
            <PoundSterling size={22} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{sourceNote}</p>
      </CardContent>
    </Card>
  );
}
