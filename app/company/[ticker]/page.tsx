import { redirect } from "next/navigation";

export default function CompanyIndex({ params }: { params: { ticker: string } }) {
  redirect(`/company/${params.ticker}/timing`);
}