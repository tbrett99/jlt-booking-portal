import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { policyTabLink } from "@shared/policy-navigation";

export default function CurrentAgencyTermsNotice() {
  return (
    <div className="space-y-3" aria-label="Current agency terms">
      <p className="text-sm text-muted-foreground">
        Your membership is governed by the latest JLT Agent Terms &amp;
        Conditions, issued in May 2026. You can read these below.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href={policyTabLink("terms")}>
          Read Agent Terms &amp; Conditions
        </Link>
      </Button>
    </div>
  );
}
