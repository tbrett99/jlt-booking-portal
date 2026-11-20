import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import { academyPdfViewerUrl, type AcademyPdfResource } from "@shared/academy-pdf";

type Props = AcademyPdfResource & { attachmentName?: string | null; title: string; locked?: boolean };

function PdfPreview({ source, title }: { source: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const unsupported = typeof navigator !== "undefined" && navigator.pdfViewerEnabled === false;
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const reportFailure = () => setFailed(true);
    element.addEventListener("error", reportFailure);
    return () => element.removeEventListener("error", reportFailure);
  }, [source, unsupported]);
  if (failed || unsupported) return <p className="border-t px-4 py-5 text-sm text-muted-foreground" role="status">This browser cannot display the PDF here. Use Open or download PDF above.</p>;
  return <>
    <iframe
      ref={frame}
      src={source}
      title={`PDF: ${title}`}
      className="block h-[65vh] min-h-[360px] max-h-[760px] w-full border-0 bg-muted sm:h-[75vh]"
      referrerPolicy="no-referrer"
    />
    <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground">If the PDF is blank or does not display correctly, use Open or download PDF above. Your browser controls PDF viewing and saving.</p>
  </>;
}

export function AcademyLessonResource(props: Props) {
  if (props.locked || !props.attachmentUrl) return null;
  // Never turn dangerous protocols or malformed legacy values into a link/frame.
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(props.attachmentUrl);
    if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) return null;
  } catch { return null; }
  const preview = academyPdfViewerUrl(props);
  const name = props.attachmentName || "Lesson resource";
  if (!preview) return <a href={downloadUrl.href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4 transition hover:bg-muted"><span className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-card text-primary shadow-sm"><FileText size={20} /></span><span className="min-w-0"><span className="block break-words font-semibold">{name}</span><span className="mt-0.5 block text-xs text-muted-foreground">Open or save your copy</span></span></span><Download size={18} className="shrink-0" /></a>;
  return <section aria-label={`Lesson PDF: ${name}`} className="overflow-hidden rounded-xl border bg-muted/20">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2 font-semibold"><FileText size={18} className="shrink-0 text-primary" /><span className="break-words">{name}</span></span>
      <a href={downloadUrl.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open or download PDF <ExternalLink size={13} /></a>
    </div>
    <PdfPreview key={preview} source={preview} title={name} />
  </section>;
}
