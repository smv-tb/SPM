"use client";

import { createContext, useContext } from "react";

export interface FrameUser {
  name: string;
  roleLabel: string;
  /** Organisation name for the breadcrumb root. */
  orgName: string;
}

const UserContext = createContext<FrameUser | null>(null);

export function FrameUserProvider({ value, children }: { value: FrameUser; children: React.ReactNode }) {
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useFrameUser(): FrameUser | null {
  return useContext(UserContext);
}
