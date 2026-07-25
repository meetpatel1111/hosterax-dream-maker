import { useState } from "react";

export function useEngine() {
  const [url, setUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem("hx.url") || "http://localhost:7777";
    }
    return "http://localhost:7777";
  });
  
  const [token, setToken] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem("hx.token") || "";
    }
    return "";
  });
  
  const save = (u: string, t: string) => { 
    if (typeof window !== 'undefined') {
      localStorage.setItem("hx.url", u); 
      localStorage.setItem("hx.token", t); 
    }
    setUrl(u); 
    setToken(t); 
  };
  
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await fetch(url + path, {
      method, 
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let err;
      try { err = await r.json(); } catch { err = await r.text(); }
      throw new Error(err.error || err || "API Error");
    }
    return r.json();
  };
  
  return { url, token, save, call };
}
