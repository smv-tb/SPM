"use client";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
}

const variantClasses = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-input bg-transparent hover:bg-accent text-primary",
  ghost: "bg-transparent hover:bg-accent text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

const sizeClasses = {
  sm: "h-9 min-w-6 px-4 text-sm",
  md: "h-10 px-6 text-sm",
  lg: "h-11 px-8 text-sm",
};

export function Button({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
