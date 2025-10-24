import { customAlphabet } from "nanoid";

const slugAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const slugGenerator = customAlphabet(slugAlphabet, 12);

export function generateShareSlug() {
  return slugGenerator();
}

export function formatDate(date: string | Date | null | undefined) {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
