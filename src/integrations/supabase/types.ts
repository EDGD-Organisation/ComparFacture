export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      app_secrets: {
        Row: {
          erp_api_key: string | null;
          id: boolean;
          updated_at: string;
        };
        Insert: {
          erp_api_key?: string | null;
          id?: boolean;
          updated_at?: string;
        };
        Update: {
          erp_api_key?: string | null;
          id?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          auto_confirm_score: number;
          erp_api_url: string | null;
          id: boolean;
          review_score: number;
          tolerance_percent: number;
          updated_at: string;
        };
        Insert: {
          auto_confirm_score?: number;
          erp_api_url?: string | null;
          id?: boolean;
          review_score?: number;
          tolerance_percent?: number;
          updated_at?: string;
        };
        Update: {
          auto_confirm_score?: number;
          erp_api_url?: string | null;
          id?: boolean;
          review_score?: number;
          tolerance_percent?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      catalog_products: {
        Row: {
          created_at: string;
          currency: string;
          ean: string | null;
          embedding: string | null;
          family: string | null;
          id: string;
          is_active: boolean;
          label: string;
          ozego_id: string | null;
          price: number | null;
          reference: string;
          source: string;
          supplier_name: string | null;
          unit: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          ean?: string | null;
          embedding?: string | null;
          family?: string | null;
          id?: string;
          is_active?: boolean;
          label: string;
          ozego_id?: string | null;
          price?: number | null;
          reference: string;
          source?: string;
          supplier_name?: string | null;
          unit?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          ean?: string | null;
          embedding?: string | null;
          family?: string | null;
          id?: string;
          is_active?: boolean;
          label?: string;
          ozego_id?: string | null;
          price?: number | null;
          reference?: string;
          source?: string;
          supplier_name?: string | null;
          unit?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      catalog_sync_runs: {
        Row: {
          created_at: string;
          id: string;
          message: string | null;
          products_count: number;
          source: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message?: string | null;
          products_count?: number;
          source: string;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string | null;
          products_count?: number;
          source?: string;
          status?: string;
        };
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          created_at: string;
          discount_percent: number | null;
          id: string;
          invoice_id: string;
          label: string;
          line_number: number;
          line_total: number | null;
          manual_override: boolean;
          match_method: string | null;
          match_score: number | null;
          match_status: string;
          matched_product_id: string | null;
          pack_factor: number;
          quantity: number;
          supplier_reference: string | null;
          unit: string | null;
          unit_price: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          discount_percent?: number | null;
          id?: string;
          invoice_id: string;
          label: string;
          line_number?: number;
          line_total?: number | null;
          manual_override?: boolean;
          match_method?: string | null;
          match_score?: number | null;
          match_status?: string;
          matched_product_id?: string | null;
          pack_factor?: number;
          quantity?: number;
          supplier_reference?: string | null;
          unit?: string | null;
          unit_price?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          discount_percent?: number | null;
          id?: string;
          invoice_id?: string;
          label?: string;
          line_number?: number;
          line_total?: number | null;
          manual_override?: boolean;
          match_method?: string | null;
          match_score?: number | null;
          match_status?: string;
          matched_product_id?: string | null;
          pack_factor?: number;
          quantity?: number;
          supplier_reference?: string | null;
          unit?: string | null;
          unit_price?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_lines_matched_product_id_fkey";
            columns: ["matched_product_id"];
            isOneToOne: false;
            referencedRelation: "catalog_products";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          created_at: string;
          currency: string;
          error_message: string | null;
          file_mime: string | null;
          file_name: string | null;
          file_path: string | null;
          id: string;
          invoice_date: string | null;
          invoice_number: string | null;
          prospect_id: string | null;
          status: string;
          supplier_id: string | null;
          supplier_name: string | null;
          total_ht: number | null;
          total_ttc: number | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          error_message?: string | null;
          file_mime?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          id?: string;
          invoice_date?: string | null;
          invoice_number?: string | null;
          prospect_id?: string | null;
          status?: string;
          supplier_id?: string | null;
          supplier_name?: string | null;
          total_ht?: number | null;
          total_ttc?: number | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          error_message?: string | null;
          file_mime?: string | null;
          file_name?: string | null;
          file_path?: string | null;
          id?: string;
          invoice_date?: string | null;
          invoice_number?: string | null;
          prospect_id?: string | null;
          status?: string;
          supplier_id?: string | null;
          supplier_name?: string | null;
          total_ht?: number | null;
          total_ttc?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_prospect_id_fkey";
            columns: ["prospect_id"];
            isOneToOne: false;
            referencedRelation: "prospects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      product_mappings: {
        Row: {
          created_at: string;
          id: string;
          pack_factor: number;
          product_id: string;
          supplier_label: string | null;
          supplier_name: string | null;
          supplier_reference: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          pack_factor?: number;
          product_id: string;
          supplier_label?: string | null;
          supplier_name?: string | null;
          supplier_reference?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          pack_factor?: number;
          product_id?: string;
          supplier_label?: string | null;
          supplier_name?: string | null;
          supplier_reference?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_mappings_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "catalog_products";
            referencedColumns: ["id"];
          },
        ];
      };
      prospects: {
        Row: {
          created_at: string;
          delivery_date: string | null;
          id: string;
          name: string;
          notes: string | null;
          preferred_suppliers: string[];
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          delivery_date?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          preferred_suppliers?: string[];
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          delivery_date?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          preferred_suppliers?: string[];
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      suppliers: {
        Row: {
          code: string | null;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      catalog_variants_by_ozego: {
        Args: { ids: string[] };
        Returns: {
          ean: string;
          family: string;
          id: string;
          label: string;
          ozego_id: string;
          price: number;
          reference: string;
          supplier_name: string;
          unit: string;
        }[];
      };
      cheapest_by_ozego: {
        Args: { ids: string[] };
        Returns: {
          ean: string;
          family: string;
          id: string;
          label: string;
          ozego_id: string;
          price: number;
          reference: string;
          supplier_name: string;
          unit: string;
          variants_count: number;
        }[];
      };
      distinct_catalog_suppliers: {
        Args: never;
        Returns: {
          supplier_name: string;
        }[];
      };
      match_catalog_embedding: {
        Args: { max_results?: number; query_embedding: string };
        Returns: {
          id: string;
          label: string;
          price: number;
          reference: string;
          similarity: number;
          unit: string;
        }[];
      };
      search_catalog: {
        Args: { max_results?: number; q: string };
        Returns: {
          ean: string;
          id: string;
          label: string;
          price: number;
          reference: string;
          score: number;
          unit: string;
        }[];
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      [_ in never]: never;
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
