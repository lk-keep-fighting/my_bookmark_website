import { Parser } from "htmlparser2";
import { randomUUID } from "node:crypto";
import { BookmarkDocument, BookmarkNode } from "./types";
import { calculateBookmarkStatistics } from "./statistics";

type CurrentTarget =
  | {
      kind: "folder" | "bookmark";
      node: BookmarkNode;
    }
  | {
      kind: "description";
      node: BookmarkNode;
    }
  | null;

const GENERATOR = "bookmark-saas";

export function parseBookmarksHtml(html: string, source = "import"): BookmarkDocument {
  const root: BookmarkNode = {
    type: "folder",
    name: "All bookmarks",
    id: randomUUID().replace(/-/g, ""),
    children: [],
  };

  const stack: BookmarkNode[] = [root];
  let pendingFolder: BookmarkNode | null = null;
  let currentTarget: CurrentTarget = null;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const tag = name.toLowerCase();
        const attrs = Object.fromEntries(
          Object.entries(attribs).map(([key, value]) => [key.toLowerCase(), value ?? ""]),
        );

        if (tag === "dl") {
          if (pendingFolder) {
            const parent = stack[stack.length - 1];
            if (!parent.children) parent.children = [];
            parent.children.push(pendingFolder);
            stack.push(pendingFolder);
            pendingFolder = null;
          }
          return;
        }

        if (tag === "dt") {
          currentTarget = null;
          return;
        }

        if (tag === "h1") {
          currentTarget = { kind: "folder", node: root };
          return;
        }

        if (tag === "h3") {
          pendingFolder = {
            type: "folder",
            name: "",
            id: randomUUID().replace(/-/g, ""),
            children: [],
            add_date: attrs["add_date"],
            last_modified: attrs["last_modified"],
          };
          if (attrs["personal_toolbar_folder"] === "true") {
            pendingFolder.tags = ["toolbar"];
          }
          currentTarget = { kind: "folder", node: pendingFolder };
          return;
        }

        if (tag === "a") {
          const bookmark: BookmarkNode = {
            type: "bookmark",
            name: "",
            id: randomUUID().replace(/-/g, ""),
            url: attrs["href"] ?? "",
            add_date: attrs["add_date"],
            last_modified: attrs["last_modified"],
            icon: attrs["icon"] ?? attrs["icon_uri"],
          };
          const tags = attrs["tags"];
          if (tags) {
            bookmark.tags = tags
              .split(",")
              .map((tagItem) => tagItem.trim())
              .filter(Boolean);
          }
          const parent = stack[stack.length - 1];
          if (!parent.children) parent.children = [];
          parent.children.push(bookmark);
          currentTarget = { kind: "bookmark", node: bookmark };
          return;
        }

        if (tag === "dd") {
          const parent = stack[stack.length - 1];
          const lastChild = parent.children?.[parent.children.length - 1];
          if (lastChild) {
            currentTarget = { kind: "description", node: lastChild };
          }
          return;
        }

        currentTarget = null;
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (tag === "dl") {
          if (stack.length > 1) {
            stack.pop();
          }
          return;
        }

        if (["h1", "h3", "a", "dd"].includes(tag)) {
          currentTarget = null;
        }
      },
      ontext(text) {
        if (!currentTarget) return;
        const trimmed = text.trim();
        if (!trimmed) return;

        if (currentTarget.kind === "description") {
          const existing = currentTarget.node.description ?? "";
          currentTarget.node.description = existing ? `${existing}\n${trimmed}` : trimmed;
          return;
        }

        const name = currentTarget.node.name ? `${currentTarget.node.name} ${trimmed}` : trimmed;
        currentTarget.node.name = name.trim();
      },
    },
    { decodeEntities: true },
  );

  parser.write(html);
  parser.end();

  const statistics = calculateBookmarkStatistics(root);

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source,
    generator: GENERATOR,
    statistics,
    root,
  };
}
