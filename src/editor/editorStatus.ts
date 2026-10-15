/** A visible, screen-reader-announced message that does not steal editor focus. */
export function announceEditorStatus(doc: Document, message: string): void {
  let status = doc.querySelector<HTMLElement>(".mlrt-clipboard-status");
  if (!status) {
    status = doc.createElement("div");
    status.className = "mlrt-clipboard-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    doc.body.append(status);
  }
  status.textContent = "";
  const element = status;
  doc.defaultView?.requestAnimationFrame(() => {
    element.textContent = message;
    element.dataset.visible = "true";
    doc.defaultView?.setTimeout(() => {
      if (element.textContent === message) delete element.dataset.visible;
    }, 5000);
  });
}
