import "server-only";
import { getPlanningProvider } from "@/lib/planning/provider";
import { PlanningForm } from "./planning-form";

export function PlanningComposer(props: { productId: string; revisionId: string; requestId: string }) {
  const provider = getPlanningProvider();
  const fixture = provider?.generator.id === "fixture-not-ai";
  return <>
    <p role="note">{!provider ? "Generation unavailable: ask the operator to configure a planning provider." : fixture
      ? "Fixture preview — canned development data, not AI generation. Your brief does not change this fixture."
      : provider.generator.id === "live-chat-completions"
        ? `Live AI generation · ${provider.generator.version}. Operator-estimated cost per request including repairs: $${Number(process.env.PLANNING_LIVE_EXPECTED_REQUEST_COST_USD).toFixed(4)} USD. This estimate is not a billing cap.`
        : "Local planning transport — generation depends on the configured local provider."}</p>
    <PlanningForm {...props} />
  </>;
}
