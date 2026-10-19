import { cn } from "@/lib/utils";

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <div className="border-b border-border pb-1.5">
        <legend className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</legend>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}
