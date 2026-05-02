/**
 * Admin Recruitment Pipeline — /crm/recruitment
 * Shows all prospects in a filterable table with stage badges.
 */
import { useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, UserPlus, ExternalLink } from "lucide-react";

// ─── Stage config ─────────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  { value: "new_enquiry", label: "New Enquiry", color: "bg-blue-100 text-blue-800" },
  { value: "application_received", label: "Application Received", color: "bg-yellow-100 text-yellow-800" },
  { value: "ar_approved", label: "AR Approved", color: "bg-green-100 text-green-800" },
  { value: "ar_declined", label: "AR Declined", color: "bg-red-100 text-red-800" },
  { value: "discovery_call_booked", label: "Call Booked", color: "bg-purple-100 text-purple-800" },
  { value: "did_not_turn_up", label: "Did Not Turn Up", color: "bg-orange-100 text-orange-800" },
  { value: "discovery_call_complete", label: "Call Complete", color: "bg-teal-100 text-teal-800" },
  { value: "onboarding_approved", label: "Onboarding Approved", color: "bg-emerald-100 text-emerald-800" },
  { value: "onboarding_declined", label: "Onboarding Declined", color: "bg-rose-100 text-rose-800" },
  { value: "waitlisted", label: "Waitlisted", color: "bg-gray-100 text-gray-600" },
  { value: "archived", label: "Archived", color: "bg-gray-100 text-gray-400" },
];

export function getStageBadge(stage: string) {
  const s = PIPELINE_STAGES.find((x) => x.value === stage);
  return s ?? { value: stage, label: stage, color: "bg-gray-100 text-gray-600" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RecruitmentPipeline() {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");

  const { data: prospects = [], isLoading } = trpc.recruitment.listProspectsFiltered.useQuery(
    { stage: stageFilter === "all" ? undefined : stageFilter, search: search || undefined },
    { refetchInterval: 30_000 }
  );

  const { data: stageCounts = {} } = trpc.recruitment.stageCounts.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const totalActive = prospects.filter(
    (p) => !["archived", "ar_declined", "onboarding_declined"].includes(p.pipelineStage)
  ).length;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Recruitment Pipeline</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {totalActive} active prospect{totalActive !== 1 ? "s" : ""} across all stages
          </p>
        </div>
        <a
          href="/apply"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#02E6D2] hover:bg-[#02E6D2]/90 text-[#1a1a1a] font-semibold text-sm transition-colors"
        >
          <ExternalLink size={14} />
          View Enquiry Form
        </a>
      </div>

      {/* Stage summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {PIPELINE_STAGES.filter((s) =>
          !["ar_declined", "onboarding_declined", "archived"].includes(s.value)
        ).map((s) => (
          <button
            key={s.value}
            onClick={() => setStageFilter(stageFilter === s.value ? "all" : s.value)}
            className={`rounded-xl border p-3 text-left transition-all hover:shadow-sm ${
              stageFilter === s.value ? "ring-2 ring-[#02E6D2] border-[#02E6D2]" : "border-border"
            }`}
          >
            <div className="text-2xl font-bold text-foreground">
              {(stageCounts as Record<string, number>)[s.value] ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading prospects...</div>
        ) : prospects.length === 0 ? (
          <div className="p-12 text-center">
            <UserPlus size={40} className="mx-auto mb-3 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">No prospects found</p>
            <p className="text-muted-foreground/60 text-sm mt-1">
              {search || stageFilter !== "all"
                ? "Try adjusting your filters"
                : "Share the enquiry form to start receiving applications"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stage</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Applied</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Enquired</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => {
                const stage = getStageBadge(p.pipelineStage);
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {p.firstName} {p.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${stage.color}`}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground capitalize">
                      {p.source ?? "website"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.applicationSubmittedAt
                        ? new Date(p.applicationSubmittedAt).toLocaleDateString()
                        : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/crm/recruitment/${p.id}`}>
                        <Button variant="ghost" size="sm" className="text-xs">
                          View
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
