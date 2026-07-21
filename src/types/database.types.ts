export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      announcements: {
        Row: {
          content: string | null;
          created_at: string | null;
          id: string;
        };
        Insert: {
          content?: string | null;
          created_at?: string | null;
          id?: string;
        };
        Update: {
          content?: string | null;
          created_at?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      attendances: {
        Row: {
          id: number;
          rehearsal_id: number;
          status: Database["public"]["Enums"]["attendanceStatus"] | null;
          user_id: string;
        };
        Insert: {
          id?: never;
          rehearsal_id: number;
          status?: Database["public"]["Enums"]["attendanceStatus"] | null;
          user_id: string;
        };
        Update: {
          id?: never;
          rehearsal_id?: number;
          status?: Database["public"]["Enums"]["attendanceStatus"] | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendances_rehearsal_id_fkey";
            columns: ["rehearsal_id"];
            isOneToOne: false;
            referencedRelation: "rehearsals";
            referencedColumns: ["id"];
          },
        ];
      };
      invitation_codes: {
        Row: {
          code: string;
          created_at: string | null;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          max_uses: number | null;
          used: boolean | null;
          used_by: string | null;
          used_count: number | null;
        };
        Insert: {
          code: string;
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          used?: boolean | null;
          used_by?: string | null;
          used_count?: number | null;
        };
        Update: {
          code?: string;
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          max_uses?: number | null;
          used?: boolean | null;
          used_by?: string | null;
          used_count?: number | null;
        };
        Relationships: [];
      };
      posts: {
        Row: {
          author_id: string;
          contact_info: string | null;
          content: string | null;
          created_at: string | null;
          current_sections: string | null;
          id: string;
          image_url: string | null;
          missing_sections: string | null;
          title: string;
          type: Database["public"]["Enums"]["postType"];
        };
        Insert: {
          author_id: string;
          contact_info?: string | null;
          content?: string | null;
          created_at?: string | null;
          current_sections?: string | null;
          id?: string;
          image_url?: string | null;
          missing_sections?: string | null;
          title: string;
          type?: Database["public"]["Enums"]["postType"];
        };
        Update: {
          author_id?: string;
          contact_info?: string | null;
          content?: string | null;
          created_at?: string | null;
          current_sections?: string | null;
          id?: string;
          image_url?: string | null;
          missing_sections?: string | null;
          title?: string;
          type?: Database["public"]["Enums"]["postType"];
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          college: string | null;
          created_at: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          instrument: string | null;
          join_date: string | null;
          role: Database["public"]["Enums"]["profileRole"] | null;
          status: Database["public"]["Enums"]["profileStatus"] | null;
        };
        Insert: {
          college?: string | null;
          created_at?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          instrument?: string | null;
          join_date?: string | null;
          role?: Database["public"]["Enums"]["profileRole"] | null;
          status?: Database["public"]["Enums"]["profileStatus"] | null;
        };
        Update: {
          college?: string | null;
          created_at?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          instrument?: string | null;
          join_date?: string | null;
          role?: Database["public"]["Enums"]["profileRole"] | null;
          status?: Database["public"]["Enums"]["profileStatus"] | null;
        };
        Relationships: [];
      };
      rehearsals: {
        Row: {
          created_at: string | null;
          date: string | null;
          end_time: string | null;
          id: number;
          location: string | null;
          repertoire: string | null;
          sign_in_code: string | null;
          start_time: string | null;
          target_section: string | null;
          time: string | null;
          title: string | null;
          type: string | null;
        };
        Insert: {
          created_at?: string | null;
          date?: string | null;
          end_time?: string | null;
          id?: never;
          location?: string | null;
          repertoire?: string | null;
          sign_in_code?: string | null;
          start_time?: string | null;
          target_section?: string | null;
          time?: string | null;
          title?: string | null;
          type?: string | null;
        };
        Update: {
          created_at?: string | null;
          date?: string | null;
          end_time?: string | null;
          id?: never;
          location?: string | null;
          repertoire?: string | null;
          sign_in_code?: string | null;
          start_time?: string | null;
          target_section?: string | null;
          time?: string | null;
          title?: string | null;
          type?: string | null;
        };
        Relationships: [];
      };
      schedule_groups: {
        Row: {
          author_id: string | null;
          created_at: string | null;
          id: string;
          monthly_day: number | null;
          monthly_end_month: number | null;
          monthly_end_year: number | null;
          monthly_start_month: number | null;
          monthly_start_year: number | null;
          repeat_mode: string;
          title: string;
          updated_at: string | null;
          weekly_day: number | null;
          weekly_end_date: string | null;
          weekly_end_month: number | null;
          weekly_end_week: number | null;
          weekly_end_year: number | null;
          weekly_start_date: string | null;
          weekly_start_month: number | null;
          weekly_start_week: number | null;
          weekly_start_year: number | null;
        };
        Insert: {
          author_id?: string | null;
          created_at?: string | null;
          id?: string;
          monthly_day?: number | null;
          monthly_end_month?: number | null;
          monthly_end_year?: number | null;
          monthly_start_month?: number | null;
          monthly_start_year?: number | null;
          repeat_mode: string;
          title: string;
          updated_at?: string | null;
          weekly_day?: number | null;
          weekly_end_date?: string | null;
          weekly_end_month?: number | null;
          weekly_end_week?: number | null;
          weekly_end_year?: number | null;
          weekly_start_date?: string | null;
          weekly_start_month?: number | null;
          weekly_start_week?: number | null;
          weekly_start_year?: number | null;
        };
        Update: {
          author_id?: string | null;
          created_at?: string | null;
          id?: string;
          monthly_day?: number | null;
          monthly_end_month?: number | null;
          monthly_end_year?: number | null;
          monthly_start_month?: number | null;
          monthly_start_year?: number | null;
          repeat_mode?: string;
          title?: string;
          updated_at?: string | null;
          weekly_day?: number | null;
          weekly_end_date?: string | null;
          weekly_end_month?: number | null;
          weekly_end_week?: number | null;
          weekly_end_year?: number | null;
          weekly_start_date?: string | null;
          weekly_start_month?: number | null;
          weekly_start_week?: number | null;
          weekly_start_year?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_groups_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      schedules: {
        Row: {
          author_id: string | null;
          created_at: string | null;
          end_time: string | null;
          group_id: string | null;
          id: number;
          rehearsal_id: number | null;
          start_time: string;
          title: string | null;
        };
        Insert: {
          author_id?: string | null;
          created_at?: string | null;
          end_time?: string | null;
          group_id?: string | null;
          id?: never;
          rehearsal_id?: number | null;
          start_time: string;
          title?: string | null;
        };
        Update: {
          author_id?: string | null;
          created_at?: string | null;
          end_time?: string | null;
          group_id?: string | null;
          id?: never;
          rehearsal_id?: number | null;
          start_time?: string;
          title?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "schedules_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "schedules_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "schedule_groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "schedules_rehearsal_id_fkey";
            columns: ["rehearsal_id"];
            isOneToOne: false;
            referencedRelation: "rehearsals";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      is_admin: { Args: never; Returns: boolean };
      verify_and_use_invitation_code: {
        Args: { p_code: string; p_user_id: string };
        Returns: {
          expires_at: string;
          message: string;
          success: boolean;
        }[];
      };
    };
    Enums: {
      attendanceStatus: "present" | "late" | "absent" | "excused";
      postType: "ensemble" | "gathering";
      profileRole: "member" | "admin";
      profileStatus: "pending" | "approved" | "rejected";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      attendanceStatus: ["present", "late", "absent", "excused"],
      postType: ["ensemble", "gathering"],
      profileRole: ["member", "admin"],
      profileStatus: ["pending", "approved", "rejected"],
    },
  },
} as const;
