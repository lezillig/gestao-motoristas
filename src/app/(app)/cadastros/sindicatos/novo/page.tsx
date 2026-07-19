import PageHeader from "@/components/ui/PageHeader";
import { cardClass } from "@/lib/ui";
import SindicatoForm from "../SindicatoForm";
import { createSindicato } from "../actions";

export default function NovoSindicatoPage() {
  return (
    <div className="max-w-lg">
      <PageHeader title="Novo sindicato" />
      <div className={cardClass}>
        <SindicatoForm action={createSindicato} />
      </div>
    </div>
  );
}
