import { Suspense } from "react";
import { SearchView } from "@/components/search-view";

export const dynamic = "force-dynamic";

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchView />
    </Suspense>
  );
}
