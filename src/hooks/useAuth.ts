"use client";

import React from "react";
import { supabase as defaultClient } from "@/lib/supabase";
import type { ProfileRow } from "@/types/database";

export type AuthState = {
  sessionUserId: string | null;
  sessionLoading: boolean;
  profileStatus: string | null;
  profileRole: string | null;
  profileName: string | null;
  profileInstrument: string | null;
  profileEmail: string | null;
  profileLoading: boolean;
  profileErrorMsg: string | null;
};

export type AuthActions = {
  handleSignOut: () => Promise<void>;
};

type OnProfileLoaded = (profile: {
  id: string;
  name: string;
  role: string;
  section: string;
  status: string;
  email: string;
}) => void;

type UseAuthOptions = {
  onProfileLoaded: OnProfileLoaded;
  onClearProfile: () => void;
};

export function useAuth(
  { onProfileLoaded, onClearProfile }: UseAuthOptions,
  client: typeof defaultClient = defaultClient,
) {
  const [sessionUserId, setSessionUserId] = React.useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [profileStatus, setProfileStatus] = React.useState<string | null>(null);
  const [profileRole, setProfileRole] = React.useState<string | null>(null);
  const [profileName, setProfileName] = React.useState<string | null>(null);
  const [profileInstrument, setProfileInstrument] = React.useState<string | null>(null);
  const [profileEmail, setProfileEmail] = React.useState<string | null>(null);
  const [profileLoading, setProfileLoading] = React.useState(false);
  const [profileErrorMsg, setProfileErrorMsg] = React.useState<string | null>(null);

  // 1. Session 初始化 + 实时监听
  React.useEffect(() => {
    let mounted = true;

    const init = async () => {
      setSessionLoading(true);
      const { data, error } = await client.auth.getSession();
      if (!mounted) return;
      if (error) console.warn("[useAuth] getSession 失败:", error.message);
      setSessionUserId(data.session?.user?.id ?? null);
      setSessionLoading(false);
    };
    void init();

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSessionUserId(next?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2. 根据 sessionUserId 加载 profiles
  React.useEffect(() => {
    let mounted = true;

    const fetchProfile = async () => {
      if (!sessionUserId) {
        setProfileStatus(null);
        setProfileRole(null);
        setProfileName(null);
        setProfileInstrument(null);
        setProfileEmail(null);
        setProfileErrorMsg(null);
        onClearProfile();
        return;
      }

      setProfileLoading(true);
      setProfileErrorMsg(null);

      const { data, error } = await client
        .from("profiles")
        .select("id, status, role, full_name, instrument, email")
        .eq("id", sessionUserId)
        .maybeSingle();

      if (!mounted) return;

      if (error) {
        setProfileLoading(false);
        setProfileErrorMsg(`查询失败：${error.message}`);
        setProfileStatus(null);
        return;
      }

      if (data == null) {
        setProfileLoading(false);
        setProfileErrorMsg(`未查到 profile 记录（id = ${sessionUserId}）`);
        setProfileStatus(null);
        return;
      }

      const profile = data as ProfileRow;
      setProfileErrorMsg(null);
      setProfileStatus(profile.status ?? null);
      setProfileRole(profile.role ?? null);
      setProfileName(profile.full_name ?? null);
      setProfileInstrument(profile.instrument ?? null);
      setProfileEmail(profile.email ?? null);

      onProfileLoaded({
        id: sessionUserId,
        name: profile.full_name ?? "未命名用户",
        role: profile.role ?? "member",
        section: profile.instrument ?? "",
        status: profile.status ?? "",
        email: profile.email ?? "",
      });

      setProfileLoading(false);
    };

    void fetchProfile();
    return () => {
      mounted = false;
    };
  }, [sessionUserId, onProfileLoaded, onClearProfile]);

  const handleSignOut = async () => {
    await client.auth.signOut();
    onClearProfile();
  };

  return {
    sessionUserId,
    sessionLoading,
    profileStatus,
    profileRole,
    profileName,
    profileInstrument,
    profileEmail,
    profileLoading,
    profileErrorMsg,
    handleSignOut,
  } satisfies AuthState & AuthActions;
}
