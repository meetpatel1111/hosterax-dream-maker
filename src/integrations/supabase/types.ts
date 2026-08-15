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
      access_tokens: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          last_used_at: string | null
          name: string
          owner_id: string
          project_grants: string[]
          scopes: Database["public"]["Enums"]["token_scope"][]
          token_hash: string
          token_prefix: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          owner_id: string
          project_grants?: string[]
          scopes?: Database["public"]["Enums"]["token_scope"][]
          token_hash: string
          token_prefix: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          owner_id?: string
          project_grants?: string[]
          scopes?: Database["public"]["Enums"]["token_scope"][]
          token_hash?: string
          token_prefix?: string
        }
        Relationships: []
      }
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
          artifact_url: string | null
          branch: string
          commit_message: string | null
          commit_sha: string
          created_at: string
          duration_ms: number | null
          environment: Database["public"]["Enums"]["env_scope"]
          finished_at: string | null
          id: string
          phase: Database["public"]["Enums"]["deploy_phase"]
          project_id: string
          rollback_of: string | null
          source_url: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["deployment_status"]
          trigger_type: Database["public"]["Enums"]["deploy_trigger"]
          triggered_by: string | null
          version: string | null
        }
        Insert: {
          artifact_url?: string | null
          branch?: string
          commit_message?: string | null
          commit_sha: string
          created_at?: string
          duration_ms?: number | null
          environment?: Database["public"]["Enums"]["env_scope"]
          finished_at?: string | null
          id?: string
          phase?: Database["public"]["Enums"]["deploy_phase"]
          project_id: string
          rollback_of?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["deployment_status"]
          trigger_type?: Database["public"]["Enums"]["deploy_trigger"]
          triggered_by?: string | null
          version?: string | null
        }
        Update: {
          artifact_url?: string | null
          branch?: string
          commit_message?: string | null
          commit_sha?: string
          created_at?: string
          duration_ms?: number | null
          environment?: Database["public"]["Enums"]["env_scope"]
          finished_at?: string | null
          id?: string
          phase?: Database["public"]["Enums"]["deploy_phase"]
          project_id?: string
          rollback_of?: string | null
          source_url?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["deployment_status"]
          trigger_type?: Database["public"]["Enums"]["deploy_trigger"]
          triggered_by?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deployments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deployments_rollback_of_fkey"
            columns: ["rollback_of"]
            isOneToOne: false
            referencedRelation: "deployments"
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
      git_webhooks: {
        Row: {
          actor: string | null
          commit_sha: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          project_id: string
          ref: string | null
        }
        Insert: {
          actor?: string | null
          commit_sha?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          project_id: string
          ref?: string | null
        }
        Update: {
          actor?: string | null
          commit_sha?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          project_id?: string
          ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "git_webhooks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_secret_hash: string | null
          created_at: string
          description: string | null
          id: string
          is_mcp: boolean
          is_public: boolean
          logo_url: string | null
          name: string
          owner_id: string
          redirect_uris: string[]
          scopes: string[]
        }
        Insert: {
          client_id: string
          client_secret_hash?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_mcp?: boolean
          is_public?: boolean
          logo_url?: string | null
          name: string
          owner_id: string
          redirect_uris?: string[]
          scopes?: string[]
        }
        Update: {
          client_id?: string
          client_secret_hash?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_mcp?: boolean
          is_public?: boolean
          logo_url?: string | null
          name?: string
          owner_id?: string
          redirect_uris?: string[]
          scopes?: string[]
        }
        Relationships: []
      }
      oauth_grants: {
        Row: {
          client_id: string
          created_at: string
          expires_at: string | null
          grant_type: Database["public"]["Enums"]["oauth_grant_type"]
          id: string
          last_used_at: string | null
          refresh_token_hash: string | null
          revoked: boolean
          scopes: string[]
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          expires_at?: string | null
          grant_type: Database["public"]["Enums"]["oauth_grant_type"]
          id?: string
          last_used_at?: string | null
          refresh_token_hash?: string | null
          revoked?: boolean
          scopes?: string[]
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          expires_at?: string | null
          grant_type?: Database["public"]["Enums"]["oauth_grant_type"]
          id?: string
          last_used_at?: string | null
          refresh_token_hash?: string | null
          revoked?: boolean
          scopes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_grants_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
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
          build_timeout_minutes: number
          created_at: string
          current_version: string | null
          git_provider: string
          id: string
          name: string
          owner_id: string
          port: number | null
          region: string
          repo_url: string | null
          root_dir: string | null
          slug: string
          ssh_host: string | null
          ssh_user: string | null
          stack: string
          start_command: string | null
          status: Database["public"]["Enums"]["project_status"]
          subdomain: string | null
          target_type: Database["public"]["Enums"]["deploy_target"]
          updated_at: string
          webhook_secret: string | null
          workspace_type: Database["public"]["Enums"]["workspace_type"]
        }
        Insert: {
          branch?: string
          build_command?: string | null
          build_timeout_minutes?: number
          created_at?: string
          current_version?: string | null
          git_provider?: string
          id?: string
          name: string
          owner_id: string
          port?: number | null
          region?: string
          repo_url?: string | null
          root_dir?: string | null
          slug: string
          ssh_host?: string | null
          ssh_user?: string | null
          stack?: string
          start_command?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          subdomain?: string | null
          target_type?: Database["public"]["Enums"]["deploy_target"]
          updated_at?: string
          webhook_secret?: string | null
          workspace_type?: Database["public"]["Enums"]["workspace_type"]
        }
        Update: {
          branch?: string
          build_command?: string | null
          build_timeout_minutes?: number
          created_at?: string
          current_version?: string | null
          git_provider?: string
          id?: string
          name?: string
          owner_id?: string
          port?: number | null
          region?: string
          repo_url?: string | null
          root_dir?: string | null
          slug?: string
          ssh_host?: string | null
          ssh_user?: string | null
          stack?: string
          start_command?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          subdomain?: string | null
          target_type?: Database["public"]["Enums"]["deploy_target"]
          updated_at?: string
          webhook_secret?: string | null
          workspace_type?: Database["public"]["Enums"]["workspace_type"]
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
      deploy_phase:
        | "queued"
        | "building"
        | "deploying"
        | "ready"
        | "failed"
        | "cancelled"
      deploy_target: "docker" | "process" | "ssh" | "cloud"
      deploy_trigger:
        | "git"
        | "manual"
        | "upload"
        | "url"
        | "cli"
        | "api"
        | "rollback"
      deployment_status:
        | "queued"
        | "building"
        | "deploying"
        | "success"
        | "failed"
        | "cancelled"
      env_scope: "production" | "preview" | "development"
      log_level: "info" | "warn" | "error" | "success" | "debug"
      oauth_grant_type:
        | "authorization_code"
        | "refresh_token"
        | "client_credentials"
      project_status: "active" | "building" | "failed" | "sleeping" | "archived"
      token_scope: "read" | "deploy" | "admin"
      workspace_type:
        | "none"
        | "pnpm"
        | "npm"
        | "yarn"
        | "rush"
        | "cargo"
        | "go"
        | "uv"
        | "elixir"
        | "maven"
        | "gradle"
        | "dotnet"
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
      deploy_phase: [
        "queued",
        "building",
        "deploying",
        "ready",
        "failed",
        "cancelled",
      ],
      deploy_target: ["docker", "process", "ssh", "cloud"],
      deploy_trigger: [
        "git",
        "manual",
        "upload",
        "url",
        "cli",
        "api",
        "rollback",
      ],
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
      oauth_grant_type: [
        "authorization_code",
        "refresh_token",
        "client_credentials",
      ],
      project_status: ["active", "building", "failed", "sleeping", "archived"],
      token_scope: ["read", "deploy", "admin"],
      workspace_type: [
        "none",
        "pnpm",
        "npm",
        "yarn",
        "rush",
        "cargo",
        "go",
        "uv",
        "elixir",
        "maven",
        "gradle",
        "dotnet",
      ],
    },
  },
} as const
