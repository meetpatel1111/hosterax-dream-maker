export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      databases: {
        Row: {
          connection_string: string | null
          created_at: string
          engine: Database["public"]["Enums"]["db_engine"]
          id: string
          name: string
          project_id: string
          size_mb: number
          status: Database["public"]["Enums"]["db_status"]
        }
        Insert: {
          connection_string?: string | null
          created_at?: string
          engine: Database["public"]["Enums"]["db_engine"]
          id?: string
          name: string
          project_id: string
          size_mb?: number
          status?: Database["public"]["Enums"]["db_status"]
        }
        Update: {
          connection_string?: string | null
          created_at?: string
          engine?: Database["public"]["Enums"]["db_engine"]
          id?: string
          name?: string
          project_id?: string
          size_mb?: number
          status?: Database["public"]["Enums"]["db_status"]
        }
        Relationships: [
          {
            foreignKeyName: "databases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deployment_logs: {
        Row: {
          created_at: string
          deployment_id: string
          id: string
          level: Database["public"]["Enums"]["log_level"]
          message: string
        }
        Insert: {
          created_at?: string
          deployment_id: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message: string
        }
        Update: {
          created_at?: string
          deployment_id?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "deployment_logs_deployment_id_fkey"
            columns: ["deployment_id"]
            isOneToOne: false
            referencedRelation: "deployments"
            referencedColumns: ["id"]
          },
        ]
      }
      deployments: {
        Row: {
          branch: string
          commit_message: string | null
          commit_sha: string
          created_at: string
          duration_ms: number | null
          finished_at: string | null
          id: string
          project_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["deployment_status"]
          triggered_by: string | null
        }
        Insert: {
          branch?: string
          commit_message?: string | null
          commit_sha: string
          created_at?: string
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          project_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["deployment_status"]
          triggered_by?: string | null
        }
        Update: {
          branch?: string
          commit_message?: string | null
          commit_sha?: string
          created_at?: string
          duration_ms?: number | null
          finished_at?: string | null
          id?: string
          project_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["deployment_status"]
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deployments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      env_vars: {
        Row: {
          created_at: string
          environment: Database["public"]["Enums"]["env_scope"]
          id: string
          is_secret: boolean
          key: string
          project_id: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          environment?: Database["public"]["Enums"]["env_scope"]
          id?: string
          is_secret?: boolean
          key: string
          project_id: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          environment?: Database["public"]["Enums"]["env_scope"]
          id?: string
          is_secret?: boolean
          key?: string
          project_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "env_vars_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          branch: string
          build_command: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          port: number | null
          region: string
          repo_url: string | null
          root_dir: string | null
          slug: string
          stack: string
          start_command: string | null
          status: Database["public"]["Enums"]["project_status"]
          subdomain: string | null
          updated_at: string
        }
        Insert: {
          branch?: string
          build_command?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
          port?: number | null
          region?: string
          repo_url?: string | null
          root_dir?: string | null
          slug: string
          stack?: string
          start_command?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          subdomain?: string | null
          updated_at?: string
        }
        Update: {
          branch?: string
          build_command?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          port?: number | null
          region?: string
          repo_url?: string | null
          root_dir?: string | null
          slug?: string
          stack?: string
          start_command?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          subdomain?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      db_engine: "postgres" | "mysql" | "mongodb" | "redis"
      db_status: "provisioning" | "running" | "stopped" | "failed"
      deployment_status:
        | "queued"
        | "building"
        | "deploying"
        | "success"
        | "failed"
        | "cancelled"
      env_scope: "production" | "preview" | "development"
      log_level: "info" | "warn" | "error" | "success" | "debug"
      project_status: "active" | "building" | "failed" | "sleeping" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      db_engine: ["postgres", "mysql", "mongodb", "redis"],
      db_status: ["provisioning", "running", "stopped", "failed"],
      deployment_status: [
        "queued",
        "building",
        "deploying",
        "success",
        "failed",
        "cancelled",
      ],
      env_scope: ["production", "preview", "development"],
      log_level: ["info", "warn", "error", "success", "debug"],
      project_status: ["active", "building", "failed", "sleeping", "archived"],
    },
  },
} as const
