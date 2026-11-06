import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'flex h-7 items-center justify-between gap-1 rounded-md border border-zinc-700 bg-zinc-900/70 px-2 text-xs text-zinc-200 outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 data-[placeholder]:text-zinc-500',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          'z-50 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 text-zinc-200 shadow-xl',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'min-w-[var(--radix-select-trigger-width)]',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

// `trailing` renders after the label but outside ItemText, so it shows in the
// list without being copied into the closed trigger.
function SelectItem({
  className,
  children,
  trailing,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item> & { trailing?: ReactNode }) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex cursor-pointer select-none items-center whitespace-nowrap rounded-sm py-1.5 pl-7 pr-2 text-xs outline-none focus:bg-zinc-800 data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex items-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {trailing}
    </SelectPrimitive.Item>
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
};
