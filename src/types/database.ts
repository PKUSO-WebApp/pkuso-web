// ---- 通用 ----
// UserRole 定义在 src/context/UserContext.tsx,此处不重复

/** 考勤状态 */
export type AttendanceStatus = "present" | "leave" | "absent";

// ---- profiles 表 ----

export type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  instrument: string | null;
  status: string | null;
  role: string | null;
  college: string | null;
  join_date: string | null;
  created_at: string | null;
};

// ---- rehearsals 表 ----

export type RehearsalRow = {
  id: number;
  title: string | null;
  date: string | null;
  /** @deprecated 使用 start_time / end_time */
  time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location: string | null;
  repertoire: string | null;
  created_at: string | null;
  /** DB 排练类型:full=合排, section=分排 */
  type?: string | null;
  target_section?: string | null;
  sign_in_code?: string | null;
};

// ---- announcements 表 ----

export type AnnouncementRow = {
  id: string;
  content: string | null;
  created_at: string | null;
};

// ---- posts 表 ----

export type PostType = "ensemble" | "gathering";

export type PostRow = {
  id: string;
  title: string;
  type: PostType;
  content: string;
  image_url: string | null;
  author_id: string;
  created_at: string;
  contact_info: string | null;
  current_sections: string | null;
  missing_sections: string | null;
  /** Supabase join: users!author_id(name, section) 的解包结果 */
  users?: { name: string; section: string } | null;
};

// ---- attendances 表 ----

export type AttendanceRow = {
  id: string | number;
  rehearsal_id: string | number;
  user_id?: string;
  status?: string;
  /** Supabase join: users(name, section) 的解包结果 */
  users?: { name?: string; section?: string } | null;
};
