"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type {
  InstrumentPrincipalRow,
  ProfileRosterRow,
  SectionGroupMemberRow,
  SectionLeaderRow,
  SectionRow,
} from "@/types/database";

/**
 * P0c：web 角色任命的数据层。
 *
 * 读走浏览器客户端的 RLS 只读策略；写只能走 `/api/admin/section-leadership`
 * （verifyAdmin + service_role RPC）——角色表对 authenticated 没有写权限。
 */

type SectionLeadershipData = {
  sections: SectionRow[];
  groupMembers: SectionGroupMemberRow[];
  leaders: SectionLeaderRow[];
  principals: InstrumentPrincipalRow[];
  roster: ProfileRosterRow[];
};

const EMPTY_DATA: SectionLeadershipData = {
  sections: [],
  groupMembers: [],
  leaders: [],
  principals: [],
  roster: [],
};

export type LeadershipMutation =
  | { action: "set_section_leader"; section: string; userId: string }
  | { action: "remove_section_leader"; section: string }
  | { action: "set_principal"; instrument: string; userId: string }
  | { action: "remove_principal"; instrument: string };

export type MutationResult = { ok: true } | { ok: false; message: string };

export function useSectionLeadership(client: typeof defaultClient = defaultClient) {
  const [data, setData] = React.useState<SectionLeadershipData>(EMPTY_DATA);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const fetchSeqRef = React.useRef(0);

  const fetch = React.useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const [sections, groupMembers, leaders, principals, roster] = await Promise.all([
        client.from("sections").select("*").order("sort_order"),
        client.from("section_group_members").select("*").order("sort_order"),
        client.from("section_leaders").select("*"),
        client.from("instrument_principals").select("*"),
        client.from("profiles_roster").select("*"),
      ]);

      if (seq !== fetchSeqRef.current) return;

      const firstError = [
        sections.error,
        groupMembers.error,
        leaders.error,
        principals.error,
        roster.error,
      ].find((item) => item != null);
      if (firstError) {
        setError(firstError.message);
        setData(EMPTY_DATA);
        return;
      }

      setData({
        sections: sections.data ?? [],
        groupMembers: groupMembers.data ?? [],
        leaders: leaders.data ?? [],
        principals: principals.data ?? [],
        roster: roster.data ?? [],
      });
    } catch {
      if (seq === fetchSeqRef.current) {
        setError("网络错误");
        setData(EMPTY_DATA);
      }
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [client]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetch();
  }, [fetch]);

  const mutate = React.useCallback(
    async (body: LeadershipMutation): Promise<MutationResult> => {
      if (savingRef.current) return { ok: false, message: "操作进行中，请稍候" };
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const response = await window.fetch("/api/admin/section-leadership", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          return { ok: false, message: result.error || "保存失败，请重试" };
        }
        await fetch();
        return { ok: true };
      } catch {
        return { ok: false, message: "网络错误" };
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [client, fetch],
  );

  return {
    ...data,
    loading,
    error,
    saving,
    fetch,
    assignLeader: (section: string, userId: string) =>
      mutate({ action: "set_section_leader", section, userId }),
    removeLeader: (section: string) => mutate({ action: "remove_section_leader", section }),
    assignPrincipal: (instrument: string, userId: string) =>
      mutate({ action: "set_principal", instrument, userId }),
    removePrincipal: (instrument: string) => mutate({ action: "remove_principal", instrument }),
  };
}
