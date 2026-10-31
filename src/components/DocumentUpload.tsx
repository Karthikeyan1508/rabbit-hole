"use client";
import { useState } from "react";
import { api } from "./api";
import { Button } from "./ui/button";
import { FileInput } from "./ui/file-input";

/** Collapsible form: paste text, or pick a .txt / .md / .pdf file, then run it through the same extract-and-verify pipeline as a web page.
 *  Text files are read in the browser and stay editable; a PDF is sent as-is and its text is extracted on the server. */
export function DocumentUpload({ invId, busy, onStarted, onError }: {
  invId: string; busy: boolean; onStarted: (expansionId: string) => void; onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);

  async function pick(f: File) {
    setTitle(t => t || f.name.replace(/\.(pdf|txt|md)$/i, ""));
    if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") { setPdf(f); setText(""); } else { setPdf(null); setText(await f.text()); }
  }

  async function submit() {
    try {
      let body: BodyInit;
      if (pdf) { const f = new FormData(); f.set("title", title); f.set("file", pdf); body = f; } else body = JSON.stringify({ title, text });
      const r = await api(`/investigations/${invId}/documents`, { method: "POST", body });
      setTitle(""); setText(""); setPdf(null); setOpen(false); onStarted(r.expansionId);
    } catch (e: any) { onError(e.message); }
  }

  if (!open) return <Button full onClick={() => setOpen(true)}>Add a document</Button>;
  return (
    <div className="stack">
      <input placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
      {pdf
        ? <p className="muted small">PDF ready ({Math.round(pdf.size / 1024)} KB). Its text is read when you analyze it.</p>
        : <textarea rows={4} placeholder="Paste text from a memo, article or report…" value={text} onChange={e => setText(e.target.value)} />}
      <FileInput accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onFile={pick} />
      <div className="btn-row">
        <Button variant="primary" disabled={busy || !title.trim() || (!pdf && text.trim().length < 50)} onClick={submit}>Analyze</Button>
        <Button onClick={() => { setOpen(false); setPdf(null); }}>Cancel</Button>
      </div>
    </div>
  );
}
