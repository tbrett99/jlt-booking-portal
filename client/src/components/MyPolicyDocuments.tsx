import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, LockKeyhole, ArrowRight, BookOpen } from "lucide-react";
import { policyTabLink, type PolicyTab } from "@shared/policy-navigation";

const documents: {
  tab: PolicyTab;
  title: string;
  description: string;
  action: string;
  icon: typeof FileText;
}[] = [
  {
    tab: "terms",
    title: "Full Agent Terms & Conditions",
    description: "The current published membership terms and conditions.",
    action: "Read Full Agent Terms",
    icon: FileText,
  },
  {
    tab: "conduct",
    title: "Agent Code of Conduct",
    description:
      "Professional standards, client care and your responsibilities as a JLT agent.",
    action: "Read Code of Conduct",
    icon: FileText,
  },
  {
    tab: "privacy",
    title: "Privacy Policy",
    description:
      "How JLT handles personal information and the rights available to you.",
    action: "Read Privacy Policy",
    icon: LockKeyhole,
  },
  {
    tab: "appendices",
    title: "Policy Appendices",
    description: "Supporting schedules, operational policies and guidance.",
    action: "Read Policy Appendices",
    icon: BookOpen,
  },
];

export default function MyPolicyDocuments() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Current policy documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Read the current published policies. These are separate from your
          personal signed agency agreement and signing history below.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map(({ tab, title, description, action, icon: Icon }) => (
            <div key={tab} className="space-y-2 rounded-lg border p-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Icon size={15} /> {title}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
              <Button asChild size="sm" variant="outline" className="gap-2">
                <Link href={policyTabLink(tab)}>
                  {action} <ArrowRight size={13} />
                </Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Opening these documents does not create a new signature or
          acknowledgement record.
        </p>
      </CardContent>
    </Card>
  );
}
