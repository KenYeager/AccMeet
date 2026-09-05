"use client";

import { useCallback, useEffect, useState } from "react";
import { getUserId, getUserName, setUserName as persistUserName, getIsDeaf, setIsDeaf as persistIsDeaf } from "@/lib/identity";

export function useIdentity() {
  const [userId, setUserId] = useState("");
  const [userName, setUserNameState] = useState("");
  const [isDeaf, setIsDeafState] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setUserId(getUserId());
    setUserNameState(getUserName());
    setIsDeafState(getIsDeaf());
    setIsReady(true);
  }, []);

  const setUserName = useCallback((name: string) => {
    setUserNameState(persistUserName(name));
  }, []);

  const setIsDeaf = useCallback((deaf: boolean) => {
    setIsDeafState(persistIsDeaf(deaf));
  }, []);

  return { userId, userName, setUserName, isDeaf, setIsDeaf, isReady };
}

