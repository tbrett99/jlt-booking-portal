// Print only the already-authorised, safely rendered agreement article. No
// surrounding profile, bank details, tokens or other Portal content is copied.
export async function printMyAgreement(article: HTMLElement) {
  const frame = document.createElement("iframe");
  frame.title = "Print your agreement record";
  frame.setAttribute("sandbox", "allow-same-origin allow-modals");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    throw new Error("Printing could not be opened. Please try again.");
  }
  doc.title = "JLT — My signed agency terms";
  const style = doc.createElement("style");
  style.textContent =
    "@page{margin:18mm}body{font:12px/1.55 Arial,sans-serif;color:#111}h1{font-size:22px}h2{font-size:16px}h3{font-size:14px}p{margin:8px 0}dl{margin:12px 0}dt{font-weight:bold}dd{margin:0 0 9px}img{max-width:100%;max-height:120px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#111}details{display:block}summary{font-weight:bold}button{display:none}";
  doc.head.appendChild(style);
  const copy = doc.importNode(article, true);
  copy.querySelectorAll("details").forEach(item => {
    item.open = true;
  });
  doc.body.appendChild(copy);
  const images = Array.from(doc.images);
  await Promise.all(
    images.map(image =>
      image.complete
        ? Promise.resolve()
        : new Promise<void>(resolve => {
            const timer = window.setTimeout(resolve, 4000);
            const done = () => {
              window.clearTimeout(timer);
              resolve();
            };
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
          })
    )
  );
  const cleanup = () => {
    window.clearTimeout(timer);
    frame.remove();
  };
  const timer = window.setTimeout(cleanup, 120_000);
  win.addEventListener("afterprint", cleanup, { once: true });
  try {
    win.focus();
    win.print();
  } catch {
    cleanup();
    throw new Error("Printing could not be opened. Please try again.");
  }
}
