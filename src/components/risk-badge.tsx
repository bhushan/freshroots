import type { ReviewStatus } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { ACTION_LABELS, type ActionCode, type FlagCode } from "@/lib/rules/engine";
import { ACTION_STYLES, FLAG_LABELS, FLAG_STYLES, STATUS_LABELS, STATUS_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

const tag = "h-[22px] rounded-[4px] bg-transparent px-2 text-xs font-medium tracking-[-0.1px]";

export function FlagBadge({ code, className }: { code: FlagCode; className?: string }) {
  return (
    <Badge variant="outline" className={cn(tag, FLAG_STYLES[code], className)}>
      {FLAG_LABELS[code]}
    </Badge>
  );
}

export function StatusBadge({ status, className }: { status: ReviewStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(tag, STATUS_STYLES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function ActionText({ action, className }: { action: ActionCode; className?: string }) {
  return <span className={cn("font-medium", ACTION_STYLES[action], className)}>{ACTION_LABELS[action]}</span>;
}
