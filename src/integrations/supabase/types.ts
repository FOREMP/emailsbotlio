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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      contact_lists: {
        Row: {
          columns: Json | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          columns?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          columns?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          custom_fields: Json | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          list_id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      do_not_contact: {
        Row: {
          created_at: string
          email: string
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          contact_id: string
          created_at: string
          current_step: number
          id: string
          last_sent_at: string | null
          next_send_at: string | null
          sequence_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          current_step?: number
          id?: string
          last_sent_at?: string | null
          next_send_at?: string | null
          sequence_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          current_step?: number
          id?: string
          last_sent_at?: string | null
          next_send_at?: string | null
          sequence_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      imported_files: {
        Row: {
          column_count: number
          columns_detected: Json
          created_at: string
          custom_columns: Json
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          imported_count: number
          list_id: string | null
          mapping: Json
          row_count: number
          sample_rows: Json
          user_id: string
        }
        Insert: {
          column_count?: number
          columns_detected?: Json
          created_at?: string
          custom_columns?: Json
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          imported_count?: number
          list_id?: string | null
          mapping?: Json
          row_count?: number
          sample_rows?: Json
          user_id: string
        }
        Update: {
          column_count?: number
          columns_detected?: Json
          created_at?: string
          custom_columns?: Json
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          imported_count?: number
          list_id?: string | null
          mapping?: Json
          row_count?: number
          sample_rows?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "imported_files_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          credits_remaining: number
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          credits_remaining?: number
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          credits_remaining?: number
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_insights: {
        Row: {
          action_items: Json | null
          avg_rating: number | null
          created_at: string
          id: string
          period_end: string
          period_start: string
          period_type: string
          review_count: number | null
          sentiment_avg: number | null
          source_id: string | null
          summary: string | null
          top_negative_themes: Json | null
          top_positive_themes: Json | null
          user_id: string
        }
        Insert: {
          action_items?: Json | null
          avg_rating?: number | null
          created_at?: string
          id?: string
          period_end: string
          period_start: string
          period_type: string
          review_count?: number | null
          sentiment_avg?: number | null
          source_id?: string | null
          summary?: string | null
          top_negative_themes?: Json | null
          top_positive_themes?: Json | null
          user_id: string
        }
        Update: {
          action_items?: Json | null
          avg_rating?: number | null
          created_at?: string
          id?: string
          period_end?: string
          period_start?: string
          period_type?: string
          review_count?: number | null
          sentiment_avg?: number | null
          source_id?: string | null
          summary?: string | null
          top_negative_themes?: Json | null
          top_positive_themes?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_insights_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "review_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      review_sources: {
        Row: {
          api_credentials: Json | null
          business_unit_id: string | null
          created_at: string
          domain: string | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          name: string
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_credentials?: Json | null
          business_unit_id?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name: string
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_credentials?: Json | null
          business_unit_id?: string | null
          created_at?: string
          domain?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          name?: string
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          ai_response_draft: string | null
          analyzed_at: string | null
          author_name: string | null
          created_at: string
          external_id: string | null
          id: string
          key_phrases: Json | null
          platform: string
          rating: number | null
          response_posted: boolean
          review_date: string | null
          review_text: string | null
          sentiment_label: string | null
          sentiment_score: number | null
          source_id: string
          themes: Json | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_response_draft?: string | null
          analyzed_at?: string | null
          author_name?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          key_phrases?: Json | null
          platform: string
          rating?: number | null
          response_posted?: boolean
          review_date?: string | null
          review_text?: string | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          source_id: string
          themes?: Json | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_response_draft?: string | null
          analyzed_at?: string | null
          author_name?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          key_phrases?: Json | null
          platform?: string
          rating?: number | null
          response_posted?: boolean
          review_date?: string | null
          review_text?: string | null
          sentiment_label?: string | null
          sentiment_score?: number | null
          source_id?: string
          themes?: Json | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "review_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      senders: {
        Row: {
          created_at: string
          from_email: string
          from_name: string
          id: string
          is_active: boolean
          reply_to: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          from_email: string
          from_name: string
          id?: string
          is_active?: boolean
          reply_to?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          from_email?: string
          from_name?: string
          id?: string
          is_active?: boolean
          reply_to?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sent_emails: {
        Row: {
          body: string | null
          contact_id: string | null
          enrollment_id: string | null
          error_message: string | null
          id: string
          message_id: string | null
          opened_at: string | null
          recipient_email: string
          replied_at: string | null
          sender_id: string | null
          sent_at: string
          status: string
          step_id: string | null
          subject: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          contact_id?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          opened_at?: string | null
          recipient_email: string
          replied_at?: string | null
          sender_id?: string | null
          sent_at?: string
          status?: string
          step_id?: string | null
          subject?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          contact_id?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          id?: string
          message_id?: string | null
          opened_at?: string | null
          recipient_email?: string
          replied_at?: string | null
          sender_id?: string | null
          sent_at?: string
          status?: string
          step_id?: string | null
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sent_emails_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          ai_model: string
          ai_prompt: string | null
          body_template: string | null
          created_at: string
          delay_days: number
          id: string
          sequence_id: string
          step_order: number
          subject_template: string | null
          updated_at: string
          use_ai: boolean
          user_id: string
        }
        Insert: {
          ai_model?: string
          ai_prompt?: string | null
          body_template?: string | null
          created_at?: string
          delay_days?: number
          id?: string
          sequence_id: string
          step_order: number
          subject_template?: string | null
          updated_at?: string
          use_ai?: boolean
          user_id: string
        }
        Update: {
          ai_model?: string
          ai_prompt?: string | null
          body_template?: string | null
          created_at?: string
          delay_days?: number
          id?: string
          sequence_id?: string
          step_order?: number
          subject_template?: string | null
          updated_at?: string
          use_ai?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          contact_list_id: string | null
          created_at: string
          id: string
          name: string
          sender_rotation: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_list_id?: string | null
          created_at?: string
          id?: string
          name: string
          sender_rotation?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_list_id?: string | null
          created_at?: string
          id?: string
          name?: string
          sender_rotation?: Json
          status?: string
          updated_at?: string
          user_id?: string
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
      [_ in never]: never
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
    Enums: {},
  },
} as const
