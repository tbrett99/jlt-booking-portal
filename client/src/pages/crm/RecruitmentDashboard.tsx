/**
 * Recruitment Performance Dashboard
 * /crm/recruitment/dashboard
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { ArrowLeft, Users, TrendingUp, Trophy, Target, Clock } from "lucide-react";

// ─── Date range helpers ────────────────────────────────────────────────────────

const DATE_RANGES = [
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "Last 180 days", value: "180" },
  { label: "Last 365 days", value: "365" },
  { label: "All time", value: "all" },
];

function getDateFrom(range: string): Date | undefined {
  if (range === "all") return undefined;
  const d = new Date();
  d.setDate(d.getDate() - Number(range));
  return d;
}

// ─── Colour palette ────────────────────────────────────────────────────────────

const CHART_COLOURS = [
  "#70FFE8", "#02E6D2", "#FFC3BC", "#FF8B80", "#a78bfa",
  "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#c084fc",
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
            <p className="text-3xl font-bold mt-1" style={accent ? { color: accent } : {}}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon size={18} className="text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Conversion funnel row ────────────────────────────────────────────────────

function ConversionRow({
  label,
  rate,
  from,
  to,
}: {
  label: string;
  rate: number;
  from: string;
  to: string;
}) {
  const colour = rate >= 60 ? "#02E6D2" : rate >= 30 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{from} → {to}</p>
      </div>
      <div className="flex items-center gap-2 w-40">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${rate}%`, background: colour }}
          />
        </div>
        <span className="text-sm font-bold w-10 text-right" style={{ color: colour }}>
          {rate}%
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RecruitmentDashboard() {
  const [range, setRange] = useState("all");
  const dateFrom = useMemo(() => getDateFrom(range), [range]);

  const { data, isLoading } = trpc.recruitment.analytics.useQuery(
    { dateFrom },
    { staleTime: 60_000 }
  );

  // Trim weekly volume to last N weeks based on range
  const weeklyData = useMemo(() => {
    if (!data) return [];
    const weeks = range === "all" ? 52 : Math.ceil(Number(range) / 7);
    return data.weeklyVolume.slice(-weeks);
  }, [data, range]);

  // Stage funnel — only the key funnel stages, exclude declined/archived
  const funnelData = useMemo(() => {
    if (!data) return [];
    return data.stageFunnel.filter((s) =>
      ["new_enquiry", "application_received", "ar_approved",
       "discovery_call_booked", "discovery_call_complete",
       "onboarding_approved", "won"].includes(s.stage)
    );
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading analytics…
      </div>
    );
  }

  if (!data) return null;

  const cr = data.conversionRates;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/crm/recruitment">
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ArrowLeft size={14} />
              Pipeline
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Recruitment Performance</h1>
            <p className="text-sm text-muted-foreground">Lead source, conversion, and volume analytics</p>
          </div>
        </div>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Total Prospects"
          value={data.totalProspects.toLocaleString()}
          icon={Users}
          sub="in selected period"
        />
        <KpiCard
          title="Applications"
          value={data.totalApplications.toLocaleString()}
          icon={Target}
          sub={`${cr.enquiryToApplication}% of enquiries`}
          accent="#02E6D2"
        />
        <KpiCard
          title="Won"
          value={data.totalWon.toLocaleString()}
          icon={Trophy}
          sub={`${data.overallConversionRate}% overall rate`}
          accent="#70FFE8"
        />
        <KpiCard
          title="Overall Conversion"
          value={`${data.overallConversionRate}%`}
          icon={TrendingUp}
          sub="enquiry → won"
          accent={data.overallConversionRate >= 10 ? "#02E6D2" : "#fbbf24"}
        />
      </div>

      {/* Row 1: Source breakdown + Stage funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead source bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead Sources</CardTitle>
            <p className="text-xs text-muted-foreground">Where prospects heard about JLT Group</p>
          </CardHeader>
          <CardContent>
            {data.sourceBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No source data yet</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.sourceBreakdown.slice(0, 10)}
                  layout="vertical"
                  margin={{ left: 8, right: 40, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="source"
                    tick={{ fontSize: 11 }}
                    width={90}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, name) => [value, name === "count" ? "Prospects" : "Won"]}
                  />
                  <Bar dataKey="count" name="count" radius={[0, 4, 4, 0]}>
                    {data.sourceBreakdown.slice(0, 10).map((_, i) => (
                      <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Stage funnel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pipeline Funnel</CardTitle>
            <p className="text-xs text-muted-foreground">Current prospects at each stage</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={funnelData}
                margin={{ left: 8, right: 16, top: 4, bottom: 40 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value) => [value, "Prospects"]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {funnelData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Weekly volume */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">New Enquiries Over Time</CardTitle>
          <p className="text-xs text-muted-foreground">Weekly volume of new prospects entering the pipeline</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={weeklyData} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 10 }}
                tickFormatter={(w) => w.replace(/^\d{4}-/, "")}
                interval={Math.floor(weeklyData.length / 8)}
              />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => [value, "New enquiries"]}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#70FFE8"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#70FFE8" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Row 3: Conversion rates + Source conversion table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stage-to-stage conversion rates */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stage Conversion Rates</CardTitle>
            <p className="text-xs text-muted-foreground">How many prospects advance at each step</p>
          </CardHeader>
          <CardContent className="pt-2">
            <ConversionRow
              label="Enquiry → Application"
              rate={cr.enquiryToApplication}
              from="New Enquiry"
              to="Application Received"
            />
            <ConversionRow
              label="Application → AR Approved"
              rate={cr.applicationToArApproved}
              from="Application"
              to="AR Approved"
            />
            <ConversionRow
              label="AR Approved → Call Booked"
              rate={cr.arApprovedToCallBooked}
              from="AR Approved"
              to="Call Booked"
            />
            <ConversionRow
              label="Call Booked → Call Complete"
              rate={cr.callBookedToCallComplete}
              from="Call Booked"
              to="Call Complete"
            />
            <ConversionRow
              label="Call Complete → Onboarding"
              rate={cr.callCompleteToOnboardingApproved}
              from="Call Complete"
              to="Onboarding Approved"
            />
            <ConversionRow
              label="Onboarding → Won"
              rate={cr.onboardingApprovedToWon}
              from="Onboarding Approved"
              to="Won"
            />
            <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
              <span className="text-sm font-semibold">Overall (Enquiry → Won)</span>
              <span
                className="text-lg font-bold"
                style={{ color: cr.overallEnquiryToWon >= 10 ? "#02E6D2" : "#fbbf24" }}
              >
                {cr.overallEnquiryToWon}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Source conversion table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversion by Source</CardTitle>
            <p className="text-xs text-muted-foreground">Which channels produce the most wins</p>
          </CardHeader>
          <CardContent className="pt-2">
            {data.sourceBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No source data yet</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left py-2 font-medium">Source</th>
                      <th className="text-right py-2 font-medium">Prospects</th>
                      <th className="text-right py-2 font-medium">Won</th>
                      <th className="text-right py-2 font-medium">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sourceBreakdown.map((s) => (
                      <tr key={s.source} className="border-b border-border/50 last:border-0">
                        <td className="py-2 font-medium">{s.source}</td>
                        <td className="py-2 text-right text-muted-foreground">{s.count}</td>
                        <td className="py-2 text-right text-muted-foreground">{s.wonCount}</td>
                        <td className="py-2 text-right">
                          <span
                            className="font-bold"
                            style={{
                              color: s.conversionRate >= 10
                                ? "#02E6D2"
                                : s.conversionRate >= 5
                                ? "#fbbf24"
                                : "hsl(var(--muted-foreground))",
                            }}
                          >
                            {s.conversionRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 4: Average time in stage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock size={16} />
            Average Time in Stage
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Average days prospects spend at each stage before moving on (based on stage history)
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={data.avgDaysInStage}
              margin={{ left: 8, right: 16, top: 4, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis tick={{ fontSize: 11 }} unit=" d" />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value) => [`${value} days`, "Avg. time"]}
              />
              <Bar dataKey="avgDays" radius={[4, 4, 0, 0]}>
                {data.avgDaysInStage.map((_, i) => (
                  <Cell key={i} fill={CHART_COLOURS[i % CHART_COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
