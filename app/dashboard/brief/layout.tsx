export default function BriefLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative mx-auto w-full max-w-5xl px-8">{children}</div>
  );
}
