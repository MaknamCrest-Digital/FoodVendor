# Version 1 UI design system

The application remains version 1.0.0. This visual update retains every existing route,
business workflow, persistence contract and printer/sync integration.

## Shared Tailwind theme

`apps/pos/app/globals.css` defines the Tailwind theme and the equivalent CSS variables:

| Token | Value | Use |
| --- | --- | --- |
| `brand-bg` | `#E9F5F6` | Application background |
| `brand-surface` | `#FFFFFF` | Cards, navigation, cart, forms |
| `brand-primary` | `#0F586E` | Primary actions, selected navigation, focus |
| `brand-border` | `#ABCAEC` | Subtle borders and separators |
| `brand-text-main` | `#122134` | Main content and metrics |
| `brand-text-muted` | `#75848C` | Labels and supporting text |
| `rounded-card` | `24px` | Product/metric cards, tables, dialogs |
| `rounded-input` | `12px` | Inputs and buttons |
| `shadow-card`, `shadow-soft` | Subtle neutral shadows | Surface separation |

Use the shared tokens, not independent module palettes. Semantic success/warning/danger
colors represent actual states. Payment choices all use the same teal selection style.
The demo printer uses an information badge, never a false connected status. Product cards
say "On menu" because the current demo has no stock-availability source.

## Reusable presentation

`components/ui/primitives.tsx` provides Button, Card, MetricCard, StatusBadge, Input,
DataTable, EmptyState and PageHeader. `SystemStatus.tsx` provides SyncStatus and PrinterStatus.
Existing receipt-dialog behavior is retained with shared surface and button styles.
Use these components in future module implementations instead of copying class strings.

The sales table supplies real table headings, comfortable rows, status badges and a
contained horizontal scroll area on small screens. Inputs are at least 44px high; primary
checkout is 56px high. POS retains its tablet landscape columns and existing responsive
breakpoints. All focus indicators use the primary color.

Dashboard, Kitchen and other planned modules retain their existing planned pages with
shared page/empty-state styling. This visual task does not invent metrics, stock state,
kitchen tickets, new workflows or additional operational screens.
