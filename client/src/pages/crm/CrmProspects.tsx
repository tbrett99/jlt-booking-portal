import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { Search, ArrowRight } from "lucide-react";

const STAGES = ["All","New Enquiry","AR Submitted","AR Approved","Discovery Call Booked","Approved","Rejected","Lost","Won"] as const;

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

export default function CrmProspects() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("All");

  const { data: prospects = [] } = trpc.crm.prospects.list.useQuery();

  const filtered = (prospects as any[]).filter((p) => {
    const matchSearch = !search || `${p.firstName} ${p.lastName} ${p.email}`.toLowerCase().includes(search.toLowerCase());
    const matchStage = stageFilter === "All" || p.stage === stageFilter;
    return matchSearch && matchStage;
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold">All Prospects</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} of {(prospects as any[]).length}</p>
        </div>
        <div className="flex gap-2 sm:ml-auto flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 h-8 w-52 text-sm" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Phone</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Stage</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Tags</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Agent ID</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">Added</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No prospects found.</td></tr>
            ) : filtered.map((p: any) => (
              <tr key={p.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/crm/prospects/${p.id}`)}>
                <td className="px-4 py-3 font-medium">{p.firstName} {p.lastName}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.email}</td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{p.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stageColor[p.stage] ?? "bg-gray-100 text-gray-600"}`}>{p.stage}</span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {(p.tags ?? []).slice(0, 3).map((t: string) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-medium">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell font-mono text-xs text-muted-foreground">{p.uniqueAgentId ?? "—"}</td>
                <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{new Date(p.createdAt).toLocaleDateString("en-GB")}</td>
                <td className="px-4 py-3"><ArrowRight size={14} className="text-muted-foreground" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
