import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";

type WithClassName<T> = T & { className?: string };

export const Accordion = AccordionPrimitive.Root;

export const AccordionItem = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Item>,
  WithClassName<AccordionPrimitive.AccordionItemProps>
>(({ className = "", ...props }, ref) => (
  <AccordionPrimitive.Item
    ref={ref}
    className={`border-b border-slate-800/40 last:border-0 ${className}`}
    {...props}
  />
));
AccordionItem.displayName = "AccordionItem";

export const AccordionTrigger = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Trigger>,
  WithClassName<AccordionPrimitive.AccordionTriggerProps>
>(({ className = "", children, ...props }, ref) => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      ref={ref}
      className={`flex flex-1 items-center justify-between py-3 text-left text-sm font-medium transition hover:text-emerald-300 focus:outline-none ${className}`}
      {...props}
    >
      {children}
      <span className="ml-2 text-xs text-slate-500">+</span>
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
));
AccordionTrigger.displayName = "AccordionTrigger";

export const AccordionContent = React.forwardRef<
  React.ElementRef<typeof AccordionPrimitive.Content>,
  WithClassName<AccordionPrimitive.AccordionContentProps>
>(({ className = "", children, ...props }, ref) => (
  <AccordionPrimitive.Content
    ref={ref}
    className={`pb-4 pt-1 text-slate-200 ${className}`}
    {...props}
  >
    <div className="pt-1">{children}</div>
  </AccordionPrimitive.Content>
));
AccordionContent.displayName = "AccordionContent";
