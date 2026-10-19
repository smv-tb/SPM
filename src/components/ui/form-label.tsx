import { cn } from "@/lib/utils";

interface FormLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode;
}

export function FormLabel({ className, children, ...props }: FormLabelProps) {
  return (
    <label
      className={cn("text-xs font-medium text-muted-foreground mb-1 block", className)}
      {...props}
    >
      {children}
    </label>
  );
}
