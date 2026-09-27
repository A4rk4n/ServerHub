import { NewServerWizard } from "@/components/new-server-wizard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Deploy a server — Server Hub" };

export default function NewServerPage() {
  return <NewServerWizard />;
}
