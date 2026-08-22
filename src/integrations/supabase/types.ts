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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      contact_activity: {
        Row: {
          activity_type: string
          contact_id: string
          created_at: string
          id: string
          metadata: Json
          node_id: string | null
          sequence_id: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          contact_id: string
          created_at?: string
          id?: string
          metadata?: Json
          node_id?: string | null
          sequence_id?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          contact_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          node_id?: string | null
          sequence_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
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
          demo_site_url: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          list_id: string
          phone: string | null
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_fields?: Json | null
          demo_site_url?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id: string
          phone?: string | null
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_fields?: Json | null
          demo_site_url?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id?: string
          phone?: string | null
          tags?: string[]
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
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      enrollments: {
        Row: {
          assigned_sender_id: string | null
          attempt_count: number
          contact_id: string
          created_at: string
          current_node_id: string | null
          current_step: number
          deferred_at: string | null
          error_at: string | null
          id: string
          last_error: string | null
          last_sent_at: string | null
          next_send_at: string | null
          sequence_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_sender_id?: string | null
          attempt_count?: number
          contact_id: string
          created_at?: string
          current_node_id?: string | null
          current_step?: number
          deferred_at?: string | null
          error_at?: string | null
          id?: string
          last_error?: string | null
          last_sent_at?: string | null
          next_send_at?: string | null
          sequence_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_sender_id?: string | null
          attempt_count?: number
          contact_id?: string
          created_at?: string
          current_node_id?: string | null
          current_step?: number
          deferred_at?: string | null
          error_at?: string | null
          id?: string
          last_error?: string | null
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
      gdpr_erasures: {
        Row: {
          email_hash: string
          erased_at: string
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          email_hash: string
          erased_at?: string
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          email_hash?: string
          erased_at?: string
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      generated_sites: {
        Row: {
          attempts: number
          audit_reason: string | null
          audit_score: number | null
          click_count: number
          contact_id: string
          cost_credits: number | null
          created_at: string
          demo_site_url: string | null
          deploy_check_count: number
          error_message: string | null
          gen_progress: Json | null
          generated_files: Json | null
          generation_mode: string
          github_repo_url: string | null
          id: string
          language: string
          last_clicked_at: string | null
          last_deploy_check_at: string | null
          queued_at: string | null
          scraped_content: Json | null
          sequence_id: string | null
          site_lead_id: string | null
          source_url: string | null
          status: string
          template: string
          updated_at: string
          user_id: string
          vercel_alias_candidates: Json
          vercel_deployment_id: string | null
          vercel_deployment_url: string | null
          vercel_project_id: string | null
          vercel_ready_state: string | null
        }
        Insert: {
          attempts?: number
          audit_reason?: string | null
          audit_score?: number | null
          click_count?: number
          contact_id: string
          cost_credits?: number | null
          created_at?: string
          demo_site_url?: string | null
          deploy_check_count?: number
          error_message?: string | null
          gen_progress?: Json | null
          generated_files?: Json | null
          generation_mode?: string
          github_repo_url?: string | null
          id?: string
          language?: string
          last_clicked_at?: string | null
          last_deploy_check_at?: string | null
          queued_at?: string | null
          scraped_content?: Json | null
          sequence_id?: string | null
          site_lead_id?: string | null
          source_url?: string | null
          status?: string
          template?: string
          updated_at?: string
          user_id: string
          vercel_alias_candidates?: Json
          vercel_deployment_id?: string | null
          vercel_deployment_url?: string | null
          vercel_project_id?: string | null
          vercel_ready_state?: string | null
        }
        Update: {
          attempts?: number
          audit_reason?: string | null
          audit_score?: number | null
          click_count?: number
          contact_id?: string
          cost_credits?: number | null
          created_at?: string
          demo_site_url?: string | null
          deploy_check_count?: number
          error_message?: string | null
          gen_progress?: Json | null
          generated_files?: Json | null
          generation_mode?: string
          github_repo_url?: string | null
          id?: string
          language?: string
          last_clicked_at?: string | null
          last_deploy_check_at?: string | null
          queued_at?: string | null
          scraped_content?: Json | null
          sequence_id?: string | null
          site_lead_id?: string | null
          source_url?: string | null
          status?: string
          template?: string
          updated_at?: string
          user_id?: string
          vercel_alias_candidates?: Json
          vercel_deployment_id?: string | null
          vercel_deployment_url?: string | null
          vercel_project_id?: string | null
          vercel_ready_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_sites_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_sites_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_sites_site_lead_id_fkey"
            columns: ["site_lead_id"]
            isOneToOne: false
            referencedRelation: "site_leads"
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
          daily_limit: number
          followup_multiplier: number
          from_email: string
          from_name: string
          id: string
          is_active: boolean
          language: string
          reply_to: string | null
          updated_at: string
          user_id: string
          warmup_enabled: boolean
          warmup_started_at: string | null
          warmup_target: number
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          followup_multiplier?: number
          from_email: string
          from_name: string
          id?: string
          is_active?: boolean
          language?: string
          reply_to?: string | null
          updated_at?: string
          user_id: string
          warmup_enabled?: boolean
          warmup_started_at?: string | null
          warmup_target?: number
        }
        Update: {
          created_at?: string
          daily_limit?: number
          followup_multiplier?: number
          from_email?: string
          from_name?: string
          id?: string
          is_active?: boolean
          language?: string
          reply_to?: string | null
          updated_at?: string
          user_id?: string
          warmup_enabled?: boolean
          warmup_started_at?: string | null
          warmup_target?: number
        }
        Relationships: []
      }
      sending_domains: {
        Row: {
          brand: string
          created_at: string
          domain: string
          id: string
          is_active: boolean
          is_verified: boolean
          postal_address: string | null
          reply_to_email: string
          sender_subdomain: string
          tracking_host: string | null
          updated_at: string
        }
        Insert: {
          brand: string
          created_at?: string
          domain: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          postal_address?: string | null
          reply_to_email: string
          sender_subdomain?: string
          tracking_host?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string
          created_at?: string
          domain?: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          postal_address?: string | null
          reply_to_email?: string
          sender_subdomain?: string
          tracking_host?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sent_emails: {
        Row: {
          body: string | null
          bounce_type: string | null
          bounced_at: string | null
          complained_at: string | null
          contact_id: string | null
          enrollment_id: string | null
          error_message: string | null
          id: string
          last_opened_at: string | null
          message_id: string | null
          open_count: number
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
          bounce_type?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          contact_id?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          id?: string
          last_opened_at?: string | null
          message_id?: string | null
          open_count?: number
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
          bounce_type?: string | null
          bounced_at?: string | null
          complained_at?: string | null
          contact_id?: string | null
          enrollment_id?: string | null
          error_message?: string | null
          id?: string
          last_opened_at?: string | null
          message_id?: string | null
          open_count?: number
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
      sequence_edges: {
        Row: {
          created_at: string
          id: string
          sequence_id: string
          source_handle: string
          source_node_id: string
          target_node_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sequence_id: string
          source_handle?: string
          source_node_id: string
          target_node_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          sequence_id?: string
          source_handle?: string
          source_node_id?: string
          target_node_id?: string
          user_id?: string
        }
        Relationships: []
      }
      sequence_nodes: {
        Row: {
          config: Json
          created_at: string
          id: string
          node_type: string
          position_x: number
          position_y: number
          sequence_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          node_type: string
          position_x?: number
          position_y?: number
          sequence_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          node_type?: string
          position_x?: number
          position_y?: number
          sequence_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          seeded: boolean
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
          seeded?: boolean
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
          seeded?: boolean
          sender_rotation?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      site_leads: {
        Row: {
          address: string | null
          approved_at: string | null
          audit_details: Json | null
          audit_reason: string | null
          audit_score: number | null
          auto_send: boolean
          category: string | null
          company_name: string
          company_name_normalized: string
          created_at: string
          demo_url: string | null
          domain: string | null
          domain_normalized: string | null
          email: string | null
          extra: Json | null
          feedback: string | null
          generated_site_id: string | null
          id: string
          language: string
          last_email_sent_at: string | null
          niche: string
          phone: string | null
          rating: number | null
          review_snippets: Json | null
          reviews_count: number | null
          source_file_id: string | null
          status: string
          triaged_at: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          approved_at?: string | null
          audit_details?: Json | null
          audit_reason?: string | null
          audit_score?: number | null
          auto_send?: boolean
          category?: string | null
          company_name: string
          company_name_normalized: string
          created_at?: string
          demo_url?: string | null
          domain?: string | null
          domain_normalized?: string | null
          email?: string | null
          extra?: Json | null
          feedback?: string | null
          generated_site_id?: string | null
          id?: string
          language?: string
          last_email_sent_at?: string | null
          niche?: string
          phone?: string | null
          rating?: number | null
          review_snippets?: Json | null
          reviews_count?: number | null
          source_file_id?: string | null
          status?: string
          triaged_at?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          approved_at?: string | null
          audit_details?: Json | null
          audit_reason?: string | null
          audit_score?: number | null
          auto_send?: boolean
          category?: string | null
          company_name?: string
          company_name_normalized?: string
          created_at?: string
          demo_url?: string | null
          domain?: string | null
          domain_normalized?: string | null
          email?: string | null
          extra?: Json | null
          feedback?: string | null
          generated_site_id?: string | null
          id?: string
          language?: string
          last_email_sent_at?: string | null
          niche?: string
          phone?: string | null
          rating?: number | null
          review_snippets?: Json | null
          reviews_count?: number | null
          source_file_id?: string | null
          status?: string
          triaged_at?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_leads_generated_site_id_fkey"
            columns: ["generated_site_id"]
            isOneToOne: false
            referencedRelation: "generated_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _json_string_escape: { Args: { value: string }; Returns: string }
      next_sequence_schedule_slot: {
        Args: { base_at?: string; config: Json }
        Returns: string
      }
      seed_default_senders: { Args: never; Returns: number }
      sender_capacity_remaining: {
        Args: { _is_followup: boolean; _sender_id: string }
        Returns: number
      }
      sender_daily_remaining: { Args: { _sender_id: string }; Returns: number }
      sender_warmup_quota: { Args: { _sender_id: string }; Returns: number }
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
