"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Check, ChevronDown, Search } from "lucide-react";

import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Shown greyed out at the end of the row, e.g. a track count. */
  hint?: string;
  /** Extra text the filter matches on but does not show, e.g. an owner. */
  keywords?: string;
};

/** Lowercase and accent-free, so "cancion" finds "Canción". */
function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * A select you can type in: the trigger looks like `SelectTrigger`, and opening
 * it reveals a search box that narrows the list. Lists of a hundred playlists
 * are unusable otherwise.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Choose one",
  searchPlaceholder = "Type to filter…",
  emptyMessage = "Nothing matches",
  disabled,
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  /** Put the service's theme class here: the list is portalled out of the page. */
  contentClassName?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `combobox-list-${useId()}`.replace(/:/g, "");

  const selected = options.find((option) => option.value === value);

  const matches = useMemo(() => {
    const term = fold(query.trim());
    if (!term) return options;
    // Every word has to appear somewhere, so "2025 rock" narrows down.
    const words = term.split(/\s+/u);
    return options.filter((option) => {
      const haystack = fold(`${option.label} ${option.keywords ?? ""}`);
      return words.every((word) => haystack.includes(word));
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open, matches.length]);

  function choose(option: ComboboxOption | undefined) {
    if (!option) return;
    onValueChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + matches.length) % matches.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(matches[active]);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : matches.length - 1);
    }
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Always reopen on the full list rather than on the last search.
        if (next) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          // Radix focuses the panel itself by default, which would swallow the
          // first keystrokes; the search box is what the user is aiming at.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
          // z-index above the dialog (z-50).
          className={cn(
            "z-[60] w-(--radix-popover-trigger-width) overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0",
            contentClassName,
          )}
        >
          <div className="relative border-b">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // A shorter list would leave the highlight past the end.
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              role="combobox"
              aria-label={ariaLabel ?? searchPlaceholder}
              aria-expanded
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                matches[active] ? `${listId}-${active}` : undefined
              }
              className="h-9 w-full bg-transparent pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="max-h-64 overflow-y-auto p-1"
          >
            {matches.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            ) : (
              matches.map((option, index) => {
                const isActive = index === active;

                return (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={option.value === value}
                    data-active={isActive}
                    // Keeps the focus in the search box, so typing never stops.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                    className={cn(
                      "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm select-none",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                  >
                    {option.value === value && (
                      <Check className="absolute left-2 size-4 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                    </span>
                    {option.hint && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
