export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      account_aliases: {
        Row: {
          account_id: string | null
          alias: string | null
          created_at: string | null
          id: string | null
          normalized_alias: string | null
          source: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          alias?: string | null
          created_at?: string | null
          id?: string | null
          normalized_alias?: string | null
          source?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          alias?: string | null
          created_at?: string | null
          id?: string | null
          normalized_alias?: string | null
          source?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_aliases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "account_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      account_contact_relationships: {
        Row: {
          account_id: string | null
          contact_id: string | null
          created_at: string | null
          ended_at: string | null
          id: string | null
          is_primary: boolean | null
          role: string | null
          started_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          ended_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          role?: string | null
          started_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          ended_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          role?: string | null
          started_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_contact_relationships_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_contact_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_contact_relationships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "account_contact_relationships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_type: string | null
          address: Json | null
          archived_at: string | null
          created_at: string | null
          created_by: string | null
          domain: string | null
          id: string | null
          lifecycle_state: string | null
          merged_into_account_id: string | null
          name: string | null
          normalized_name: string | null
          notes: string | null
          original_acquisition_at: string | null
          original_acquisition_source: string | null
          owner_id: string | null
          registration_number: string | null
          registration_number_key: string | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          account_type?: string | null
          address?: Json | null
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          domain?: string | null
          id?: string | null
          lifecycle_state?: string | null
          merged_into_account_id?: string | null
          name?: string | null
          normalized_name?: string | null
          notes?: string | null
          original_acquisition_at?: string | null
          original_acquisition_source?: string | null
          owner_id?: string | null
          registration_number?: string | null
          registration_number_key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_type?: string | null
          address?: Json | null
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          domain?: string | null
          id?: string | null
          lifecycle_state?: string | null
          merged_into_account_id?: string | null
          name?: string | null
          normalized_name?: string | null
          notes?: string | null
          original_acquisition_at?: string | null
          original_acquisition_source?: string | null
          owner_id?: string | null
          registration_number?: string | null
          registration_number_key?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_merged_into_account_id_fkey"
            columns: ["merged_into_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          account_id: string | null
          actor_id: string | null
          body: string | null
          channel: string | null
          contact_id: string | null
          created_at: string | null
          id: string | null
          kind: string | null
          lead_id: string | null
          metadata: Json | null
          occurred_at: string | null
          opportunity_id: string | null
          project_id: string | null
          purchase_id: string | null
          subject: string | null
          visit_id: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          actor_id?: string | null
          body?: string | null
          channel?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          kind?: string | null
          lead_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          opportunity_id?: string | null
          project_id?: string | null
          purchase_id?: string | null
          subject?: string | null
          visit_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          actor_id?: string | null
          body?: string | null
          channel?: string | null
          contact_id?: string | null
          created_at?: string | null
          id?: string | null
          kind?: string | null
          lead_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          opportunity_id?: string | null
          project_id?: string | null
          purchase_id?: string | null
          subject?: string | null
          visit_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_purchase_fk"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "activities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      attribute_definitions: {
        Row: {
          comparable: boolean | null
          data_type: string | null
          description: string | null
          id: string | null
          key: string | null
          label: string | null
          options: Json | null
          schema_version: number | null
          status: string | null
          unit: string | null
          workspace_id: string | null
        }
        Insert: {
          comparable?: boolean | null
          data_type?: string | null
          description?: string | null
          id?: string | null
          key?: string | null
          label?: string | null
          options?: Json | null
          schema_version?: number | null
          status?: string | null
          unit?: string | null
          workspace_id?: string | null
        }
        Update: {
          comparable?: boolean | null
          data_type?: string | null
          description?: string | null
          id?: string | null
          key?: string | null
          label?: string | null
          options?: Json | null
          schema_version?: number | null
          status?: string | null
          unit?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attribute_definitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "attribute_definitions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string | null
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          correlation_id: string | null
          id: string | null
          metadata: Json | null
          object_id: string | null
          object_schema: string | null
          object_table: string | null
          occurred_at: string | null
          reason: string | null
          workspace_id: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          correlation_id?: string | null
          id?: string | null
          metadata?: Json | null
          object_id?: string | null
          object_schema?: string | null
          object_table?: string | null
          occurred_at?: string | null
          reason?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          correlation_id?: string | null
          id?: string | null
          metadata?: Json | null
          object_id?: string | null
          object_schema?: string | null
          object_table?: string | null
          occurred_at?: string | null
          reason?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          country_code: string | null
          created_at: string | null
          id: string | null
          is_house_brand: boolean | null
          name: string | null
          normalized_name: string | null
          owner_organization_id: string | null
          slug: string | null
          supplier_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string | null
          id?: string | null
          is_house_brand?: boolean | null
          name?: string | null
          normalized_name?: string | null
          owner_organization_id?: string | null
          slug?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string | null
          id?: string | null
          is_house_brand?: boolean | null
          name?: string | null
          normalized_name?: string | null
          owner_organization_id?: string | null
          slug?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_owner_organization_id_fkey"
            columns: ["owner_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "stale_supplier_queue"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "brands_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brands_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "brands_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_locations: {
        Row: {
          address: Json | null
          code: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          kind: string | null
          name: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          address?: Json | null
          code?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          kind?: string | null
          name?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          address?: Json | null
          code?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          kind?: string | null
          name?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "business_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_facts: {
        Row: {
          candidate_record_id: string | null
          confidence: number | null
          created_at: string | null
          field_path: string | null
          id: string | null
          mapping_rule_version: string | null
          normalized_value: Json | null
          raw_label: string | null
          raw_value: string | null
          source_page: number | null
          source_region: Json | null
          validation_state: string | null
          workspace_id: string | null
        }
        Insert: {
          candidate_record_id?: string | null
          confidence?: number | null
          created_at?: string | null
          field_path?: string | null
          id?: string | null
          mapping_rule_version?: string | null
          normalized_value?: Json | null
          raw_label?: string | null
          raw_value?: string | null
          source_page?: number | null
          source_region?: Json | null
          validation_state?: string | null
          workspace_id?: string | null
        }
        Update: {
          candidate_record_id?: string | null
          confidence?: number | null
          created_at?: string | null
          field_path?: string | null
          id?: string | null
          mapping_rule_version?: string | null
          normalized_value?: Json | null
          raw_label?: string | null
          raw_value?: string | null
          source_page?: number | null
          source_region?: Json | null
          validation_state?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_facts_candidate_record_id_fkey"
            columns: ["candidate_record_id"]
            isOneToOne: false
            referencedRelation: "candidate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "candidate_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_records: {
        Row: {
          candidate_key: string | null
          candidate_record_type: string | null
          created_at: string | null
          extraction_rule: string | null
          group_confidence: number | null
          id: string | null
          import_run_id: string | null
          published_object_id: string | null
          published_object_type: string | null
          raw_group_reference: string | null
          review_state: string | null
          source_asset_id: string | null
          source_locator: Json | null
          source_version_id: string | null
          updated_at: string | null
          validation_state: string | null
          workspace_id: string | null
        }
        Insert: {
          candidate_key?: string | null
          candidate_record_type?: string | null
          created_at?: string | null
          extraction_rule?: string | null
          group_confidence?: number | null
          id?: string | null
          import_run_id?: string | null
          published_object_id?: string | null
          published_object_type?: string | null
          raw_group_reference?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_version_id?: string | null
          updated_at?: string | null
          validation_state?: string | null
          workspace_id?: string | null
        }
        Update: {
          candidate_key?: string | null
          candidate_record_type?: string | null
          created_at?: string | null
          extraction_rule?: string | null
          group_confidence?: number | null
          id?: string | null
          import_run_id?: string | null
          published_object_id?: string | null
          published_object_type?: string | null
          raw_group_reference?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_version_id?: string | null
          updated_at?: string | null
          validation_state?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_records_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_records_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "candidate_records_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_records_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_records_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "candidate_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_edition_candidates: {
        Row: {
          brand_hint: string | null
          candidate_key: string | null
          candidate_record_id: string | null
          created_at: string | null
          edition_label_candidate: string | null
          external_source_id: string | null
          id: string | null
          language_signals: string[] | null
          name_candidate: string | null
          publication_date_candidate: string | null
          review_state: string | null
          root_name: string | null
          source_asset_id: string | null
          source_path: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          created_at?: string | null
          edition_label_candidate?: string | null
          external_source_id?: string | null
          id?: string | null
          language_signals?: string[] | null
          name_candidate?: string | null
          publication_date_candidate?: string | null
          review_state?: string | null
          root_name?: string | null
          source_asset_id?: string | null
          source_path?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          created_at?: string | null
          edition_label_candidate?: string | null
          external_source_id?: string | null
          id?: string | null
          language_signals?: string[] | null
          name_candidate?: string | null
          publication_date_candidate?: string | null
          review_state?: string | null
          root_name?: string | null
          source_asset_id?: string | null
          source_path?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_edition_candidates_candidate_record_id_fkey"
            columns: ["candidate_record_id"]
            isOneToOne: false
            referencedRelation: "candidate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_edition_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "catalog_edition_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_edition_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_edition_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "catalog_edition_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_editions: {
        Row: {
          brand_id: string | null
          created_at: string | null
          created_by: string | null
          edition_label: string | null
          id: string | null
          language: string | null
          market: string | null
          name: string | null
          publication_date: string | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_asset_id: string | null
          source_version_id: string | null
          status: string | null
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_id?: string | null
          created_at?: string | null
          created_by?: string | null
          edition_label?: string | null
          id?: string | null
          language?: string | null
          market?: string | null
          name?: string | null
          publication_date?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          status?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_id?: string | null
          created_at?: string | null
          created_by?: string | null
          edition_label?: string | null
          id?: string | null
          language?: string | null
          market?: string | null
          name?: string | null
          publication_date?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          status?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_editions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_editions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "catalog_editions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_editions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_editions_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_editions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "catalog_editions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_entries: {
        Row: {
          catalog_edition_id: string | null
          created_at: string | null
          display_order: number | null
          id: string | null
          page_ref: string | null
          product_id: string | null
          raw_catalog_label: string | null
          region: Json | null
          snippet: string | null
          source_asset_id: string | null
          source_version_id: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          catalog_edition_id?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          page_ref?: string | null
          product_id?: string | null
          raw_catalog_label?: string | null
          region?: Json | null
          snippet?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          catalog_edition_id?: string | null
          created_at?: string | null
          display_order?: number | null
          id?: string | null
          page_ref?: string | null
          product_id?: string | null
          raw_catalog_label?: string | null
          region?: Json | null
          snippet?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_entries_catalog_edition_id_fkey"
            columns: ["catalog_edition_id"]
            isOneToOne: false
            referencedRelation: "catalog_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_entries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_entries_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "catalog_entries_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_entries_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_entries_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_entries_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "catalog_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      category_attribute_rules: {
        Row: {
          attribute_definition_id: string | null
          category_id: string | null
          id: string | null
          is_required: boolean | null
          position: number | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          attribute_definition_id?: string | null
          category_id?: string | null
          id?: string | null
          is_required?: boolean | null
          position?: number | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          attribute_definition_id?: string | null
          category_id?: string | null
          id?: string | null
          is_required?: boolean | null
          position?: number | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "category_attribute_rules_attribute_definition_id_fkey"
            columns: ["attribute_definition_id"]
            isOneToOne: false
            referencedRelation: "attribute_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_attribute_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_attribute_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "category_attribute_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_candidates: {
        Row: {
          brand_hint: string | null
          candidate_key: string | null
          candidate_record_id: string | null
          certificate_number_candidates: string[] | null
          certificate_type_signal_candidates: string[] | null
          confidence: number | null
          created_at: string | null
          date_candidates: string[] | null
          external_source_id: string | null
          extraction_rule: string | null
          filename_date_candidates: string[] | null
          filename_identifier_candidates: string[] | null
          id: string | null
          published_certificate_id: string | null
          review_state: string | null
          role_candidates: Json | null
          root_name: string | null
          scope_text_raw: string | null
          scope_type: string | null
          source_asset_id: string | null
          source_locator: Json | null
          source_path: string | null
          standard_candidates: string[] | null
          title_candidate: string | null
          updated_at: string | null
          validation_flags: Json | null
          workspace_id: string | null
        }
        Insert: {
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          certificate_number_candidates?: string[] | null
          certificate_type_signal_candidates?: string[] | null
          confidence?: number | null
          created_at?: string | null
          date_candidates?: string[] | null
          external_source_id?: string | null
          extraction_rule?: string | null
          filename_date_candidates?: string[] | null
          filename_identifier_candidates?: string[] | null
          id?: string | null
          published_certificate_id?: string | null
          review_state?: string | null
          role_candidates?: Json | null
          root_name?: string | null
          scope_text_raw?: string | null
          scope_type?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          standard_candidates?: string[] | null
          title_candidate?: string | null
          updated_at?: string | null
          validation_flags?: Json | null
          workspace_id?: string | null
        }
        Update: {
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          certificate_number_candidates?: string[] | null
          certificate_type_signal_candidates?: string[] | null
          confidence?: number | null
          created_at?: string | null
          date_candidates?: string[] | null
          external_source_id?: string | null
          extraction_rule?: string | null
          filename_date_candidates?: string[] | null
          filename_identifier_candidates?: string[] | null
          id?: string | null
          published_certificate_id?: string | null
          review_state?: string | null
          role_candidates?: Json | null
          root_name?: string | null
          scope_text_raw?: string | null
          scope_type?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          standard_candidates?: string[] | null
          title_candidate?: string | null
          updated_at?: string | null
          validation_flags?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificate_candidates_candidate_record_id_fkey"
            columns: ["candidate_record_id"]
            isOneToOne: false
            referencedRelation: "candidate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "certificate_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "certificate_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_scopes: {
        Row: {
          brand_id: string | null
          certificate_id: string | null
          created_at: string | null
          facility_text: string | null
          id: string | null
          organization_id: string | null
          product_category_id: string | null
          product_id: string | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope_text_raw: string | null
          scope_type: string | null
          updated_at: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_id?: string | null
          certificate_id?: string | null
          created_at?: string | null
          facility_text?: string | null
          id?: string | null
          organization_id?: string | null
          product_category_id?: string | null
          product_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_text_raw?: string | null
          scope_type?: string | null
          updated_at?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_id?: string | null
          certificate_id?: string | null
          created_at?: string | null
          facility_text?: string | null
          id?: string | null
          organization_id?: string | null
          product_category_id?: string | null
          product_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_text_raw?: string | null
          scope_type?: string | null
          updated_at?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificate_scopes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_scopes_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_scopes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_scopes_product_category_id_fkey"
            columns: ["product_category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_scopes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_scopes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_scopes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "certificate_scopes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_number: string | null
          certificate_type: string | null
          created_at: string | null
          created_by: string | null
          expires_on: string | null
          holder_organization_id: string | null
          id: string | null
          issued_on: string | null
          issuing_organization_id: string | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_asset_id: string | null
          source_version_id: string | null
          standard_code: string | null
          title: string | null
          updated_at: string | null
          validity_state: string | null
          workspace_id: string | null
        }
        Insert: {
          certificate_number?: string | null
          certificate_type?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_on?: string | null
          holder_organization_id?: string | null
          id?: string | null
          issued_on?: string | null
          issuing_organization_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          standard_code?: string | null
          title?: string | null
          updated_at?: string | null
          validity_state?: string | null
          workspace_id?: string | null
        }
        Update: {
          certificate_number?: string | null
          certificate_type?: string | null
          created_at?: string | null
          created_by?: string | null
          expires_on?: string | null
          holder_organization_id?: string | null
          id?: string | null
          issued_on?: string | null
          issuing_organization_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          standard_code?: string | null
          title?: string | null
          updated_at?: string | null
          validity_state?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificates_holder_organization_id_fkey"
            columns: ["holder_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_issuing_organization_id_fkey"
            columns: ["issuing_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "certificates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "certificates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_amount_observations: {
        Row: {
          amount_normalized: number | null
          amount_raw: string | null
          brand_hint: string | null
          candidate_record_id: string | null
          created_at: string | null
          currency_code: string | null
          external_source_id: string | null
          id: string | null
          observation_key: string | null
          observation_type: string | null
          raw_excerpt: string | null
          reason_not_price_candidate: string | null
          review_state: string | null
          source_asset_id: string | null
          source_locator: Json | null
          source_path: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          amount_normalized?: number | null
          amount_raw?: string | null
          brand_hint?: string | null
          candidate_record_id?: string | null
          created_at?: string | null
          currency_code?: string | null
          external_source_id?: string | null
          id?: string | null
          observation_key?: string | null
          observation_type?: string | null
          raw_excerpt?: string | null
          reason_not_price_candidate?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount_normalized?: number | null
          amount_raw?: string | null
          brand_hint?: string | null
          candidate_record_id?: string | null
          created_at?: string | null
          currency_code?: string | null
          external_source_id?: string | null
          id?: string | null
          observation_key?: string | null
          observation_type?: string | null
          raw_excerpt?: string | null
          reason_not_price_candidate?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commercial_amount_observations_candidate_record_id_fkey"
            columns: ["candidate_record_id"]
            isOneToOne: false
            referencedRelation: "candidate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_amount_observations_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "commercial_amount_observations_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_amount_observations_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commercial_amount_observations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "commercial_amount_observations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_checkpoints: {
        Row: {
          connection_id: string | null
          cursor: string | null
          id: string | null
          stream: string | null
          updated_at: string | null
        }
        Insert: {
          connection_id?: string | null
          cursor?: string | null
          id?: string | null
          stream?: string | null
          updated_at?: string | null
        }
        Update: {
          connection_id?: string | null
          cursor?: string | null
          id?: string | null
          stream?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connector_checkpoints_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          channel: string | null
          contact_id: string | null
          evidence: string | null
          id: string | null
          notice_version: string | null
          purpose: string | null
          recorded_at: string | null
          recorded_by: string | null
          status: string | null
          workspace_id: string | null
        }
        Insert: {
          channel?: string | null
          contact_id?: string | null
          evidence?: string | null
          id?: string | null
          notice_version?: string | null
          purpose?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Update: {
          channel?: string | null
          contact_id?: string | null
          evidence?: string | null
          id?: string | null
          notice_version?: string | null
          purpose?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "consent_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_points: {
        Row: {
          contact_id: string | null
          created_at: string | null
          hash_key: string | null
          id: string | null
          is_primary: boolean | null
          is_shared: boolean | null
          kind: string | null
          label: string | null
          normalized_value: string | null
          raw_value: string | null
          source: string | null
          updated_at: string | null
          verified_at: string | null
          workspace_id: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          hash_key?: string | null
          id?: string | null
          is_primary?: boolean | null
          is_shared?: boolean | null
          kind?: string | null
          label?: string | null
          normalized_value?: string | null
          raw_value?: string | null
          source?: string | null
          updated_at?: string | null
          verified_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          hash_key?: string | null
          id?: string | null
          is_primary?: boolean | null
          is_shared?: boolean | null
          kind?: string | null
          label?: string | null
          normalized_value?: string | null
          raw_value?: string | null
          source?: string | null
          updated_at?: string | null
          verified_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_points_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_points_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "contact_points_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_sheet_items: {
        Row: {
          contact_sheet_id: string | null
          created_at: string | null
          id: string | null
          label: string | null
          media_asset_id: string | null
          source_path: string | null
          workspace_id: string | null
        }
        Insert: {
          contact_sheet_id?: string | null
          created_at?: string | null
          id?: string | null
          label?: string | null
          media_asset_id?: string | null
          source_path?: string | null
          workspace_id?: string | null
        }
        Update: {
          contact_sheet_id?: string | null
          created_at?: string | null
          id?: string | null
          label?: string | null
          media_asset_id?: string | null
          source_path?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_sheet_items_contact_sheet_id_fkey"
            columns: ["contact_sheet_id"]
            isOneToOne: false
            referencedRelation: "contact_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_sheet_items_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_sheet_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "contact_sheet_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_sheets: {
        Row: {
          content_checksum: string | null
          created_at: string | null
          id: string | null
          item_count: number | null
          object_path: string | null
          sheet_key: string | null
          storage_bucket: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          content_checksum?: string | null
          created_at?: string | null
          id?: string | null
          item_count?: number | null
          object_path?: string | null
          sheet_key?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          content_checksum?: string | null
          created_at?: string | null
          id?: string | null
          item_count?: number | null
          object_path?: string | null
          sheet_key?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_sheets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "contact_sheets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          archived_at: string | null
          created_at: string | null
          created_by: string | null
          customer_type: string | null
          display_name: string | null
          family_name: string | null
          given_name: string | null
          id: string | null
          is_provisional: boolean | null
          lifecycle_state: string | null
          merged_into_contact_id: string | null
          normalized_name: string | null
          notes: string | null
          original_acquisition_at: string | null
          original_acquisition_source: string | null
          preferred_language: string | null
          salutation: string | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_type?: string | null
          display_name?: string | null
          family_name?: string | null
          given_name?: string | null
          id?: string | null
          is_provisional?: boolean | null
          lifecycle_state?: string | null
          merged_into_contact_id?: string | null
          normalized_name?: string | null
          notes?: string | null
          original_acquisition_at?: string | null
          original_acquisition_source?: string | null
          preferred_language?: string | null
          salutation?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_type?: string | null
          display_name?: string | null
          family_name?: string | null
          given_name?: string | null
          id?: string | null
          is_provisional?: boolean | null
          lifecycle_state?: string | null
          merged_into_contact_id?: string | null
          normalized_name?: string | null
          notes?: string | null
          original_acquisition_at?: string | null
          original_acquisition_source?: string | null
          preferred_language?: string | null
          salutation?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_merged_into_contact_id_fkey"
            columns: ["merged_into_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_asset_reviews: {
        Row: {
          decision: string | null
          id: string | null
          reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          shoot_output_id: string | null
        }
        Insert: {
          decision?: string | null
          id?: string | null
          reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          shoot_output_id?: string | null
        }
        Update: {
          decision?: string | null
          id?: string | null
          reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          shoot_output_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_asset_reviews_shoot_output_id_fkey"
            columns: ["shoot_output_id"]
            isOneToOne: false
            referencedRelation: "shoot_outputs"
            referencedColumns: ["id"]
          },
        ]
      }
      content_opportunities: {
        Row: {
          account_id: string | null
          contact_id: string | null
          content_types: string[] | null
          created_at: string | null
          customer_owner_id: string | null
          id: string | null
          interview_subjects: string | null
          marketing_owner_id: string | null
          nominated_by: string | null
          nomination_reason: string | null
          opportunity_id: string | null
          priority: string | null
          products_used: string[] | null
          project_id: string | null
          purchase_id: string | null
          readiness_state: string | null
          reference_media: Json | null
          site_notes: string | null
          special_requirements: string | null
          status: string | null
          story_angle: string | null
          target_window_end: string | null
          target_window_start: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          content_types?: string[] | null
          created_at?: string | null
          customer_owner_id?: string | null
          id?: string | null
          interview_subjects?: string | null
          marketing_owner_id?: string | null
          nominated_by?: string | null
          nomination_reason?: string | null
          opportunity_id?: string | null
          priority?: string | null
          products_used?: string[] | null
          project_id?: string | null
          purchase_id?: string | null
          readiness_state?: string | null
          reference_media?: Json | null
          site_notes?: string | null
          special_requirements?: string | null
          status?: string | null
          story_angle?: string | null
          target_window_end?: string | null
          target_window_start?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          content_types?: string[] | null
          created_at?: string | null
          customer_owner_id?: string | null
          id?: string | null
          interview_subjects?: string | null
          marketing_owner_id?: string | null
          nominated_by?: string | null
          nomination_reason?: string | null
          opportunity_id?: string | null
          priority?: string | null
          products_used?: string[] | null
          project_id?: string | null
          purchase_id?: string | null
          readiness_state?: string | null
          reference_media?: Json | null
          site_notes?: string | null
          special_requirements?: string | null
          status?: string | null
          story_angle?: string | null
          target_window_end?: string | null
          target_window_start?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "content_opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      content_opportunity_status_events: {
        Row: {
          actor_id: string | null
          content_opportunity_id: string | null
          from_status: string | null
          id: string | null
          occurred_at: string | null
          reason: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          content_opportunity_id?: string | null
          from_status?: string | null
          id?: string | null
          occurred_at?: string | null
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          content_opportunity_id?: string | null
          from_status?: string | null
          id?: string | null
          occurred_at?: string | null
          reason?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_opportunity_status_events_content_opportunity_id_fkey"
            columns: ["content_opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      corpus_reconciliation: {
        Row: {
          catalog_edition_candidates: number | null
          certificate_candidates: number | null
          certificate_candidates_not_pending: number | null
          commercial_amount_observations: number | null
          corpus_review_tasks: number | null
          duplicate_code_groups: number | null
          media_assets: number | null
          media_links: number | null
          page_renders: number | null
          price_candidates: number | null
          price_candidates_not_pending: number | null
          shape_profiles: number | null
          source_assets: number | null
          source_pdfs: number | null
          standalone_images: number | null
          variant_candidates: number | null
          variant_candidates_not_pending: number | null
          versions_connector_only: number | null
          versions_deferred: number | null
          versions_excluded: number | null
          versions_uploaded: number | null
          visual_observations: number | null
          workspace_id: string | null
        }
        Insert: {
          catalog_edition_candidates?: never
          certificate_candidates?: never
          certificate_candidates_not_pending?: never
          commercial_amount_observations?: never
          corpus_review_tasks?: never
          duplicate_code_groups?: never
          media_assets?: never
          media_links?: never
          page_renders?: never
          price_candidates?: never
          price_candidates_not_pending?: never
          shape_profiles?: never
          source_assets?: never
          source_pdfs?: never
          standalone_images?: never
          variant_candidates?: never
          variant_candidates_not_pending?: never
          versions_connector_only?: never
          versions_deferred?: never
          versions_excluded?: never
          versions_uploaded?: never
          visual_observations?: never
          workspace_id?: string | null
        }
        Update: {
          catalog_edition_candidates?: never
          certificate_candidates?: never
          certificate_candidates_not_pending?: never
          commercial_amount_observations?: never
          corpus_review_tasks?: never
          duplicate_code_groups?: never
          media_assets?: never
          media_links?: never
          page_renders?: never
          price_candidates?: never
          price_candidates_not_pending?: never
          shape_profiles?: never
          source_assets?: never
          source_pdfs?: never
          standalone_images?: never
          variant_candidates?: never
          variant_candidates_not_pending?: never
          versions_connector_only?: never
          versions_deferred?: never
          versions_excluded?: never
          versions_uploaded?: never
          visual_observations?: never
          workspace_id?: string | null
        }
        Relationships: []
      }
      corpus_validation_issues: {
        Row: {
          affected_candidate_count: number | null
          created_at: string | null
          details: Json | null
          external_source_id: string | null
          id: string | null
          issue_key: string | null
          issue_type: string | null
          review_state: string | null
          severity: string | null
          severity_raw: string | null
          source_asset_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          affected_candidate_count?: number | null
          created_at?: string | null
          details?: Json | null
          external_source_id?: string | null
          id?: string | null
          issue_key?: string | null
          issue_type?: string | null
          review_state?: string | null
          severity?: string | null
          severity_raw?: string | null
          source_asset_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          affected_candidate_count?: number | null
          created_at?: string | null
          details?: Json | null
          external_source_id?: string | null
          id?: string | null
          issue_key?: string | null
          issue_type?: string | null
          review_state?: string | null
          severity?: string | null
          severity_raw?: string | null
          source_asset_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corpus_validation_issues_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "corpus_validation_issues_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corpus_validation_issues_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corpus_validation_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "corpus_validation_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      current_variant_prices: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          currency: string | null
          id: string | null
          min_quantity: number | null
          price_list_id: string | null
          price_list_name: string | null
          price_type: string | null
          product_id: string | null
          review_state: string | null
          source_ref: string | null
          state: string | null
          unit_code: string | null
          unit_label: string | null
          valid_from: string | null
          valid_to: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "variant_prices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      data_quality_issues: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          details: Json | null
          id: string | null
          issue_type: string | null
          object_id: string | null
          object_type: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
          status: string | null
          summary: string | null
          workspace_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string | null
          issue_type?: string | null
          object_id?: string | null
          object_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          status?: string | null
          summary?: string | null
          workspace_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string | null
          issue_type?: string | null
          object_id?: string | null
          object_type?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          status?: string | null
          summary?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_quality_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "data_quality_issues_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_code_groups: {
        Row: {
          brand_hint: string | null
          candidate_count: number | null
          candidate_keys: string[] | null
          created_at: string | null
          external_source_ids: string[] | null
          group_key: string | null
          id: string | null
          resolution_state: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_count: number | null
          supplier_code_normalized: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_hint?: string | null
          candidate_count?: number | null
          candidate_keys?: string[] | null
          created_at?: string | null
          external_source_ids?: string[] | null
          group_key?: string | null
          id?: string | null
          resolution_state?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_count?: number | null
          supplier_code_normalized?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_hint?: string | null
          candidate_count?: number | null
          candidate_keys?: string[] | null
          created_at?: string | null
          external_source_ids?: string[] | null
          group_key?: string | null
          id?: string | null
          resolution_state?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_count?: number | null
          supplier_code_normalized?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_code_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "duplicate_code_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_calendar_links: {
        Row: {
          calendar_id: string | null
          conflict_state: string | null
          created_at: string | null
          event_id: string | null
          id: string | null
          last_synced_at: string | null
          provider: string | null
          shoot_booking_id: string | null
          sync_direction: string | null
          workspace_id: string | null
        }
        Insert: {
          calendar_id?: string | null
          conflict_state?: string | null
          created_at?: string | null
          event_id?: string | null
          id?: string | null
          last_synced_at?: string | null
          provider?: string | null
          shoot_booking_id?: string | null
          sync_direction?: string | null
          workspace_id?: string | null
        }
        Update: {
          calendar_id?: string | null
          conflict_state?: string | null
          created_at?: string | null
          event_id?: string | null
          id?: string | null
          last_synced_at?: string | null
          provider?: string | null
          shoot_booking_id?: string | null
          sync_direction?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_calendar_links_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_calendar_links_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_calendar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_calendar_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "external_calendar_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_document_links: {
        Row: {
          created_at: string | null
          created_by: string | null
          document_number: string | null
          document_type: string | null
          id: string | null
          metadata: Json | null
          object_id: string | null
          object_type: string | null
          system: string | null
          url: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          document_number?: string | null
          document_type?: string | null
          id?: string | null
          metadata?: Json | null
          object_id?: string | null
          object_type?: string | null
          system?: string | null
          url?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          document_number?: string | null
          document_type?: string | null
          id?: string | null
          metadata?: Json | null
          object_id?: string | null
          object_type?: string | null
          system?: string | null
          url?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_document_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "external_document_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      external_identities: {
        Row: {
          account_id: string | null
          contact_id: string | null
          external_id: string | null
          first_seen_at: string | null
          id: string | null
          last_seen_at: string | null
          provider: string | null
          raw: Json | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          external_id?: string | null
          first_seen_at?: string | null
          id?: string | null
          last_seen_at?: string | null
          provider?: string | null
          raw?: Json | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          external_id?: string | null
          first_seen_at?: string | null
          id?: string | null
          last_seen_at?: string | null
          provider?: string | null
          raw?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_identities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_identities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_identities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "external_identities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_fields: {
        Row: {
          confidence: number | null
          field_key: string | null
          id: string | null
          record_id: string | null
          region: Json | null
          source_text: string | null
          value: string | null
        }
        Insert: {
          confidence?: number | null
          field_key?: string | null
          id?: string | null
          record_id?: string | null
          region?: Json | null
          source_text?: string | null
          value?: string | null
        }
        Update: {
          confidence?: number | null
          field_key?: string | null
          id?: string | null
          record_id?: string | null
          region?: Json | null
          source_text?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extracted_fields_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "ingestion_records"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          enabled: boolean | null
          key: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          enabled?: boolean | null
          key?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          enabled?: boolean | null
          key?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "feature_flags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      field_mappings: {
        Row: {
          connection_id: string | null
          created_at: string | null
          created_by: string | null
          form_ref: string | null
          id: string | null
          provider: string | null
          source_field: string | null
          target_field: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          connection_id?: string | null
          created_at?: string | null
          created_by?: string | null
          form_ref?: string | null
          id?: string | null
          provider?: string | null
          source_field?: string | null
          target_field?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          connection_id?: string | null
          created_at?: string | null
          created_by?: string | null
          form_ref?: string | null
          id?: string | null
          provider?: string | null
          source_field?: string | null
          target_field?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_mappings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "field_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "field_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_match_candidates: {
        Row: {
          candidate_id: string | null
          confidence: string | null
          created_at: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string | null
          reasons: Json | null
          score: number | null
          status: string | null
          subject_id: string | null
          subject_type: string | null
          workspace_id: string | null
        }
        Insert: {
          candidate_id?: string | null
          confidence?: string | null
          created_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string | null
          reasons?: Json | null
          score?: number | null
          status?: string | null
          subject_id?: string | null
          subject_type?: string | null
          workspace_id?: string | null
        }
        Update: {
          candidate_id?: string | null
          confidence?: string | null
          created_at?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string | null
          reasons?: Json | null
          score?: number | null
          status?: string | null
          subject_id?: string | null
          subject_type?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_match_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "identity_match_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_merge_events: {
        Row: {
          actor_id: string | null
          before_snapshot: Json | null
          entity_type: string | null
          id: string | null
          merged_id: string | null
          occurred_at: string | null
          reason: string | null
          relinked: Json | null
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          survivor_id: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_id?: string | null
          before_snapshot?: Json | null
          entity_type?: string | null
          id?: string | null
          merged_id?: string | null
          occurred_at?: string | null
          reason?: string | null
          relinked?: Json | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          survivor_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_id?: string | null
          before_snapshot?: Json | null
          entity_type?: string | null
          id?: string | null
          merged_id?: string | null
          occurred_at?: string | null
          reason?: string | null
          relinked?: Json | null
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          survivor_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_merge_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "identity_merge_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_items: {
        Row: {
          actual_count: number | null
          attempts: number | null
          checksum: string | null
          created_at: string | null
          expected_count: number | null
          external_key: string | null
          id: string | null
          import_run_id: string | null
          item_kind: string | null
          message: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          actual_count?: number | null
          attempts?: number | null
          checksum?: string | null
          created_at?: string | null
          expected_count?: number | null
          external_key?: string | null
          id?: string | null
          import_run_id?: string | null
          item_kind?: string | null
          message?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          actual_count?: number | null
          attempts?: number | null
          checksum?: string | null
          created_at?: string | null
          expected_count?: number | null
          external_key?: string | null
          id?: string | null
          import_run_id?: string | null
          item_kind?: string | null
          message?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_items_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "import_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          completed_at: string | null
          corpus_cutoff: string | null
          counts: Json | null
          created_at: string | null
          created_by: string | null
          error_code: string | null
          error_detail_safe: string | null
          id: string | null
          parser_name: string | null
          parser_version: string | null
          pipeline_version: string | null
          run_key: string | null
          started_at: string | null
          status: string | null
          target_env: string | null
          updated_at: string | null
          warning_count: number | null
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          corpus_cutoff?: string | null
          counts?: Json | null
          created_at?: string | null
          created_by?: string | null
          error_code?: string | null
          error_detail_safe?: string | null
          id?: string | null
          parser_name?: string | null
          parser_version?: string | null
          pipeline_version?: string | null
          run_key?: string | null
          started_at?: string | null
          status?: string | null
          target_env?: string | null
          updated_at?: string | null
          warning_count?: number | null
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          corpus_cutoff?: string | null
          counts?: Json | null
          created_at?: string | null
          created_by?: string | null
          error_code?: string | null
          error_detail_safe?: string | null
          id?: string | null
          parser_name?: string | null
          parser_version?: string | null
          pipeline_version?: string | null
          run_key?: string | null
          started_at?: string | null
          status?: string | null
          target_env?: string | null
          updated_at?: string | null
          warning_count?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "import_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_jobs: {
        Row: {
          attempts: number | null
          created_at: string | null
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string | null
          job_type: string | null
          parser_version: string | null
          progress: Json | null
          source_asset_id: string | null
          started_at: string | null
          stats: Json | null
          status: string | null
          workspace_id: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string | null
          job_type?: string | null
          parser_version?: string | null
          progress?: Json | null
          source_asset_id?: string | null
          started_at?: string | null
          stats?: Json | null
          status?: string | null
          workspace_id?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string | null
          job_type?: string | null
          parser_version?: string | null
          progress?: Json | null
          source_asset_id?: string | null
          started_at?: string | null
          stats?: Json | null
          status?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_jobs_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "ingestion_jobs_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_jobs_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "ingestion_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_records: {
        Row: {
          confidence: number | null
          id: string | null
          issues: Json | null
          job_id: string | null
          normalized: Json | null
          page_no: number | null
          raw: Json | null
          row_no: number | null
          status: string | null
        }
        Insert: {
          confidence?: number | null
          id?: string | null
          issues?: Json | null
          job_id?: string | null
          normalized?: Json | null
          page_no?: number | null
          raw?: Json | null
          row_no?: number | null
          status?: string | null
        }
        Update: {
          confidence?: number | null
          id?: string | null
          issues?: Json | null
          job_id?: string | null
          normalized?: Json | null
          page_no?: number | null
          raw?: Json | null
          row_no?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingestion_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["job_id"]
          },
        ]
      }
      intake_events: {
        Row: {
          created_by: string | null
          external_id: string | null
          id: string | null
          idempotency_key: string | null
          lead_id: string | null
          occurred_at: string | null
          payload: Json | null
          provider: string | null
          raw_text: string | null
          received_at: string | null
          source_channel: string | null
          status: string | null
          workspace_id: string | null
        }
        Insert: {
          created_by?: string | null
          external_id?: string | null
          id?: string | null
          idempotency_key?: string | null
          lead_id?: string | null
          occurred_at?: string | null
          payload?: Json | null
          provider?: string | null
          raw_text?: string | null
          received_at?: string | null
          source_channel?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_by?: string | null
          external_id?: string | null
          id?: string | null
          idempotency_key?: string | null
          lead_id?: string | null
          occurred_at?: string | null
          payload?: Json | null
          provider?: string | null
          raw_text?: string | null
          received_at?: string | null
          source_channel?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_events_lead_fk"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "intake_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_reconciliation: {
        Row: {
          day: string | null
          deduplicated: number | null
          failed: number | null
          processed: number | null
          provider: string | null
          received: number | null
          source_channel: string | null
          unlinked: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "intake_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          business_purpose: string | null
          config: Json | null
          created_at: string | null
          credential_ref: string | null
          direction: string | null
          environment: string | null
          id: string | null
          last_attempt_at: string | null
          last_error: string | null
          last_success_at: string | null
          name: string | null
          owner_id: string | null
          provider: string | null
          scopes: string[] | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          business_purpose?: string | null
          config?: Json | null
          created_at?: string | null
          credential_ref?: string | null
          direction?: string | null
          environment?: string | null
          id?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          name?: string | null
          owner_id?: string | null
          provider?: string | null
          scopes?: string[] | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          business_purpose?: string | null
          config?: Json | null
          created_at?: string | null
          credential_ref?: string | null
          direction?: string | null
          environment?: string | null
          id?: string | null
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          name?: string | null
          owner_id?: string | null
          provider?: string | null
          scopes?: string[] | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "integration_connections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_mappings: {
        Row: {
          created_at: string | null
          external_item_code: string | null
          id: string | null
          source_id: string | null
          status: string | null
          unit_id: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          external_item_code?: string | null
          id?: string | null
          source_id?: string | null
          status?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          external_item_code?: string | null
          id?: string | null
          source_id?: string | null
          status?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_mappings_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "inventory_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_mappings_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_mappings_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_item_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "inventory_item_mappings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          business_location_id: string | null
          created_at: string | null
          external_code: string | null
          id: string | null
          name: string | null
          source_id: string | null
          workspace_id: string | null
        }
        Insert: {
          business_location_id?: string | null
          created_at?: string | null
          external_code?: string | null
          id?: string | null
          name?: string | null
          source_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          business_location_id?: string | null
          created_at?: string | null
          external_code?: string | null
          id?: string | null
          name?: string | null
          source_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_business_location_id_fkey"
            columns: ["business_location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "inventory_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "inventory_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          id: string | null
          location_id: string | null
          movement_type: string | null
          occurred_at: string | null
          quantity: number | null
          recorded_by: string | null
          reference: string | null
          source_id: string | null
          unit_id: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          id?: string | null
          location_id?: string | null
          movement_type?: string | null
          occurred_at?: string | null
          quantity?: number | null
          recorded_by?: string | null
          reference?: string | null
          source_id?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          id?: string | null
          location_id?: string | null
          movement_type?: string | null
          occurred_at?: string | null
          quantity?: number | null
          recorded_by?: string | null
          reference?: string | null
          source_id?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "inventory_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "inventory_movements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_snapshots: {
        Row: {
          allocated: number | null
          available: number | null
          captured_at: string | null
          checkpoint: string | null
          external_item_code: string | null
          id: string | null
          location_id: string | null
          on_hand: number | null
          source_id: string | null
          source_timestamp: string | null
          unit_id: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          allocated?: number | null
          available?: number | null
          captured_at?: string | null
          checkpoint?: string | null
          external_item_code?: string | null
          id?: string | null
          location_id?: string | null
          on_hand?: number | null
          source_id?: string | null
          source_timestamp?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          allocated?: number | null
          available?: number | null
          captured_at?: string | null
          checkpoint?: string | null
          external_item_code?: string | null
          id?: string | null
          location_id?: string | null
          on_hand?: number | null
          source_id?: string | null
          source_timestamp?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_snapshots_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_snapshots_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "inventory_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_snapshots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_snapshots_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "inventory_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_sources: {
        Row: {
          config: Json | null
          created_at: string | null
          freshness_sla_minutes: number | null
          id: string | null
          is_authoritative: boolean | null
          key: string | null
          kind: string | null
          name: string | null
          workspace_id: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          freshness_sla_minutes?: number | null
          id?: string | null
          is_authoritative?: boolean | null
          key?: string | null
          kind?: string | null
          name?: string | null
          workspace_id?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          freshness_sla_minutes?: number | null
          id?: string | null
          is_authoritative?: boolean | null
          key?: string | null
          kind?: string | null
          name?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "inventory_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_intake_links: {
        Row: {
          intake_event_id: string | null
          lead_id: string | null
        }
        Insert: {
          intake_event_id?: string | null
          lead_id?: string | null
        }
        Update: {
          intake_event_id?: string | null
          lead_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_intake_links_intake_event_id_fkey"
            columns: ["intake_event_id"]
            isOneToOne: false
            referencedRelation: "intake_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intake_links_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          account_id: string | null
          assigned_at: string | null
          contact_attempts: number | null
          contact_id: string | null
          converted_opportunity_id: string | null
          created_at: string | null
          created_by: string | null
          disqualified_reason: string | null
          duplicate_of_lead_id: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          id: string | null
          interest: string | null
          location_id: string | null
          notes: string | null
          owner_id: string | null
          product_interest: string[] | null
          qualified_at: string | null
          raw_company: string | null
          raw_email: string | null
          raw_name: string | null
          raw_phone: string | null
          raw_phone_normalized: string | null
          source_channel: string | null
          source_detail: string | null
          status: string | null
          updated_at: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          assigned_at?: string | null
          contact_attempts?: number | null
          contact_id?: string | null
          converted_opportunity_id?: string | null
          created_at?: string | null
          created_by?: string | null
          disqualified_reason?: string | null
          duplicate_of_lead_id?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string | null
          interest?: string | null
          location_id?: string | null
          notes?: string | null
          owner_id?: string | null
          product_interest?: string[] | null
          qualified_at?: string | null
          raw_company?: string | null
          raw_email?: string | null
          raw_name?: string | null
          raw_phone?: string | null
          raw_phone_normalized?: string | null
          source_channel?: string | null
          source_detail?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          assigned_at?: string | null
          contact_attempts?: number | null
          contact_id?: string | null
          converted_opportunity_id?: string | null
          created_at?: string | null
          created_by?: string | null
          disqualified_reason?: string | null
          duplicate_of_lead_id?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string | null
          interest?: string | null
          location_id?: string | null
          notes?: string | null
          owner_id?: string | null
          product_interest?: string[] | null
          qualified_at?: string | null
          raw_company?: string | null
          raw_email?: string | null
          raw_name?: string | null
          raw_phone?: string | null
          raw_phone_normalized?: string | null
          source_channel?: string | null
          source_detail?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_opportunity_fk"
            columns: ["converted_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_duplicate_of_lead_id_fkey"
            columns: ["duplicate_of_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_asset_variant_links: {
        Row: {
          confidence: number | null
          created_at: string | null
          external_key: string | null
          id: string | null
          link_basis: string | null
          link_basis_raw: string | null
          media_asset_id: string | null
          page_number: number | null
          product_variant_id: string | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_code_raw: string | null
          source_region: Json | null
          updated_at: string | null
          variant_candidate_id: string | null
          variant_candidate_key: string | null
          workspace_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          external_key?: string | null
          id?: string | null
          link_basis?: string | null
          link_basis_raw?: string | null
          media_asset_id?: string | null
          page_number?: number | null
          product_variant_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_code_raw?: string | null
          source_region?: Json | null
          updated_at?: string | null
          variant_candidate_id?: string | null
          variant_candidate_key?: string | null
          workspace_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          external_key?: string | null
          id?: string | null
          link_basis?: string | null
          link_basis_raw?: string | null
          media_asset_id?: string | null
          page_number?: number | null
          product_variant_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_code_raw?: string | null
          source_region?: Json | null
          updated_at?: string | null
          variant_candidate_id?: string | null
          variant_candidate_key?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_asset_variant_links_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_asset_variant_links_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_asset_variant_links_variant_candidate_id_fkey"
            columns: ["variant_candidate_id"]
            isOneToOne: false
            referencedRelation: "variant_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_asset_variant_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "media_asset_variant_links_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          asset_kind: string | null
          brand_hint: string | null
          content_checksum: string | null
          created_at: string | null
          document_class: string | null
          external_key: string | null
          height_px: number | null
          id: string | null
          mime_type: string | null
          object_path: string | null
          orientation: string | null
          page_number: number | null
          parent_media_asset_id: string | null
          pipeline_version: string | null
          region: Json | null
          review_state: string | null
          size_bytes: number | null
          source_asset_id: string | null
          source_path: string | null
          source_version_id: string | null
          source_web_url: string | null
          storage_bucket: string | null
          updated_at: string | null
          usage_rights_state: string | null
          width_px: number | null
          workspace_id: string | null
        }
        Insert: {
          asset_kind?: string | null
          brand_hint?: string | null
          content_checksum?: string | null
          created_at?: string | null
          document_class?: string | null
          external_key?: string | null
          height_px?: number | null
          id?: string | null
          mime_type?: string | null
          object_path?: string | null
          orientation?: string | null
          page_number?: number | null
          parent_media_asset_id?: string | null
          pipeline_version?: string | null
          region?: Json | null
          review_state?: string | null
          size_bytes?: number | null
          source_asset_id?: string | null
          source_path?: string | null
          source_version_id?: string | null
          source_web_url?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
          usage_rights_state?: string | null
          width_px?: number | null
          workspace_id?: string | null
        }
        Update: {
          asset_kind?: string | null
          brand_hint?: string | null
          content_checksum?: string | null
          created_at?: string | null
          document_class?: string | null
          external_key?: string | null
          height_px?: number | null
          id?: string | null
          mime_type?: string | null
          object_path?: string | null
          orientation?: string | null
          page_number?: number | null
          parent_media_asset_id?: string | null
          pipeline_version?: string | null
          region?: Json | null
          review_state?: string | null
          size_bytes?: number | null
          source_asset_id?: string | null
          source_path?: string | null
          source_version_id?: string | null
          source_web_url?: string | null
          storage_bucket?: string | null
          updated_at?: string | null
          usage_rights_state?: string | null
          width_px?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_parent_media_asset_id_fkey"
            columns: ["parent_media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "media_assets_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "media_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      media_permission_records: {
        Row: {
          account_id: string | null
          contact_id: string | null
          content_opportunity_id: string | null
          created_at: string | null
          evidence_storage_path: string | null
          expires_at: string | null
          granted_at: string | null
          granted_by_name: string | null
          id: string | null
          permitted_capture: string[] | null
          permitted_uses: string[] | null
          recorded_by: string | null
          restrictions: string | null
          revocation_reason: string | null
          revoked_at: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          content_opportunity_id?: string | null
          created_at?: string | null
          evidence_storage_path?: string | null
          expires_at?: string | null
          granted_at?: string | null
          granted_by_name?: string | null
          id?: string | null
          permitted_capture?: string[] | null
          permitted_uses?: string[] | null
          recorded_by?: string | null
          restrictions?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          content_opportunity_id?: string | null
          created_at?: string | null
          evidence_storage_path?: string | null
          expires_at?: string | null
          granted_at?: string | null
          granted_by_name?: string | null
          id?: string | null
          permitted_capture?: string[] | null
          permitted_uses?: string[] | null
          recorded_by?: string | null
          restrictions?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_permission_records_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_permission_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_permission_records_content_opportunity_id_fkey"
            columns: ["content_opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_permission_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "media_permission_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_invites: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          default_location_id: string | null
          email: string | null
          id: string | null
          invited_by: string | null
          role_key: string | null
          status: string | null
          workspace_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          default_location_id?: string | null
          email?: string | null
          id?: string | null
          invited_by?: string | null
          role_key?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          default_location_id?: string | null
          email?: string | null
          id?: string | null
          invited_by?: string | null
          role_key?: string | null
          status?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_invites_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_invites_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "membership_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "membership_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_scopes: {
        Row: {
          created_at: string | null
          id: string | null
          membership_id: string | null
          scope_id: string | null
          scope_type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          membership_id?: string | null
          scope_id?: string | null
          scope_type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          membership_id?: string | null
          scope_id?: string | null
          scope_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "membership_scopes_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string | null
          default_location_id: string | null
          id: string | null
          role_key: string | null
          status: string | null
          team_id: string | null
          updated_at: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          default_location_id?: string | null
          id?: string | null
          role_key?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          default_location_id?: string | null
          id?: string | null
          role_key?: string | null
          status?: string | null
          team_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_default_location_id_fkey"
            columns: ["default_location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "memberships_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_definitions: {
        Row: {
          caveat: string | null
          formula: string | null
          grain: string | null
          key: string | null
          name: string | null
          pii_class: string | null
          quality: string | null
          report_key: string | null
          sources: string[] | null
        }
        Insert: {
          caveat?: string | null
          formula?: string | null
          grain?: string | null
          key?: string | null
          name?: string | null
          pii_class?: string | null
          quality?: string | null
          report_key?: string | null
          sources?: string[] | null
        }
        Update: {
          caveat?: string | null
          formula?: string | null
          grain?: string | null
          key?: string | null
          name?: string | null
          pii_class?: string | null
          quality?: string | null
          report_key?: string | null
          sources?: string[] | null
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          account_id: string | null
          competitor: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          deferred_until: string | null
          estimated_value: number | null
          expected_close_date: string | null
          id: string | null
          lead_id: string | null
          lost_at: string | null
          name: string | null
          next_action: string | null
          next_action_due_at: string | null
          notes: string | null
          outcome_reason: string | null
          owner_id: string | null
          probability_band: string | null
          product_interest: string[] | null
          project_id: string | null
          segment: string | null
          source_channel: string | null
          stage_key: string | null
          status: string | null
          updated_at: string | null
          version: number | null
          won_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          competitor?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          deferred_until?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string | null
          lead_id?: string | null
          lost_at?: string | null
          name?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          notes?: string | null
          outcome_reason?: string | null
          owner_id?: string | null
          probability_band?: string | null
          product_interest?: string[] | null
          project_id?: string | null
          segment?: string | null
          source_channel?: string | null
          stage_key?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          won_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          competitor?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          deferred_until?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string | null
          lead_id?: string | null
          lost_at?: string | null
          name?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          notes?: string | null
          outcome_reason?: string | null
          owner_id?: string | null
          probability_band?: string | null
          product_interest?: string[] | null
          project_id?: string | null
          segment?: string | null
          source_channel?: string | null
          stage_key?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          won_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "opportunities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_stage_events: {
        Row: {
          actor_id: string | null
          from_stage_key: string | null
          id: string | null
          is_backward: boolean | null
          occurred_at: string | null
          opportunity_id: string | null
          reason: string | null
          to_stage_key: string | null
          workspace_id: string | null
        }
        Insert: {
          actor_id?: string | null
          from_stage_key?: string | null
          id?: string | null
          is_backward?: boolean | null
          occurred_at?: string | null
          opportunity_id?: string | null
          reason?: string | null
          to_stage_key?: string | null
          workspace_id?: string | null
        }
        Update: {
          actor_id?: string | null
          from_stage_key?: string | null
          id?: string | null
          is_backward?: boolean | null
          occurred_at?: string | null
          opportunity_id?: string | null
          reason?: string | null
          to_stage_key?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stage_events_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "opportunity_stage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_stages: {
        Row: {
          id: string | null
          is_active: boolean | null
          key: string | null
          label: string | null
          position: number | null
          reporting_group: string | null
          requires_next_action: boolean | null
          requires_reason: boolean | null
          workspace_id: string | null
        }
        Insert: {
          id?: string | null
          is_active?: boolean | null
          key?: string | null
          label?: string | null
          position?: number | null
          reporting_group?: string | null
          requires_next_action?: boolean | null
          requires_reason?: boolean | null
          workspace_id?: string | null
        }
        Update: {
          id?: string | null
          is_active?: boolean | null
          key?: string | null
          label?: string | null
          position?: number | null
          reporting_group?: string | null
          requires_next_action?: boolean | null
          requires_reason?: boolean | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "opportunity_stages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_roles: {
        Row: {
          brand_id: string | null
          created_at: string | null
          id: string | null
          organization_id: string | null
          product_category_id: string | null
          review_state: string | null
          role: string | null
          scope_note: string | null
          source_version_id: string | null
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_id?: string | null
          created_at?: string | null
          id?: string | null
          organization_id?: string | null
          product_category_id?: string | null
          review_state?: string | null
          role?: string | null
          scope_note?: string | null
          source_version_id?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_id?: string | null
          created_at?: string | null
          id?: string | null
          organization_id?: string | null
          product_category_id?: string | null
          review_state?: string | null
          role?: string | null
          scope_note?: string | null
          source_version_id?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_roles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_roles_product_category_id_fkey"
            columns: ["product_category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_roles_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "organization_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          canonical_name: string | null
          country_code: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          normalized_name: string | null
          registration_name: string | null
          review_state: string | null
          source_version_id: string | null
          status: string | null
          updated_at: string | null
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          canonical_name?: string | null
          country_code?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          normalized_name?: string | null
          registration_name?: string | null
          review_state?: string | null
          source_version_id?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          canonical_name?: string | null
          country_code?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          normalized_name?: string | null
          registration_name?: string | null
          review_state?: string | null
          source_version_id?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "organizations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      packaging_configurations: {
        Row: {
          coverage_per_pack: number | null
          coverage_unit_id: string | null
          created_at: string | null
          effective_from: string | null
          effective_to: string | null
          gross_weight_kg: number | null
          id: string | null
          inner_unit_id: string | null
          moq: number | null
          order_increment: number | null
          pack_label: string | null
          pack_unit_id: string | null
          quantity_per_pack: number | null
          review_state: string | null
          source_version_id: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          coverage_per_pack?: number | null
          coverage_unit_id?: string | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          gross_weight_kg?: number | null
          id?: string | null
          inner_unit_id?: string | null
          moq?: number | null
          order_increment?: number | null
          pack_label?: string | null
          pack_unit_id?: string | null
          quantity_per_pack?: number | null
          review_state?: string | null
          source_version_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          coverage_per_pack?: number | null
          coverage_unit_id?: string | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          gross_weight_kg?: number | null
          id?: string | null
          inner_unit_id?: string | null
          moq?: number | null
          order_increment?: number | null
          pack_label?: string | null
          pack_unit_id?: string | null
          quantity_per_pack?: number | null
          review_state?: string | null
          source_version_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packaging_configurations_coverage_unit_id_fkey"
            columns: ["coverage_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configurations_inner_unit_id_fkey"
            columns: ["inner_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configurations_pack_unit_id_fkey"
            columns: ["pack_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configurations_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configurations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packaging_configurations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "packaging_configurations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      price_approval_events: {
        Row: {
          action: string | null
          actor_id: string | null
          id: string | null
          occurred_at: string | null
          reason: string | null
          variant_price_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          id?: string | null
          occurred_at?: string | null
          reason?: string | null
          variant_price_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          id?: string | null
          occurred_at?: string | null
          reason?: string | null
          variant_price_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_approval_events_variant_price_id_fkey"
            columns: ["variant_price_id"]
            isOneToOne: false
            referencedRelation: "current_variant_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_approval_events_variant_price_id_fkey"
            columns: ["variant_price_id"]
            isOneToOne: false
            referencedRelation: "variant_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_approval_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "price_approval_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      price_candidates: {
        Row: {
          amount_normalized: number | null
          amount_raw: string | null
          brand_hint: string | null
          candidate_key: string | null
          candidate_record_id: string | null
          confidence: number | null
          created_at: string | null
          currency_code: string | null
          effective_date_raw: string | null
          external_source_id: string | null
          extraction_rule: string | null
          id: string | null
          price_type_raw: string | null
          product_code_candidate: string | null
          published_price_id: string | null
          review_state: string | null
          source_asset_id: string | null
          source_locator: Json | null
          source_path: string | null
          tax_basis: string | null
          unit_basis: string | null
          updated_at: string | null
          validation_flags: Json | null
          variant_candidate_key: string | null
          workspace_id: string | null
        }
        Insert: {
          amount_normalized?: number | null
          amount_raw?: string | null
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          confidence?: number | null
          created_at?: string | null
          currency_code?: string | null
          effective_date_raw?: string | null
          external_source_id?: string | null
          extraction_rule?: string | null
          id?: string | null
          price_type_raw?: string | null
          product_code_candidate?: string | null
          published_price_id?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          tax_basis?: string | null
          unit_basis?: string | null
          updated_at?: string | null
          validation_flags?: Json | null
          variant_candidate_key?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount_normalized?: number | null
          amount_raw?: string | null
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          confidence?: number | null
          created_at?: string | null
          currency_code?: string | null
          effective_date_raw?: string | null
          external_source_id?: string | null
          extraction_rule?: string | null
          id?: string | null
          price_type_raw?: string | null
          product_code_candidate?: string | null
          published_price_id?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          tax_basis?: string | null
          unit_basis?: string | null
          updated_at?: string | null
          validation_flags?: Json | null
          variant_candidate_key?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_candidates_candidate_record_id_fkey"
            columns: ["candidate_record_id"]
            isOneToOne: false
            referencedRelation: "candidate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_candidates_published_price_id_fkey"
            columns: ["published_price_id"]
            isOneToOne: false
            referencedRelation: "current_variant_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_candidates_published_price_id_fkey"
            columns: ["published_price_id"]
            isOneToOne: false
            referencedRelation: "variant_prices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "price_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "price_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          default_currency_code: string | null
          default_market: string | null
          default_price_type: string | null
          default_price_unit_id: string | null
          default_tax_basis: string | null
          effective_from: string | null
          effective_to: string | null
          id: string | null
          issued_at: string | null
          price_list_id: string | null
          review_state: string | null
          source_asset_id: string | null
          source_version_id: string | null
          supersedes_version_id: string | null
          updated_at: string | null
          version_label: string | null
          workspace_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          default_currency_code?: string | null
          default_market?: string | null
          default_price_type?: string | null
          default_price_unit_id?: string | null
          default_tax_basis?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          issued_at?: string | null
          price_list_id?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          supersedes_version_id?: string | null
          updated_at?: string | null
          version_label?: string | null
          workspace_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          default_currency_code?: string | null
          default_market?: string | null
          default_price_type?: string | null
          default_price_unit_id?: string | null
          default_tax_basis?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          issued_at?: string | null
          price_list_id?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_version_id?: string | null
          supersedes_version_id?: string | null
          updated_at?: string | null
          version_label?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_versions_default_price_unit_id_fkey"
            columns: ["default_price_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_versions_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_versions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "price_list_versions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_versions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_versions_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_versions_supersedes_version_id_fkey"
            columns: ["supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "price_list_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "price_list_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          brand_id: string | null
          category_id: string | null
          created_at: string | null
          currency: string | null
          id: string | null
          market: string | null
          name: string | null
          notes: string | null
          owner_id: string | null
          price_type: string | null
          source_ref: string | null
          status: string | null
          supplier_id: string | null
          tax_inclusive: boolean | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          market?: string | null
          name?: string | null
          notes?: string | null
          owner_id?: string | null
          price_type?: string | null
          source_ref?: string | null
          status?: string | null
          supplier_id?: string | null
          tax_inclusive?: boolean | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          market?: string | null
          name?: string | null
          notes?: string | null
          owner_id?: string | null
          price_type?: string | null
          source_ref?: string | null
          status?: string | null
          supplier_id?: string | null
          tax_inclusive?: boolean | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "stale_supplier_queue"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "price_lists_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_lists_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "price_lists_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_aliases: {
        Row: {
          alias: string | null
          alias_key: string | null
          created_at: string | null
          id: string | null
          normalized_alias: string | null
          product_id: string | null
          source: string | null
          workspace_id: string | null
        }
        Insert: {
          alias?: string | null
          alias_key?: string | null
          created_at?: string | null
          id?: string | null
          normalized_alias?: string | null
          product_id?: string | null
          source?: string | null
          workspace_id?: string | null
        }
        Update: {
          alias?: string | null
          alias_key?: string | null
          created_at?: string | null
          id?: string | null
          normalized_alias?: string | null
          product_id?: string | null
          source?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_aliases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "product_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_attribute_values: {
        Row: {
          attribute_definition_id: string | null
          confidence: number | null
          created_at: string | null
          id: string | null
          product_id: string | null
          review_state: string | null
          source_ref: string | null
          source_version_id: string | null
          unit_id: string | null
          valid_from: string | null
          valid_to: string | null
          value: Json | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          attribute_definition_id?: string | null
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          product_id?: string | null
          review_state?: string | null
          source_ref?: string | null
          source_version_id?: string | null
          unit_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          value?: Json | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          attribute_definition_id?: string | null
          confidence?: number | null
          created_at?: string | null
          id?: string | null
          product_id?: string | null
          review_state?: string | null
          source_ref?: string | null
          source_version_id?: string | null
          unit_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
          value?: Json | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_attribute_values_attribute_definition_id_fkey"
            columns: ["attribute_definition_id"]
            isOneToOne: false
            referencedRelation: "attribute_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_values_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_values_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_values_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_attribute_values_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "product_attribute_values_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          id: string | null
          is_active: boolean | null
          key: string | null
          label: string | null
          parent_id: string | null
          position: number | null
          workspace_id: string | null
        }
        Insert: {
          id?: string | null
          is_active?: boolean | null
          key?: string | null
          label?: string | null
          parent_id?: string | null
          position?: number | null
          workspace_id?: string | null
        }
        Update: {
          id?: string | null
          is_active?: boolean | null
          key?: string | null
          label?: string | null
          parent_id?: string | null
          position?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "product_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          alt_text: string | null
          caption: string | null
          created_at: string | null
          id: string | null
          is_primary: boolean | null
          kind: string | null
          media_asset_id: string | null
          media_asset_variant_link_id: string | null
          product_id: string | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sort_order: number | null
          source_ref: string | null
          storage_bucket: string | null
          storage_path: string | null
          usage_rights_state: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          kind?: string | null
          media_asset_id?: string | null
          media_asset_variant_link_id?: string | null
          product_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sort_order?: number | null
          source_ref?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          usage_rights_state?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          kind?: string | null
          media_asset_id?: string | null
          media_asset_variant_link_id?: string | null
          product_id?: string | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sort_order?: number | null
          source_ref?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          usage_rights_state?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_media_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_media_asset_variant_link_id_fkey"
            columns: ["media_asset_variant_link_id"]
            isOneToOne: false
            referencedRelation: "media_asset_variant_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_media_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "product_media_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_status_history: {
        Row: {
          created_at: string | null
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          id: string | null
          review_state: string | null
          source_locator: Json | null
          source_version_id: string | null
          status_code: string | null
          status_raw: string | null
          supersedes_id: string | null
          updated_at: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          review_state?: string | null
          source_locator?: Json | null
          source_version_id?: string | null
          status_code?: string | null
          status_raw?: string | null
          supersedes_id?: string | null
          updated_at?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string | null
          review_state?: string | null
          source_locator?: Json | null
          source_version_id?: string | null
          status_code?: string | null
          status_raw?: string | null
          supersedes_id?: string | null
          updated_at?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_status_history_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_status_history_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "product_status_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_status_history_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_status_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "product_status_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color_code: string | null
          created_at: string | null
          dimensions: Json | null
          finish_code: string | null
          grade_code: string | null
          id: string | null
          is_default: boolean | null
          manufacturer_code: string | null
          manufacturer_code_key: string | null
          name: string | null
          product_id: string | null
          purchase_unit_id: string | null
          selling_unit_id: string | null
          sku: string | null
          sku_key: string | null
          source_version_id: string | null
          status: string | null
          supplier_code: string | null
          supplier_code_key: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          color_code?: string | null
          created_at?: string | null
          dimensions?: Json | null
          finish_code?: string | null
          grade_code?: string | null
          id?: string | null
          is_default?: boolean | null
          manufacturer_code?: string | null
          manufacturer_code_key?: string | null
          name?: string | null
          product_id?: string | null
          purchase_unit_id?: string | null
          selling_unit_id?: string | null
          sku?: string | null
          sku_key?: string | null
          source_version_id?: string | null
          status?: string | null
          supplier_code?: string | null
          supplier_code_key?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          color_code?: string | null
          created_at?: string | null
          dimensions?: Json | null
          finish_code?: string | null
          grade_code?: string | null
          id?: string | null
          is_default?: boolean | null
          manufacturer_code?: string | null
          manufacturer_code_key?: string | null
          name?: string | null
          product_id?: string | null
          purchase_unit_id?: string | null
          selling_unit_id?: string | null
          sku?: string | null
          sku_key?: string | null
          source_version_id?: string | null
          status?: string | null
          supplier_code?: string | null
          supplier_code_key?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_purchase_unit_id_fkey"
            columns: ["purchase_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_selling_unit_id_fkey"
            columns: ["selling_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "product_variants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          applicable_use: string | null
          brand_id: string | null
          category_id: string | null
          code: string | null
          code_key: string | null
          color: string | null
          confidence: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          family: string | null
          finish: string | null
          id: string | null
          material: string | null
          material_code: string | null
          name: string | null
          normalized_name: string | null
          published_version: number | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          search_keywords: string[] | null
          series_name: string | null
          source_asset_id: string | null
          source_ref: string | null
          source_version_id: string | null
          status: string | null
          style: string | null
          supplier_id: string | null
          updated_at: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          applicable_use?: string | null
          brand_id?: string | null
          category_id?: string | null
          code?: string | null
          code_key?: string | null
          color?: string | null
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family?: string | null
          finish?: string | null
          id?: string | null
          material?: string | null
          material_code?: string | null
          name?: string | null
          normalized_name?: string | null
          published_version?: number | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_keywords?: string[] | null
          series_name?: string | null
          source_asset_id?: string | null
          source_ref?: string | null
          source_version_id?: string | null
          status?: string | null
          style?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          applicable_use?: string | null
          brand_id?: string | null
          category_id?: string | null
          code?: string | null
          code_key?: string | null
          color?: string | null
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          family?: string | null
          finish?: string | null
          id?: string | null
          material?: string | null
          material_code?: string | null
          name?: string | null
          normalized_name?: string | null
          published_version?: number | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_keywords?: string[] | null
          series_name?: string | null
          source_asset_id?: string | null
          source_ref?: string | null
          source_version_id?: string | null
          status?: string | null
          style?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "products_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "stale_supplier_queue"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      project_sites: {
        Row: {
          access_notes: string | null
          address: Json | null
          created_at: string | null
          id: string | null
          label: string | null
          project_id: string | null
          workspace_id: string | null
        }
        Insert: {
          access_notes?: string | null
          address?: Json | null
          created_at?: string | null
          id?: string | null
          label?: string | null
          project_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          access_notes?: string | null
          address?: Json | null
          created_at?: string | null
          id?: string | null
          label?: string | null
          project_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_sites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "project_sites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_id: string | null
          area: string | null
          created_at: string | null
          created_by: string | null
          expected_completion: string | null
          expected_start: string | null
          id: string | null
          name: string | null
          notes: string | null
          owner_id: string | null
          primary_contact_id: string | null
          project_type: string | null
          status: string | null
          updated_at: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          area?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_completion?: string | null
          expected_start?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          owner_id?: string | null
          primary_contact_id?: string | null
          project_type?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          area?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_completion?: string | null
          expected_start?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          owner_id?: string | null
          primary_contact_id?: string | null
          project_type?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_items: {
        Row: {
          description: string | null
          id: string | null
          line_total: number | null
          position: number | null
          price_snapshot: Json | null
          product_variant_id: string | null
          purchase_id: string | null
          quantity: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          description?: string | null
          id?: string | null
          line_total?: number | null
          position?: number | null
          price_snapshot?: Json | null
          product_variant_id?: string | null
          purchase_id?: string | null
          quantity?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          description?: string | null
          id?: string | null
          line_total?: number | null
          position?: number | null
          price_snapshot?: Json | null
          product_variant_id?: string | null
          purchase_id?: string | null
          quantity?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_payments: {
        Row: {
          amount: number | null
          created_at: string | null
          currency: string | null
          id: string | null
          method: string | null
          paid_at: string | null
          purchase_id: string | null
          reference: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          method?: string | null
          paid_at?: string | null
          purchase_id?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          method?: string | null
          paid_at?: string | null
          purchase_id?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_payments_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          account_id: string | null
          amount: number | null
          contact_id: string | null
          created_at: string | null
          currency: string | null
          external_ref: string | null
          id: string | null
          is_repeat: boolean | null
          location_id: string | null
          notes: string | null
          opportunity_id: string | null
          project_id: string | null
          purchase_source: string | null
          purchased_at: string | null
          recorded_by: string | null
          salesperson_id: string | null
          status: string | null
          updated_at: string | null
          version: number | null
          visit_id: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          amount?: number | null
          contact_id?: string | null
          created_at?: string | null
          currency?: string | null
          external_ref?: string | null
          id?: string | null
          is_repeat?: boolean | null
          location_id?: string | null
          notes?: string | null
          opportunity_id?: string | null
          project_id?: string | null
          purchase_source?: string | null
          purchased_at?: string | null
          recorded_by?: string | null
          salesperson_id?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          visit_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          amount?: number | null
          contact_id?: string | null
          created_at?: string | null
          currency?: string | null
          external_ref?: string | null
          id?: string | null
          is_repeat?: boolean | null
          location_id?: string | null
          notes?: string | null
          opportunity_id?: string | null
          project_id?: string | null
          purchase_source?: string | null
          purchased_at?: string | null
          recorded_by?: string | null
          salesperson_id?: string | null
          status?: string | null
          updated_at?: string | null
          version?: number | null
          visit_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "purchases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_items: {
        Row: {
          currency: string | null
          description: string | null
          id: string | null
          line_total: number | null
          position: number | null
          price_snapshot: Json | null
          product_variant_id: string | null
          quantity: number | null
          quote_version_id: string | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          currency?: string | null
          description?: string | null
          id?: string | null
          line_total?: number | null
          position?: number | null
          price_snapshot?: Json | null
          product_variant_id?: string | null
          quantity?: number | null
          quote_version_id?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          currency?: string | null
          description?: string | null
          id?: string | null
          line_total?: number | null
          position?: number | null
          price_snapshot?: Json | null
          product_variant_id?: string | null
          quantity?: number | null
          quote_version_id?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_quote_version_id_fkey"
            columns: ["quote_version_id"]
            isOneToOne: false
            referencedRelation: "quote_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_versions: {
        Row: {
          created_at: string | null
          created_by: string | null
          currency: string | null
          external_ref: string | null
          id: string | null
          issued_at: string | null
          notes: string | null
          quote_id: string | null
          total_amount: number | null
          valid_until: string | null
          version_no: number | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          external_ref?: string | null
          id?: string | null
          issued_at?: string | null
          notes?: string | null
          quote_id?: string | null
          total_amount?: number | null
          valid_until?: string | null
          version_no?: number | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          external_ref?: string | null
          id?: string | null
          issued_at?: string | null
          notes?: string | null
          quote_id?: string | null
          total_amount?: number | null
          valid_until?: string | null
          version_no?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_versions_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "quote_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string | null
          created_by: string | null
          current_version_no: number | null
          id: string | null
          opportunity_id: string | null
          quote_number: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          current_version_no?: number | null
          id?: string | null
          opportunity_id?: string | null
          quote_number?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          current_version_no?: number | null
          id?: string | null
          opportunity_id?: string | null
          quote_number?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "quotes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      review_decisions: {
        Row: {
          corrected_value: Json | null
          created_at: string | null
          decision: string | null
          id: string | null
          reason: string | null
          review_target_id: string | null
          review_target_key: string | null
          review_target_type: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          supersedes_id: string | null
          workspace_id: string | null
        }
        Insert: {
          corrected_value?: Json | null
          created_at?: string | null
          decision?: string | null
          id?: string | null
          reason?: string | null
          review_target_id?: string | null
          review_target_key?: string | null
          review_target_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          supersedes_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          corrected_value?: Json | null
          created_at?: string | null
          decision?: string | null
          id?: string | null
          reason?: string | null
          review_target_id?: string | null
          review_target_key?: string | null
          review_target_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          supersedes_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_decisions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "review_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "review_decisions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      review_items: {
        Row: {
          confidence: number | null
          conflicts: Json | null
          created_at: string | null
          decision_note: string | null
          external_key: string | null
          id: string | null
          import_run_id: string | null
          item_type: string | null
          job_id: string | null
          priority: number | null
          proposed: Json | null
          published_object_id: string | null
          record_id: string | null
          review_target_id: string | null
          review_target_key: string | null
          review_target_type: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          task_type: string | null
          workspace_id: string | null
        }
        Insert: {
          confidence?: number | null
          conflicts?: Json | null
          created_at?: string | null
          decision_note?: string | null
          external_key?: string | null
          id?: string | null
          import_run_id?: string | null
          item_type?: string | null
          job_id?: string | null
          priority?: number | null
          proposed?: Json | null
          published_object_id?: string | null
          record_id?: string | null
          review_target_id?: string | null
          review_target_key?: string | null
          review_target_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          task_type?: string | null
          workspace_id?: string | null
        }
        Update: {
          confidence?: number | null
          conflicts?: Json | null
          created_at?: string | null
          decision_note?: string | null
          external_key?: string | null
          id?: string | null
          import_run_id?: string | null
          item_type?: string | null
          job_id?: string | null
          priority?: number | null
          proposed?: Json | null
          published_object_id?: string | null
          record_id?: string | null
          review_target_id?: string | null
          review_target_key?: string | null
          review_target_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          task_type?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_items_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ingestion_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["job_id"]
          },
          {
            foreignKeyName: "review_items_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "ingestion_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "review_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      review_queue: {
        Row: {
          confidence: number | null
          conflicts: Json | null
          created_at: string | null
          decision_note: string | null
          fields: Json | null
          id: string | null
          item_type: string | null
          job_id: string | null
          job_type: string | null
          page_count: number | null
          page_no: number | null
          parser_version: string | null
          proposed: Json | null
          published_object_id: string | null
          raw: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          row_no: number | null
          source_asset_id: string | null
          source_kind: string | null
          source_name: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          supplier_name: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "review_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission: string | null
          role_key: string | null
        }
        Insert: {
          permission?: string | null
          role_key?: string | null
        }
        Update: {
          permission?: string | null
          role_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_key_fkey"
            columns: ["role_key"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["key"]
          },
        ]
      }
      roles: {
        Row: {
          description: string | null
          key: string | null
          label: string | null
          rank: number | null
        }
        Insert: {
          description?: string | null
          key?: string | null
          label?: string | null
          rank?: number | null
        }
        Update: {
          description?: string | null
          key?: string | null
          label?: string | null
          rank?: number | null
        }
        Relationships: []
      }
      routing_rules: {
        Row: {
          assign_to: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          match_location_id: string | null
          match_product_interest: string | null
          match_source_channel: string | null
          position: number | null
          workspace_id: string | null
        }
        Insert: {
          assign_to?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          match_location_id?: string | null
          match_product_interest?: string | null
          match_source_channel?: string | null
          position?: number | null
          workspace_id?: string | null
        }
        Update: {
          assign_to?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          match_location_id?: string | null
          match_product_interest?: string | null
          match_source_channel?: string | null
          position?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_rules_match_location_id_fkey"
            columns: ["match_location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "routing_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_targets: {
        Row: {
          created_at: string | null
          created_by: string | null
          currency: string | null
          id: string | null
          notes: string | null
          target_amount: number | null
          updated_at: string | null
          workspace_id: string | null
          year: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          notes?: string | null
          target_amount?: number | null
          updated_at?: string | null
          workspace_id?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          notes?: string | null
          target_amount?: number | null
          updated_at?: string | null
          workspace_id?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "sales_targets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          columns: Json | null
          created_at: string | null
          filters: Json | null
          id: string | null
          is_default: boolean | null
          name: string | null
          position: number | null
          sort: Json | null
          surface: string | null
          updated_at: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          columns?: Json | null
          created_at?: string | null
          filters?: Json | null
          id?: string | null
          is_default?: boolean | null
          name?: string | null
          position?: number | null
          sort?: Json | null
          surface?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          columns?: Json | null
          created_at?: string | null
          filters?: Json | null
          id?: string | null
          is_default?: boolean | null
          name?: string | null
          position?: number | null
          sort?: Json | null
          surface?: string | null
          updated_at?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "saved_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shape_clusters: {
        Row: {
          cluster_key: string | null
          created_at: string | null
          document_class: string | null
          document_count: number | null
          extraction_method: string | null
          id: string | null
          layout_hint: string | null
          member_source_ids: string[] | null
          mime_type: string | null
          representative_source_id: string | null
          representative_source_path: string | null
          review_state: string | null
          root_name: string | null
          selection_score: number | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          cluster_key?: string | null
          created_at?: string | null
          document_class?: string | null
          document_count?: number | null
          extraction_method?: string | null
          id?: string | null
          layout_hint?: string | null
          member_source_ids?: string[] | null
          mime_type?: string | null
          representative_source_id?: string | null
          representative_source_path?: string | null
          review_state?: string | null
          root_name?: string | null
          selection_score?: number | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          cluster_key?: string | null
          created_at?: string | null
          document_class?: string | null
          document_count?: number | null
          extraction_method?: string | null
          id?: string | null
          layout_hint?: string | null
          member_source_ids?: string[] | null
          mime_type?: string | null
          representative_source_id?: string | null
          representative_source_path?: string | null
          review_state?: string | null
          root_name?: string | null
          selection_score?: number | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shape_clusters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "shape_clusters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shape_profiles: {
        Row: {
          brand_hint: string | null
          created_at: string | null
          document_class: string | null
          external_source_id: string | null
          extraction: Json | null
          id: string | null
          language_signals: string[] | null
          likely_grain: string | null
          notes: string | null
          observed_fields: Json | null
          review_state: string | null
          safe_for_schema_learning: boolean | null
          source_asset_id: string | null
          source_path: string | null
          source_version_id: string | null
          text_metrics: Json | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_hint?: string | null
          created_at?: string | null
          document_class?: string | null
          external_source_id?: string | null
          extraction?: Json | null
          id?: string | null
          language_signals?: string[] | null
          likely_grain?: string | null
          notes?: string | null
          observed_fields?: Json | null
          review_state?: string | null
          safe_for_schema_learning?: boolean | null
          source_asset_id?: string | null
          source_path?: string | null
          source_version_id?: string | null
          text_metrics?: Json | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_hint?: string | null
          created_at?: string | null
          document_class?: string | null
          external_source_id?: string | null
          extraction?: Json | null
          id?: string | null
          language_signals?: string[] | null
          likely_grain?: string | null
          notes?: string | null
          observed_fields?: Json | null
          review_state?: string | null
          safe_for_schema_learning?: boolean | null
          source_asset_id?: string | null
          source_path?: string | null
          source_version_id?: string | null
          text_metrics?: Json | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shape_profiles_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "shape_profiles_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shape_profiles_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shape_profiles_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shape_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "shape_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_booking_status_events: {
        Row: {
          actor_id: string | null
          from_status: string | null
          id: string | null
          occurred_at: string | null
          previous_ends_at: string | null
          previous_starts_at: string | null
          reason: string | null
          shoot_booking_id: string | null
          to_status: string | null
        }
        Insert: {
          actor_id?: string | null
          from_status?: string | null
          id?: string | null
          occurred_at?: string | null
          previous_ends_at?: string | null
          previous_starts_at?: string | null
          reason?: string | null
          shoot_booking_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor_id?: string | null
          from_status?: string | null
          id?: string | null
          occurred_at?: string | null
          previous_ends_at?: string | null
          previous_starts_at?: string | null
          reason?: string | null
          shoot_booking_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_booking_status_events_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_booking_status_events_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_calendar"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_bookings: {
        Row: {
          all_day: boolean | null
          content_opportunity_id: string | null
          coordinator_id: string | null
          created_at: string | null
          created_by: string | null
          ends_at: string | null
          id: string | null
          notes: string | null
          outcome: string | null
          outcome_reason: string | null
          starts_at: string | null
          status: string | null
          timezone: string | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          all_day?: boolean | null
          content_opportunity_id?: string | null
          coordinator_id?: string | null
          created_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          id?: string | null
          notes?: string | null
          outcome?: string | null
          outcome_reason?: string | null
          starts_at?: string | null
          status?: string | null
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          all_day?: boolean | null
          content_opportunity_id?: string | null
          coordinator_id?: string | null
          created_at?: string | null
          created_by?: string | null
          ends_at?: string | null
          id?: string | null
          notes?: string | null
          outcome?: string | null
          outcome_reason?: string | null
          starts_at?: string | null
          status?: string | null
          timezone?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_bookings_content_opportunity_id_fkey"
            columns: ["content_opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "shoot_bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_calendar: {
        Row: {
          account_id: string | null
          account_name: string | null
          all_day: boolean | null
          contact_id: string | null
          contact_name: string | null
          content_opportunity_id: string | null
          content_types: string[] | null
          coordinator_id: string | null
          ends_at: string | null
          id: string | null
          notes: string | null
          outcome: string | null
          outcome_reason: string | null
          output_count: number | null
          participants: Json | null
          permission_expires_at: string | null
          permission_status: string | null
          priority: string | null
          project_area: string | null
          project_id: string | null
          project_name: string | null
          readiness_state: string | null
          site_count: number | null
          starts_at: string | null
          status: string | null
          story_angle: string | null
          timezone: string | null
          title: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_opportunities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_opportunities_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_bookings_content_opportunity_id_fkey"
            columns: ["content_opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "shoot_bookings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_checklists: {
        Row: {
          done_at: string | null
          done_by: string | null
          id: string | null
          is_done: boolean | null
          item: string | null
          shoot_booking_id: string | null
        }
        Insert: {
          done_at?: string | null
          done_by?: string | null
          id?: string | null
          is_done?: boolean | null
          item?: string | null
          shoot_booking_id?: string | null
        }
        Update: {
          done_at?: string | null
          done_by?: string | null
          id?: string | null
          is_done?: boolean | null
          item?: string | null
          shoot_booking_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_checklists_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_checklists_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_calendar"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_locations: {
        Row: {
          address: Json | null
          id: string | null
          notes: string | null
          project_site_id: string | null
          sequence: number | null
          shoot_booking_id: string | null
          travel_buffer_minutes: number | null
        }
        Insert: {
          address?: Json | null
          id?: string | null
          notes?: string | null
          project_site_id?: string | null
          sequence?: number | null
          shoot_booking_id?: string | null
          travel_buffer_minutes?: number | null
        }
        Update: {
          address?: Json | null
          id?: string | null
          notes?: string | null
          project_site_id?: string | null
          sequence?: number | null
          shoot_booking_id?: string | null
          travel_buffer_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_locations_project_site_id_fkey"
            columns: ["project_site_id"]
            isOneToOne: false
            referencedRelation: "project_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_locations_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_locations_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_calendar"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_outputs: {
        Row: {
          caption: string | null
          captured_at: string | null
          content_opportunity_id: string | null
          created_at: string | null
          id: string | null
          kind: string | null
          mime_type: string | null
          shoot_booking_id: string | null
          size_bytes: number | null
          state: string | null
          storage_path: string | null
          uploaded_by: string | null
          workspace_id: string | null
        }
        Insert: {
          caption?: string | null
          captured_at?: string | null
          content_opportunity_id?: string | null
          created_at?: string | null
          id?: string | null
          kind?: string | null
          mime_type?: string | null
          shoot_booking_id?: string | null
          size_bytes?: number | null
          state?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          caption?: string | null
          captured_at?: string | null
          content_opportunity_id?: string | null
          created_at?: string | null
          id?: string | null
          kind?: string | null
          mime_type?: string | null
          shoot_booking_id?: string | null
          size_bytes?: number | null
          state?: string | null
          storage_path?: string | null
          uploaded_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_outputs_content_opportunity_id_fkey"
            columns: ["content_opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_outputs_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_outputs_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_calendar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_outputs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "shoot_outputs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_participants: {
        Row: {
          created_at: string | null
          external_name: string | null
          id: string | null
          role: string | null
          shoot_booking_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          external_name?: string | null
          id?: string | null
          role?: string | null
          shoot_booking_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          external_name?: string | null
          id?: string | null
          role?: string | null
          shoot_booking_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_participants_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_participants_shoot_booking_id_fkey"
            columns: ["shoot_booking_id"]
            isOneToOne: false
            referencedRelation: "shoot_calendar"
            referencedColumns: ["id"]
          },
        ]
      }
      shoot_requests: {
        Row: {
          content_opportunity_id: string | null
          created_at: string | null
          id: string | null
          proposed_windows: Json | null
          requested_by: string | null
          workspace_id: string | null
        }
        Insert: {
          content_opportunity_id?: string | null
          created_at?: string | null
          id?: string | null
          proposed_windows?: Json | null
          requested_by?: string | null
          workspace_id?: string | null
        }
        Update: {
          content_opportunity_id?: string | null
          created_at?: string | null
          id?: string | null
          proposed_windows?: Json | null
          requested_by?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shoot_requests_content_opportunity_id_fkey"
            columns: ["content_opportunity_id"]
            isOneToOne: false
            referencedRelation: "content_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shoot_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "shoot_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_asset_versions: {
        Row: {
          checksum: string | null
          created_at: string | null
          discovered_at: string | null
          id: string | null
          mime_type: string | null
          modified_at_source: string | null
          parser_hint: string | null
          provider_revision_id: string | null
          size_bytes: number | null
          snapshot_state: string | null
          source_asset_id: string | null
          source_page_count: number | null
          storage_bucket: string | null
          storage_path: string | null
          supersedes_version_id: string | null
          version_no: number | null
          workspace_id: string | null
        }
        Insert: {
          checksum?: string | null
          created_at?: string | null
          discovered_at?: string | null
          id?: string | null
          mime_type?: string | null
          modified_at_source?: string | null
          parser_hint?: string | null
          provider_revision_id?: string | null
          size_bytes?: number | null
          snapshot_state?: string | null
          source_asset_id?: string | null
          source_page_count?: number | null
          storage_bucket?: string | null
          storage_path?: string | null
          supersedes_version_id?: string | null
          version_no?: number | null
          workspace_id?: string | null
        }
        Update: {
          checksum?: string | null
          created_at?: string | null
          discovered_at?: string | null
          id?: string | null
          mime_type?: string | null
          modified_at_source?: string | null
          parser_hint?: string | null
          provider_revision_id?: string | null
          size_bytes?: number | null
          snapshot_state?: string | null
          source_asset_id?: string | null
          source_page_count?: number | null
          storage_bucket?: string | null
          storage_path?: string | null
          supersedes_version_id?: string | null
          version_no?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_asset_versions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "source_asset_versions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_asset_versions_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_asset_versions_supersedes_version_id_fkey"
            columns: ["supersedes_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_asset_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "source_asset_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_assets: {
        Row: {
          asset_class: string | null
          asset_class_review_state: string | null
          brand_id: string | null
          checksum: string | null
          created_at: string | null
          current_version_id: string | null
          external_id: string | null
          id: string | null
          kind: string | null
          mime_type: string | null
          name: string | null
          page_count: number | null
          provider: string | null
          received_at: string | null
          size_bytes: number | null
          source_location_id: string | null
          source_web_url: string | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          supplier_id: string | null
          uploaded_by: string | null
          url: string | null
          workspace_id: string | null
        }
        Insert: {
          asset_class?: string | null
          asset_class_review_state?: string | null
          brand_id?: string | null
          checksum?: string | null
          created_at?: string | null
          current_version_id?: string | null
          external_id?: string | null
          id?: string | null
          kind?: string | null
          mime_type?: string | null
          name?: string | null
          page_count?: number | null
          provider?: string | null
          received_at?: string | null
          size_bytes?: number | null
          source_location_id?: string | null
          source_web_url?: string | null
          status?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          supplier_id?: string | null
          uploaded_by?: string | null
          url?: string | null
          workspace_id?: string | null
        }
        Update: {
          asset_class?: string | null
          asset_class_review_state?: string | null
          brand_id?: string | null
          checksum?: string | null
          created_at?: string | null
          current_version_id?: string | null
          external_id?: string | null
          id?: string | null
          kind?: string | null
          mime_type?: string | null
          name?: string | null
          page_count?: number | null
          provider?: string | null
          received_at?: string | null
          size_bytes?: number | null
          source_location_id?: string | null
          source_web_url?: string | null
          status?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          supplier_id?: string | null
          uploaded_by?: string | null
          url?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_assets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_assets_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_assets_source_location_id_fkey"
            columns: ["source_location_id"]
            isOneToOne: false
            referencedRelation: "source_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "stale_supplier_queue"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "source_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "source_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_collections: {
        Row: {
          code: string | null
          created_at: string | null
          created_by: string | null
          external_folder_id: string | null
          id: string | null
          name: string | null
          provider: string | null
          status: string | null
          supply_model: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          external_folder_id?: string | null
          id?: string | null
          name?: string | null
          provider?: string | null
          status?: string | null
          supply_model?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          external_folder_id?: string | null
          id?: string | null
          name?: string | null
          provider?: string | null
          status?: string | null
          supply_model?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_collections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "source_collections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_library: {
        Row: {
          brand_name: string | null
          checksum: string | null
          id: string | null
          job_count: number | null
          kind: string | null
          last_processed_at: string | null
          mime_type: string | null
          name: string | null
          page_count: number | null
          pending_reviews: number | null
          received_at: string | null
          size_bytes: number | null
          status: string | null
          storage_bucket: string | null
          storage_path: string | null
          supplier_name: string | null
          uploaded_by: string | null
          url: string | null
          version_no: number | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "source_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_locations: {
        Row: {
          access_state: string | null
          brand_hint: string | null
          created_at: string | null
          display_path: string | null
          external_id: string | null
          id: string | null
          last_scanned_at: string | null
          location_type: string | null
          name: string | null
          parent_id: string | null
          provider: string | null
          source_collection_id: string | null
          updated_at: string | null
          web_url: string | null
          workspace_id: string | null
        }
        Insert: {
          access_state?: string | null
          brand_hint?: string | null
          created_at?: string | null
          display_path?: string | null
          external_id?: string | null
          id?: string | null
          last_scanned_at?: string | null
          location_type?: string | null
          name?: string | null
          parent_id?: string | null
          provider?: string | null
          source_collection_id?: string | null
          updated_at?: string | null
          web_url?: string | null
          workspace_id?: string | null
        }
        Update: {
          access_state?: string | null
          brand_hint?: string | null
          created_at?: string | null
          display_path?: string | null
          external_id?: string | null
          id?: string | null
          last_scanned_at?: string | null
          location_type?: string | null
          name?: string | null
          parent_id?: string | null
          provider?: string | null
          source_collection_id?: string | null
          updated_at?: string | null
          web_url?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "source_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_locations_source_collection_id_fkey"
            columns: ["source_collection_id"]
            isOneToOne: false
            referencedRelation: "source_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "source_locations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stale_supplier_queue: {
        Row: {
          aging_hours: number | null
          fresh_hours: number | null
          freshness: string | null
          last_update_at: string | null
          snapshot_count: number | null
          supplier_id: string | null
          supplier_name: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "suppliers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_availability: {
        Row: {
          allocated: number | null
          as_of: string | null
          availability: string | null
          evidence_storage_path: string | null
          expected_replenishment: string | null
          is_authoritative: boolean | null
          location_name: string | null
          notes: string | null
          on_hand: number | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          sla_minutes: number | null
          source_channel: string | null
          source_kind: string | null
          source_name: string | null
          supplier_id: string | null
          supplier_name: string | null
          unit_code: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Relationships: []
      }
      stock_freshness_policies: {
        Row: {
          aging_hours: number | null
          created_at: string | null
          fresh_hours: number | null
          id: string | null
          source_id: string | null
          supplier_id: string | null
          workspace_id: string | null
        }
        Insert: {
          aging_hours?: number | null
          created_at?: string | null
          fresh_hours?: number | null
          id?: string | null
          source_id?: string | null
          supplier_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          aging_hours?: number | null
          created_at?: string | null
          fresh_hours?: number | null
          id?: string | null
          source_id?: string | null
          supplier_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_freshness_policies_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "inventory_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_freshness_policies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "stale_supplier_queue"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "stock_freshness_policies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_freshness_policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "stock_freshness_policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reconciliation_cases: {
        Row: {
          expected: number | null
          id: string | null
          notes: string | null
          observed: number | null
          opened_at: string | null
          resolved_at: string | null
          source_id: string | null
          status: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          expected?: number | null
          id?: string | null
          notes?: string | null
          observed?: number | null
          opened_at?: string | null
          resolved_at?: string | null
          source_id?: string | null
          status?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          expected?: number | null
          id?: string | null
          notes?: string | null
          observed?: number | null
          opened_at?: string | null
          resolved_at?: string | null
          source_id?: string | null
          status?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reconciliation_cases_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "inventory_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reconciliation_cases_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reconciliation_cases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "stock_reconciliation_cases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_availability_snapshots: {
        Row: {
          availability: string | null
          captured_at: string | null
          evidence_storage_path: string | null
          expected_replenishment: string | null
          id: string | null
          notes: string | null
          product_id: string | null
          quantity: number | null
          source_channel: string | null
          submitted_by: string | null
          supersedes_id: string | null
          supplier_id: string | null
          unit_id: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          availability?: string | null
          captured_at?: string | null
          evidence_storage_path?: string | null
          expected_replenishment?: string | null
          id?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number | null
          source_channel?: string | null
          submitted_by?: string | null
          supersedes_id?: string | null
          supplier_id?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          availability?: string | null
          captured_at?: string | null
          evidence_storage_path?: string | null
          expected_replenishment?: string | null
          id?: string | null
          notes?: string | null
          product_id?: string | null
          quantity?: number | null
          source_channel?: string | null
          submitted_by?: string | null
          supersedes_id?: string | null
          supplier_id?: string | null
          unit_id?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_availability_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "supplier_availability_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "stale_supplier_queue"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "supplier_availability_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact: Json | null
          created_at: string | null
          id: string | null
          name: string | null
          normalized_name: string | null
          notes: string | null
          organization_id: string | null
          status: string | null
          updated_at: string | null
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          contact?: Json | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          normalized_name?: string | null
          notes?: string | null
          organization_id?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          contact?: Json | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          normalized_name?: string | null
          notes?: string | null
          organization_id?: string | null
          status?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "suppliers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          connection_id: string | null
          error: string | null
          finished_at: string | null
          id: string | null
          records_created: number | null
          records_read: number | null
          records_rejected: number | null
          records_updated: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          connection_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string | null
          records_created?: number | null
          records_read?: number | null
          records_rejected?: number | null
          records_updated?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          connection_id?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string | null
          records_created?: number | null
          records_read?: number | null
          records_rejected?: number | null
          records_updated?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "integration_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          account_id: string | null
          assignee_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string | null
          lead_id: string | null
          opportunity_id: string | null
          outcome: string | null
          priority: string | null
          project_id: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string | null
          lead_id?: string | null
          opportunity_id?: string | null
          outcome?: string | null
          priority?: string | null
          project_id?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          assignee_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string | null
          lead_id?: string | null
          opportunity_id?: string | null
          outcome?: string | null
          priority?: string | null
          project_id?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "teams_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_conversions: {
        Row: {
          context_variant_id: string | null
          created_at: string | null
          effective_from: string | null
          factor: number | null
          from_unit_id: string | null
          id: string | null
          to_unit_id: string | null
          version: number | null
          workspace_id: string | null
        }
        Insert: {
          context_variant_id?: string | null
          created_at?: string | null
          effective_from?: string | null
          factor?: number | null
          from_unit_id?: string | null
          id?: string | null
          to_unit_id?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Update: {
          context_variant_id?: string | null
          created_at?: string | null
          effective_from?: string | null
          factor?: number | null
          from_unit_id?: string | null
          id?: string | null
          to_unit_id?: string | null
          version?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "unit_conversions_from_unit_id_fkey"
            columns: ["from_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_conversions_to_unit_id_fkey"
            columns: ["to_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_conversions_variant_fk"
            columns: ["context_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_conversions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "unit_conversions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      units_of_measure: {
        Row: {
          code: string | null
          id: string | null
          kind: string | null
          label: string | null
          workspace_id: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          kind?: string | null
          label?: string | null
          workspace_id?: string | null
        }
        Update: {
          code?: string | null
          id?: string | null
          kind?: string | null
          label?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_of_measure_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "units_of_measure_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_candidates: {
        Row: {
          brand_hint: string | null
          candidate_key: string | null
          candidate_record_id: string | null
          confidence: number | null
          created_at: string | null
          dimensions_raw: string[] | null
          external_source_id: string | null
          extraction_rule: string | null
          family_name_candidate: string | null
          finish_raw: string | null
          id: string | null
          material_raw: string | null
          package_raw: string | null
          published_variant_id: string | null
          raw_excerpt: string | null
          review_state: string | null
          root_name: string | null
          source_asset_id: string | null
          source_locator: Json | null
          source_path: string | null
          status_raw: string | null
          supplier_code_normalized: string | null
          supplier_code_raw: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          confidence?: number | null
          created_at?: string | null
          dimensions_raw?: string[] | null
          external_source_id?: string | null
          extraction_rule?: string | null
          family_name_candidate?: string | null
          finish_raw?: string | null
          id?: string | null
          material_raw?: string | null
          package_raw?: string | null
          published_variant_id?: string | null
          raw_excerpt?: string | null
          review_state?: string | null
          root_name?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          status_raw?: string | null
          supplier_code_normalized?: string | null
          supplier_code_raw?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          brand_hint?: string | null
          candidate_key?: string | null
          candidate_record_id?: string | null
          confidence?: number | null
          created_at?: string | null
          dimensions_raw?: string[] | null
          external_source_id?: string | null
          extraction_rule?: string | null
          family_name_candidate?: string | null
          finish_raw?: string | null
          id?: string | null
          material_raw?: string | null
          package_raw?: string | null
          published_variant_id?: string | null
          raw_excerpt?: string | null
          review_state?: string | null
          root_name?: string | null
          source_asset_id?: string | null
          source_locator?: Json | null
          source_path?: string | null
          status_raw?: string | null
          supplier_code_normalized?: string | null
          supplier_code_raw?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variant_candidates_candidate_record_id_fkey"
            columns: ["candidate_record_id"]
            isOneToOne: false
            referencedRelation: "candidate_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_candidates_published_variant_id_fkey"
            columns: ["published_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "variant_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_candidates_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "variant_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_prices: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_tier: string | null
          id: string | null
          imported_at: string | null
          market: string | null
          min_quantity: number | null
          notes: string | null
          price_list_id: string | null
          price_list_version_id: string | null
          price_type: string | null
          quantity_unit_id: string | null
          review_state: string | null
          source_asset_id: string | null
          source_page_or_row: string | null
          source_ref: string | null
          source_version_id: string | null
          state: string | null
          tax_basis: string | null
          unit_id: string | null
          updated_at: string | null
          valid_from: string | null
          valid_to: string | null
          variant_id: string | null
          workspace_id: string | null
        }
        Insert: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_tier?: string | null
          id?: string | null
          imported_at?: string | null
          market?: string | null
          min_quantity?: number | null
          notes?: string | null
          price_list_id?: string | null
          price_list_version_id?: string | null
          price_type?: string | null
          quantity_unit_id?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_page_or_row?: string | null
          source_ref?: string | null
          source_version_id?: string | null
          state?: string | null
          tax_basis?: string | null
          unit_id?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_tier?: string | null
          id?: string | null
          imported_at?: string | null
          market?: string | null
          min_quantity?: number | null
          notes?: string | null
          price_list_id?: string | null
          price_list_version_id?: string | null
          price_type?: string | null
          quantity_unit_id?: string | null
          review_state?: string | null
          source_asset_id?: string | null
          source_page_or_row?: string | null
          source_ref?: string | null
          source_version_id?: string | null
          state?: string | null
          tax_basis?: string | null
          unit_id?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_to?: string | null
          variant_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variant_prices_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_price_list_version_id_fkey"
            columns: ["price_list_version_id"]
            isOneToOne: false
            referencedRelation: "price_list_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_quantity_unit_id_fkey"
            columns: ["quantity_unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "review_queue"
            referencedColumns: ["source_asset_id"]
          },
          {
            foreignKeyName: "variant_prices_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_source_asset_fk"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "source_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "source_asset_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units_of_measure"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_prices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "variant_prices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          account_id: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          customer_type: string | null
          id: string | null
          inquiry_source: string | null
          is_new_customer: boolean | null
          lead_id: string | null
          location_id: string | null
          notes: string | null
          occurred_at: string | null
          opportunity_id: string | null
          origin_area: string | null
          purpose: string | null
          quotation_amount: number | null
          quotation_ref: string | null
          renovation_area: string | null
          staff_user_id: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_type?: string | null
          id?: string | null
          inquiry_source?: string | null
          is_new_customer?: boolean | null
          lead_id?: string | null
          location_id?: string | null
          notes?: string | null
          occurred_at?: string | null
          opportunity_id?: string | null
          origin_area?: string | null
          purpose?: string | null
          quotation_amount?: number | null
          quotation_ref?: string | null
          renovation_area?: string | null
          staff_user_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          account_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_type?: string | null
          id?: string | null
          inquiry_source?: string | null
          is_new_customer?: boolean | null
          lead_id?: string | null
          location_id?: string | null
          notes?: string | null
          occurred_at?: string | null
          opportunity_id?: string | null
          origin_area?: string | null
          purpose?: string | null
          quotation_amount?: number | null
          quotation_ref?: string | null
          renovation_area?: string | null
          staff_user_id?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "business_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "visits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      visual_observations: {
        Row: {
          confidence: number | null
          created_at: string | null
          external_key: string | null
          id: string | null
          media_asset_id: string | null
          model_or_rule_version: string | null
          observation_basis: string | null
          observation_basis_raw: string | null
          observation_scope: string | null
          observation_type: string | null
          page_number: number | null
          physical_size_inferred_from_pixels: boolean | null
          region: Json | null
          review_state: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_text_raw: string | null
          value: Json | null
          workspace_id: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          external_key?: string | null
          id?: string | null
          media_asset_id?: string | null
          model_or_rule_version?: string | null
          observation_basis?: string | null
          observation_basis_raw?: string | null
          observation_scope?: string | null
          observation_type?: string | null
          page_number?: number | null
          physical_size_inferred_from_pixels?: boolean | null
          region?: Json | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_text_raw?: string | null
          value?: Json | null
          workspace_id?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          external_key?: string | null
          id?: string | null
          media_asset_id?: string | null
          model_or_rule_version?: string | null
          observation_basis?: string | null
          observation_basis_raw?: string | null
          observation_scope?: string | null
          observation_type?: string | null
          page_number?: number | null
          physical_size_inferred_from_pixels?: boolean | null
          region?: Json | null
          review_state?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_text_raw?: string | null
          value?: Json | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visual_observations_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visual_observations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "corpus_reconciliation"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "visual_observations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string | null
          default_currency: string | null
          id: string | null
          name: string | null
          settings: Json | null
          slug: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_currency?: string | null
          id?: string | null
          name?: string | null
          settings?: Json | null
          slug?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_currency?: string | null
          id?: string | null
          name?: string | null
          settings?: Json | null
          slug?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_intake: {
        Args: {
          p_external_id: string
          p_fields?: Json
          p_form_ref?: string
          p_idempotency_key: string
          p_occurred_at?: string
          p_payload: Json
          p_provider: string
          p_raw_text?: string
          p_source_channel: string
          p_workspace_id: string
        }
        Returns: Json
      }
      approve_certificate_candidate: {
        Args: { p_candidate_id: string; p_corrections?: Json; p_note?: string }
        Returns: string
      }
      approve_media_link: {
        Args: { p_link_id: string; p_note?: string; p_variant_id: string }
        Returns: string
      }
      approve_review_item: {
        Args: {
          p_corrections?: Json
          p_note?: string
          p_review_item_id: string
        }
        Returns: Json
      }
      assign_lead: {
        Args: { p_lead_id: string; p_owner_id: string; p_reason?: string }
        Returns: undefined
      }
      change_opportunity_stage: {
        Args: {
          p_next_action?: string
          p_next_action_due_at?: string
          p_opportunity_id: string
          p_outcome_date?: string
          p_reason?: string
          p_to_stage_key: string
        }
        Returns: undefined
      }
      command_centre_summary: { Args: never; Returns: Json }
      convert_lead: {
        Args: {
          p_account_id?: string
          p_contact_id: string
          p_estimated_value?: number
          p_lead_id: string
          p_next_action?: string
          p_next_action_due_at?: string
          p_opportunity_name?: string
          p_project_name?: string
        }
        Returns: Json
      }
      create_contact: {
        Args: {
          p_account_id?: string
          p_customer_type?: string
          p_display_name: string
          p_email?: string
          p_is_provisional?: boolean
          p_notes?: string
          p_phone?: string
          p_source?: string
        }
        Returns: string
      }
      create_ingestion_job: {
        Args: {
          p_job_type: string
          p_parser_version?: string
          p_source_asset_id: string
        }
        Returns: string
      }
      entity_timeline: {
        Args: { p_entity_id: string; p_entity_type: string; p_limit?: number }
        Returns: {
          actor_id: string
          actor_name: string
          body: string
          channel: string
          id: string
          kind: string
          lead_id: string
          metadata: Json
          occurred_at: string
          opportunity_id: string
          purchase_id: string
          subject: string
          visit_id: string
        }[]
      }
      find_identity_candidates: {
        Args: {
          p_company?: string
          p_email?: string
          p_limit?: number
          p_name?: string
          p_phone?: string
          p_registration_number?: string
        }
        Returns: {
          confidence: string
          display_name: string
          entity_id: string
          entity_type: string
          last_activity_at: string
          lifecycle_state: string
          masked_email: string
          masked_phone: string
          reasons: Json
          score: number
        }[]
      }
      finish_import_run: {
        Args: {
          p_counts?: Json
          p_error_code?: string
          p_error_detail_safe?: string
          p_import_run_id: string
          p_status: string
          p_warning_count?: number
        }
        Returns: undefined
      }
      finish_sync_run: {
        Args: {
          p_checkpoint?: string
          p_created?: number
          p_error?: string
          p_read?: number
          p_rejected?: number
          p_run_id: string
          p_status: string
          p_stream?: string
          p_updated?: number
        }
        Returns: undefined
      }
      flag_stale_suppliers: { Args: never; Returns: number }
      global_search: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          entity_id: string
          entity_type: string
          href: string
          score: number
          subtitle: string
          title: string
        }[]
      }
      log_lead_response: {
        Args: {
          p_body?: string
          p_channel: string
          p_kind: string
          p_lead_id: string
          p_reached?: boolean
        }
        Returns: string
      }
      map_inventory_item: {
        Args: {
          p_ignore?: boolean
          p_mapping_id: string
          p_unit_id?: string
          p_variant_id: string
        }
        Returns: undefined
      }
      merge_contacts: {
        Args: {
          p_candidate_id?: string
          p_merged_id: string
          p_reason: string
          p_survivor_id: string
        }
        Returns: string
      }
      my_membership: {
        Args: never
        Returns: {
          currency: string
          default_location_id: string
          role_key: string
          role_label: string
          timezone: string
          workspace_id: string
          workspace_name: string
          workspace_slug: string
        }[]
      }
      my_permissions: { Args: never; Returns: string[] }
      nominate_content_opportunity: {
        Args: {
          p_content_types: string[]
          p_interview_subjects?: string
          p_nomination_reason?: string
          p_opportunity_id?: string
          p_priority?: string
          p_products_used?: string[]
          p_project_id: string
          p_purchase_id?: string
          p_readiness_state?: string
          p_site_notes?: string
          p_special_requirements?: string
          p_story_angle?: string
          p_target_window_end?: string
          p_target_window_start?: string
        }
        Returns: string
      }
      open_reconciliation_case: {
        Args: {
          p_expected: number
          p_notes?: string
          p_observed: number
          p_source_id: string
          p_variant_id: string
        }
        Returns: string
      }
      publish_price: {
        Args: {
          p_override?: boolean
          p_reason?: string
          p_variant_price_id: string
        }
        Returns: undefined
      }
      publish_product_media: {
        Args: {
          p_alt_text?: string
          p_is_primary?: boolean
          p_link_id: string
          p_sort_order?: number
        }
        Returns: string
      }
      record_extraction: {
        Args: {
          p_error?: string
          p_job_id: string
          p_records: Json
          p_stats?: Json
          p_status?: string
        }
        Returns: Json
      }
      record_import_item: {
        Args: {
          p_actual_count?: number
          p_checksum?: string
          p_expected_count?: number
          p_external_key: string
          p_import_run_id: string
          p_item_kind: string
          p_message?: string
          p_status: string
        }
        Returns: string
      }
      record_inventory_snapshot: {
        Args: {
          p_allocated?: number
          p_available?: number
          p_checkpoint?: string
          p_external_item_code: string
          p_location_code?: string
          p_on_hand?: number
          p_source_key: string
          p_source_timestamp?: string
          p_unit_id?: string
        }
        Returns: string
      }
      record_media_permission: {
        Args: {
          p_content_opportunity_id: string
          p_evidence_storage_path?: string
          p_expires_at?: string
          p_granted_at?: string
          p_granted_by_name?: string
          p_permitted_capture?: string[]
          p_permitted_uses?: string[]
          p_restrictions?: string
          p_revocation_reason?: string
          p_status: string
        }
        Returns: string
      }
      record_purchase: {
        Args: {
          p_account_id: string
          p_amount: number
          p_contact_id: string
          p_external_ref?: string
          p_items?: Json
          p_location_id?: string
          p_notes?: string
          p_opportunity_id?: string
          p_payments?: Json
          p_project_id?: string
          p_purchase_source?: string
          p_purchased_at?: string
          p_salesperson_id?: string
          p_visit_id?: string
        }
        Returns: string
      }
      record_shoot_outcome: {
        Args: {
          p_booking_id: string
          p_follow_up?: string
          p_outcome: string
          p_reason?: string
        }
        Returns: undefined
      }
      record_supplier_availability: {
        Args: {
          p_availability: string
          p_captured_at?: string
          p_evidence_storage_path?: string
          p_expected_replenishment?: string
          p_notes?: string
          p_product_id?: string
          p_quantity?: number
          p_source_channel?: string
          p_supplier_id: string
          p_unit_id?: string
          p_variant_id?: string
        }
        Returns: string
      }
      record_walk_in: {
        Args: {
          p_account_id?: string
          p_contact_id: string
          p_create_opportunity?: boolean
          p_customer_type?: string
          p_inquiry_source?: string
          p_location_id?: string
          p_notes?: string
          p_occurred_at?: string
          p_opportunity_id?: string
          p_opportunity_name?: string
          p_origin_area?: string
          p_product_interest?: string[]
          p_project_name?: string
          p_purchase?: Json
          p_purpose?: string
          p_staff_user_id?: string
        }
        Returns: Json
      }
      register_shoot_output: {
        Args: {
          p_caption?: string
          p_captured_at?: string
          p_content_opportunity_id: string
          p_kind: string
          p_mime_type?: string
          p_shoot_booking_id?: string
          p_size_bytes?: number
          p_storage_path: string
        }
        Returns: string
      }
      register_source_asset: {
        Args: {
          p_brand_id?: string
          p_checksum: string
          p_kind: string
          p_mime_type?: string
          p_name: string
          p_page_count?: number
          p_size_bytes?: number
          p_storage_path?: string
          p_supplier_id?: string
          p_url?: string
        }
        Returns: Json
      }
      reject_identity_candidate: {
        Args: { p_candidate_id: string; p_note?: string }
        Returns: undefined
      }
      reject_review_item: {
        Args: { p_reason: string; p_review_item_id: string }
        Returns: undefined
      }
      replay_intake_event: {
        Args: { p_fields?: Json; p_intake_event_id: string }
        Returns: Json
      }
      report_cohorts: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          amount: number
          cohort_month: string
          customers: number
          median_days_between: number
          purchases: number
          repeat_customers: number
        }[]
      }
      report_content_pipeline: {
        Args: never
        Returns: {
          opportunities: number
          permission_approved: number
          shoots_completed: number
          shoots_confirmed: number
          status: string
          usable_assets: number
        }[]
      }
      report_data_quality: {
        Args: never
        Returns: {
          bucket: string
          duplicates_open: number
          high_severity: number
          open_issues: number
          pending_reviews: number
          resolved_30d: number
        }[]
      }
      report_demand: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          brand_name: string
          category_label: string
          product_code: string
          product_id: string
          product_name: string
          purchased_qty: number
          purchased_value: number
          quoted_qty: number
          quoted_value: number
        }[]
      }
      report_lead_source: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          converted: number
          disqualified: number
          leads: number
          median_response_minutes: number
          qualified: number
          responded: number
          source_channel: string
        }[]
      }
      report_pipeline: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          avg_age_days: number
          open_value: number
          opportunities: number
          overdue: number
          reporting_group: string
          stage_key: string
          stage_label: string
          stage_position: number
        }[]
      }
      report_price_health: {
        Args: never
        Returns: {
          bucket: string
          conflicted: number
          expiring_30d: number
          products: number
          unreviewed: number
          with_current_price: number
        }[]
      }
      report_quotes: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          bucket: string
          lost: number
          open: number
          quotes: number
          revisions: number
          total_value: number
          won: number
        }[]
      }
      report_stock_freshness: {
        Args: never
        Returns: {
          freshness: string
          last_update_at: string
          open_cases: number
          snapshot_count: number
          supplier_name: string
        }[]
      }
      report_walkins: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          amount: number
          bucket: string
          new_customers: number
          payment_mix: Json
          purchases: number
          visits: number
        }[]
      }
      resolve_reconciliation_case: {
        Args: { p_case_id: string; p_notes: string; p_status: string }
        Returns: undefined
      }
      reveal_contact_points: {
        Args: { p_contact_id: string }
        Returns: {
          id: string
          is_primary: boolean
          kind: string
          label: string
          normalized_value: string
          raw_value: string
        }[]
      }
      review_shoot_output: {
        Args: { p_decision: string; p_output_id: string; p_reason?: string }
        Returns: undefined
      }
      sales_scorecard: { Args: { p_year?: number }; Returns: Json }
      set_content_opportunity_status: {
        Args: {
          p_id: string
          p_marketing_owner_id?: string
          p_reason?: string
          p_status: string
        }
        Returns: undefined
      }
      set_project_readiness: {
        Args: { p_id: string; p_note?: string; p_readiness: string }
        Returns: undefined
      }
      set_sales_target: {
        Args: { p_amount: number; p_notes?: string; p_year: number }
        Returns: undefined
      }
      shoot_conflicts: {
        Args: {
          p_booking_id?: string
          p_buffer_minutes?: number
          p_ends_at: string
          p_participant_ids?: string[]
          p_starts_at: string
        }
        Returns: {
          booking_id: string
          detail: string
          kind: string
          severity: string
          user_id: string
        }[]
      }
      start_import_run: {
        Args: {
          p_corpus_cutoff?: string
          p_parser_name?: string
          p_parser_version?: string
          p_pipeline_version: string
          p_run_key: string
          p_target_env: string
        }
        Returns: string
      }
      start_sync_run: { Args: { p_connection_id: string }; Returns: string }
      suggest_contact_duplicates: {
        Args: { p_contact_id: string }
        Returns: number
      }
      unmerge_contacts: {
        Args: { p_merge_event_id: string; p_reason: string }
        Returns: undefined
      }
      upsert_shoot_booking: {
        Args: {
          p_all_day?: boolean
          p_booking_id?: string
          p_content_opportunity_id: string
          p_ends_at: string
          p_notes?: string
          p_override?: boolean
          p_participants?: Json
          p_reason?: string
          p_sites?: Json
          p_starts_at: string
          p_status?: string
          p_title?: string
        }
        Returns: string
      }
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
  api: {
    Enums: {},
  },
} as const

