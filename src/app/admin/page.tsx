import { redirect } from "next/navigation";

// There is no admin login any more: every control is public. Old links to /admin land on the Overview.
export default function AdminPage() {
  redirect("/");
}
