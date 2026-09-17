"use client";

import { useEffect, useRef, useState } from "react";
import { Disc3, Music, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Official service logos, served from `public/logos/` (see the README there).
 * Same props as a lucide icon, so they drop into the places that used one.
 * If a file is missing or fails to load, a generic icon is shown instead of a
 * broken image. Plain <img>: next/image refuses local SVGs unless SVG support is
 * enabled globally, and these need no resizing.
 */
type LogoProps = { className?: string };

function Logo({
  src,
  fallback: Fallback,
  className,
}: LogoProps & { src: string; fallback: LucideIcon }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // The server-rendered <img> can fail before React attaches `onError`.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <Fallback aria-hidden className={cn("size-4 shrink-0 text-primary", className)} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => setFailed(true)}
      className={cn("size-4 shrink-0 object-contain", className)}
    />
  );
}

export function SpotifyLogo({ className }: LogoProps) {
  return <Logo src="/logos/spotify.svg" fallback={Disc3} className={className} />;
}

export function YouTubeMusicLogo({ className }: LogoProps) {
  return (
    <Logo src="/logos/youtube-music.svg" fallback={Music} className={className} />
  );
}
