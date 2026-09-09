import Refusal from "../../../_ui/Refusal.tsx";

export default function FieldNotFound() {
  return (
    <Refusal title="No such field"
             body="That field is not in the catalogue for this period. The review board lists the ones that are."
             action={{ href: "/review", label: "Back to the review board" }} />
  );
}
