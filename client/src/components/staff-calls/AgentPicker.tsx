import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { control, Field, QueryState, type Agent } from "./CallUI";

export default function AgentPicker({
  selected,
  onChange,
  initialAgentId,
  disabled = false,
}: {
  selected: Agent[];
  onChange: (agents: Agent[]) => void;
  initialAgentId?: number;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<number | undefined>();
  const [lookupId, setLookupId] = useState(initialAgentId);
  const [missing, setMissing] = useState(false);
  const input = useMemo(
    () => ({ query: lookupId ? "" : query, cursor, limit: 50 }),
    [query, cursor, lookupId]
  );
  const agents = trpc.staffCalls.agents.useQuery(input, {
    retry: false,
    enabled: !disabled,
  });
  useEffect(() => {
    if (!lookupId || !agents.data || agents.error || agents.isFetching) return;
    const exact = agents.data.items.find(agent => agent.id === lookupId);
    if (exact) {
      if (!selected.some(agent => agent.id === exact.id))
        onChange([...selected, exact]);
      setLookupId(undefined);
      setCursor(undefined);
    } else if (agents.data.nextCursor !== null)
      setCursor(agents.data.nextCursor);
    else {
      setLookupId(undefined);
      setMissing(true);
      setCursor(undefined);
    }
  }, [
    lookupId,
    agents.data,
    agents.error,
    agents.isFetching,
    selected,
    onChange,
  ]);
  return (
    <section className="space-y-3">
      <Field label="Search exact Portal agents">
        <input
          className={control}
          value={query}
          disabled={disabled || !!lookupId}
          maxLength={100}
          onChange={event => {
            setQuery(event.target.value);
            setCursor(undefined);
          }}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        Select existing active Portal records explicitly. A typed name or email
        is never an attendee.
      </p>
      {lookupId && (
        <p role="status" className="text-sm">
          Checking the linked Portal agent #{lookupId} against permitted
          records…
        </p>
      )}
      {missing && (
        <p role="alert" className="text-sm text-amber-800">
          The linked agent is not available in your permitted active records.
          Select another exact record.
        </p>
      )}
      <div aria-label="Selected agents" className="flex flex-wrap gap-2">
        {selected.map(agent => (
          <Button
            type="button"
            key={agent.id}
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange(selected.filter(item => item.id !== agent.id))
            }
          >
            Remove {agent.name || "Agent"} · #{agent.id}
          </Button>
        ))}
      </div>
      {!disabled && (
        <QueryState query={agents}>
          <div className="max-h-48 space-y-2 overflow-auto rounded-lg border p-3">
            {agents.data?.items.map(agent => (
              <label className="flex items-center gap-2 text-sm" key={agent.id}>
                <input
                  type="checkbox"
                  checked={selected.some(item => item.id === agent.id)}
                  disabled={disabled || !!lookupId}
                  onChange={event =>
                    onChange(
                      event.target.checked
                        ? [...selected, agent]
                        : selected.filter(item => item.id !== agent.id)
                    )
                  }
                />
                {agent.name || "Agent"} · #{agent.id}
              </label>
            ))}
            {!agents.data?.items.length && (
              <p className="text-sm">No matching active Portal agents.</p>
            )}
          </div>
          {agents.data?.nextCursor !== null &&
            agents.data?.nextCursor !== undefined &&
            !lookupId && (
              <Button
                type="button"
                className="mt-2"
                variant="outline"
                onClick={() => setCursor(agents.data!.nextCursor!)}
              >
                Next agents
              </Button>
            )}
          {cursor !== undefined && !lookupId && (
            <Button
              type="button"
              className="mt-2 ml-2"
              variant="ghost"
              onClick={() => setCursor(undefined)}
            >
              First agents
            </Button>
          )}
        </QueryState>
      )}
    </section>
  );
}
