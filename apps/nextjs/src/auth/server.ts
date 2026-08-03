import "server-only";

import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";

export interface AppSession {
  user: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

function getDisplayName(user: Awaited<ReturnType<typeof currentUser>>) {
  if (!user) {
    return "Unknown user";
  }

  return (
    user.fullName ??
    user.primaryEmailAddress?.emailAddress ??
    user.username ??
    "Unknown user"
  );
}

export const getAuthSession = cache(async (): Promise<AppSession | null> => {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  return {
    user: {
      id: userId,
      name: null,
      email: null,
    },
  };
});

export const getSession = cache(async (): Promise<AppSession | null> => {
  const authSession = await getAuthSession();

  if (!authSession) {
    return null;
  }

  const user = await currentUser();

  return {
    user: {
      id: authSession.user.id,
      name: getDisplayName(user),
      email: user?.primaryEmailAddress?.emailAddress ?? null,
    },
  };
});
