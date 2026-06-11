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
      declared_hours: {
        Row: {
          created_at: string
          id: string
          minutes: number
          note: string | null
          updated_at: string
          user_id: string
          work_date: string
        }
        Insert: {
          created_at?: string
          id?: string
          minutes?: number
          note?: string | null
          updated_at?: string
          user_id: string
          work_date: string
        }
        Update: {
          created_at?: string
          id?: string
          minutes?: number
          note?: string | null
          updated_at?: string
          user_id?: string
          work_date?: string
        }
        Relationships: []
      }
      departure_overrides: {
        Row: {
          created_at: string
          id: string
          notion_page_id: string
          slot_index: number
          updated_at: string
          user_id: string
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          id?: string
          notion_page_id: string
          slot_index: number
          updated_at?: string
          user_id: string
          weekdays?: number[]
        }
        Update: {
          created_at?: string
          id?: string
          notion_page_id?: string
          slot_index?: number
          updated_at?: string
          user_id?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      departures: {
        Row: {
          created_at: string
          driver: string
          id: string
          location: string
          notion_page_id: string | null
          qub: string
          route: string
          slot_index: number
          start_time: string
          updated_at: string
          user_id: string
          vehicle: string
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          driver?: string
          id?: string
          location?: string
          notion_page_id?: string | null
          qub?: string
          route?: string
          slot_index?: number
          start_time: string
          updated_at?: string
          user_id: string
          vehicle?: string
          weekdays?: number[]
        }
        Update: {
          created_at?: string
          driver?: string
          id?: string
          location?: string
          notion_page_id?: string | null
          qub?: string
          route?: string
          slot_index?: number
          start_time?: string
          updated_at?: string
          user_id?: string
          vehicle?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      driving_sessions: {
        Row: {
          bus_reference: string | null
          created_at: string
          end_at: string | null
          id: string
          km_end: number | null
          km_start: number | null
          notion_synced_at: string | null
          shift_id: string | null
          start_at: string
          user_id: string
        }
        Insert: {
          bus_reference?: string | null
          created_at?: string
          end_at?: string | null
          id?: string
          km_end?: number | null
          km_start?: number | null
          notion_synced_at?: string | null
          shift_id?: string | null
          start_at?: string
          user_id: string
        }
        Update: {
          bus_reference?: string | null
          created_at?: string
          end_at?: string | null
          id?: string
          km_end?: number | null
          km_start?: number | null
          notion_synced_at?: string | null
          shift_id?: string | null
          start_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driving_sessions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      duties: {
        Row: {
          created_at: string
          driver: string
          id: string
          last_checked_date: string | null
          notion_page_id: string | null
          qub: string
          route: string
          sort_order: number
          start_time: string
          updated_at: string
          user_id: string
          vehicle: string
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          driver?: string
          id?: string
          last_checked_date?: string | null
          notion_page_id?: string | null
          qub?: string
          route?: string
          sort_order?: number
          start_time: string
          updated_at?: string
          user_id: string
          vehicle?: string
          weekdays?: number[]
        }
        Update: {
          created_at?: string
          driver?: string
          id?: string
          last_checked_date?: string | null
          notion_page_id?: string | null
          qub?: string
          route?: string
          sort_order?: number
          start_time?: string
          updated_at?: string
          user_id?: string
          vehicle?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      fuel_fillups: {
        Row: {
          bus_reference: string
          created_at: string
          filled_at: string
          id: string
          km_at_fillup: number
          liters: number
          notion_synced_at: string | null
          session_id: string | null
          user_id: string
        }
        Insert: {
          bus_reference: string
          created_at?: string
          filled_at?: string
          id?: string
          km_at_fillup: number
          liters: number
          notion_synced_at?: string | null
          session_id?: string | null
          user_id: string
        }
        Update: {
          bus_reference?: string
          created_at?: string
          filled_at?: string
          id?: string
          km_at_fillup?: number
          liters?: number
          notion_synced_at?: string | null
          session_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_fillups_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "driving_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          id: string
          kind: string
          label: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          id?: string
          kind?: string
          label?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          id?: string
          kind?: string
          label?: string | null
          user_id?: string
        }
        Relationships: []
      }
      school_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          label: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          label: string
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          label?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string
          id: string
          note: string | null
          notion_synced_at: string | null
          off_duty_at: string | null
          on_duty_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          notion_synced_at?: string | null
          off_duty_at?: string | null
          on_duty_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          notion_synced_at?: string | null
          off_duty_at?: string | null
          on_duty_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_balance_settings: {
        Row: {
          created_at: string
          starting_balance_date: string
          starting_cp_n: number
          starting_cp_n_minus_1: number
          starting_overtime_minutes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          starting_balance_date?: string
          starting_cp_n?: number
          starting_cp_n_minus_1?: number
          starting_overtime_minutes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          starting_balance_date?: string
          starting_cp_n?: number
          starting_cp_n_minus_1?: number
          starting_overtime_minutes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notion_settings: {
        Row: {
          created_at: string
          daily_totals_db_id: string | null
          distance_summary_db_id: string | null
          fuel_fillups_db_id: string | null
          services_db_id: string | null
          services_db_id_sat_hol: string | null
          services_db_id_wed: string | null
          sessions_db_id: string | null
          shifts_db_id: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_totals_db_id?: string | null
          distance_summary_db_id?: string | null
          fuel_fillups_db_id?: string | null
          services_db_id?: string | null
          services_db_id_sat_hol?: string | null
          services_db_id_wed?: string | null
          sessions_db_id?: string | null
          shifts_db_id?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_totals_db_id?: string | null
          distance_summary_db_id?: string | null
          fuel_fillups_db_id?: string | null
          services_db_id?: string | null
          services_db_id_sat_hol?: string | null
          services_db_id_wed?: string | null
          sessions_db_id?: string | null
          shifts_db_id?: string | null
          timezone?: string
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
