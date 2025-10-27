import type { BookmarkDocument } from "../bookmarks";

export type Database = {
  public: {
    Tables: {
      bookmark_collections: {
        Row: {
          id: string;
          user_id: string;
          data: BookmarkDocument | null;
          share_slug: string | null;
          title: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          data: BookmarkDocument;
          share_slug: string;
          title?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          data?: BookmarkDocument;
          share_slug?: string | null;
          title?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookmark_collections_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      share_sites: {
        Row: {
          id: string;
          user_id: string;
          collection_id: string;
          name: string;
          share_slug: string;
          folder_ids: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          collection_id: string;
          name: string;
          share_slug: string;
          folder_ids: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          collection_id?: string;
          name?: string;
          share_slug?: string;
          folder_ids?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "share_sites_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "share_sites_collection_id_fkey";
            columns: ["collection_id"];
            referencedRelation: "bookmark_collections";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: never;
    Functions: never;
    Enums: never;
    CompositeTypes: never;
  };
};
