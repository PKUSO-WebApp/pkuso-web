"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { FeatureCard } from "./components/FeatureCard";
import { useAdminPageHeader } from "@/context/admin-page-header-context";
import {
  UserCheck,
  CalendarCheck,
  Megaphone,
  Music,
  Calendar,
  ClipboardList,
  UsersRound,
  MessagesSquare,
  Key,
  Bell,
  MessageSquare,
  Mail,
  Upload,
} from "lucide-react";

interface FeatureItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
}

export default function AdminHomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resetHeader } = useAdminPageHeader();

  // 首页重置页顶状态（清除子页面残留的标题/按钮）
  React.useEffect(() => {
    resetHeader();
  }, [resetHeader]);

  // 兼容旧深链：/admin?tab=leave -> 重定向到 /admin/leave
  React.useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab) {
      const tabMap: Record<string, string> = {
        approval: "/admin/approval",
        leave: "/admin/leave",
        announcement: "/admin/announcements",
        rehearsals: "/admin/rehearsals",
        schedule: "/admin/schedule",
        members: "/admin/attendance",
        community: "/admin/community",
        profile: "/admin/profile",
      };
      const target = tabMap[tab];
      if (target) {
        router.replace(target);
      }
    }
  }, [searchParams, router]);

  const [pendingApprovalCount, setPendingApprovalCount] = React.useState(0);
  const [pendingLeaveCount, setPendingLeaveCount] = React.useState(0);
  const [loadingBadges, setLoadingBadges] = React.useState(true);

  // 并行获取徽章计数
  React.useEffect(() => {
    let mounted = true;
    async function fetchBadges() {
      try {
        const [{ count: approvalCount }, { count: leaveCount }] = await Promise.all([
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
          supabase
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending"),
        ]);
        if (mounted) {
          setPendingApprovalCount(approvalCount ?? 0);
          setPendingLeaveCount(leaveCount ?? 0);
          setLoadingBadges(false);
        }
      } catch {
        if (mounted) setLoadingBadges(false);
      }
    }
    fetchBadges();
    return () => {
      mounted = false;
    };
  }, []);

  const features: FeatureItem[] = [
    {
      title: "入团审批",
      href: "/admin/approval",
      icon: UserCheck,
      badgeCount: pendingApprovalCount,
    },
    { title: "请假审批", href: "/admin/leave", icon: CalendarCheck, badgeCount: pendingLeaveCount },
    { title: "公告管理", href: "/admin/announcements", icon: Megaphone },
    { title: "排练管理", href: "/admin/rehearsals", icon: Music },
    { title: "排练房预约", href: "/admin/schedule", icon: Calendar },
    { title: "考勤管理", href: "/admin/attendance", icon: ClipboardList },
    { title: "成员花名册", href: "/admin/roster", icon: UsersRound },
    { title: "社区管理", href: "/admin/community", icon: MessagesSquare },
    { title: "邀请码管理", href: "/admin/invitation-codes", icon: Key },
    { title: "系统通知", href: "/admin/system-notify", icon: Bell },
    { title: "反馈查看", href: "/admin/feedback", icon: MessageSquare },
    { title: "邮件签名", href: "/admin/email-signature", icon: Mail },
    { title: "数据导入", href: "/admin/config/import", icon: Upload },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      {loadingBadges && (
        <div className="mb-2 flex h-8 items-center justify-center text-xs text-text-subtle">
          加载徽章计数…
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          {features.map((f) => (
            <FeatureCard
              key={f.href}
              title={f.title}
              href={f.href}
              icon={f.icon}
              badgeCount={f.badgeCount}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
