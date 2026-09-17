"use client";

import React from "react";
import Link from "next/link";

interface FeatureCardProps {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
  badgeMax?: number;
}

export function FeatureCard({
  title,
  href,
  icon: Icon,
  badgeCount,
  badgeMax = 99,
}: FeatureCardProps) {
  const showBadge = badgeCount && badgeCount > 0;
  const displayBadge = showBadge
    ? badgeCount > badgeMax
      ? `${badgeMax}+`
      : String(badgeCount)
    : null;

  return (
    <Link
      href={href}
      prefetch={false}
      className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-3 transition-colors hover:bg-muted hover:border-border/50"
    >
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
        {displayBadge && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-medium text-danger-foreground">
            {displayBadge}
          </span>
        )}
      </div>
      <span className="text-label font-medium text-text truncate">{title}</span>
    </Link>
  );
}
