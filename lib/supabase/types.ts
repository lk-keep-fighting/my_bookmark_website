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
    };
    Views: never;
    Functions: never;
    Enums: never;
    CompositeTypes: never;
  };
};
