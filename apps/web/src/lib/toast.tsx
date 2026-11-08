import { CircleCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import { toast, Toaster as SonnerToaster } from "sonner";

/**
 * Nool's own toast card, drawn headless so it carries the palette instead of Sonner's default look.
 * Sonner still does the placing, stacking, timing and swipe to dismiss.
 */
function SuccessCard({ id, title, description }: { id: string | number; title: string; description?: ReactNode }) {
  return (
    <div className="toast" role="status">
      <span className="toast-icon" aria-hidden="true">
        <CircleCheck size={18} strokeWidth={2.4} />
      </span>
      <div className="toast-text">
        <p className="toast-title">{title}</p>
        {description && <p className="toast-description">{description}</p>}
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => toast.dismiss(id)}>
        <X size={15} aria-hidden="true" />
      </button>
      <span className="toast-thread" aria-hidden="true" />
    </div>
  );
}

export const notify = {
  success(title: string, description?: ReactNode) {
    return toast.custom((id) => <SuccessCard id={id} title={title} description={description} />, { duration: 4000 });
  },
};

/** Mounted once, in the merchandiser shell. */
export function Toaster() {
  return <SonnerToaster position="bottom-right" offset={24} mobileOffset={16} gap={10} visibleToasts={3} />;
}
