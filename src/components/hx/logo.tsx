export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={"flex items-center gap-2 " + className}>
      <div className="relative flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono font-bold">
        <span className="text-sm leading-none">Hx</span>
      </div>
      <span className="text-lg font-semibold tracking-tight">HosteraX</span>
    </div>
  );
}
