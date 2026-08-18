export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={"flex items-center gap-2.5 " + className}>
      <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-[#a3e635] text-zinc-950 font-sans font-extrabold shadow-sm transition-transform hover:scale-105">
        <span className="text-xs leading-none tracking-tight">Hx</span>
      </div>
      <span className="text-lg font-bold tracking-tight text-foreground font-sans">HosteraX</span>
    </div>
  );
}
