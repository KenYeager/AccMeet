"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getUserId,
  getUserName,
  setUserName as persistUserName,
  getIsPatientDevice,
  setIsPatientDevice as persistIsPatientDevice,
} from "@/lib/identity";

/**
 * Reads/writes the guest identity from localStorage. `isReady` guards the
 * brief window before the client-side effect runs (localStorage isn't
 * available during SSR), so callers can show a loading state instead of
 * flashing the name-entry prompt.
 */
export function useIdentity() {
  const [userId, setUserId] = useState("");
  const [userName, setUserNameState] = useState("");
  const [isPatientDevice, setIsPatientDeviceState] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setUserId(getUserId());
    setUserNameState(getUserName());
    setIsPatientDeviceState(getIsPatientDevice());
    setIsReady(true);
  }, []);

  const setUserName = useCallback((name: string) => {
    setUserNameState(persistUserName(name));
  }, []);

  const setIsPatientDevice = useCallback((value: boolean) => {
    persistIsPatientDevice(value);
    setIsPatientDeviceState(value);
  }, []);

  return { userId, userName, setUserName, isPatientDevice, setIsPatientDevice, isReady };
}
