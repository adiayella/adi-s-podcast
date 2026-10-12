import { redirect } from "next/navigation";

// Podcast management now lives in the Research Control Center (Focused Research tab).
export default function ManagePodcastsPage() {
  redirect("/research?tab=focused");
}
