// Decide whether an encyclopedia page is the SAME PERSON as a guest in our database. A wrong face on a real person is a
// worse failure than showing initials, so every test must pass: the page title must be the person's name, it must be a
// person (not a disambiguation page), and the page text must agree with the company or role we hold for them.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const PERSON_WORDS = /\b(founder|co-founder|entrepreneur|investor|venture capitalist|businessman|businesswoman|business executive|executive|chief executive|ceo|chairman|chairperson|author|economist|journalist|producer|actor|actress|writer|professor|comedian|youtuber|podcaster|politician|investor|banker|engineer|scientist|cricketer|athlete|filmmaker|director|psychologist|speaker|philanthropist)\b/i;
const STOP = new Set(["and", "the", "of", "at", "for", "inc", "ltd", "pvt", "limited", "private", "co", "company", "group", "capital", "ventures", "venture", "partners", "india", "global", "technologies", "labs", "ai"]);

export type WikiPage = { title: string; description?: string; extract?: string; thumbnail?: string; disambiguation?: boolean };

export function isSamePerson(guest: { name: string; company?: string | null; role?: string | null }, page: WikiPage): { ok: boolean; why: string } {
  if (!page.thumbnail) return { ok: false, why: "page has no image" };
  if (page.disambiguation) return { ok: false, why: "disambiguation page" };
  const gt = norm(guest.name).split(" ").filter(Boolean);
  const pt = norm(page.title.replace(/\(.*?\)/g, "")).split(" ").filter(Boolean);
  if (gt.length < 2) return { ok: false, why: "single-word name" };
  // same first and last name (middle names may differ)
  if (gt[0] !== pt[0] || gt[gt.length - 1] !== pt[pt.length - 1]) return { ok: false, why: "title does not match the name" };
  const text = `${page.description ?? ""} ${page.extract ?? ""}`;
  if (!PERSON_WORDS.test(text)) return { ok: false, why: "page does not describe a person's occupation" };
  const hay = norm(text);
  const hayWords = new Set(hay.split(" "));
  const companyTokens = norm(guest.company ?? "").split(" ").filter((t) => t.length > 2 && !STOP.has(t));
  if (companyTokens.length && companyTokens.some((t) => hayWords.has(t))) return { ok: true, why: "name and company agree" };
  const roleTokens = norm(guest.role ?? "").split(" ").filter((t) => t.length > 3 && !STOP.has(t));
  if (roleTokens.length && roleTokens.some((t) => hayWords.has(t))) return { ok: true, why: "name and role agree" };
  return { ok: false, why: "company/role not confirmed by the page" };
}

export function initials(name: string): string {
  const w = name.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase() || "?";
}
