import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { policyTabLink } from "@shared/policy-navigation";

export default function CurrentAgencyTermsNotice() {
  return (
    <div className="space-y-3" aria-label="Current agency terms">
      <p className="text-sm text-muted-foreground">
        The current JLT Agent Terms &amp; Conditions are available to read below.
        Publication does not automatically replace your existing agreement, and
        reading these terms does not record acceptance.
      </p>
      <Button asChild size="sm" variant="outline">
        <Link href={policyTabLink("terms")}>
          Read Agent Terms &amp; Conditions
        </Link>
      </Button>
    </div>
  );
}
