import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Search, X } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { useDebounce } from "@/hooks/useDebounce";

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const debouncedQuery = useDebounce(query, 300);

  const { data: results = [], isFetching } = trpc.bookings.quickSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 }
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (bookingId: number) => {
    navigate(`/bookings/${bookingId}`);
    setQuery("");
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs sm:max-w-sm">
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search bookings..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.length >= 2 && setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full h-8 pl-8 pr-7 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#70FFE8] transition-all"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setOpen(false); }}
            className="absolute right-2 text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {open && query.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          {isFetching ? (
            <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
              <div className="w-3 h-3 rounded-full border-2 border-[#70FFE8] border-t-transparent animate-spin" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">No bookings found</div>
          ) : (
            <ul>
              {results.map((b: any) => (
                <li key={b.id}>
                  <button
                    className="w-full text-left px-4 py-2.5 hover:bg-muted/60 transition-colors border-b border-border last:border-0"
                    onClick={() => handleSelect(b.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm text-foreground truncate">{b.clientName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">#{b.id}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {b.ptsRef && (
                        <span className="text-xs text-muted-foreground">PTS: {b.ptsRef}</span>
                      )}
                      {b.topdogRef && (
                        <span className="text-xs text-muted-foreground">TD: {b.topdogRef}</span>
                      )}
                      {b.departureDate && (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(b.departureDate), "dd MMM yyyy")}
                        </span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground ml-auto">{b.currentStage}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
