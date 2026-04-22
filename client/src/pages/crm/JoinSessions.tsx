/**
 * JoinSessions — Admin page for managing self-sign-up applications and agent teams.
 *
 * Shows:
 *  - Join Sessions tab: all sign-up applications with status, tier, contract signed, payment status
 *  - Teams tab: Duo/Trio teams with members and invite status
 */

import React, { useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, FileSignature, CreditCard, CheckCircle2, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { TIER_LABELS, TYPE_LABELS } from "../../../../shared/membership";

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "plan" | "contract" | "payment" | "complete";

const STEP_LABELS: Record<Step, string> = {
  plan: "Plan Selection",
  contract: "Contract Signing",
  payment: "Payment",
  complete: "Complete",
};

const STEP_COLORS: Record<Step, string> = {
  plan: "bg-gray-100 text-gray-600",
  contract: "bg-amber-100 text-amber-700",
  payment: "bg-blue-100 text-blue-700",
  complete: "bg-green-100 text-green-700",
};

function StepBadge({ step }: { step: string }) {
  const s = step as Step;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STEP_COLORS[s] ?? "bg-gray-100 text-gray-600"}`}>
      {s === "complete" && <CheckCircle2 size={11} />}
      {s === "payment" && <CreditCard size={11} />}
      {s === "contract" && <FileSignature size={11} />}
      {s === "plan" && <Clock size={11} />}
      {STEP_LABELS[s] ?? s}
    </span>
  );
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function SessionsTab() {
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "contract" | "payment" | "complete">("all");
  const [search, setSearch] = useState("");

  const { data: sessions, isLoading, refetch } = trpc.join.adminListSessions.useQuery({
    status: statusFilter,
    limit: 100,
    offset: 0,
  });

  const filtered = (sessions ?? []).filter((s) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.email.toLowerCase().includes(q) ||
      (s.signerName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Plan Selection</SelectItem>
            <SelectItem value="contract">Contract Signing</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="complete">Complete</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw size={14} /> Refresh
        </Button>
        <span className="text-sm text-gray-500 ml-auto">{filtered.length} session{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="animate-spin text-[#70FFE8]" size={28} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <AlertCircle size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No sign-up sessions found</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Email / Name</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Contract</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((session) => (
                <TableRow key={session.id} className="hover:bg-gray-50">
                  <TableCell>
                    <div className="font-medium text-[#414141] text-sm">{session.email}</div>
                    {session.signerName && (
                      <div className="text-xs text-gray-400">{session.signerName}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.membershipTier ? (
                      <div>
                        <div className="text-xs font-medium text-[#414141]">
                          {TIER_LABELS[session.membershipTier as keyof typeof TIER_LABELS] ?? session.membershipTier}
                        </div>
                        {session.membershipType && (
                          <div className="text-xs text-gray-400">
                            {TYPE_LABELS[session.membershipType as keyof typeof TYPE_LABELS] ?? session.membershipType}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StepBadge step={session.step} />
                  </TableCell>
                  <TableCell>
                    {session.contractSignedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 size={12} />
                        {new Date(session.contractSignedAt).toLocaleDateString("en-GB")}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not signed</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.joiningFeePaidAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 size={12} />
                        {new Date(session.joiningFeePaidAt).toLocaleDateString("en-GB")}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not paid</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {session.userId ? (
                      <span className="text-xs font-mono text-[#414141]">#{session.userId}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-400">
                      {new Date(session.createdAt).toLocaleDateString("en-GB")}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── Teams Tab ────────────────────────────────────────────────────────────────

function TeamsTab() {
  const { data: teams, isLoading, refetch } = trpc.join.adminListTeams.useQuery();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{(teams ?? []).length} team{(teams ?? []).length !== 1 ? "s" : ""}</span>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1">
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="animate-spin text-[#70FFE8]" size={28} />
        </div>
      ) : (teams ?? []).length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">No teams yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {(teams ?? []).map((team) => (
            <Card key={team.id} className="border border-gray-200">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base text-[#414141]">{team.name}</CardTitle>
                    <div className="flex gap-2 mt-1">
                      {team.membershipTier && (
                        <Badge variant="outline" className="text-xs">
                          {TIER_LABELS[team.membershipTier as keyof typeof TIER_LABELS] ?? team.membershipTier}
                        </Badge>
                      )}
                      {team.monthlySub && (
                        <Badge variant="outline" className="text-xs text-green-600 border-green-200">
                          £{team.monthlySub}/mo
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-[#414141]">{team.memberCount} member{team.memberCount !== 1 ? "s" : ""}</div>
                    <div className="text-xs text-gray-400">Team #{team.id}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {team.notes && (
                  <p className="text-xs text-gray-500 mb-3">{team.notes}</p>
                )}
                {team.invites && team.invites.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">Invites</p>
                    <div className="space-y-1">
                      {team.invites.map((invite) => (
                        <div key={invite.id} className="flex items-center justify-between text-xs">
                          <span className="text-[#414141]">{invite.invitedEmail}</span>
                          <span className={`px-2 py-0.5 rounded-full font-medium ${
                            invite.status === "accepted"
                              ? "bg-green-100 text-green-700"
                              : invite.status === "expired"
                              ? "bg-red-100 text-red-600"
                              : "bg-amber-100 text-amber-700"
                          }`}>
                            {invite.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  Created {new Date(team.createdAt).toLocaleDateString("en-GB")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Summary Stats ────────────────────────────────────────────────────────────

function SummaryStats() {
  const { data: allSessions } = trpc.join.adminListSessions.useQuery({ status: "all", limit: 200, offset: 0 });

  const stats = React.useMemo(() => {
    if (!allSessions) return null;
    return {
      total: allSessions.length,
      complete: allSessions.filter((s) => s.step === "complete").length,
      pending: allSessions.filter((s) => s.step !== "complete").length,
      contractSigned: allSessions.filter((s) => s.contractSignedAt).length,
      paid: allSessions.filter((s) => s.joiningFeePaidAt).length,
    };
  }, [allSessions]);

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
      {[
        { label: "Total Applications", value: stats.total, icon: <Users size={16} /> },
        { label: "Complete", value: stats.complete, icon: <CheckCircle2 size={16} className="text-green-500" /> },
        { label: "In Progress", value: stats.pending, icon: <Clock size={16} className="text-amber-500" /> },
        { label: "Contract Signed", value: stats.contractSigned, icon: <FileSignature size={16} className="text-blue-500" /> },
        { label: "Joining Fee Paid", value: stats.paid, icon: <CreditCard size={16} className="text-purple-500" /> },
      ].map((stat) => (
        <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-gray-500 text-xs">{stat.icon} {stat.label}</div>
          <div className="text-2xl font-bold text-[#414141]">{stat.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JoinSessions() {
  const [activeTab, setActiveTab] = useState<"sessions" | "teams">("sessions");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#414141]">Sign-Up Applications</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage self-service sign-up sessions and agent teams
        </p>
      </div>

      <SummaryStats />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(["sessions", "teams"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? "border-[#70FFE8] text-[#414141]"
                : "border-transparent text-gray-500 hover:text-[#414141]"
            }`}
          >
            {tab === "sessions" ? "Applications" : "Teams"}
          </button>
        ))}
      </div>

      {activeTab === "sessions" ? <SessionsTab /> : <TeamsTab />}
    </div>
  );
}
