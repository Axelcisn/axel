// app/company/[ticker]/page.tsx
import Link from "next/link";

export default function CompanyHub({ params }: { params: { ticker: string }}) {
  const t = params.ticker.toUpperCase();
  const Card = ({ title, href, disabled=false }: { title: string; href: string; disabled?: boolean }) => (
    <Link aria-disabled={disabled} href={disabled ? "#" : href}
      className={`p-8 rounded-2xl border transition ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50"}`}>
      <div className="text-2xl font-semibold">{title}</div>
    </Link>
  );

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="text-sm text-gray-500 mb-2">Search › {t}</div>
      <h1 className="text-3xl font-bold mb-6">{t}</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Data" href={`/company/${t}/data`} />
        <Card title="Analysis" href="#" disabled />
        <Card title="Results" href="#" disabled />
      </div>
    </div>
  );
}