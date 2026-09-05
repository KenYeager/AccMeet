"use client";

import { useCallback, useEffect, useState } from "react";
import { getUserId, getUserName, setUserName as persistUserName } from "@/lib/identity";

export function useIdentity() {
  const [userId, setUserId] = useState("");
  const [userName, setUserNameState] = useState("");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setUserId(getUserId());
    setUserNameState(getUserName());
    setIsReady(true);
  }, []);

  const setUserName = useCallback((name: string) => {
    setUserNameState(persistUserName(name));
  }, []);

  return { userId, userName, setUserName, isReady };
}
