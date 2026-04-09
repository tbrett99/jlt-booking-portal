import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "wouter";
import { User, Calendar, ArrowRight } from "lucide-react";
import { useState } from "react";

const STAGES = ["To Do", "In Progress", "Actioned"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_COLORS: Record<Stage, string> = {
  "To Do": "bg-amber-100 text-amber-800 border-amber-300",
  "In Progress": "bg-blue-100 text-blue-800 border-blue-300",
  "Actioned": "bg-emerald-100 text-emerald-800 border-emerald-300",
};

export default function AdminAmendmentKanban() {
  const { data: amendments, refetch } = trpc.amendments.all.useQuery();
  const { data: adminUsers = [] } = trpc.users.listAdmins.useQuery();
  const updatePipeline = trpc.amendments.updatePipeline.useMutation({
    onSuccess: () => { refetch(); toast.success("Amendment updated"); },
    onError: (e) => toast.error(e.message),
  });

  const byStage = (stage: Stage) =>
    (amendments ?? []).filter((a) => (a.pipelineStage ?? "To Do") === stage);

  const moveStage = (amendmentId: number, stage: Stage) => {
    updatePipeline.mutate({ amendmentId, pipelineStage: stage });
  };

  const assignTo = (amendmentId: number, userId: number | null) => {
    updatePipeline.mutate({ amendmentId, assignedToId: userId });
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Amendment Pipeline</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage and track all amendment requests across stages</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {STAGES.map((stage) => (
          <div key={stage} className="space-y-3">
            <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${STAGE_COLORS[stage]}`}>
              <span className="font-semibold text-sm">{stage}</span>
              <Badge variant="outline" className="text-xs">{byStage(stage).length}</Badge>
            </div>

            {byStage(stage).map((amendment) => (
              <AmendmentCard
                key={amendment.id}
                amendment={amendment}
                stage={stage}
                stages={STAGES}
                adminUsers={adminUsers}
                onMoveStage={moveStage}
                onAssign={assignTo}
              />
            ))}

            {byStage(stage).length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                No amendments
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AmendmentCard({
  amendment,
  stage,
  stages,
  adminUsers,
  onMoveStage,
  onAssign,
}: {
  amendment: any;
  stage: Stage;
  stages: readonly Stage[];
  adminUsers: any[];
  onMoveStage: (id: number, stage: Stage) => void;
  onAssign: (id: number, userId: number | null) => void;
}) {
  const [showMove, setShowMove] = useState(false);
  const assignedUser = adminUsers.find((u) => u.id === amendment.assignedToId);
  const currentIdx = stages.indexOf(stage);

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-[#70FFE8]">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/bookings/${amendment.bookingId}`}>
              <span className="font-semibold text-sm text-foreground hover:text-[#02E6D2] cursor-pointer block truncate">
                {amendment.clientName ?? `Booking #${amendment.bookingId}`}
              </span>
            </Link>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
              {amendment.ptsRef && (
                <span className="text-xs text-muted-foreground">PTS: {amendment.ptsRef}</span>
              )}
              {amendment.topdogRef && (
                <span className="text-xs text-muted-foreground">TD: {amendment.topdogRef}</span>
              )}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(amendment.createdAt).toLocaleDateString("en-GB")}
              </span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">#{amendment.id}</Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        <p className="text-sm text-foreground line-clamp-3 bg-muted/50 rounded p-2">{amendment.details}</p>

        {/* Assignee */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <User className="w-3 h-3" /> Assigned to
          </label>
          <Select
            value={amendment.assignedToId ? String(amendment.assignedToId) : "unassigned"}
            onValueChange={(val) => onAssign(amendment.id, val === "unassigned" ? null : Number(val))}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Unassigned" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {adminUsers.map((u) => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stage movement */}
        <div className="flex gap-1 flex-wrap">
          {stages.filter((s) => s !== stage).map((s) => (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => onMoveStage(amendment.id, s)}
            >
              <ArrowRight className="w-3 h-3 mr-1" />
              {s}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
