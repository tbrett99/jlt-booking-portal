import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format, subMonths } from "date-fns";
import { Users, TrendingUp, Award, Search } from "lucide-react";

export default function AdminAgentPerformance() {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"bookings" | "commission" | "name">("bookings");

  const { data: bookings = [], isLoading } = trpc.bookings.all.useQuery(undefined, { staleTime: 120000 });
  const { data: agents = [] } = trpc.users.listAgents.useQuery(undefined, { staleTime: 120000 });

  const agentStats = useMemo(() => {
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const last30 = subMonths(now, 1);

    const map: Record<number, {
      id: number;
      name: string;
      email: string;
      totalBookings: number;
      activeBookings: number;
      cancelledBookings: number;
      thisMonthBookings: number;
      totalCommission: number;
      paidCommission: number;
      pendingCommission: number;
      lastBookingDate: Date | null;
    }> = {};

    for (const agent of agents) {
      map[agent.id] = {
        id: agent.id,
        name: agent.name ?? "Unknown",
        email: agent.email ?? "",
        totalBookings: 0,
        activeBookings: 0,
        cancelledBookings: 0,
        thisMonthBookings: 0,
        totalCommission: 0,
        paidCommission: 0,
        pendingCommission: 0,
        lastBookingDate: null,
      };
    }

    for (const b of bookings) {
      const agentId = (b as any).agentId;
      if (!map[agentId]) continue;
      const stat = map[agentId];
      stat.totalBookings += 1;
      if (b.currentStage === "Cancelled") {
        stat.cancelledBookings += 1;
      } else {
        stat.activeBookings += 1;
      }
      const created = new Date(b.createdAt);
      if (created.getMonth() === thisMonth && created.getFullYear() === thisYear) {
        stat.thisMonthBookings += 1;
      }
      const commission = Number(b.expectedCommission ?? 0);
      stat.totalCommission += commission;
      if (b.currentStage === "Commission Claimed") {
        stat.paidCommission += commission;
      } else if (b.currentStage !== "Cancelled") {
        // Count all non-cancelled, non-paid bookings as pending commission
        stat.pendingCommission += commission;
      }
      if (!stat.lastBookingDate || created > stat.lastBookingDate) {
        stat.lastBookingDate = created;
      }
    }

    return Object.values(map);
  }, [bookings, agents]);

  const filtered = agentStats
    .filter((a) => !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "bookings") return b.totalBookings - a.totalBookings;
      if (sortBy === "commission") return b.totalCommission - a.totalCommission;
      return a.name.localeCompare(b.name);
    });

  const totalBookings = agentStats.reduce((s, a) => s + a.totalBookings, 0);
  const totalCommission = agentStats.reduce((s, a) => s + a.totalCommission, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Performance</h1>
        <p className="text-sm text-muted-foreground">Overview of all agent activity and commission</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Agents", value: agents.length, icon: Users, color: "#FFC3BC" },
          { label: "Total Bookings", value: totalBookings, icon: TrendingUp, color: "#70FFE8" },
          { label: "Total Commission", value: `£${totalCommission.toFixed(0)}`, icon: Award, color: "#d1fae5" },
          { label: "Avg per Agent", value: agents.length ? `£${(totalCommission / agents.length).toFixed(0)}` : "—", icon: Award, color: "#e0e7ff" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color }}>
                <Icon size={16} style={{ color: "#414141" }} />
              </div>
              <div>
                <p className="text-xl font-bold leading-none">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Agent table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <CardTitle className="text-base">Agent Breakdown</CardTitle>
            <div className="sm:ml-auto flex items-center gap-2">
              <div className="relative w-52">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <select
                className="h-8 text-xs border rounded px-2 bg-background"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              >
                <option value="bookings">Sort: Most bookings</option>
                <option value="commission">Sort: Most commission</option>
                <option value="name">Sort: Name A–Z</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: '#70FFE8' }} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-semibold text-muted-foreground">Agent</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-right">Total</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-right">Active</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-right hidden sm:table-cell">This Month</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-right hidden md:table-cell">Commission</th>
                    <th className="pb-3 font-semibold text-muted-foreground text-right hidden lg:table-cell">Claimable</th>
                    <th className="pb-3 font-semibold text-muted-foreground hidden xl:table-cell">Last Booking</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((a, idx) => (
                    <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          {idx < 3 && a.totalBookings > 0 && (
                            <span className="text-sm">{["🥇","🥈","🥉"][idx]}</span>
                          )}
                          <div>
                            <p className="font-medium">{a.name}</p>
                            <p className="text-xs text-muted-foreground">{a.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right font-semibold">{a.totalBookings}</td>
                      <td className="py-3 text-right">
                        <Badge variant="outline" className="text-xs">{a.activeBookings}</Badge>
                      </td>
                      <td className="py-3 text-right hidden sm:table-cell">
                        {a.thisMonthBookings > 0 ? (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ background: '#d1fae5', color: '#065f46' }}>
                            +{a.thisMonthBookings}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right hidden md:table-cell font-medium">
                        {a.totalCommission > 0 ? `£${a.totalCommission.toFixed(0)}` : "—"}
                      </td>
                      <td className="py-3 text-right hidden lg:table-cell">
                        {a.pendingCommission > 0 ? (
                          <span className="text-xs font-medium" style={{ color: '#02E6D2' }}>£{a.pendingCommission.toFixed(0)}</span>
                        ) : "—"}
                      </td>
                      <td className="py-3 text-xs text-muted-foreground hidden xl:table-cell">
                        {a.lastBookingDate ? format(a.lastBookingDate, "dd MMM yyyy") : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <p className="text-center py-8 text-muted-foreground">No agents found</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
