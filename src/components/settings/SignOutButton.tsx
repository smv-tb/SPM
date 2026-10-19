"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
    >
      Sign out instead
    </button>
  );
}
