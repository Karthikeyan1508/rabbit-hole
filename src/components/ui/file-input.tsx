"use client";
import { useRef, useState } from "react";
import { Button } from "./button";

/** Styled file picker: a normal button plus the chosen filename, instead of the browser's default control. */
export function FileInput({ accept, onFile, label = "Choose file" }: { accept: string; onFile: (file: File) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  return (
    <div className="file-row">
      <Button onClick={() => ref.current?.click()}>{label}</Button>
      <span className="file-name">{name || "No file chosen"}</span>
      <input ref={ref} type="file" accept={accept} hidden
        onChange={e => { const f = e.target.files?.[0]; if (f) { setName(f.name); onFile(f); } e.target.value = ""; }} />
    </div>
  );
}
