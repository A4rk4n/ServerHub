import { AuditTrailView } from "@/components/audit-trail-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit Trail — Server Hub" };

export default function AuditPage() {
  return <AuditTrailView />;
}
