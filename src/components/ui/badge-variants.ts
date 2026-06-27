import { cva } from 'class-variance-authority';

// Kept in its own file so badge.tsx exports only a component (Fast Refresh /
// react-refresh/only-export-components).
export const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium leading-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-zinc-700 text-zinc-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
