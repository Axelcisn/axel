import LayoutContainer from '@/components/LayoutContainer';
import PortfolioClient from './PortfolioClient';
import { fetchPortfolioData } from '@/lib/portfolio/data';

export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  const initialData = await fetchPortfolioData('positions');

  return (
    <main className="min-h-screen bg-[#0d0d0d] pb-10">
      <LayoutContainer className="pt-8 text-white">
        <div className="mb-4">
          <h1 className="text-3xl font-semibold text-white">Portfolio</h1>
        </div>
        <PortfolioClient initialData={initialData} />
      </LayoutContainer>
    </main>
  );
}
