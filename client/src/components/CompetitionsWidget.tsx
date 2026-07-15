import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Ticket, ChevronRight, Clock } from "lucide-react";

function daysRemaining(endDate: Date | string) {
  const diff = new Date(endDate).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function CompetitionsWidget() {
  const { data: summary, isLoading } = trpc.competitions.myTicketSummary.useQuery();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" /> Competitions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!summary || summary.length === 0) {
    return null; // Don't show widget if no active competitions
  }

  return (
    <Card className="border-amber-200/60 bg-gradient-to-br from-amber-50/40 to-background">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" /> Active Competitions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {summary.map(({ competition, tickets }) => {
          const days = daysRemaining(competition.endDate);
          return (
            <div key={competition.id} className="space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{competition.title}</p>
                  <p className="text-xs text-amber-600 font-medium">{competition.prizeDescription}</p>
                </div>
                {days > 0 && (
                  <Badge variant="outline" className="text-xs shrink-0 gap-1 border-amber-200 text-amber-700">
                    <Clock className="w-2.5 h-2.5" />
                    {days}d left
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Ticket className="w-3 h-3 text-emerald-500" />
                  <span className="font-semibold text-foreground">{tickets}</span> ticket{tickets !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          );
        })}
        <Link href="/competitions">
          <Button variant="outline" size="sm" className="w-full gap-1 mt-1 text-xs h-8">
            View Leaderboard <ChevronRight className="w-3 h-3" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
