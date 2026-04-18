import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, CheckCheck, ChevronRight, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function AgentNotifications() {
  const utils = trpc.useUtils();
  const { data: notifications = [], isLoading } = trpc.notifications.myNotifications.useQuery();
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.myNotifications.invalidate();
      utils.notifications.unreadCount.invalidate();
      toast.success("All notifications marked as read");
    },
  });

  const unread = notifications.filter((n) => !n.isRead);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Notifications</h1>
          {unread.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {unread.length} unread
            </p>
          )}
        </div>
        {unread.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-sm"
            onClick={() => markRead.mutate()}
            disabled={markRead.isPending}
          >
            <CheckCheck size={15} />
            Mark all read
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-4 pb-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell size={36} className="mx-auto text-muted-foreground opacity-30 mb-3" />
              <p className="font-medium text-foreground">No notifications yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                You'll be notified here when there are updates to your bookings.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 py-3 px-1 ${!n.isRead ? "bg-[#FFF6ED]/60" : ""}`}
                >
                  <div
                    className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!n.isRead ? "bg-[#02E6D2]" : "bg-transparent"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${!n.isRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                      {n.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {format(new Date(n.createdAt), "dd MMM yyyy, HH:mm")}
                    </p>
                  </div>
                  {(n.bookingId || n.linkUrl) && (
                    <Link href={n.linkUrl ?? `/bookings/${n.bookingId}`}>
                      <button className="flex items-center gap-1 text-xs font-semibold flex-shrink-0 mt-0.5" style={{ color: '#02E6D2' }}>
                        View <ChevronRight size={13} />
                      </button>
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
