import { redirect } from "next/navigation";

import { getAuthSession } from "~/auth/server";

export default async function HomePage() {
  const session = await getAuthSession();

  redirect(session ? "/dashboard" : "/login");
}
